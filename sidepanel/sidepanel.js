/**
 * 侧边栏主逻辑
 * 负责 UI 渲染、事件处理、与 Service Worker 通信
 */

import { initStorage, getAllNotes, getNoteById, createNote, updateNote, deleteNote,
         searchNotes, getAllCategories, getCategoryById, createCategory, updateCategory,
         deleteCategory, getSettings, updateSettings } from '../lib/storage.js';
import { formatDate, escapeHtml, truncate, normalizeTags, debounce } from '../lib/utils.js';
import { exportNotes } from '../lib/export.js';

// ===================== DOM 引用缓存 =====================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const DOM = {
  // 工具栏
  searchInput: $('#searchInput'),
  exportSelect: $('#exportSelect'),
  settingsBtn: $('#settingsBtn'),
  extractPageBtn: $('#extractPageBtn'),
  summarizePageBtn: $('#summarizePageBtn'),
  quickUrlBtn: $('#quickUrlBtn'),
  quickSelectionBtn: $('#quickSelectionBtn'),
  pageStatus: $('#pageStatus'),
  pageStatusIcon: $('#pageStatusIcon'),
  pageStatusTitle: $('#pageStatusTitle'),
  pageStatusDetail: $('#pageStatusDetail'),

  // 筛选栏
  categoryFilter: $('#categoryFilter'),
  sortOrder: $('#sortOrder'),
  newNoteBtn: $('#newNoteBtn'),

  // 笔记列表
  noteList: $('#noteList'),
  emptyState: $('#emptyState'),

  // 编辑器
  editorPanel: $('#editorPanel'),
  backToListBtn: $('#backToListBtn'),
  saveNoteBtn: $('#saveNoteBtn'),
  previewSummaryPayloadBtn: $('#previewSummaryPayloadBtn'),
  insertSummaryBtn: $('#insertSummaryBtn'),
  summarizeNoteBtn: $('#summarizeNoteBtn'),
  cancelSummaryBtn: $('#cancelSummaryBtn'),
  noteTitle: $('#noteTitle'),
  noteCategory: $('#noteCategory'),
  noteTags: $('#noteTags'),
  noteContent: $('#noteContent'),
  noteQualityWarnings: $('#noteQualityWarnings'),
  noteSummary: $('#noteSummary'),
  notePinned: $('#notePinned'),
  noteSource: $('#noteSource'),
  sourceLink: $('#sourceLink'),
  charCount: $('#charCount'),
  autoSaveIndicator: $('#autoSaveIndicator'),

  // 设置面板
  settingsPanel: $('#settingsPanel'),
  closeSettingsBtn: $('#closeSettingsBtn'),
  saveSettingsBtn: $('#saveSettingsBtn'),
  llmEnabled: $('#llmEnabled'),
  llmEndpoint: $('#llmEndpoint'),
  llmApiKey: $('#llmApiKey'),
  llmModel: $('#llmModel'),
  toggleApiKeyVisibility: $('#toggleApiKeyVisibility'),
  themeSelect: $('#themeSelect'),
  fontSizeRange: $('#fontSizeRange'),
  defaultCategorySelect: $('#defaultCategorySelect'),
  categoryManager: $('#categoryManager'),
  newCategoryName: $('#newCategoryName'),
  newCategoryColor: $('#newCategoryColor'),
  addCategoryBtn: $('#addCategoryBtn'),
  summaryLengthSelect: $('#summaryLengthSelect'),
  autoSummarizeCheck: $('#autoSummarizeCheck')
};

// ===================== 状态管理 =====================
const state = {
  currentView: 'list',          // 'list' | 'editor' | 'settings'
  editingNoteId: null,         // 正在编辑的笔记 ID（null = 新建模式）
  activeNoteId: null,          // 列表中高亮的笔记 ID
  searchQuery: '',
  categoryFilter: '',
  sortOrder: 'newest',
  settings: {},
  currentTab: null,
  pageAccess: 'unknown',
  pageStatusHoldUntil: 0,
  pageStatusHoldTabId: null,
  activeSummaryRequestId: null,
  activeSummaryNoteId: null,
  cancelledSummaryRequests: new Set()
};

const CATEGORY_COLOR_PRESETS = [
  '#4A90D9',
  '#7B61FF',
  '#2ECC71',
  '#F39C12',
  '#E84393',
  '#00A8A8',
  '#95A5A6'
];

const LLM_CONTENT_LIMIT = 8000;
const PREVIEW_CONTENT_LIMIT = 1200;
const CLOUD_SUMMARY_TOTAL_TIMEOUT = 45000;
const CHROME_SUMMARIZER_TIMEOUT = 20000;

function showStartupError(err) {
  console.error('[SidePanel] 初始化失败:', err);

  const message = err && err.message ? err.message : String(err || '未知错误');
  const app = document.querySelector('#app');
  if (app && !app.textContent.trim()) {
    app.innerHTML = `
      <div style="padding:16px;font-family:system-ui,sans-serif;color:#212529;">
        <h3 style="margin:0 0 8px;">侧边栏初始化失败</h3>
        <p style="margin:0 0 8px;">请刷新扩展后重新打开侧边栏。</p>
        <pre style="white-space:pre-wrap;font-size:12px;color:#666;">${escapeHtml(message)}</pre>
      </div>
    `;
  }

  showToast('初始化失败，请刷新侧边栏', 'error');
}

// ===================== 初始化 =====================
async function init() {
  try {
    // 初始化存储层（从 chrome.storage.local 加载数据）
    await initStorage();

    // 加载设置
    state.settings = getSettings();

    // 应用主题
    applyTheme(state.settings.theme || 'light');

    // 应用字号
    applyFontSize(state.settings.fontSize || 14);

    // 渲染分类选项
    renderCategoryOptions();
    renderCategoryManager();

    // 渲染笔记列表
    renderNoteList();

    // 绑定事件
    bindEvents();

    // 缓存当前活动标签页，用于在按钮点击手势内请求站点权限。
    // 不阻塞 UI 初始化，避免浏览器侧边栏权限/窗口状态异常时造成白屏。
    refreshCurrentTabInfo({ force: true });
    setInterval(refreshCurrentTabInfo, 2000);

    // 恢复上次的导出格式选择
    if (state.settings.exportFormat) {
      DOM.exportSelect.value = state.settings.exportFormat;
    }

    console.log('[SidePanel] 初始化完成');
  } catch (err) {
    showStartupError(err);
  }
}

// ===================== 主题与外观 =====================
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  if (DOM.themeSelect) DOM.themeSelect.value = theme;
}

function applyFontSize(size) {
  document.documentElement.style.setProperty('--font-size-base', size + 'px');
  if (DOM.fontSizeRange) DOM.fontSizeRange.value = size;
}

// ===================== 当前网页状态 =====================
function getPageStatusIcon(type) {
  const icons = {
    info: 'i',
    success: '✓',
    warning: '!',
    error: '!'
  };
  return icons[type] || 'i';
}

function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (err) {
    return '';
  }
}

function setActionButtonsEnabled(enabled) {
  [DOM.extractPageBtn, DOM.summarizePageBtn, DOM.quickUrlBtn, DOM.quickSelectionBtn].forEach(btn => {
    if (!btn) return;
    const disabled = !enabled || !!state.activeSummaryRequestId;
    btn.disabled = disabled;
    btn.setAttribute('aria-disabled', String(disabled));
  });

  const title = enabled ? '' : '请先在目标网页点击扩展图标打开侧边栏';
  if (DOM.extractPageBtn) DOM.extractPageBtn.title = title;
  if (DOM.summarizePageBtn) DOM.summarizePageBtn.title = title;
  if (DOM.quickUrlBtn) DOM.quickUrlBtn.title = title;
  if (DOM.quickSelectionBtn) DOM.quickSelectionBtn.title = title;
}

function setPageStatus(type, title, detail = '', options = {}) {
  if (!DOM.pageStatus) return;

  const statusType = type || 'info';
  DOM.pageStatus.className = `page-status ${statusType}`;
  DOM.pageStatus.title = [title, detail].filter(Boolean).join('\n');

  if (DOM.pageStatusIcon) DOM.pageStatusIcon.textContent = getPageStatusIcon(statusType);
  if (DOM.pageStatusTitle) DOM.pageStatusTitle.textContent = title || '';
  if (DOM.pageStatusDetail) DOM.pageStatusDetail.textContent = detail || '';

  if (options.holdFor) {
    state.pageStatusHoldUntil = Date.now() + options.holdFor;
    state.pageStatusHoldTabId = options.tabId || state.currentTab?.id || null;
  } else if (options.clearHold) {
    state.pageStatusHoldUntil = 0;
    state.pageStatusHoldTabId = null;
  }
}

function shouldKeepHeldPageStatus(tab) {
  return state.pageStatusHoldUntil > Date.now() &&
    state.pageStatusHoldTabId &&
    tab &&
    tab.id === state.pageStatusHoldTabId;
}

function updatePageStatusFromTab(tab, options = {}) {
  if (!options.force && shouldKeepHeldPageStatus(tab)) {
    setActionButtonsEnabled(true);
    return;
  }

  if (!tab || typeof tab.id !== 'number') {
    state.pageAccess = 'none';
    setActionButtonsEnabled(false);
    setPageStatus(
      'warning',
      '未绑定网页',
      '请在目标网页点击扩展图标打开侧边栏',
      { clearHold: true }
    );
    return;
  }

  if (!tab.url) {
    state.pageAccess = 'none';
    setActionButtonsEnabled(false);
    setPageStatus(
      'warning',
      '未绑定网页',
      '请在目标网页点击扩展图标绑定当前网页',
      { clearHold: true }
    );
    return;
  }

  if (isRestrictedPageUrl(tab.url)) {
    state.pageAccess = 'restricted';
    setActionButtonsEnabled(false);
    setPageStatus(
      'error',
      '当前页面无法提取',
      '系统页面、扩展页面或本地文件页面不支持内容提取',
      { clearHold: true }
    );
    return;
  }

  if (!/^https?:\/\//i.test(tab.url || '')) {
    state.pageAccess = 'none';
    setActionButtonsEnabled(false);
    setPageStatus(
      'warning',
      '未绑定可提取网页',
      '请切换到 http/https 网页后点击扩展图标打开侧边栏',
      { clearHold: true }
    );
    return;
  }

  state.pageAccess = 'ready';
  setActionButtonsEnabled(true);
  setPageStatus(
    'info',
    `当前页面：${tab.title || '未命名页面'}`,
    getHostname(tab.url) || tab.url || '',
    { clearHold: true }
  );
}

// ===================== 渲染函数 =====================

/** 渲染分类下拉选项（筛选栏 + 编辑器） */
function renderCategoryOptions() {
  const categories = getAllCategories();
  const optionsHtml = categories.map(c =>
    `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`
  ).join('');
  const hasSelectedFilter = state.categoryFilter &&
    categories.some(c => c.id === state.categoryFilter);
  const settings = getSettings();
  const selectedDefaultId = DOM.defaultCategorySelect?.value || settings.defaultCategoryId || '';
  const defaultCategoryId = categories.some(c => c.id === selectedDefaultId) ?
    selectedDefaultId : ((categories[0] && categories[0].id) || '');

  // 筛选栏分类下拉
  DOM.categoryFilter.innerHTML = '<option value="">全部分类</option>' + optionsHtml;

  // 编辑器分类下拉
  DOM.noteCategory.innerHTML = '<option value="">选择分类</option>' + optionsHtml;

  if (DOM.defaultCategorySelect) {
    DOM.defaultCategorySelect.innerHTML = optionsHtml ||
      '<option value="">暂无分类</option>';
    DOM.defaultCategorySelect.value = defaultCategoryId;
  }

  // 恢复筛选栏选中值
  if (hasSelectedFilter) {
    DOM.categoryFilter.value = state.categoryFilter;
  } else {
    state.categoryFilter = '';
    DOM.categoryFilter.value = '';
  }
}

function getCategoryUsageMap() {
  const usage = {};
  getAllNotes().forEach(note => {
    const id = note.categoryId || '';
    usage[id] = (usage[id] || 0) + 1;
  });
  return usage;
}

function getNextCategoryColor() {
  const categories = getAllCategories();
  return CATEGORY_COLOR_PRESETS[categories.length % CATEGORY_COLOR_PRESETS.length];
}

function isDuplicateCategoryName(name, ignoreId = '') {
  const normalized = name.trim().toLowerCase();
  return getAllCategories().some(category =>
    category.id !== ignoreId &&
    category.name.trim().toLowerCase() === normalized
  );
}

function renderCategoryManager() {
  if (!DOM.categoryManager) return;

  const categories = getAllCategories();
  const usage = getCategoryUsageMap();

  if (DOM.newCategoryColor && !DOM.newCategoryColor.value) {
    DOM.newCategoryColor.value = getNextCategoryColor();
  }

  if (categories.length === 0) {
    DOM.categoryManager.innerHTML = `
      <div class="category-empty">
        暂无分类，请先添加一个分类。
      </div>
    `;
    return;
  }

  DOM.categoryManager.innerHTML = categories.map(category => {
    const noteCount = usage[category.id] || 0;
    const canDelete = categories.length > 1;
    return `
      <div class="category-row" data-category-id="${escapeHtml(category.id)}">
        <input class="category-color-input" type="color"
               value="${escapeHtml(category.color || '#95A5A6')}"
               data-category-field="color"
               title="分类颜色" />
        <input class="category-name-input" type="text"
               value="${escapeHtml(category.name)}"
               data-category-field="name"
               maxlength="24"
               aria-label="分类名称" />
        <span class="category-note-count">${noteCount} 条</span>
        <button class="toolbar-btn category-delete-btn"
                data-category-action="delete"
                ${canDelete ? '' : 'disabled aria-disabled="true"'}
                title="${canDelete ? '删除分类' : '至少保留一个分类'}">删除</button>
      </div>
    `;
  }).join('');
}

function refreshCategoryViews({ renderList = true } = {}) {
  renderCategoryOptions();
  renderCategoryManager();
  if (renderList) {
    renderNoteList();
  }
}

async function addCategoryFromInput() {
  const name = DOM.newCategoryName.value.trim();
  const color = DOM.newCategoryColor.value || getNextCategoryColor();

  if (!name) {
    showToast('请输入分类名称', 'warning');
    DOM.newCategoryName.focus();
    return;
  }

  if (isDuplicateCategoryName(name)) {
    showToast('分类名称已存在', 'warning');
    DOM.newCategoryName.focus();
    return;
  }

  try {
    const category = await createCategory({ name, color });
    const settings = getSettings();
    if (!settings.defaultCategoryId) {
      await updateSettings({ defaultCategoryId: category.id });
      state.settings = getSettings();
    }

    DOM.newCategoryName.value = '';
    DOM.newCategoryColor.value = getNextCategoryColor();
    refreshCategoryViews();
    showToast('分类已添加', 'success');
  } catch (err) {
    console.error('[SidePanel] 添加分类失败:', err);
    showToast('添加分类失败', 'error');
  }
}

async function updateCategoryFromField(field) {
  const row = field.closest('.category-row');
  const categoryId = row?.dataset.categoryId;
  const category = getCategoryById(categoryId);
  if (!category) return;

  const fieldName = field.dataset.categoryField;
  const updates = {};

  if (fieldName === 'name') {
    const name = field.value.trim();
    if (!name) {
      field.value = category.name;
      showToast('分类名称不能为空', 'warning');
      return;
    }
    if (isDuplicateCategoryName(name, category.id)) {
      field.value = category.name;
      showToast('分类名称已存在', 'warning');
      return;
    }
    if (name === category.name) return;
    updates.name = name;
  } else if (fieldName === 'color') {
    const color = field.value;
    if (!/^#[0-9a-fA-F]{6}$/.test(color) || color === category.color) return;
    updates.color = color;
  } else {
    return;
  }

  try {
    await updateCategory(category.id, updates);
    refreshCategoryViews();
    showToast('分类已更新', 'success');
  } catch (err) {
    console.error('[SidePanel] 更新分类失败:', err);
    showToast('更新分类失败', 'error');
  }
}

async function deleteCategoryWithConfirm(categoryId) {
  const category = getCategoryById(categoryId);
  if (!category) return;

  const categories = getAllCategories();
  if (categories.length <= 1) {
    showToast('至少保留一个分类', 'warning');
    return;
  }

  const noteCount = getAllNotes().filter(note => note.categoryId === categoryId).length;
  const message = noteCount > 0 ?
    `确定删除分类"${category.name}"吗？\n该分类下的 ${noteCount} 条笔记会移动到默认分类。` :
    `确定删除分类"${category.name}"吗？`;

  if (!confirm(message)) return;

  try {
    await deleteCategory(categoryId);
    state.settings = getSettings();
    if (state.categoryFilter === categoryId) {
      state.categoryFilter = '';
    }
    if (DOM.noteCategory.value === categoryId) {
      DOM.noteCategory.value = state.settings.defaultCategoryId || '';
    }
    refreshCategoryViews();
    showToast('分类已删除', 'info');
  } catch (err) {
    console.error('[SidePanel] 删除分类失败:', err);
    showToast('删除分类失败', 'error');
  }
}

/** 渲染笔记列表 */
function renderNoteList() {
  // 获取笔记
  let notes;
  if (state.searchQuery) {
    notes = searchNotes(state.searchQuery);
  } else {
    notes = getAllNotes();
  }

  // 分类筛选
  if (state.categoryFilter) {
    notes = notes.filter(n => n.categoryId === state.categoryFilter);
  }

  // 排序
  notes = sortNotes(notes, state.sortOrder);

  // 更新空状态
  if (notes.length === 0) {
    DOM.emptyState.style.display = '';
  } else {
    DOM.emptyState.style.display = 'none';
  }

  // 构建 HTML
  const categories = getAllCategories();
  const categoryMap = {};
  categories.forEach(c => { categoryMap[c.id] = c; });

  const html = notes.map(note => {
    const category = categoryMap[note.categoryId];
    const categoryName = category ? category.name : '';
    const categoryColor = category ? category.color : '';
    const dateStr = formatDate(note.updatedAt || note.createdAt, 'relative');
    const isActive = note.id === state.activeNoteId;
    const typeLabels = {
      'manual': '手动',
      'extracted': '提取',
      'summarized': '摘要',
      'quick-url': '链接',
      'quick-selection': '选中'
    };
    const typeLabel = typeLabels[note.type] || '手动';

    return `
      <div class="note-card ${isActive ? 'active' : ''} ${note.pinned ? 'pinned' : ''}"
           data-note-id="${escapeHtml(note.id)}">
        <div class="note-card-header">
          <span class="note-card-title">${escapeHtml(note.title || '未命名笔记')}</span>
          <div class="note-card-meta">
            ${note.pinned ? '<span class="note-card-pin-icon">📌</span>' : ''}
            <span class="note-card-type ${note.type}">${typeLabel}</span>
          </div>
        </div>
        <div class="note-card-body">
          <span class="note-card-excerpt">${escapeHtml(note.excerpt || truncate(note.content || '', 100))}</span>
          <span class="note-card-date">${dateStr}</span>
          <button class="note-card-delete" data-action="delete" data-note-id="${escapeHtml(note.id)}"
                  title="删除笔记">✕</button>
        </div>
        ${note.tags && note.tags.length > 0 ? `
          <div class="note-card-tags">
            ${note.tags.slice(0, 3).map(t =>
              `<span class="note-card-tag">${escapeHtml(t)}</span>`
            ).join('')}
          </div>
        ` : ''}
        ${categoryName ? `
          <div style="margin-top:4px;">
            <span style="font-size:10px;color:${escapeHtml(categoryColor)};">● ${escapeHtml(categoryName)}</span>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  // 保留空状态元素
  DOM.noteList.innerHTML = html + '<div id="emptyState" class="empty-state" style="' +
    (notes.length === 0 ? '' : 'display:none') + '">' +
    '<div class="empty-icon">📝</div>' +
    '<p>还没有笔记</p>' +
    '<p class="empty-hint">点击上方按钮开始记录</p>' +
    '</div>';

  // 重新获取 emptyState 引用（因为 innerHTML 重建了它）
  DOM.emptyState = $('#emptyState');
}

/** 笔记排序 */
function sortNotes(notes, order) {
  const sorted = [...notes];
  const pinnedFirst = (a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return 0;
  };

  switch (order) {
    case 'newest':
      return sorted.sort((a, b) => pinnedFirst(a, b) || (b.createdAt || 0) - (a.createdAt || 0));
    case 'oldest':
      return sorted.sort((a, b) => pinnedFirst(a, b) || (a.createdAt || 0) - (b.createdAt || 0));
    case 'updated':
      return sorted.sort((a, b) => pinnedFirst(a, b) || (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    case 'title':
      return sorted.sort((a, b) => pinnedFirst(a, b) || (a.title || '').localeCompare(b.title || '', 'zh'));
    default:
      return sorted.sort(pinnedFirst);
  }
}

/** 打开编辑器 */
function openEditor(noteId = null) {
  state.currentView = 'editor';
  state.editingNoteId = noteId;

  // 切换面板
  DOM.editorPanel.classList.remove('hidden');
  DOM.noteList.style.display = 'none';
  DOM.settingsPanel.classList.add('hidden');

  // 填充分类下拉
  renderCategoryOptions();

  if (noteId) {
    // 编辑已有笔记
    const note = getNoteById(noteId);
    if (note) {
      DOM.noteTitle.value = note.title || '';
      DOM.noteCategory.value = note.categoryId || '';
      DOM.noteTags.value = (note.tags || []).join(', ');
      DOM.noteContent.value = note.content || '';
      renderQualityWarnings(note);
      DOM.noteSummary.value = note.summary || '';
      DOM.notePinned.checked = note.pinned || false;

      // 来源链接
      if (note.url) {
        DOM.noteSource.classList.remove('hidden');
        DOM.sourceLink.href = note.url;
        DOM.sourceLink.textContent = note.sourceTitle || note.url;
      } else {
        DOM.noteSource.classList.add('hidden');
      }

      DOM.summarizeNoteBtn.style.display = '';
    }
  } else {
    // 新建笔记
    DOM.noteTitle.value = '';
    DOM.noteCategory.value = state.settings.defaultCategoryId || '';
    DOM.noteTags.value = '';
    DOM.noteContent.value = '';
    renderQualityWarnings({});
    DOM.noteSummary.value = '';
    DOM.notePinned.checked = false;
    DOM.noteSource.classList.add('hidden');
    DOM.summarizeNoteBtn.style.display = 'none';
  }

  // 更新字符计数
  updateCharCount();
  updateSummaryUtilityButtons();

  DOM.noteTitle.focus();
}

/** 关闭编辑器，返回列表 */
function closeEditor() {
  state.currentView = 'list';
  state.editingNoteId = null;

  DOM.editorPanel.classList.add('hidden');
  DOM.noteList.style.display = '';
  DOM.settingsPanel.classList.add('hidden');

  renderNoteList();
}

/** 保存当前编辑的笔记 */
async function saveCurrentNote() {
  const title = DOM.noteTitle.value.trim();
  const content = DOM.noteContent.value;
  const categoryId = DOM.noteCategory.value;
  const tags = normalizeTags(DOM.noteTags.value);
  const summary = DOM.noteSummary.value;
  const pinned = DOM.notePinned && DOM.notePinned.checked;

  // 标题必填
  if (!title) {
    showToast('请输入笔记标题', 'warning');
    DOM.noteTitle.focus();
    return;
  }

  try {
    if (state.editingNoteId) {
      // 更新已有笔记
      const updated = await updateNote(state.editingNoteId, {
        title,
        content,
        categoryId,
        tags,
        summary,
        pinned
      });
      if (updated) {
        showToast('笔记已保存', 'success');
      } else {
        showToast('保存失败：笔记不存在', 'error');
      }
    } else {
      // 创建新笔记（检查是否有提取数据）
      const extraData = state._extractedData || {};
      const note = await createNote({
        type: extraData.type || 'manual',
        title,
        content,
        categoryId,
        tags,
        summary,
        pinned,
        url: extraData.url || '',
        sourceTitle: extraData.sourceTitle || '',
        pageType: extraData.pageType || '',
        extractionMethod: extraData.extractionMethod || extraData.method || '',
        extractionConfidence: typeof extraData.extractionConfidence === 'number' ? extraData.extractionConfidence : null,
        extractionReason: extraData.extractionReason || extraData.reason || '',
        qualityWarnings: Array.isArray(extraData.qualityWarnings) ? extraData.qualityWarnings : []
      });
      state._extractedData = null;
      state.editingNoteId = note.id;
      DOM.summarizeNoteBtn.style.display = '';
      showToast('笔记已创建', 'success');
    }

    // 更新列表（在后台）
    renderNoteList();
    updateSummaryUtilityButtons();
  } catch (err) {
    console.error('[SidePanel] 保存笔记失败:', err);
    showToast('保存失败：' + err.message, 'error');
  }
}

/** 删除笔记（带确认） */
async function deleteNoteWithConfirm(noteId) {
  const note = getNoteById(noteId);
  if (!note) return;

  const confirmed = confirm(`确定删除笔记"${note.title}"吗？\n此操作不可撤销。`);
  if (!confirmed) return;

  try {
    await deleteNote(noteId);

    // 如果正在编辑这条笔记，返回列表
    if (state.editingNoteId === noteId) {
      closeEditor();
    }
    if (state.activeNoteId === noteId) {
      state.activeNoteId = null;
    }

    renderNoteList();
    showToast('笔记已删除', 'info');
  } catch (err) {
    console.error('[SidePanel] 删除笔记失败:', err);
    showToast('删除失败', 'error');
  }
}

// ===================== 设置面板 =====================
function openSettings() {
  state.currentView = 'settings';

  DOM.settingsPanel.classList.remove('hidden');
  DOM.noteList.style.display = 'none';
  DOM.editorPanel.classList.add('hidden');

  // 填充当前设置
  const settings = getSettings();
  DOM.llmEnabled.checked = settings.llm?.enabled || false;
  DOM.llmEndpoint.value = settings.llm?.apiEndpoint || '';
  DOM.llmApiKey.value = settings.llm?.apiKey || '';
  DOM.llmModel.value = settings.llm?.model || 'gpt-4o-mini';
  DOM.themeSelect.value = settings.theme || 'light';
  DOM.fontSizeRange.value = settings.fontSize || 14;
  renderCategoryOptions();
  renderCategoryManager();
  DOM.defaultCategorySelect.value = settings.defaultCategoryId || DOM.defaultCategorySelect.value || '';
  DOM.summaryLengthSelect.value = settings.summaryLength || 'medium';
  DOM.autoSummarizeCheck.checked = settings.autoSummarize || false;
}

function closeSettings() {
  state.currentView = 'list';

  DOM.settingsPanel.classList.add('hidden');
  DOM.noteList.style.display = '';

  renderNoteList();
}

async function saveSettings() {
  try {
    const normalizedEndpoint = normalizeLlmEndpoint(DOM.llmEndpoint.value);
    const newSettings = {
      llm: {
        apiEndpoint: normalizedEndpoint,
        apiKey: DOM.llmApiKey.value.trim(),
        model: DOM.llmModel.value.trim() || 'gpt-4o-mini',
        enabled: DOM.llmEnabled.checked
      },
      theme: DOM.themeSelect.value,
      fontSize: parseInt(DOM.fontSizeRange.value, 10),
      defaultCategoryId: DOM.defaultCategorySelect.value,
      summaryLength: DOM.summaryLengthSelect.value,
      autoSummarize: DOM.autoSummarizeCheck.checked
    };

    await updateSettings(newSettings);
    state.settings = getSettings();
    DOM.llmEndpoint.value = normalizedEndpoint;

    // 应用主题和字号
    applyTheme(newSettings.theme);
    applyFontSize(newSettings.fontSize);

    showToast('设置已保存', 'success');
    closeSettings();
  } catch (err) {
    console.error('[SidePanel] 保存设置失败:', err);
    showToast('保存设置失败', 'error');
  }
}

// ===================== 与 Service Worker 通信 =====================

/** 发送消息到 Service Worker */
async function sendToSW(action, payload = {}) {
  try {
    const response = await chrome.runtime.sendMessage({ action, ...payload });
    return response;
  } catch (err) {
    console.error(`[SidePanel] 消息 "${action}" 失败:`, err);
    throw err;
  }
}

async function getRememberedActiveTab() {
  try {
    const response = await sendToSW('getActiveTab');
    if (response && response.success && response.data && typeof response.data.id === 'number') {
      return response.data;
    }
  } catch (err) {
    console.warn('[SidePanel] 获取扩展 action 标签页失败:', err);
  }
  return null;
}

function cacheCurrentTabInfo(tab) {
  if (!tab || typeof tab.id !== 'number') {
    state.currentTab = null;
    return null;
  }

  state.currentTab = {
    id: tab.id,
    windowId: tab.windowId,
    url: tab.url || '',
    title: tab.title || '',
    source: tab.source || '',
    updatedAt: tab.updatedAt || null
  };

  return state.currentTab;
}

function pickUsableTab(tabs) {
  if (!Array.isArray(tabs) || tabs.length === 0) {
    return null;
  }

  return tabs.find(tab => /^https?:\/\//i.test(tab.url || '')) ||
    null;
}

async function queryActiveTab(queryInfo) {
  try {
    const tabs = await chrome.tabs.query(queryInfo);
    return pickUsableTab(tabs);
  } catch (err) {
    console.warn('[SidePanel] 查询当前标签页失败:', queryInfo, err);
    return null;
  }
}

async function getBestCurrentTab() {
  return await getRememberedActiveTab() ||
    await queryActiveTab({ active: true, currentWindow: true }) ||
    await queryActiveTab({ active: true, lastFocusedWindow: true }) ||
    await queryActiveTab({ active: true });
}

async function refreshCurrentTabInfo(options = {}) {
  try {
    const tab = cacheCurrentTabInfo(await getBestCurrentTab());
    updatePageStatusFromTab(tab, options);
    return tab;
  } catch (err) {
    console.warn('[SidePanel] 刷新当前标签页信息失败:', err);
    state.currentTab = null;
    updatePageStatusFromTab(null, { force: true });
    return null;
  }
}

function isRestrictedPageUrl(url) {
  return /^(chrome|chrome-extension|edge|about|view-source|file):/i.test(url || '');
}

function isUsableWebTab(tab) {
  return !!tab && typeof tab.id === 'number' && /^https?:\/\//i.test(tab.url || '') && !isRestrictedPageUrl(tab.url);
}

function showUnavailablePageForAction(tab) {
  updatePageStatusFromTab(tab || null, { force: true });
  if (!tab) {
    showToast('无法获取当前标签页', 'error');
  } else if (isRestrictedPageUrl(tab.url)) {
    showToast('无法在系统页面、扩展页面或本地文件页面操作', 'warning');
  } else {
    showToast('请先在目标网页点击扩展图标打开侧边栏', 'warning');
  }
}

function isMissingHostPermissionError(error) {
  return /缺少当前网页访问授权|Missing host permission|host permission|activeTab|manifest must request permission|Cannot access contents of url/i.test(error || '');
}

function isMissingHostPermissionResponse(response) {
  return response?.code === 'MISSING_HOST_PERMISSION' || isMissingHostPermissionError(response?.error);
}

function buildLlmConfig(settings) {
  return {
    endpoint: settings.llm?.apiEndpoint || '',
    apiKey: settings.llm?.apiKey || '',
    model: settings.llm?.model || 'gpt-4o-mini',
    enabled: settings.llm?.enabled || false,
    length: settings.summaryLength || 'medium'
  };
}

function generateRequestId() {
  return `sum_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getEndpointHost(endpoint) {
  try {
    return new URL(endpoint).host;
  } catch (err) {
    return endpoint || '未配置';
  }
}

function normalizeLlmEndpoint(endpoint) {
  const raw = String(endpoint || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    const path = url.pathname.replace(/\/+$/, '');
    if (!path) {
      url.pathname = '/chat/completions';
    } else if (/^\/v\d+$/i.test(path)) {
      url.pathname = `${path}/chat/completions`;
    }
    return url.toString();
  } catch (err) {
    return raw;
  }
}

function isCloudLlmConfigured(config) {
  return !!(config && config.enabled && config.apiKey && config.endpoint);
}

function getExtractionWarnings(noteOrData = {}) {
  const warnings = Array.isArray(noteOrData.qualityWarnings) ? [...noteOrData.qualityWarnings] : [];
  const content = String(noteOrData.content || '');
  const trimmed = content.trim();
  const method = noteOrData.extractionMethod || noteOrData.method || '';
  const pageType = noteOrData.pageType || '';

  if (trimmed && trimmed.length < 180) {
    warnings.push('提取内容较短，请检查是否已获取到正文。');
  }

  const nonImageText = trimmed
    .replace(/图片内容：[\s\S]*$/m, '')
    .replace(/https?:\/\/\S+/g, '')
    .trim();
  if (/图片内容：/.test(content) && nonImageText.length < 220) {
    warnings.push('页面正文可能主要在图片中；当前只记录了图片信息，未读取图片文字。');
  }

  if (method === 'fallback' && !warnings.some(w => /回退|通用/.test(w))) {
    warnings.push('已使用通用回退提取，正文可能包含页面控件或遗漏部分内容。');
  }

  if (pageType === 'unknown' && !warnings.some(w => /页面类型不明确/.test(w))) {
    warnings.push('页面类型不明确，建议保存前快速检查正文。');
  }

  return [...new Set(warnings.map(w => String(w || '').trim()).filter(Boolean))];
}

function hasPartialExtractionWarning(noteOrData = {}) {
  return getExtractionWarnings(noteOrData).length > 0;
}

function renderQualityWarnings(noteOrData = {}) {
  if (!DOM.noteQualityWarnings) return;

  const warnings = getExtractionWarnings(noteOrData);
  if (warnings.length === 0) {
    DOM.noteQualityWarnings.classList.add('hidden');
    DOM.noteQualityWarnings.innerHTML = '';
    return;
  }

  DOM.noteQualityWarnings.classList.remove('hidden');
  DOM.noteQualityWarnings.innerHTML = `
    <div class="quality-warnings-title">提取质量提示</div>
    <ul>
      ${warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}
    </ul>
  `;
}

function isSummaryRequestCancelled(requestId) {
  return !!requestId && state.cancelledSummaryRequests.has(requestId);
}

function cancelledSummaryResponse() {
  return { success: false, code: 'CANCELLED', error: '已取消生成', method: 'none' };
}

function getPageTypeForNote(note = {}) {
  if (note.pageType) return note.pageType;
  if (note.extractionMethod && String(note.extractionMethod).startsWith('search-results')) {
    return note.extractionMethod;
  }
  return note.type === 'extracted' ? 'unknown' : 'article';
}

function getPageTypeLabel(pageType = 'unknown') {
  if (pageType.startsWith('search-results')) return '搜索结果页';

  const labels = {
    article: '文章/新闻/文档页',
    listing: '列表/聚合页',
    'forum-qa': '论坛/问答页',
    video: '视频/音频页',
    product: '商品/服务页',
    'pdf-document': 'PDF/文档页',
    login: '登录/验证码页',
    error: '错误页',
    restricted: '受限页面',
    unknown: '未知页面'
  };

  return labels[pageType] || labels.unknown;
}

function getSummaryNoticeForNote(note = {}) {
  const pageType = getPageTypeForNote(note);
  if (pageType.startsWith('search-results')) {
    return '当前是搜索结果页，摘要基于页面条目，不代表已阅读每条原文。';
  }
  if (pageType === 'listing') {
    return '当前是列表/聚合页，摘要基于页面条目，不代表具体文章全文。';
  }
  const warning = Array.isArray(note.qualityWarnings) ? note.qualityWarnings[0] : '';
  return warning || '';
}

function getSummaryBlockReason(note = {}) {
  const pageType = getPageTypeForNote(note);
  if (['login', 'error', 'restricted'].includes(pageType)) {
    return `当前页面类型为“${getPageTypeLabel(pageType)}”，无法生成可靠摘要。`;
  }
  if (!(note.content || '').trim()) {
    return '笔记内容为空，无法生成摘要。';
  }
  if ((note.content || '').trim().length < 80) {
    return '提取内容太短，无法生成可靠摘要。';
  }
  return '';
}

function getCurrentEditorNoteSnapshot() {
  if (!state.editingNoteId) return null;
  const note = getNoteById(state.editingNoteId);
  if (!note) return null;

  return {
    ...note,
    title: DOM.noteTitle.value.trim() || note.title,
    content: DOM.noteContent.value || '',
    summary: DOM.noteSummary.value || ''
  };
}

function updateSummaryUtilityButtons() {
  const note = getCurrentEditorNoteSnapshot();
  const settings = getSettings();
  const llmConfig = buildLlmConfig(settings);
  const hasSummary = !!(DOM.noteSummary?.value || '').trim();
  const canPreview = !!(note && note.content && isCloudLlmConfigured(llmConfig));

  if (DOM.insertSummaryBtn) {
    DOM.insertSummaryBtn.classList.toggle('hidden', !hasSummary);
  }

  if (DOM.previewSummaryPayloadBtn) {
    DOM.previewSummaryPayloadBtn.classList.toggle('hidden', !canPreview);
  }
}

function setSummaryGeneratingState(isGenerating, requestId = null) {
  const isActive = !!isGenerating;
  if (DOM.summarizeNoteBtn) {
    DOM.summarizeNoteBtn.disabled = isActive;
    DOM.summarizeNoteBtn.textContent = isActive ? '⏳ 生成中...' : '✨ 生成摘要';
  }
  if (DOM.cancelSummaryBtn) {
    DOM.cancelSummaryBtn.classList.toggle('hidden', !isActive);
    DOM.cancelSummaryBtn.disabled = !isActive;
  }
  if (DOM.summarizePageBtn) {
    DOM.summarizePageBtn.disabled = isActive || state.pageAccess !== 'ready';
    DOM.summarizePageBtn.setAttribute('aria-disabled', String(DOM.summarizePageBtn.disabled));
  }
  if (requestId) {
    state.activeSummaryRequestId = requestId;
  } else if (!isActive) {
    state.activeSummaryRequestId = null;
    state.activeSummaryNoteId = null;
  }
  setActionButtonsEnabled(state.pageAccess === 'ready');
}

function setSummaryStage(label) {
  if (!state.activeSummaryRequestId || !DOM.summarizeNoteBtn || !label) return;
  DOM.summarizeNoteBtn.textContent = `⏳ ${label}`;
}

function createTextEl(tag, text, className = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = text;
  return el;
}

async function showCloudSummaryPreview(note, llmConfig, options = {}) {
  const settings = getSettings();
  const viewOnly = !!options.viewOnly;
  const force = !!options.force;

  if (!viewOnly && !force && settings.privacy?.cloudSummaryNoticeAccepted) {
    return { confirmed: true };
  }

  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog privacy-preview-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    dialog.appendChild(createTextEl('h3', viewOnly ? '发送内容预览' : '确认发送到云端模型'));
    dialog.appendChild(createTextEl(
      'p',
      '网页摘要会把必要内容发送给你配置的 OpenAI 兼容接口。用户历史笔记、本地全部数据和完整网址不会加入请求体。',
      'privacy-preview-note'
    ));

    const detail = document.createElement('dl');
    detail.className = 'privacy-preview-detail';
    const rows = [
      ['服务地址', getEndpointHost(llmConfig.endpoint)],
      ['模型', llmConfig.model || 'gpt-4o-mini'],
      ['标题', note.title || '未命名笔记'],
      ['页面类型', getPageTypeLabel(getPageTypeForNote(note))],
      ['正文长度', `${(note.content || '').length} 字`],
      ['发送正文', `前 ${Math.min((note.content || '').length, LLM_CONTENT_LIMIT)} 字`],
      ['质量提示', getSummaryNoticeForNote(note) || '无'],
      ['API 密钥', '作为 Authorization header 发送，不会在此显示']
    ];
    rows.forEach(([label, value]) => {
      detail.appendChild(createTextEl('dt', label));
      detail.appendChild(createTextEl('dd', value));
    });
    dialog.appendChild(detail);

    const preview = document.createElement('textarea');
    preview.className = 'privacy-preview-text';
    preview.readOnly = true;
    preview.value = `标题：${note.title || '未命名笔记'}\n页面类型：${getPageTypeLabel(getPageTypeForNote(note))}\n\n正文预览：\n${(note.content || '').slice(0, PREVIEW_CONTENT_LIMIT)}`;
    dialog.appendChild(preview);

    let dontShowAgain = null;
    if (!viewOnly) {
      const checkLabel = document.createElement('label');
      checkLabel.className = 'privacy-preview-check';
      dontShowAgain = document.createElement('input');
      dontShowAgain.type = 'checkbox';
      checkLabel.appendChild(dontShowAgain);
      checkLabel.appendChild(document.createTextNode('不再自动弹出此确认，但仍可点击“查看发送内容”'));
      dialog.appendChild(checkLabel);
    }

    const buttons = document.createElement('div');
    buttons.className = 'confirm-dialog-buttons';

    const close = (confirmed) => {
      overlay.remove();
      resolve({ confirmed });
    };

    if (!viewOnly) {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'action-btn';
      cancelBtn.textContent = '取消';
      cancelBtn.addEventListener('click', () => close(false));
      buttons.appendChild(cancelBtn);

      const sendBtn = document.createElement('button');
      sendBtn.className = 'action-btn primary';
      sendBtn.textContent = '发送并生成';
      sendBtn.addEventListener('click', async () => {
        if (dontShowAgain?.checked) {
          try {
            await updateSettings({ privacy: { cloudSummaryNoticeAccepted: true } });
            state.settings = getSettings();
          } catch (err) {
            console.error('[SidePanel] 保存隐私确认设置失败:', err.message || err);
            showToast('隐私确认设置保存失败，本次仍将继续生成', 'warning');
          }
        }
        close(true);
      });
      buttons.appendChild(sendBtn);
    } else {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'action-btn primary';
      closeBtn.textContent = '关闭';
      closeBtn.addEventListener('click', () => close(true));
      buttons.appendChild(closeBtn);
    }

    dialog.appendChild(buttons);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  });
}

function startExtractPageFromUserGesture() {
  extractPage(state.currentTab);
}

async function requestPageExtraction(cachedTab = null, options = {}) {
  const title = options.statusTitle || '正在提取当前页面';
  const detail = options.statusDetail || '请稍候，正在注入脚本并读取正文';
  setPageStatus('info', title, detail);

  let tab = cachedTab;
  if (!tab || !tab.id) {
    tab = await refreshCurrentTabInfo({ force: true });
  } else {
    refreshCurrentTabInfo();
  }

  if (!tab) {
    updatePageStatusFromTab(null, { force: true });
    showToast('无法获取当前标签页', 'error');
    return null;
  }

  if (!isUsableWebTab(tab)) {
    showUnavailablePageForAction(tab);
    return null;
  }

  const response = await sendToSW('extractPage', { tabId: tab.id });

  if ((!response || !response.success) && isMissingHostPermissionResponse(response)) {
    setActionButtonsEnabled(true);
    setPageStatus(
      'warning',
      '缺少 activeTab 临时授权',
      '请回到目标网页，点击扩展图标重新打开侧边栏后再提取',
      { holdFor: 30000, tabId: tab.id }
    );
    showToast('缺少 activeTab 临时授权：请在目标网页上点击扩展图标重新打开侧边栏后再提取', 'warning');
    return null;
  }

  if (!response || !response.success || !response.data) {
    setPageStatus(
      'error',
      '提取失败',
      response?.error || '未知错误',
      { holdFor: 12000, tabId: tab.id }
    );
    showToast('提取失败：' + (response?.error || '未知错误'), 'error');
    return null;
  }

  return { tab, data: response.data };
}

async function createNoteFromExtractedPage(data, tab) {
  const note = await createNote({
    type: 'extracted',
    title: data.title || tab.title || '未命名页面',
    content: data.content || '',
    url: data.url || tab.url || '',
    sourceTitle: data.sourceTitle || data.title || tab.title || '',
    excerpt: data.excerpt || '',
    pageType: data.pageType || '',
    extractionMethod: data.method || '',
    extractionConfidence: typeof data.confidence === 'number' ? data.confidence : null,
    extractionReason: data.reason || '',
    qualityWarnings: Array.isArray(data.qualityWarnings) ? data.qualityWarnings : []
  });

  state._extractedData = null;
  state.activeNoteId = note.id;
  return note;
}

/** 提取当前页面内容 */
async function extractPage(cachedTab = null) {
  try {
    showToast('正在提取页面内容...', 'info');
    const result = await requestPageExtraction(cachedTab);
    if (!result) return;

    const { tab, data } = result;
    const partialExtraction = hasPartialExtractionWarning(data);
    const note = await createNoteFromExtractedPage(data, tab);
    setActionButtonsEnabled(true);
    setPageStatus(
      partialExtraction ? 'warning' : 'success',
      partialExtraction ? '已提取部分页面内容' : '已提取当前页面内容',
      data.title || tab.title || getHostname(tab.url) || '',
      { holdFor: 12000, tabId: tab.id }
    );
    openEditor(note.id);

    showToast(partialExtraction ? '已提取部分内容，请检查正文' : '页面内容提取成功', partialExtraction ? 'warning' : 'success');

    if (getSettings().autoSummarize) {
      await generateSummaryForNote(note.id);
    }
  } catch (err) {
    console.error('[SidePanel] 提取页面失败:', err.message || err);
    setPageStatus(
      'error',
      '提取失败',
      err.message || '请确认已打开网页',
      { holdFor: 12000, tabId: state.currentTab?.id || null }
    );
    showToast('提取失败，请确认已打开网页', 'error');
  }
}

async function summarizeCurrentPage() {
  if (state.activeSummaryRequestId) {
    showToast('摘要正在生成中，请稍候', 'warning');
    return;
  }

  try {
    showToast('正在提取并总结当前网页...', 'info');
    const result = await requestPageExtraction(state.currentTab, {
      statusTitle: '正在准备网页摘要',
      statusDetail: '先提取当前网页正文，再生成摘要'
    });
    if (!result) return;

    const { tab, data } = result;
    const partialExtraction = hasPartialExtractionWarning(data);
    const note = await createNoteFromExtractedPage(data, tab);
    setPageStatus(
      partialExtraction ? 'warning' : 'success',
      partialExtraction ? '已提取部分页面内容' : '已提取当前页面内容',
      data.title || tab.title || getHostname(tab.url) || '',
      { holdFor: 12000, tabId: tab.id }
    );
    openEditor(note.id);
    await generateSummaryForNote(note.id);
  } catch (err) {
    console.error('[SidePanel] 总结当前网页失败:', err.message || err);
    showToast('总结当前网页失败: ' + (err.message || '未知错误'), 'error');
  }
}

/** 快速添加当前页面 URL */
async function quickAddUrl() {
  try {
    const tab = await refreshCurrentTabInfo();
    if (!tab) {
      showToast('无法获取当前标签页', 'error');
      return;
    }

    if (!isUsableWebTab(tab)) {
      showUnavailablePageForAction(tab);
      return;
    }

    await createNote({
      type: 'quick-url',
      title: tab.title || '未命名页面',
      content: tab.url || '',
      url: tab.url || '',
      sourceTitle: tab.title || ''
    });

    renderNoteList();
    showToast('已添加页面链接', 'success');
  } catch (err) {
    console.error('[SidePanel] 快速添加 URL 失败:', err);
    showToast('添加失败', 'error');
  }
}

/** 快速添加选中文本 */
async function quickAddSelection() {
  try {
    const tab = await refreshCurrentTabInfo();
    if (!tab) {
      showToast('无法获取当前标签页', 'error');
      return;
    }

    if (!isUsableWebTab(tab)) {
      showUnavailablePageForAction(tab);
      return;
    }

    const response = await sendToSW('getSelectedText', { tabId: tab.id });

    if (response && response.success && response.data) {
      await createNote({
        type: 'quick-selection',
        title: (response.data.text || '').slice(0, 50) + (response.data.text && response.data.text.length > 50 ? '...' : ''),
        content: response.data.text || '',
        url: tab.url || '',
        sourceTitle: tab.title || ''
      });

      renderNoteList();
      showToast('已添加选中文本', 'success');
    } else {
      showToast('请先在页面中选中文本', 'warning');
    }
  } catch (err) {
    console.error('[SidePanel] 快速添加选中文本失败:', err);
    showToast('添加失败', 'error');
  }
}

async function cancelActiveSummary() {
  const requestId = state.activeSummaryRequestId;
  if (!requestId) return;

  state.cancelledSummaryRequests.add(requestId);
  state.activeSummaryRequestId = null;
  state.activeSummaryNoteId = null;
  setSummaryGeneratingState(false);

  try {
    await sendToSW('cancelSummarize', { requestId });
  } catch (err) {
    console.warn('[SidePanel] 取消摘要请求失败:', err.message || err);
  }

  showToast('已取消生成', 'info');
}

async function viewCloudSummaryPayload() {
  const note = getCurrentEditorNoteSnapshot();
  const llmConfig = buildLlmConfig(getSettings());

  if (!note || !note.content) {
    showToast('当前笔记内容为空，无法预览发送内容', 'warning');
    return;
  }

  if (!isCloudLlmConfigured(llmConfig)) {
    showToast('云端 LLM 未配置或未启用', 'warning');
    return;
  }

  await showCloudSummaryPreview(note, llmConfig, { force: true, viewOnly: true });
}

async function insertSummaryIntoContent() {
  const note = getCurrentEditorNoteSnapshot();
  const summary = (DOM.noteSummary.value || '').trim();

  if (!note || !state.editingNoteId) {
    showToast('请先打开一条笔记', 'warning');
    return;
  }

  if (!summary) {
    showToast('摘要为空，无法插入正文', 'warning');
    return;
  }

  const summaryBlock = `## 摘要\n${summary}`;
  const currentContent = DOM.noteContent.value || '';
  if (currentContent.includes(summaryBlock)) {
    showToast('正文中已包含这段摘要', 'info');
    return;
  }

  const nextContent = currentContent.trim() ?
    `${currentContent.trimEnd()}\n\n${summaryBlock}` :
    summaryBlock;

  DOM.noteContent.value = nextContent;
  updateCharCount();

  try {
    await updateNote(state.editingNoteId, { content: nextContent, summary });
    showAutoSaveIndicator();
    renderNoteList();
    showToast('摘要已插入正文并保存', 'success');
  } catch (err) {
    console.error('[SidePanel] 插入摘要失败:', err.message || err);
    showToast('插入摘要失败: ' + err.message, 'error');
  }
}

async function generateSummaryForNote(noteId) {
  const note = getNoteById(noteId);
  if (!note || !note.content) {
    showToast('笔记内容为空，无法生成摘要', 'warning');
    return null;
  }

  if (state.activeSummaryRequestId) {
    showToast('摘要正在生成中，请稍候', 'warning');
    return null;
  }

  const blockReason = getSummaryBlockReason(note);
  if (blockReason) {
    showToast(blockReason, 'warning');
    return null;
  }

  const requestId = generateRequestId();
  state.activeSummaryRequestId = requestId;
  state.activeSummaryNoteId = note.id;
  state.cancelledSummaryRequests.delete(requestId);

  try {
    setSummaryGeneratingState(true, requestId);
    setSummaryStage('准备内容...');

    const notice = getSummaryNoticeForNote(note);
    showToast(notice || '正在生成摘要...', 'info');

    const response = await generateSummaryWithFallback(note, { requestId });
    if (state.activeSummaryRequestId !== requestId || response?.code === 'CANCELLED') {
      showToast('已取消生成', 'info');
      return response || cancelledSummaryResponse();
    }

    if (response && response.success && response.summary) {
      if (state.editingNoteId === note.id) {
        DOM.noteSummary.value = response.summary;
      }
      await updateNote(note.id, { summary: response.summary });
      updateSummaryUtilityButtons();

      const methodNames = {
        'llm': '云端 LLM',
        'chrome-ai': 'Chrome 内置 AI',
        'tfidf': 'TF-IDF 抽取算法',
        'passthrough': '直接使用原文'
      };
      const methodName = methodNames[response.method] || response.method || '未知';
      showToast(`摘要生成成功（${methodName}）`, 'success');
      return response;
    } else {
      showToast(response?.error || '摘要生成失败', 'error');
      return response || null;
    }
  } catch (err) {
    console.error('[SidePanel] 摘要生成失败:', err.message || err);
    showToast('摘要生成失败: ' + err.message, 'error');
    return null;
  } finally {
    if (state.activeSummaryRequestId === requestId) {
      setSummaryGeneratingState(false);
    }
    state.cancelledSummaryRequests.delete(requestId);
    updateSummaryUtilityButtons();
  }
}

async function sendSummarizeWithTimeout(payload, timeoutMs) {
  let timer = null;
  const requestPromise = sendToSW('summarize', payload).catch(err => ({
    success: false,
    error: err.message || String(err),
    method: payload.mode || 'none'
  }));
  const timeoutPromise = new Promise(resolve => {
    timer = setTimeout(() => {
      resolve({
        success: false,
        code: 'TIMEOUT',
        error: '云端摘要超时，已切换到后备摘要',
        method: payload.mode || 'llm',
        timedOut: true
      });
    }, timeoutMs);
  });

  const result = await Promise.race([requestPromise, timeoutPromise]);
  if (timer) clearTimeout(timer);

  if (result?.timedOut && payload.requestId) {
    try {
      await sendToSW('cancelSummarize', { requestId: payload.requestId });
    } catch (err) {
      console.warn('[SidePanel] 云端摘要超时后取消失败:', err.message || err);
    }
  }

  return result;
}

async function generateSummaryWithFallback(note, options = {}) {
  const requestId = options.requestId || generateRequestId();
  const settings = getSettings();
  const llmConfig = buildLlmConfig(settings);
  const pageType = getPageTypeForNote(note);
  const errors = [];

  if (llmConfig.enabled && llmConfig.apiKey && llmConfig.endpoint) {
    setSummaryStage('等待云端确认...');
    const preview = await showCloudSummaryPreview(note, llmConfig);
    if (!preview.confirmed || isSummaryRequestCancelled(requestId)) {
      return cancelledSummaryResponse();
    }

    setSummaryStage('调用云端模型...');
    const llmResponse = await sendSummarizeWithTimeout({
      requestId,
      noteId: note.id,
      content: note.content,
      title: note.title,
      config: llmConfig,
      mode: 'llm',
      pageType
    }, CLOUD_SUMMARY_TOTAL_TIMEOUT);
    if (llmResponse && llmResponse.success) return llmResponse;
    if (llmResponse?.code === 'CANCELLED' || isSummaryRequestCancelled(requestId)) {
      return cancelledSummaryResponse();
    }
    if (llmResponse?.error) errors.push(`云端 LLM: ${llmResponse.error}`);
  }

  if (isSummaryRequestCancelled(requestId)) {
    return cancelledSummaryResponse();
  }

  setSummaryStage('尝试浏览器 AI...');
  const chromeResponse = await tryChromeSummarizer(
    note.title,
    note.content,
    settings.summaryLength || 'medium',
    { timeoutMs: CHROME_SUMMARIZER_TIMEOUT }
  );
  if (isSummaryRequestCancelled(requestId)) {
    return cancelledSummaryResponse();
  }
  if (chromeResponse.success) return chromeResponse;
  if (chromeResponse.error) errors.push(`Chrome 内置 AI: ${chromeResponse.error}`);

  setSummaryStage('使用本地摘要...');
  const tfidfResponse = await sendToSW('summarize', {
    requestId,
    noteId: note.id,
    content: note.content,
    title: note.title,
    config: { length: settings.summaryLength || 'medium' },
    mode: 'tfidf',
    pageType
  });
  if (tfidfResponse && tfidfResponse.success) return tfidfResponse;
  if (tfidfResponse?.code === 'CANCELLED' || isSummaryRequestCancelled(requestId)) {
    return cancelledSummaryResponse();
  }
  if (tfidfResponse?.error) errors.push(`TF-IDF: ${tfidfResponse.error}`);

  return {
    success: false,
    error: errors.length ? errors.join('；') : '所有摘要方案均失败',
    method: 'none'
  };
}

async function tryChromeSummarizer(title, content, length, options = {}) {
  const SummarizerApi = globalThis.Summarizer;
  if (!SummarizerApi || typeof SummarizerApi.create !== 'function') {
    return { success: false, error: '当前浏览器未提供 Summarizer API', method: 'chrome-ai' };
  }

  const summarizeOptions = {
    type: 'key-points',
    format: 'plain-text',
    length: length === 'short' ? 'short' : length === 'long' ? 'long' : 'medium'
  };
  const timeoutMs = options.timeoutMs || CHROME_SUMMARIZER_TIMEOUT;

  let summarizer = null;
  const run = (async () => {
    let availability = 'available';
    if (typeof SummarizerApi.availability === 'function') {
      try {
        availability = await SummarizerApi.availability(summarizeOptions);
      } catch (err) {
        availability = await SummarizerApi.availability().catch(() => 'unavailable');
      }
    }

    if (availability === 'unavailable' || availability === 'no') {
      return { success: false, error: '模型不可用或浏览器未启用内置摘要能力', method: 'chrome-ai' };
    }

    try {
      summarizer = await SummarizerApi.create(summarizeOptions);
    } catch (err) {
      summarizer = await SummarizerApi.create();
    }

    const inputText = title ? `标题：${title}\n\n${content}` : content;
    const summary = await summarizer.summarize(inputText.slice(0, 12000));
    if (summary && summary.trim()) {
      return {
        success: true,
        summary: summary.trim(),
        method: 'chrome-ai'
      };
    }

    return { success: false, error: 'Chrome 内置 AI 返回空摘要', method: 'chrome-ai' };
  })();

  const result = await promiseWithTimeout(run, timeoutMs, () => {
    if (summarizer && typeof summarizer.destroy === 'function') {
      summarizer.destroy();
    }
  });

  if (result.timedOut) {
    return { success: false, code: 'TIMEOUT', error: 'Chrome 内置 AI 超时（20秒）', method: 'chrome-ai' };
  }

  if (result.error) {
    if (summarizer && typeof summarizer.destroy === 'function') {
      summarizer.destroy();
    }
    return { success: false, error: result.error.message || 'Chrome 内置 AI 摘要失败', method: 'chrome-ai' };
  }

  if (summarizer && typeof summarizer.destroy === 'function') {
    summarizer.destroy();
  }

  return result.value;
}

function promiseWithTimeout(promise, timeoutMs, onTimeout) {
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        if (typeof onTimeout === 'function') onTimeout();
      } catch (err) {
        console.warn('[SidePanel] 超时清理失败:', err.message || err);
      }
      resolve({ timedOut: true });
    }, timeoutMs);

    promise.then(value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ value });
    }).catch(error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ error });
    });
  });
}

/** 生成摘要（三级回退：云端 LLM → Chrome AI → TF-IDF） */
async function generateSummary() {
  if (!state.editingNoteId) {
    showToast('请先保存笔记', 'warning');
    return;
  }

  await generateSummaryForNote(state.editingNoteId);
}

// ===================== 导出处理 =====================
async function handleExport(format) {
  if (!format) return;

  let notes;
  if (state.searchQuery) {
    notes = searchNotes(state.searchQuery);
  } else {
    notes = getAllNotes();
  }
  if (state.categoryFilter) {
    notes = notes.filter(n => n.categoryId === state.categoryFilter);
  }

  if (notes.length === 0) {
    showToast('没有可导出的笔记', 'warning');
    DOM.exportSelect.value = '';
    return;
  }

  try {
    // 构建分类名称映射
    const categories = getAllCategories();
    const categoryMap = {};
    categories.forEach(c => { categoryMap[c.id] = c.name; });

    const result = await exportNotes(notes, format, {
      getCategoryName: (id) => categoryMap[id] || ''
    });

    if (result.success) {
      showToast(`已导出 ${notes.length} 条笔记 (${result.fileName})`, 'success');

      // 保存导出格式偏好
      await updateSettings({ exportFormat: format });
    } else {
      showToast(result.error || '导出失败', 'error');
    }
  } catch (err) {
    console.error('[SidePanel] 导出失败:', err);
    showToast('导出失败: ' + err.message, 'error');
  }

  DOM.exportSelect.value = '';
}

// ===================== Toast 提示 =====================
let toastTimer = null;

function showToast(message, type = 'info') {
  // 移除旧 toast
  const oldContainer = document.querySelector('.toast-container');
  if (oldContainer) oldContainer.remove();
  if (toastTimer) clearTimeout(toastTimer);

  const container = document.createElement('div');
  container.className = 'toast-container';
  container.innerHTML = `<div class="toast ${type}">${escapeHtml(message)}</div>`;
  document.body.appendChild(container);

  toastTimer = setTimeout(() => {
    container.remove();
    toastTimer = null;
  }, 3000);
}

// ===================== 字符计数 =====================
function updateCharCount() {
  if (!DOM.charCount) return;
  const len = (DOM.noteContent.value || '').length;
  DOM.charCount.textContent = len > 0 ? `${len} 字` : '0 字';
}

function showAutoSaveIndicator() {
  if (!DOM.autoSaveIndicator) return;
  DOM.autoSaveIndicator.classList.remove('hidden');
  DOM.autoSaveIndicator.style.animation = 'none';
  // 触发回流后重新播放动画
  void DOM.autoSaveIndicator.offsetWidth;
  DOM.autoSaveIndicator.style.animation = 'fade-in-out 2s ease forwards';
}

// ===================== 自动保存（编辑器防抖保存） =====================
const autoSave = debounce(async () => {
  if (state.currentView !== 'editor' || !state.editingNoteId) return;

  const note = getNoteById(state.editingNoteId);
  if (!note) return;

  const title = DOM.noteTitle.value.trim();
  const content = DOM.noteContent.value;
  const summary = DOM.noteSummary.value;
  const categoryId = DOM.noteCategory.value;
  const tags = normalizeTags(DOM.noteTags.value);
  const pinned = DOM.notePinned && DOM.notePinned.checked;

  // 只在有变化时保存
  if (title === note.title &&
      content === note.content &&
      summary === note.summary &&
      categoryId === note.categoryId &&
      pinned === note.pinned &&
      JSON.stringify(tags) === JSON.stringify(note.tags || [])) {
    return;
  }

  await updateNote(state.editingNoteId, {
    title: title || note.title,
    content,
    summary,
    categoryId,
    tags,
    pinned
  });

  showAutoSaveIndicator();
  updateSummaryUtilityButtons();
  console.log('[SidePanel] 自动保存完成');
}, 1500);

// ===================== 事件绑定 =====================
function bindEvents() {
  // --- 搜索 ---
  DOM.searchInput.addEventListener('input', debounce(() => {
    state.searchQuery = DOM.searchInput.value.trim();
    renderNoteList();
  }, 300));

  // --- 分类筛选 ---
  DOM.categoryFilter.addEventListener('change', () => {
    state.categoryFilter = DOM.categoryFilter.value;
    renderNoteList();
  });

  // --- 排序 ---
  DOM.sortOrder.addEventListener('change', () => {
    state.sortOrder = DOM.sortOrder.value;
    renderNoteList();
  });

  // --- 导出 ---
  DOM.exportSelect.addEventListener('change', () => {
    handleExport(DOM.exportSelect.value);
  });

  // --- 新建笔记 ---
  DOM.newNoteBtn.addEventListener('click', () => {
    openEditor(null);
  });

  // --- 提取页面 ---
  DOM.extractPageBtn.addEventListener('click', startExtractPageFromUserGesture);

  // --- 总结当前网页 ---
  DOM.summarizePageBtn.addEventListener('click', summarizeCurrentPage);

  // --- 快速添加 URL ---
  DOM.quickUrlBtn.addEventListener('click', quickAddUrl);

  // --- 快速添加选中文本 ---
  DOM.quickSelectionBtn.addEventListener('click', quickAddSelection);

  // --- 设置按钮 ---
  DOM.settingsBtn.addEventListener('click', openSettings);

  // --- 笔记列表点击（事件代理） ---
  DOM.noteList.addEventListener('click', (e) => {
    // 删除按钮
    const deleteBtn = e.target.closest('[data-action="delete"]');
    if (deleteBtn) {
      e.stopPropagation();
      const noteId = deleteBtn.dataset.noteId;
      if (noteId) deleteNoteWithConfirm(noteId);
      return;
    }

    // 笔记卡片（点击进入编辑）
    const card = e.target.closest('.note-card');
    if (card) {
      const noteId = card.dataset.noteId;
      if (noteId) {
        state.activeNoteId = noteId;
        openEditor(noteId);
      }
    }
  });

  // --- 编辑器 ---
  DOM.backToListBtn.addEventListener('click', closeEditor);
  DOM.saveNoteBtn.addEventListener('click', saveCurrentNote);
  DOM.previewSummaryPayloadBtn.addEventListener('click', viewCloudSummaryPayload);
  DOM.insertSummaryBtn.addEventListener('click', insertSummaryIntoContent);
  DOM.summarizeNoteBtn.addEventListener('click', generateSummary);
  DOM.cancelSummaryBtn.addEventListener('click', cancelActiveSummary);

  // 自动保存（输入变化时触发）
  const autoSaveInputs = [DOM.noteTitle, DOM.noteContent, DOM.noteSummary, DOM.noteTags, DOM.noteCategory, DOM.notePinned];
  autoSaveInputs.forEach(el => {
    if (!el) return;
    el.addEventListener('input', autoSave);
    el.addEventListener('change', autoSave);
  });

  // 字符计数
  if (DOM.noteContent) {
    DOM.noteContent.addEventListener('input', updateCharCount);
  }
  if (DOM.noteSummary) {
    DOM.noteSummary.addEventListener('input', updateSummaryUtilityButtons);
  }

  // --- 设置面板 ---
  DOM.closeSettingsBtn.addEventListener('click', closeSettings);
  DOM.saveSettingsBtn.addEventListener('click', saveSettings);
  DOM.addCategoryBtn.addEventListener('click', addCategoryFromInput);
  DOM.newCategoryName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCategoryFromInput();
    }
  });
  DOM.categoryManager.addEventListener('change', (e) => {
    const field = e.target.closest('[data-category-field]');
    if (field) {
      updateCategoryFromField(field);
    }
  });
  DOM.categoryManager.addEventListener('keydown', (e) => {
    const field = e.target.closest('[data-category-field="name"]');
    if (field && e.key === 'Enter') {
      e.preventDefault();
      updateCategoryFromField(field);
      field.blur();
    }
  });
  DOM.categoryManager.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('[data-category-action="delete"]');
    if (!deleteBtn || deleteBtn.disabled) return;
    const categoryId = deleteBtn.closest('.category-row')?.dataset.categoryId;
    if (categoryId) {
      deleteCategoryWithConfirm(categoryId);
    }
  });

  // API 密钥显示/隐藏切换
  DOM.toggleApiKeyVisibility.addEventListener('click', () => {
    const input = DOM.llmApiKey;
    if (input.type === 'password') {
      input.type = 'text';
      DOM.toggleApiKeyVisibility.textContent = '🙈';
    } else {
      input.type = 'password';
      DOM.toggleApiKeyVisibility.textContent = '👁';
    }
  });

  // --- 键盘快捷键 ---
  document.addEventListener('keydown', (e) => {
    // Ctrl+S / Cmd+S — 保存
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (state.currentView === 'editor') {
        saveCurrentNote();
      } else if (state.currentView === 'settings') {
        saveSettings();
      }
    }

    // Escape — 返回列表
    if (e.key === 'Escape') {
      if (state.currentView === 'editor') {
        closeEditor();
      } else if (state.currentView === 'settings') {
        closeSettings();
      }
    }

    // Ctrl+N — 新建笔记
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      openEditor(null);
    }
  });
}

// ===================== 启动 =====================
document.addEventListener('DOMContentLoaded', init);

console.log('[SidePanel] 模块已加载');
