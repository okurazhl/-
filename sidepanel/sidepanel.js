/**
 * 侧边栏主逻辑
 * 负责 UI 渲染、事件处理、与 Service Worker 通信
 */

import { initStorage, getAllNotes, getNoteById, createNote, updateNote, deleteNote,
         searchNotes, getAllCategories, getCategoryById, createCategory, updateCategory,
         deleteCategory, getSettings, updateSettings, reloadStorage } from '../lib/storage.js';
import { formatDate, escapeHtml, truncate, normalizeTags, debounce } from '../lib/utils.js';
import { exportNotes } from '../lib/export.js';
import { prepareSummaryContent } from '../lib/summary-content.js';

// ===================== DOM 引用缓存 =====================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const DOM = {
  // 工具栏
  mainPageTabs: $('#mainPageTabs'),
  savedPageTab: $('#savedPageTab'),
  extractPageTab: $('#extractPageTab'),
  savedPage: $('#savedPage'),
  extractPage: $('#extractPage'),
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
  summarySourceHint: $('#summarySourceHint'),
  apiConfigHint: $('#apiConfigHint'),
  summarySaveHint: $('#summarySaveHint'),
  workflowAdvice: $('#workflowAdvice'),
  workflowAdviceText: $('#workflowAdviceText'),
  openApiSettingsBtn: $('#openApiSettingsBtn'),

  // 筛选栏
  learningSummaryPanel: $('#learningSummaryPanel'),
  toggleLearningSummaryBtn: $('#toggleLearningSummaryBtn'),
  collapseLearningSummaryBtn: $('#collapseLearningSummaryBtn'),
  learningSummaryStatus: $('#learningSummaryStatus'),
  learningPeriodTabs: $('#learningPeriodTabs'),
  summarizeLearningBtn: $('#summarizeLearningBtn'),
  categoryFilter: $('#categoryFilter'),
  sortOrder: $('#sortOrder'),
  newNoteBtn: $('#newNoteBtn'),

  // 笔记列表
  noteList: $('#noteList'),
  emptyState: $('#emptyState'),

  // 网页摘要结果
  summaryResultPanel: $('#summaryResultPanel'),
  closeSummaryResultBtn: $('#closeSummaryResultBtn'),
  openSavedSummaryBtn: $('#openSavedSummaryBtn'),
  saveSummaryResultNoteBtn: $('#saveSummaryResultNoteBtn'),
  summaryResultSavedStatus: $('#summaryResultSavedStatus'),
  summaryResultSourceBadge: $('#summaryResultSourceBadge'),
  summaryResultTitle: $('#summaryResultTitle'),
  summaryResultHost: $('#summaryResultHost'),
  summaryResultNotice: $('#summaryResultNotice'),
  summaryResultText: $('#summaryResultText'),
  summaryResultNote: $('#summaryResultNote'),
  summaryResultSource: $('#summaryResultSource'),
  summaryResultLink: $('#summaryResultLink'),
  summaryResultStateTitle: $('#summaryResultStateTitle'),
  summaryResultStateDetail: $('#summaryResultStateDetail'),

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
  editorContentBlock: $('#editorContentBlock'),
  editorContentLabel: $('#editorContentLabel'),
  noteContent: $('#noteContent'),
  protectedContentNotice: $('#protectedContentNotice'),
  noteQualityWarnings: $('#noteQualityWarnings'),
  noteSummary: $('#noteSummary'),
  notePinned: $('#notePinned'),
  noteSource: $('#noteSource'),
  noteSourceBadge: $('#noteSourceBadge'),
  sourceLink: $('#sourceLink'),
  charCount: $('#charCount'),
  editorContentFooter: $('#editorContentFooter'),
  autoSaveIndicator: $('#autoSaveIndicator'),

  // 设置面板
  settingsPanel: $('#settingsPanel'),
  closeSettingsBtn: $('#closeSettingsBtn'),
  saveSettingsBtn: $('#saveSettingsBtn'),
  llmEnabled: $('#llmEnabled'),
  llmNoiseSelectionEnabled: $('#llmNoiseSelectionEnabled'),
  llmEndpoint: $('#llmEndpoint'),
  llmApiKey: $('#llmApiKey'),
  clearApiKeyBtn: $('#clearApiKeyBtn'),
  llmModel: $('#llmModel'),
  toggleApiKeyVisibility: $('#toggleApiKeyVisibility'),
  youtubeTranscriptApiEnabled: $('#youtubeTranscriptApiEnabled'),
  youtubeTranscriptApiEndpoint: $('#youtubeTranscriptApiEndpoint'),
  youtubeTranscriptApiKey: $('#youtubeTranscriptApiKey'),
  youtubeTranscriptLanguages: $('#youtubeTranscriptLanguages'),
  toggleTranscriptApiKeyVisibility: $('#toggleTranscriptApiKeyVisibility'),
  clearTranscriptApiKeyBtn: $('#clearTranscriptApiKeyBtn'),
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
  currentView: 'list',          // 'list' | 'editor' | 'settings' | 'summaryResult'
  mainPage: 'saved',            // 'saved' | 'extract'
  settingsReturnMainPage: 'saved',
  editingNoteId: null,         // 正在编辑的笔记 ID（null = 新建模式）
  activeNoteId: null,          // 列表中高亮的笔记 ID
  searchQuery: '',
  categoryFilter: '',
  sortOrder: 'updated',
  settings: {},
  currentTab: null,
  pageAccess: 'unknown',
  pageStatusHoldUntil: 0,
  pageStatusHoldTabId: null,
  activeSummaryRequestId: null,
  activeSummaryNoteId: null,
  lastSummaryNoteId: null,
  summaryFlowStatus: 'idle',
  summaryFlowDetail: '',
  summarySourceLabel: '',
  learningSummaryPeriod: 'day',
  learningSummaryVisible: false,
  learningSummaryStatus: 'idle',
  learningSummaryDetail: '',
  pendingClearContentNoteId: null,
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
const LEARNING_SUMMARY_MAX_RECORDS = 60;
const LEARNING_RECORD_SUMMARY_LIMIT = 700;
const LEARNING_RECORD_EXCERPT_LIMIT = 180;
const LEARNING_SUMMARY_INPUT_LIMIT = 12000;

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
    showMainPage('saved', { render: false });

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

// ===================== 主页面切换 =====================
function normalizeMainPage(page) {
  return page === 'extract' ? 'extract' : 'saved';
}

function setMainPanelHidden(panel, hidden) {
  if (!panel) return;
  panel.classList.toggle('hidden', hidden);
  panel.hidden = hidden;
}

function updateMainPageTabs(activePage) {
  const tabs = [
    { page: 'saved', el: DOM.savedPageTab },
    { page: 'extract', el: DOM.extractPageTab }
  ];

  tabs.forEach(({ page, el }) => {
    if (!el) return;
    const active = page === activePage;
    el.classList.toggle('active', active);
    el.setAttribute('aria-selected', String(active));
    el.tabIndex = active ? 0 : -1;
  });
}

function hideMainPagePanels() {
  setMainPanelHidden(DOM.savedPage, true);
  setMainPanelHidden(DOM.extractPage, true);
}

function showMainPage(page = 'saved', options = {}) {
  const nextPage = normalizeMainPage(page);
  const showSaved = nextPage === 'saved';

  state.currentView = 'list';
  state.mainPage = nextPage;

  if (DOM.editorPanel) DOM.editorPanel.classList.add('hidden');
  if (DOM.summaryResultPanel) DOM.summaryResultPanel.classList.add('hidden');
  if (DOM.settingsPanel) DOM.settingsPanel.classList.add('hidden');
  if (DOM.noteList) DOM.noteList.style.display = '';

  setMainPanelHidden(DOM.savedPage, !showSaved);
  setMainPanelHidden(DOM.extractPage, showSaved);
  updateMainPageTabs(nextPage);

  if (showSaved && options.render !== false) {
    renderNoteList();
  }
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

function getLearningPeriodConfig(period = state.learningSummaryPeriod) {
  const configs = {
    day: { label: '本日', title: '本日学习总结' },
    week: { label: '本周', title: '本周学习总结' },
    month: { label: '本月', title: '本月学习总结' }
  };
  return configs[period] || configs.day;
}

function getLearningSummaryRange(period = state.learningSummaryPeriod, nowDate = new Date()) {
  const now = new Date(nowDate.getTime());
  const start = new Date(now.getTime());

  if (period === 'month') {
    start.setDate(1);
  } else if (period === 'week') {
    const weekday = start.getDay();
    const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
    start.setDate(start.getDate() - daysFromMonday);
  }

  start.setHours(0, 0, 0, 0);

  return {
    period: period || 'day',
    periodLabel: getLearningPeriodConfig(period).label,
    start: start.getTime(),
    end: now.getTime(),
    rangeLabel: `${formatDate(start.getTime(), 'date')} ${formatDate(start.getTime(), 'time')} - ${formatDate(now.getTime(), 'date')} ${formatDate(now.getTime(), 'time')}`
  };
}

function getSummaryRecordTime(note = {}) {
  return note.summarySavedAt || note.updatedAt || note.createdAt || 0;
}

function cleanLearningPromptText(text, maxLength) {
  const value = String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return truncate(value, maxLength);
}

function getLearningSummarySelection(period = state.learningSummaryPeriod) {
  const range = getLearningSummaryRange(period);
  const notes = getAllNotes()
    .filter(note => {
      if (!note || note.type === 'learning-summary') return false;
      if (!String(note.summary || '').trim()) return false;
      const recordTime = getSummaryRecordTime(note);
      return recordTime >= range.start && recordTime <= range.end;
    })
    .sort((a, b) => getSummaryRecordTime(a) - getSummaryRecordTime(b));

  return { ...range, notes };
}

function getLearningSummaryTitle(selection) {
  const config = getLearningPeriodConfig(selection.period);
  const startDate = formatDate(selection.start, 'date');
  const endDate = formatDate(selection.end, 'date');
  const dateLabel = startDate === endDate ? startDate : `${startDate} 至 ${endDate}`;
  return `${config.title}（${dateLabel}）`;
}

function getCategoryNameMap() {
  const map = {};
  getAllCategories().forEach(category => {
    map[category.id] = category.name;
  });
  return map;
}

function buildLearningSummaryInput(selection) {
  const categoryMap = getCategoryNameMap();
  const allNotes = selection.notes || [];
  const selectedNotes = allNotes.length > LEARNING_SUMMARY_MAX_RECORDS ?
    allNotes.slice(-LEARNING_SUMMARY_MAX_RECORDS) :
    allNotes;
  const omittedCount = Math.max(0, allNotes.length - selectedNotes.length);

  const lines = [
    `周期：${selection.periodLabel}`,
    `范围：${selection.rangeLabel}`,
    `摘要记录总数：${allNotes.length}`,
    `发送记录数：${selectedNotes.length}`,
    omittedCount > 0 ? `说明：较早的 ${omittedCount} 条记录因数量限制未发送。` : '',
    '',
    '摘要记录：'
  ].filter(Boolean);

  selectedNotes.forEach((note, index) => {
    const tags = Array.isArray(note.tags) && note.tags.length ? note.tags.join('、') : '无';
    const categoryName = categoryMap[note.categoryId] || '未分类';
    const sourceHost = getHostname(note.url) || '本地笔记';
    const summary = cleanLearningPromptText(note.summary, LEARNING_RECORD_SUMMARY_LIMIT);
    const excerptSource = note.excerpt || (!isProtectedContentNote(note) ? note.content : '');
    const excerpt = cleanLearningPromptText(excerptSource, LEARNING_RECORD_EXCERPT_LIMIT);

    lines.push(
      '',
      `#${index + 1}`,
      `时间：${formatDate(getSummaryRecordTime(note), 'full')}`,
      `标题：${note.title || '未命名笔记'}`,
      `分类：${categoryName}`,
      `标签：${tags}`,
      `来源：${sourceHost}`,
      `摘要：${summary || '(空)'}`,
      excerpt ? `正文摘录：${excerpt}` : ''
    );
  });

  let recordsText = lines.filter(line => line !== '').join('\n');
  let truncated = false;
  if (recordsText.length > LEARNING_SUMMARY_INPUT_LIMIT) {
    recordsText = `${recordsText.slice(0, LEARNING_SUMMARY_INPUT_LIMIT).trimEnd()}\n\n[因长度限制，后续摘要记录已截断。]`;
    truncated = true;
  }

  return {
    ...selection,
    title: getLearningSummaryTitle(selection),
    selectedCount: selectedNotes.length,
    omittedCount,
    truncated,
    recordsText
  };
}

function updateLearningSummaryControls() {
  if (!DOM.learningSummaryPanel) return;

  const selection = getLearningSummarySelection(state.learningSummaryPeriod);
  const llmStatus = getLlmConfigStatus();
  const isBusy = !!state.activeSummaryRequestId;
  const isGenerating = state.learningSummaryStatus === 'generating';
  const disabled = isBusy || !llmStatus.configured || selection.notes.length === 0;
  const periodLabel = getLearningPeriodConfig(state.learningSummaryPeriod).label;
  const visible = !!state.learningSummaryVisible;

  DOM.learningSummaryPanel.classList.toggle('hidden', !visible);

  if (DOM.toggleLearningSummaryBtn) {
    const buttonLabel = isGenerating ? '生成中' : '复盘';
    const titleText = !llmStatus.configured ?
      `学习总结：${llmStatus.detail}` :
      `学习总结：${periodLabel} ${selection.notes.length} 条摘要记录`;
    DOM.toggleLearningSummaryBtn.textContent = buttonLabel;
    DOM.toggleLearningSummaryBtn.title = visible ? '收起学习总结' : `${titleText}，点击展开`;
    DOM.toggleLearningSummaryBtn.setAttribute('aria-expanded', String(visible));
    DOM.toggleLearningSummaryBtn.classList.toggle('active', visible);
    DOM.toggleLearningSummaryBtn.classList.toggle('warning', !llmStatus.configured || state.learningSummaryStatus === 'error');
    DOM.toggleLearningSummaryBtn.classList.toggle('success', state.learningSummaryStatus === 'saved');
  }

  if (DOM.learningPeriodTabs) {
    DOM.learningPeriodTabs.querySelectorAll('[data-learning-period]').forEach(btn => {
      const active = btn.dataset.learningPeriod === state.learningSummaryPeriod;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
      btn.disabled = isBusy;
    });
  }

  if (DOM.summarizeLearningBtn) {
    DOM.summarizeLearningBtn.disabled = disabled;
    DOM.summarizeLearningBtn.setAttribute('aria-disabled', String(disabled));
    DOM.summarizeLearningBtn.textContent = isGenerating ? '生成中...' : '生成总结';
    DOM.summarizeLearningBtn.title = !llmStatus.configured ?
      llmStatus.detail :
      (selection.notes.length === 0 ? `${periodLabel}没有可总结的摘要记录` : '');
  }

  if (DOM.learningSummaryStatus) {
    let statusText = `${periodLabel} ${selection.notes.length} 条摘要记录`;
    if (!llmStatus.configured) {
      statusText = '未配置云端摘要';
    } else if (state.learningSummaryDetail) {
      statusText = state.learningSummaryDetail;
    } else if (selection.notes.length === 0) {
      statusText = `${periodLabel}暂无摘要记录`;
    }

    DOM.learningSummaryStatus.textContent = statusText;
    DOM.learningSummaryStatus.classList.toggle('success', state.learningSummaryStatus === 'saved');
    DOM.learningSummaryStatus.classList.toggle('warning', state.learningSummaryStatus === 'error' || !llmStatus.configured);
  }
}

function setLearningSummaryStatus(status = 'idle', detail = '') {
  state.learningSummaryStatus = status || 'idle';
  state.learningSummaryDetail = detail || '';
  updateLearningSummaryControls();
}

function setLearningSummaryVisible(visible) {
  state.learningSummaryVisible = !!visible;
  updateLearningSummaryControls();
}

function isYouTubeUrl(url) {
  try {
    const host = new URL(url || '').hostname.toLowerCase();
    return /(^|\.)youtube\.com$/.test(host) || /(^|\.)youtu\.be$/.test(host);
  } catch (err) {
    return false;
  }
}

function getLikelySummarySourceLabel(tab) {
  if (state.summarySourceLabel && state.summaryFlowStatus !== 'idle') return state.summarySourceLabel;
  if (!tab || state.pageAccess !== 'ready') return '等待检测';
  if (isYouTubeUrl(tab.url)) return '优先 YouTube 字幕；无字幕时用描述';
  return '网页正文；有选区时优先选中文字';
}

function getLlmConfigStatus() {
  const config = buildLlmConfig(getSettings());

  if (isCloudLlmConfigured(config)) {
    return {
      configured: true,
      label: `已配置 ${config.model || '模型'}`,
      detail: '点击主按钮即可生成摘要'
    };
  }

  if (!config.enabled) {
    return {
      configured: false,
      label: '未启用',
      detail: '请在设置中启用云端摘要'
    };
  }

  if (!config.endpoint && !config.apiKey) {
    return {
      configured: false,
      label: '缺少地址和密钥',
      detail: '请填写 API 地址和 API 密钥'
    };
  }

  if (!config.endpoint) {
    return {
      configured: false,
      label: '缺少 API 地址',
      detail: '请在设置中填写 API 地址'
    };
  }

  if (!config.apiKey) {
    return {
      configured: false,
      label: '缺少 API Key',
      detail: '请在设置中填写 API 密钥'
    };
  }

  return {
    configured: false,
    label: '配置不完整',
    detail: '请检查 API 地址、密钥和启用状态'
  };
}

function setWorkflowAdvice(message = '', showApiAction = false) {
  if (!DOM.workflowAdvice || !DOM.workflowAdviceText) return;
  DOM.workflowAdvice.classList.toggle('hidden', !message);
  DOM.workflowAdviceText.textContent = message || '';
  if (DOM.openApiSettingsBtn) {
    DOM.openApiSettingsBtn.classList.toggle('hidden', !showApiAction);
  }
}

function updateWorkflowHints() {
  const llmStatus = getLlmConfigStatus();

  if (DOM.summarySourceHint) {
    DOM.summarySourceHint.textContent = getLikelySummarySourceLabel(state.currentTab);
  }

  if (DOM.apiConfigHint) {
    DOM.apiConfigHint.textContent = llmStatus.label;
    DOM.apiConfigHint.classList.toggle('hint-ok', llmStatus.configured);
    DOM.apiConfigHint.classList.toggle('hint-warn', !llmStatus.configured);
  }

  if (DOM.summarySaveHint) {
    const saveLabels = {
      idle: '生成后自动保存',
      generating: state.summaryFlowDetail ? `生成中：${state.summaryFlowDetail}` : '正在生成，完成后自动保存',
      saved: state.summaryFlowDetail || '已自动保存到本地',
      error: state.summaryFlowDetail || '未保存，请按提示处理后重试'
    };
    DOM.summarySaveHint.textContent = saveLabels[state.summaryFlowStatus] || saveLabels.idle;
    DOM.summarySaveHint.classList.toggle('hint-ok', state.summaryFlowStatus === 'saved');
    DOM.summarySaveHint.classList.toggle('hint-warn', state.summaryFlowStatus === 'error' || state.summaryFlowStatus === 'generating');
  }

  if (state.pageAccess === 'ready' && !llmStatus.configured) {
    setWorkflowAdvice(`${llmStatus.detail}，配置后即可使用“总结并自动保存”。`, true);
  } else {
    setWorkflowAdvice('');
  }
}

function setSummaryFlowStatus(status, detail = '', sourceLabel = '') {
  state.summaryFlowStatus = status || 'idle';
  state.summaryFlowDetail = detail || '';
  if (sourceLabel) state.summarySourceLabel = sourceLabel;
  else if (state.summaryFlowStatus === 'idle' || state.summaryFlowStatus === 'error') state.summarySourceLabel = '';
  updateWorkflowHints();
}

function setActionButtonsEnabled(enabled) {
  const isBusy = !!state.activeSummaryRequestId;
  const llmStatus = getLlmConfigStatus();
  const pageActionDisabled = !enabled || isBusy;

  [DOM.extractPageBtn, DOM.quickUrlBtn, DOM.quickSelectionBtn].forEach(btn => {
    if (!btn) return;
    btn.disabled = pageActionDisabled;
    btn.setAttribute('aria-disabled', String(pageActionDisabled));
  });

  if (DOM.summarizePageBtn) {
    const disabled = !enabled || isBusy || !llmStatus.configured;
    DOM.summarizePageBtn.disabled = disabled;
    DOM.summarizePageBtn.setAttribute('aria-disabled', String(disabled));
  }

  const title = enabled ? '' : '请先在目标网页点击扩展图标打开侧边栏';
  const summaryTitle = !enabled ? title :
    (!llmStatus.configured ? `${llmStatus.detail}后再总结` : '');
  if (DOM.extractPageBtn) DOM.extractPageBtn.title = title;
  if (DOM.summarizePageBtn) DOM.summarizePageBtn.title = summaryTitle;
  if (DOM.quickUrlBtn) DOM.quickUrlBtn.title = title;
  if (DOM.quickSelectionBtn) DOM.quickSelectionBtn.title = title;

  updateWorkflowHints();
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
    state.summarySourceLabel = '';
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
    state.summarySourceLabel = '';
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
    state.summarySourceLabel = '';
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
    state.summarySourceLabel = '';
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
  const llmStatus = getLlmConfigStatus();
  const sourceLabel = getLikelySummarySourceLabel(tab);
  setActionButtonsEnabled(true);
  setPageStatus(
    llmStatus.configured ? 'success' : 'warning',
    llmStatus.configured ? '当前网页可以总结' : '当前网页可读取，摘要服务未配置',
    llmStatus.configured ?
      `${sourceLabel}；点击“总结并自动保存”开始。` :
      `${llmStatus.detail}；仍可先提取成笔记或保存链接。`,
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

function isYouTubeNote(note = {}) {
  const url = note.url || '';
  try {
    const host = new URL(url).hostname.toLowerCase();
    return /(^|\.)youtube\.com$/.test(host) || /(^|\.)youtu\.be$/.test(host);
  } catch (err) {
    return false;
  }
}

function isSummaryOnlyNote(note = {}) {
  return ['summarized', 'learning-summary'].includes(note.type) && !!(note.summary || '').trim();
}

function isProtectedContentNote(note = {}) {
  return note.type === 'extracted' && !!(note.content || '').trim();
}

function getContentSourceView(note = {}) {
  const method = String(note.extractionMethod || note.method || '').toLowerCase();
  if (note.type === 'learning-summary') {
    return { label: '学习记录', kind: 'learning', detail: '本地摘要记录' };
  }

  if (method === 'selected-text' || method === 'selection' || note.type === 'quick-selection') {
    return { label: '选中文字', kind: 'selection', detail: '当前网页选中文字' };
  }

  if (isYouTubeNote(note)) {
    if (method === 'youtube-transcript' || method.includes('youtube-transcript')) {
      return { label: 'YouTube 字幕', kind: 'transcript', detail: 'YouTube 字幕' };
    }
    return { label: 'YouTube 描述', kind: 'description', detail: 'YouTube 描述/标题/章节' };
  }

  if (note.url || note.type === 'extracted' || note.type === 'summarized') {
    return { label: '网页正文', kind: 'web', detail: '网页正文' };
  }

  return { label: '笔记', kind: 'note', detail: '本地笔记' };
}

function getLocalSaveView(note = {}) {
  const savedAt = note.summarySavedAt || note.updatedAt || note.createdAt || null;
  return {
    label: '已保存到本地',
    savedAt,
    detail: savedAt ? formatDate(savedAt, 'datetime') : ''
  };
}

function getNotePreviewText(note = {}) {
  if ((note.summary || '').trim()) return truncate(note.summary, 120);
  if (isProtectedContentNote(note)) {
    return isYouTubeNote(note) ? '已保存视频内容，可生成摘要' : '已保存网页正文，可生成摘要';
  }
  if ((note.excerpt || '').trim()) return note.excerpt;
  return truncate(note.content || '', 100);
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
      'learning-summary': '学习',
      'quick-url': '链接',
      'quick-selection': '选中'
    };
    const typeLabel = typeLabels[note.type] || '手动';
    const sourceView = getContentSourceView(note);
    const saveView = getLocalSaveView(note);

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
          <span class="note-card-excerpt">${escapeHtml(getNotePreviewText(note))}</span>
          <span class="note-card-date">${dateStr}</span>
          <button class="note-card-delete" data-action="delete" data-note-id="${escapeHtml(note.id)}"
                  title="删除笔记">✕</button>
        </div>
        <div class="note-card-context">
          <span class="source-badge source-${sourceView.kind}">${escapeHtml(sourceView.label)}</span>
          <span class="save-badge">${escapeHtml(saveView.label)}</span>
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
  updateLearningSummaryControls();
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
    default:
      return sorted.sort((a, b) => pinnedFirst(a, b) || (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  }
}

/** 打开编辑器 */
function setEditorContentVisible(visible) {
  if (DOM.editorContentBlock) {
    DOM.editorContentBlock.classList.toggle('hidden', !visible);
  }
  if (DOM.noteContent) {
    DOM.noteContent.classList.toggle('hidden', !visible);
  }
  if (DOM.editorContentFooter) {
    DOM.editorContentFooter.classList.toggle('hidden', !visible);
  }
}

function renderProtectedContentNotice(note = {}) {
  if (!DOM.protectedContentNotice) return;

  if (!isProtectedContentNote(note)) {
    DOM.protectedContentNotice.classList.add('hidden');
    DOM.protectedContentNotice.textContent = '';
    return;
  }

  const sourceView = getContentSourceView(note);
  const length = (note.content || '').length;
  const lengthText = length > 0 ? ` · ${length} 字` : '';
  DOM.protectedContentNotice.classList.remove('hidden');
  DOM.protectedContentNotice.textContent =
    `原始${sourceView.label}${lengthText}已保存在本地，用于生成摘要；侧边栏不展示完整内容。`;
}

function renderEditorSource(note = {}) {
  if (!DOM.noteSource) return;

  if (!note.url) {
    DOM.noteSource.classList.add('hidden');
    return;
  }

  const sourceView = getContentSourceView(note);
  DOM.noteSource.classList.remove('hidden');
  if (DOM.noteSourceBadge) {
    DOM.noteSourceBadge.textContent = sourceView.label;
    DOM.noteSourceBadge.className = `source-badge source-${sourceView.kind}`;
  }
  if (DOM.sourceLink) {
    DOM.sourceLink.href = note.url;
    DOM.sourceLink.textContent = note.sourceTitle || note.url;
  }
}

function configureEditorContentArea(note = {}) {
  const summaryNote = isSummaryOnlyNote(note);
  const protectedContent = isProtectedContentNote(note);

  if (DOM.editorContentLabel) {
    DOM.editorContentLabel.textContent = summaryNote ? '我的笔记' : '笔记正文';
  }

  if (DOM.noteContent) {
    DOM.noteContent.placeholder = summaryNote ?
      '在这里补充你的想法；摘要会保留在上方。' :
      '在此输入笔记内容...';
  }

  setEditorContentVisible(!protectedContent);
  renderProtectedContentNotice(note);
}

function openEditor(noteId = null) {
  state.currentView = 'editor';
  state.editingNoteId = noteId;

  // 切换面板
  hideMainPagePanels();
  DOM.editorPanel.classList.remove('hidden');
  if (DOM.summaryResultPanel) DOM.summaryResultPanel.classList.add('hidden');
  DOM.noteList.style.display = 'none';
  DOM.settingsPanel.classList.add('hidden');

  // 填充分类下拉
  renderCategoryOptions();

  if (noteId) {
    // 编辑已有笔记
    const note = getNoteById(noteId);
    if (note) {
      const summaryOnly = isSummaryOnlyNote(note);
      DOM.noteTitle.value = note.title || '';
      DOM.noteCategory.value = note.categoryId || '';
      DOM.noteTags.value = (note.tags || []).join(', ');
      DOM.noteContent.value = note.content || '';
      configureEditorContentArea(note);
      if (summaryOnly) {
        renderQualityWarnings({});
      } else {
        renderQualityWarnings(note);
      }
      DOM.noteSummary.value = note.summary || '';
      DOM.notePinned.checked = note.pinned || false;

      renderEditorSource(note);

      DOM.summarizeNoteBtn.style.display = summaryOnly ? 'none' : '';
      configureEditorContentArea(note);
    }
  } else {
    // 新建笔记
    DOM.noteTitle.value = '';
    DOM.noteCategory.value = state.settings.defaultCategoryId || '';
    DOM.noteTags.value = '';
    DOM.noteContent.value = '';
    configureEditorContentArea({});
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
  state.editingNoteId = null;
  state.pendingClearContentNoteId = null;

  DOM.editorPanel.classList.add('hidden');
  DOM.noteList.style.display = '';
  DOM.settingsPanel.classList.add('hidden');
  if (DOM.summaryResultPanel) DOM.summaryResultPanel.classList.add('hidden');

  showMainPage('saved');
}

function isClearingExistingEditableContent(note, nextContent) {
  return !!note &&
    !isProtectedContentNote(note) &&
    !!String(note.content || '').trim() &&
    !String(nextContent || '').trim();
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
      const existingNote = getNoteById(state.editingNoteId);
      if (isClearingExistingEditableContent(existingNote, content)) {
        const confirmed = confirm('确定清空这条笔记正文吗？\n摘要、标题和来源信息会保留，但正文内容会被清空。');
        if (!confirmed) {
          DOM.noteContent.value = existingNote.content || '';
          updateCharCount();
          return;
        }
      }

      const updated = await updateNote(state.editingNoteId, {
        title,
        content,
        categoryId,
        tags,
        summary,
        pinned
      });
      if (updated) {
        state.pendingClearContentNoteId = null;
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
        qualityWarnings: Array.isArray(extraData.qualityWarnings) ? extraData.qualityWarnings : [],
        imageOcr: extraData.imageOcr || null,
        noiseSelectionMethod: extraData.noiseSelectionMethod || '',
        noiseSelectionConfidence: typeof extraData.noiseSelectionConfidence === 'number' ? extraData.noiseSelectionConfidence : null,
        noiseSelectionReason: extraData.noiseSelectionReason || ''
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
  state.settingsReturnMainPage = state.mainPage || 'saved';
  state.currentView = 'settings';

  hideMainPagePanels();
  DOM.settingsPanel.classList.remove('hidden');
  DOM.noteList.style.display = 'none';
  DOM.editorPanel.classList.add('hidden');
  if (DOM.summaryResultPanel) DOM.summaryResultPanel.classList.add('hidden');

  // 填充当前设置
  const settings = getSettings();
  DOM.llmEnabled.checked = settings.llm?.enabled || false;
  if (DOM.llmNoiseSelectionEnabled) {
    DOM.llmNoiseSelectionEnabled.checked = settings.llm?.noiseSelectionEnabled || false;
  }
  DOM.llmEndpoint.value = settings.llm?.apiEndpoint || '';
  DOM.llmApiKey.value = settings.llm?.apiKey || '';
  DOM.llmModel.value = settings.llm?.model || 'gpt-4o-mini';
  if (DOM.youtubeTranscriptApiEnabled) {
    DOM.youtubeTranscriptApiEnabled.checked = !!settings.youtubeTranscriptApi?.enabled;
  }
  if (DOM.youtubeTranscriptApiEndpoint) {
    DOM.youtubeTranscriptApiEndpoint.value = settings.youtubeTranscriptApi?.endpoint || '';
  }
  if (DOM.youtubeTranscriptApiKey) {
    DOM.youtubeTranscriptApiKey.value = settings.youtubeTranscriptApi?.apiKey || '';
  }
  if (DOM.youtubeTranscriptLanguages) {
    DOM.youtubeTranscriptLanguages.value = formatLanguagePreference(settings.youtubeTranscriptApi?.preferredLanguages);
  }
  DOM.themeSelect.value = settings.theme || 'light';
  DOM.fontSizeRange.value = settings.fontSize || 14;
  renderCategoryOptions();
  renderCategoryManager();
  DOM.defaultCategorySelect.value = settings.defaultCategoryId || DOM.defaultCategorySelect.value || '';
  DOM.summaryLengthSelect.value = settings.summaryLength || 'medium';
  DOM.autoSummarizeCheck.checked = settings.autoSummarize || false;
}

function closeSettings() {
  const returnPage = state.settingsReturnMainPage || state.mainPage || 'saved';
  state.settingsReturnMainPage = 'saved';

  DOM.settingsPanel.classList.add('hidden');
  DOM.noteList.style.display = '';

  showMainPage(returnPage);
}

async function saveSettings() {
  try {
    const normalizedEndpoint = normalizeLlmEndpoint(DOM.llmEndpoint.value);
    const normalizedTranscriptEndpoint = normalizeTranscriptApiEndpoint(DOM.youtubeTranscriptApiEndpoint?.value || '');
    const llmApiKey = DOM.llmApiKey.value.trim();
    const llmEnabled = DOM.llmEnabled.checked;
    const requestedAutoSummarize = DOM.autoSummarizeCheck.checked;
    const canAutoSummarize = llmEnabled && !!normalizedEndpoint && !!llmApiKey;
    const newSettings = {
      llm: {
        apiEndpoint: normalizedEndpoint,
        apiKey: llmApiKey,
        model: DOM.llmModel.value.trim() || 'gpt-4o-mini',
        enabled: llmEnabled,
        noiseSelectionEnabled: !!DOM.llmNoiseSelectionEnabled?.checked
      },
      youtubeTranscriptApi: {
        enabled: !!DOM.youtubeTranscriptApiEnabled?.checked,
        endpoint: normalizedTranscriptEndpoint,
        apiKey: DOM.youtubeTranscriptApiKey?.value.trim() || '',
        preferredLanguages: parseLanguagePreference(DOM.youtubeTranscriptLanguages?.value || ''),
        timeoutMs: 20000
      },
      theme: DOM.themeSelect.value,
      fontSize: parseInt(DOM.fontSizeRange.value, 10),
      defaultCategoryId: DOM.defaultCategorySelect.value,
      summaryLength: DOM.summaryLengthSelect.value,
      autoSummarize: requestedAutoSummarize && canAutoSummarize
    };

    await updateSettings(newSettings);
    state.settings = getSettings();
    DOM.llmEndpoint.value = normalizedEndpoint;
    if (DOM.youtubeTranscriptApiEndpoint) {
      DOM.youtubeTranscriptApiEndpoint.value = normalizedTranscriptEndpoint;
    }
    if (DOM.youtubeTranscriptLanguages) {
      DOM.youtubeTranscriptLanguages.value = formatLanguagePreference(newSettings.youtubeTranscriptApi.preferredLanguages);
    }
    if (DOM.autoSummarizeCheck) {
      DOM.autoSummarizeCheck.checked = newSettings.autoSummarize;
    }

    // 应用主题和字号
    applyTheme(newSettings.theme);
    applyFontSize(newSettings.fontSize);
    updatePageStatusFromTab(state.currentTab, { force: true });
    updateWorkflowHints();
    if (state.learningSummaryStatus === 'error') {
      setLearningSummaryStatus('idle');
    } else {
      updateLearningSummaryControls();
    }

    if (requestedAutoSummarize && !canAutoSummarize) {
      showToast('云端摘要未配置完整，已关闭自动摘要', 'warning');
    } else {
      showToast('设置已保存', 'success');
    }
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
    state.summarySourceLabel = '';
    updateWorkflowHints();
    return null;
  }

  const previousUrl = state.currentTab?.url || '';
  state.currentTab = {
    id: tab.id,
    windowId: tab.windowId,
    url: tab.url || '',
    title: tab.title || '',
    source: tab.source || '',
    updatedAt: tab.updatedAt || null
  };

  if (previousUrl && previousUrl !== state.currentTab.url) {
    state.summaryFlowStatus = 'idle';
    state.summaryFlowDetail = '';
    state.summarySourceLabel = '';
    state.lastSummaryNoteId = null;
  }

  updateWorkflowHints();
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
    showToast('无法获取当前标签页：请切换到目标网页后重新打开侧边栏', 'error');
  } else if (isRestrictedPageUrl(tab.url)) {
    const friendly = getFriendlyErrorView(tab.url || 'restricted', '页面读取');
    showToast(`${friendly.title}：${friendly.detail}`, friendly.type);
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

function getFriendlyErrorView(rawError, context = '摘要') {
  const message = String(rawError || '').trim();
  const lower = message.toLowerCase();

  if (isMissingHostPermissionError(message)) {
    return {
      type: 'warning',
      title: '需要重新授权当前网页',
      detail: '请回到目标网页，点击扩展图标重新打开侧边栏后再试。'
    };
  }

  if (/chrome:|chrome-extension:|edge:|about:|view-source:|file:|系统页面|扩展页面|本地文件|restricted/i.test(message)) {
    return {
      type: 'warning',
      title: '这个页面无法读取',
      detail: '系统页面、扩展页面和本地文件页面不支持内容提取。'
    };
  }

  if (/no_content|空内容|返回空内容|内容为空|未找到|无法生成可靠摘要|too short|empty/i.test(message)) {
    return {
      type: 'warning',
      title: '没有找到可总结的内容',
      detail: '可以换一个正文更完整的页面，或手动新建笔记。'
    };
  }

  if (/timeout|timed out|超时/i.test(lower) || /超时/.test(message)) {
    return {
      type: 'warning',
      title: `${context}用时较长`,
      detail: '本次请求已停止，请稍后重试或缩短待总结内容。'
    };
  }

  if (/API 返回错误 \((400|404)\)|model|模型|not found|invalid/i.test(message)) {
    return {
      type: 'error',
      title: '摘要服务配置可能有问题',
      detail: '请重点检查 API 地址是否包含 /chat/completions，以及模型名称是否被服务商支持。'
    };
  }

  if (/cors|跨域|Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return {
      type: 'error',
      title: '摘要服务连接失败',
      detail: '请确认 API 地址可访问，并允许浏览器扩展跨域请求。'
    };
  }

  if (/api|apikey|api key|authorization|unauthorized|401|403|endpoint|fetch failed|network/i.test(lower) ||
      /未配置云端摘要|云端 LLM 未配置|API 地址|API 密钥|密钥/.test(message)) {
    return {
      type: 'error',
      title: '摘要服务配置可能有问题',
      detail: '请检查 API 地址、密钥和网络连接后再试。'
    };
  }

  if (/youtube|transcript|字幕|caption/i.test(lower) || /字幕/.test(message)) {
    return {
      type: 'warning',
      title: '字幕暂时不可用',
      detail: '如果页面有视频描述，会优先基于描述、标题和章节生成摘要。'
    };
  }

  return {
    type: 'error',
    title: `${context}失败`,
    detail: '没能完成这次操作，请稍后重试。'
  };
}

function showFriendlyToast(rawError, context = '摘要') {
  const view = getFriendlyErrorView(rawError, context);
  showToast(`${view.title}：${view.detail}`, view.type);
  return view;
}

function buildLlmConfig(settings) {
  return {
    endpoint: settings.llm?.apiEndpoint || '',
    apiKey: settings.llm?.apiKey || '',
    model: settings.llm?.model || 'gpt-4o-mini',
    enabled: settings.llm?.enabled || false,
    noiseSelectionEnabled: settings.llm?.noiseSelectionEnabled || false,
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
    const endpointWithProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ?
      raw :
      (/^(localhost|127\.|0\.0\.0\.0|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/i.test(raw) ? `http://${raw}` : `https://${raw}`);
    const url = new URL(endpointWithProtocol);
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

function normalizeTranscriptApiEndpoint(endpoint) {
  const raw = String(endpoint || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    const path = url.pathname.replace(/\/+$/, '');
    if (!path) {
      url.pathname = '/v1/youtube/transcript';
    } else if (/^\/v\d+$/i.test(path)) {
      url.pathname = `${path}/youtube/transcript`;
    }
    return url.toString();
  } catch (err) {
    return raw;
  }
}

function parseLanguagePreference(value) {
  const languages = String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  return languages.length ? languages : ['zh-CN', 'zh', 'en'];
}

function formatLanguagePreference(languages) {
  const safeLanguages = Array.isArray(languages) ? languages.map(item => String(item || '').trim()).filter(Boolean) : [];
  return (safeLanguages.length ? safeLanguages : ['zh-CN', 'zh', 'en']).join(', ');
}

function isCloudLlmConfigured(config) {
  return !!(config && config.enabled && config.apiKey && config.endpoint);
}

function getCloudSummaryConfigError() {
  return '未配置云端摘要，请先在设置中启用云端摘要并填写 API 地址和密钥。';
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
    .replace(/图片内容：[\s\S]*?(?=\n\n图片 OCR 文字：|$)/, '')
    .replace(/图片 OCR 文字：/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .trim();
  if (/图片内容：/.test(content) && !/图片 OCR 文字：/.test(content) && nonImageText.length < 220) {
    warnings.push('页面正文可能主要在图片中；当前未能读取图片文字。');
  }

  const imageOcr = noteOrData.imageOcr || null;
  if (imageOcr && imageOcr.imageCount > 0) {
    const recognized = Number(imageOcr.recognizedCount || 0);
    const failed = Number(imageOcr.failedCount || 0);
    if (recognized > 0) {
      warnings.push(failed > 0
        ? `已识别 ${recognized} 张图片文字，${failed} 张图片识别失败。`
        : `已识别 ${recognized} 张图片文字。`);
    } else if (imageOcr.supported === false && nonImageText.length < 220) {
      warnings.push('当前浏览器未提供可用 OCR 能力，图片文字可能无法读取。');
    } else if (imageOcr.attempted && failed > 0) {
      warnings.push(`已尝试识别图片文字，但 ${failed} 张图片识别失败或超时。`);
    }
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
    'chat-conversation': '对话/聊天记录页',
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
  if (pageType === 'chat-conversation') {
    return '当前是对话/聊天记录页，摘要基于页面中可见的消息内容。';
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
  return '';
}

function getCurrentEditorNoteSnapshot() {
  if (!state.editingNoteId) return null;
  const note = getNoteById(state.editingNoteId);
  if (!note) return null;

  return {
    ...note,
    title: DOM.noteTitle.value.trim() || note.title,
    content: isProtectedContentNote(note) ? (note.content || '') : (DOM.noteContent.value || ''),
    summary: DOM.noteSummary.value || ''
  };
}

function updateSummaryUtilityButtons() {
  const note = getCurrentEditorNoteSnapshot();
  const settings = getSettings();
  const llmConfig = buildLlmConfig(settings);
  const hasSummary = !!(DOM.noteSummary?.value || '').trim();
  const summaryOnly = isSummaryOnlyNote(note);
  const protectedContent = isProtectedContentNote(note);
  const canPreview = !!(note && note.content && !summaryOnly && !protectedContent && isCloudLlmConfigured(llmConfig));

  if (DOM.insertSummaryBtn) {
    DOM.insertSummaryBtn.classList.toggle('hidden', !hasSummary || summaryOnly || protectedContent);
  }

  if (DOM.previewSummaryPayloadBtn) {
    DOM.previewSummaryPayloadBtn.classList.toggle('hidden', !canPreview);
  }
}

function setSummaryGeneratingState(isGenerating, requestId = null) {
  const isActive = !!isGenerating;
  if (DOM.summarizeNoteBtn) {
    DOM.summarizeNoteBtn.disabled = isActive;
    DOM.summarizeNoteBtn.textContent = isActive ? '生成中...' : '✨ 生成摘要';
  }
  if (DOM.cancelSummaryBtn) {
    DOM.cancelSummaryBtn.classList.toggle('hidden', !isActive);
    DOM.cancelSummaryBtn.disabled = !isActive;
  }
  if (DOM.summarizePageBtn) {
    DOM.summarizePageBtn.disabled = isActive || state.pageAccess !== 'ready';
    DOM.summarizePageBtn.setAttribute('aria-disabled', String(DOM.summarizePageBtn.disabled));
    DOM.summarizePageBtn.textContent = isActive ? '正在总结...' : '总结并自动保存';
  }
  if (requestId) {
    state.activeSummaryRequestId = requestId;
    setSummaryFlowStatus('generating', state.summaryFlowDetail || '准备中');
  } else if (!isActive) {
    state.activeSummaryRequestId = null;
    state.activeSummaryNoteId = null;
    if (state.summaryFlowStatus === 'generating') {
      setSummaryFlowStatus('idle');
    }
  }
  setActionButtonsEnabled(state.pageAccess === 'ready');
  updateLearningSummaryControls();
}

function setSummaryStage(label) {
  if (!state.activeSummaryRequestId || !label) return;
  if (state.activeSummaryNoteId && DOM.summarizeNoteBtn) {
    DOM.summarizeNoteBtn.textContent = label;
  } else if (DOM.summarizePageBtn) {
    DOM.summarizePageBtn.textContent = label;
    setPageStatus(
      'info',
      '摘要正在生成',
      `${label}；完成后会自动保存到本地。`,
      { holdFor: 60000, tabId: state.currentTab?.id || null }
    );
  }
  setSummaryFlowStatus('generating', label);
}

function getSummaryMethodName(method) {
  const methodNames = {
    'llm': '云端 LLM',
    'llm-learning': '云端 LLM 学习总结'
  };
  return methodNames[method] || method || '未知';
}

function createTextEl(tag, text, className = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = text;
  return el;
}

function normalizeUrlForCompare(url) {
  try {
    const parsed = new URL(url || '');
    parsed.hash = '';
    return parsed.toString();
  } catch (err) {
    return String(url || '').replace(/#.*$/, '');
  }
}

function isSameSummarySource(note, tab) {
  if (!note?.url || !tab?.url) return false;
  return normalizeUrlForCompare(note.url) === normalizeUrlForCompare(tab.url);
}

async function loadSelectedTextForSummary(note) {
  const tab = state.currentTab || await refreshCurrentTabInfo();
  if (!isSameSummarySource(note, tab)) {
    return { text: '', reason: 'source-mismatch' };
  }

  try {
    const response = await sendToSW('getSelectedText', { tabId: tab.id });
    const text = response?.success ? String(response.data?.text || '').trim() : '';
    return { text, reason: text ? 'available' : 'empty' };
  } catch (err) {
    console.warn('[SidePanel] 读取摘要选中文本失败:', err.message || err);
    return { text: '', reason: 'error' };
  }
}

async function getSelectedTextFromTab(tab) {
  if (!tab || typeof tab.id !== 'number') return '';

  try {
    const response = await sendToSW('getSelectedText', { tabId: tab.id });
    return response?.success ? String(response.data?.text || '').trim() : '';
  } catch (err) {
    console.warn('[SidePanel] 读取当前选中文字失败:', err.message || err);
    return '';
  }
}

function createSelectedTextSummaryData(text, tab = {}) {
  const content = String(text || '').trim();
  return {
    title: tab.title || '选中文字摘要',
    content,
    url: tab.url || '',
    sourceTitle: tab.title || '',
    excerpt: truncate(content, 200),
    pageType: 'article',
    method: 'selected-text',
    confidence: 1,
    reason: 'user-selection',
    qualityWarnings: []
  };
}

async function showCloudSummaryPreview(note, llmConfig, options = {}) {
  const settings = getSettings();
  const viewOnly = !!options.viewOnly;
  const force = !!options.force;
  const disableSelection = !!options.disableSelection;
  const selection = viewOnly || disableSelection ? { text: '' } : await loadSelectedTextForSummary(note);
  const selectedText = selection.text || '';
  let selectedScope = selectedText ? 'selection' : 'full';

  if (!viewOnly && !force && settings.privacy?.cloudSummaryNoticeAccepted && !selectedText) {
    return {
      confirmed: true,
      scope: 'full',
      title: note.title || '未命名笔记',
      content: note.content || ''
    };
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
    if (llmConfig.noiseSelectionEnabled || settings.llm?.noiseSelectionEnabled) {
      dialog.appendChild(createTextEl(
        'p',
        '云端正文去噪启用时，只会发送本地候选正文块用于去噪，不发送完整 DOM、历史笔记或完整本地数据。',
        'privacy-preview-note'
      ));
    }

    let fullRadio = null;
    let selectionRadio = null;
    if (!viewOnly) {
      const scopeGroup = document.createElement('div');
      scopeGroup.className = 'privacy-preview-scope';
      scopeGroup.setAttribute('role', 'radiogroup');
      scopeGroup.setAttribute('aria-label', '摘要发送范围');

      const makeScopeOption = (value, labelText, helperText, disabled = false) => {
        const label = document.createElement('label');
        label.className = 'privacy-preview-scope-option';
        if (disabled) label.classList.add('disabled');

        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'summaryScope';
        input.value = value;
        input.checked = selectedScope === value;
        input.disabled = disabled;
        input.addEventListener('change', () => {
          if (input.checked) {
            selectedScope = value;
            refreshPreview();
          }
        });

        const textWrap = document.createElement('span');
        textWrap.appendChild(createTextEl('strong', labelText));
        textWrap.appendChild(createTextEl('small', helperText));

        label.appendChild(input);
        label.appendChild(textWrap);
        scopeGroup.appendChild(label);
        return input;
      };

      fullRadio = makeScopeOption(
        'full',
        '总结全文',
        '发送当前笔记中的网页正文'
      );
      selectionRadio = makeScopeOption(
        'selection',
        '仅总结选中文字',
        selectedText ? `发送当前网页选区（${selectedText.length} 字）` : '当前网页没有可用选区',
        !selectedText
      );

      dialog.appendChild(scopeGroup);
    }

    const detail = document.createElement('dl');
    detail.className = 'privacy-preview-detail';
    const detailValues = {};
    const rows = [
      ['服务地址', getEndpointHost(llmConfig.endpoint)],
      ['模型', llmConfig.model || 'gpt-4o-mini'],
      ['标题', note.title || '未命名笔记'],
      ['页面类型', getPageTypeLabel(getPageTypeForNote(note))],
      ['正文长度', `${(note.content || '').length} 字`],
      ['发送正文', ''],
      ['质量提示', getSummaryNoticeForNote(note) || '无'],
      ['API 密钥', '作为 Authorization header 发送，不会在此显示']
    ];
    rows.forEach(([label, value]) => {
      detail.appendChild(createTextEl('dt', label));
      const dd = createTextEl('dd', value);
      detailValues[label] = dd;
      detail.appendChild(dd);
    });
    dialog.appendChild(detail);

    const preview = document.createElement('textarea');
    preview.className = 'privacy-preview-text';
    preview.readOnly = true;
    dialog.appendChild(preview);

    function getScopedSummaryInput() {
      const useSelection = selectedScope === 'selection' && selectedText;
      const content = useSelection ? selectedText : (note.content || '');
      return {
        scope: useSelection ? 'selection' : 'full',
        title: note.title || '未命名笔记',
        content,
        preparedContent: prepareSummaryContent(content)
      };
    }

    function refreshPreview() {
      if (fullRadio) fullRadio.checked = selectedScope === 'full';
      if (selectionRadio) selectionRadio.checked = selectedScope === 'selection';

      const input = getScopedSummaryInput();
      const protectedContent = isProtectedContentNote(note);
      const sourceView = getContentSourceView(note);
      const scopeLabel = input.scope === 'selection' ? '选中文字' : sourceView.label;
      detailValues['标题'].textContent = input.title;
      detailValues['正文长度'].textContent = `${input.content.length} 字`;
      detailValues['发送正文'].textContent =
        `${scopeLabel}，清洗后前 ${Math.min(input.preparedContent.length, LLM_CONTENT_LIMIT)} 字`;
      preview.value = protectedContent ?
        `标题：${input.title}\n页面类型：${getPageTypeLabel(getPageTypeForNote(note))}\n发送范围：${scopeLabel}\n\n原始${sourceView.label}已保存在本地，侧边栏不展示完整内容；将只把清洗后的必要文本发送给你配置的摘要服务。` :
        `标题：${input.title}\n页面类型：${getPageTypeLabel(getPageTypeForNote(note))}\n发送范围：${scopeLabel}\n\n正文预览：\n${input.preparedContent.slice(0, PREVIEW_CONTENT_LIMIT)}`;
    }
    refreshPreview();

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
      const input = getScopedSummaryInput();
      overlay.remove();
      resolve(confirmed ? {
        confirmed: true,
        scope: input.scope,
        title: input.title,
        content: input.content
      } : { confirmed: false });
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

function generateLearningRequestId() {
  return `learn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function setLearningSummaryGeneratingState(isGenerating, requestId = null) {
  const isActive = !!isGenerating;

  if (requestId) {
    state.activeSummaryRequestId = requestId;
  } else if (!isActive && String(state.activeSummaryRequestId || '').startsWith('learn_')) {
    state.activeSummaryRequestId = null;
  }

  if (!isActive && state.learningSummaryStatus === 'generating') {
    setLearningSummaryStatus('idle');
  } else {
    updateLearningSummaryControls();
  }

  setActionButtonsEnabled(state.pageAccess === 'ready');
}

async function showLearningSummaryPreview(payload, llmConfig) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog privacy-preview-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    dialog.appendChild(createTextEl('h3', '确认生成学习总结'));
    dialog.appendChild(createTextEl(
      'p',
      '将把本周期内已保存的摘要记录发送给你配置的 OpenAI 兼容接口，用于生成学习过程总结；不会把 API 密钥或完整网址写入 prompt。',
      'privacy-preview-note'
    ));

    const detail = document.createElement('dl');
    detail.className = 'privacy-preview-detail';
    const rows = [
      ['周期', payload.periodLabel],
      ['范围', payload.rangeLabel],
      ['摘要记录', `${payload.notes.length} 条`],
      ['实际发送', `${payload.selectedCount} 条`],
      ['服务地址', getEndpointHost(llmConfig.endpoint)],
      ['模型', llmConfig.model || 'gpt-4o-mini'],
      ['API 密钥', '作为 Authorization header 发送，不会在此显示']
    ];
    if (payload.omittedCount > 0) {
      rows.splice(4, 0, ['未发送', `${payload.omittedCount} 条较早记录`]);
    }
    if (payload.truncated) {
      rows.splice(4, 0, ['长度处理', '聚合文本已按长度截断']);
    }

    rows.forEach(([label, value]) => {
      detail.appendChild(createTextEl('dt', label));
      detail.appendChild(createTextEl('dd', value));
    });
    dialog.appendChild(detail);

    const preview = document.createElement('textarea');
    preview.className = 'privacy-preview-text learning-preview-text';
    preview.readOnly = true;
    preview.value = payload.recordsText;
    dialog.appendChild(preview);

    const buttons = document.createElement('div');
    buttons.className = 'confirm-dialog-buttons';

    const close = (confirmed) => {
      overlay.remove();
      resolve({ confirmed });
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'action-btn';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', () => close(false));
    buttons.appendChild(cancelBtn);

    const sendBtn = document.createElement('button');
    sendBtn.className = 'action-btn primary';
    sendBtn.textContent = '发送并生成';
    sendBtn.addEventListener('click', () => close(true));
    buttons.appendChild(sendBtn);

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
    showToast('无法获取当前标签页：请切换到目标网页后重新打开侧边栏', 'error');
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
    const friendly = getFriendlyErrorView(response?.error || '未知错误', '提取');
    setPageStatus(
      friendly.type,
      friendly.title,
      friendly.detail,
      { holdFor: 12000, tabId: tab.id }
    );
    showToast(`${friendly.title}：${friendly.detail}`, friendly.type);
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
    qualityWarnings: Array.isArray(data.qualityWarnings) ? data.qualityWarnings : [],
    imageOcr: data.imageOcr || null,
    noiseSelectionMethod: data.noiseSelectionMethod || '',
    noiseSelectionConfidence: typeof data.noiseSelectionConfidence === 'number' ? data.noiseSelectionConfidence : null,
    noiseSelectionReason: data.noiseSelectionReason || ''
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
    const friendly = getFriendlyErrorView(err.message || err, '提取');
    setPageStatus(
      friendly.type,
      friendly.title,
      friendly.detail,
      { holdFor: 12000, tabId: state.currentTab?.id || null }
    );
    showToast(`${friendly.title}：${friendly.detail}`, friendly.type);
  }
}

async function refreshStorageBackedViews() {
  await reloadStorage();
  state.settings = getSettings();
  renderCategoryOptions();
  renderCategoryManager();
  renderNoteList();
}

function setSourceBadge(el, sourceView) {
  if (!el || !sourceView) return;
  el.textContent = sourceView.label;
  el.className = `source-badge source-${sourceView.kind}`;
  el.title = sourceView.detail || sourceView.label;
}

function getSummaryResultNotice(note = {}, data = {}) {
  const sourceView = getContentSourceView(note);
  const warnings = Array.isArray(note.qualityWarnings) ? note.qualityWarnings :
    (Array.isArray(data.qualityWarnings) ? data.qualityWarnings : []);

  if (sourceView.kind === 'description') {
    return '未获取到可用字幕，本次摘要基于 YouTube 描述、标题和章节信息生成。';
  }

  if (warnings.length > 0) {
    return String(warnings[0] || '').trim();
  }

  return '';
}

function getSummaryResultView(data = {}) {
  const savedNote = data.noteId ? getNoteById(data.noteId) : null;
  const note = savedNote || {
    id: data.noteId || '',
    type: 'summarized',
    title: data.title || data.sourceTitle || '网页摘要',
    summary: data.summary || '',
    content: '',
    url: data.url || '',
    sourceTitle: data.sourceTitle || data.title || '',
    pageType: data.pageType || '',
    extractionMethod: data.extractionMethod || data.method || '',
    qualityWarnings: Array.isArray(data.qualityWarnings) ? data.qualityWarnings : [],
    summarySavedAt: data.savedAt || null,
    updatedAt: data.savedAt || Date.now()
  };

  return {
    note,
    sourceView: getContentSourceView(note),
    saveView: getLocalSaveView(note),
    title: note.title || note.sourceTitle || data.title || '网页摘要',
    summary: note.summary || data.summary || '',
    userNote: note.content || '',
    url: note.url || data.url || '',
    sourceTitle: note.sourceTitle || data.sourceTitle || note.title || '',
    notice: getSummaryResultNotice(note, data)
  };
}

function showSummaryResult(data = {}) {
  const view = getSummaryResultView(data);
  const { note, sourceView, saveView } = view;

  state.currentView = 'summaryResult';
  state.lastSummaryNoteId = note.id || data.noteId || null;
  state.activeNoteId = state.lastSummaryNoteId || state.activeNoteId;

  hideMainPagePanels();
  if (DOM.editorPanel) DOM.editorPanel.classList.add('hidden');
  if (DOM.settingsPanel) DOM.settingsPanel.classList.add('hidden');
  if (DOM.noteList) DOM.noteList.style.display = 'none';
  if (DOM.summaryResultPanel) DOM.summaryResultPanel.classList.remove('hidden');

  if (DOM.summaryResultSavedStatus) {
    DOM.summaryResultSavedStatus.textContent = saveView.detail ?
      `摘要已自动保存到本地 · ${saveView.detail}` :
      '摘要已自动保存到本地';
  }

  setSourceBadge(DOM.summaryResultSourceBadge, sourceView);

  if (DOM.summaryResultStateTitle) {
    DOM.summaryResultStateTitle.textContent = '摘要已生成并保存';
  }

  if (DOM.summaryResultStateDetail) {
    DOM.summaryResultStateDetail.textContent =
      `来源：${sourceView.detail || sourceView.label}；下方“我的笔记”不会覆盖摘要。`;
  }

  if (DOM.summaryResultTitle) {
    DOM.summaryResultTitle.textContent = view.title;
  }

  if (DOM.summaryResultText) {
    DOM.summaryResultText.textContent = view.summary || '摘要为空，请稍后重试或检查页面内容。';
  }

  if (DOM.summaryResultNote) {
    DOM.summaryResultNote.value = view.userNote;
    DOM.summaryResultNote.disabled = !state.lastSummaryNoteId;
  }

  if (DOM.summaryResultNotice) {
    const notice = view.notice;
    DOM.summaryResultNotice.classList.toggle('hidden', !notice);
    DOM.summaryResultNotice.textContent = notice;
  }

  if (DOM.summaryResultSource && DOM.summaryResultLink) {
    if (view.url) {
      DOM.summaryResultSource.classList.remove('hidden');
      DOM.summaryResultLink.href = view.url;
      DOM.summaryResultLink.textContent = view.sourceTitle || view.url;
      if (DOM.summaryResultHost) {
        DOM.summaryResultHost.textContent = getHostname(view.url) || '';
      }
    } else {
      DOM.summaryResultSource.classList.add('hidden');
      DOM.summaryResultLink.removeAttribute('href');
      DOM.summaryResultLink.textContent = '';
      if (DOM.summaryResultHost) DOM.summaryResultHost.textContent = '';
    }
  }

  if (DOM.openSavedSummaryBtn) {
    DOM.openSavedSummaryBtn.disabled = !state.lastSummaryNoteId;
    DOM.openSavedSummaryBtn.setAttribute('aria-disabled', String(!state.lastSummaryNoteId));
  }

  if (DOM.saveSummaryResultNoteBtn) {
    DOM.saveSummaryResultNoteBtn.disabled = !state.lastSummaryNoteId;
    DOM.saveSummaryResultNoteBtn.setAttribute('aria-disabled', String(!state.lastSummaryNoteId));
  }
}

async function saveSummaryResultNote() {
  if (!state.lastSummaryNoteId) {
    showToast('没有可保存的摘要笔记', 'warning');
    return;
  }

  const note = getNoteById(state.lastSummaryNoteId);
  if (!note) {
    showToast('保存失败：摘要笔记不存在', 'error');
    return;
  }

  try {
    const nextContent = DOM.summaryResultNote?.value || '';
    if ((note.content || '').trim() && !nextContent.trim()) {
      const confirmed = confirm('确定清空这条摘要下的“我的笔记”吗？\n上方摘要会保留，此操作会保存空笔记内容。');
      if (!confirmed) {
        DOM.summaryResultNote.value = note.content || '';
        return;
      }
    }

    const updated = await updateNote(note.id, { content: nextContent });
    if (updated) {
      showSummaryResult({ noteId: updated.id });
      renderNoteList();
      showToast('笔记已保存到本地', 'success');
    }
  } catch (err) {
    console.error('[SidePanel] 保存摘要笔记失败:', err);
    showToast('保存失败：' + (err.message || '未知错误'), 'error');
  }
}

function closeSummaryResultPanel() {
  if (DOM.summaryResultPanel) DOM.summaryResultPanel.classList.add('hidden');
  if (DOM.editorPanel) DOM.editorPanel.classList.add('hidden');
  if (DOM.settingsPanel) DOM.settingsPanel.classList.add('hidden');
  if (DOM.noteList) DOM.noteList.style.display = '';
  showMainPage('saved');
}

function openSavedSummaryNote() {
  if (!state.lastSummaryNoteId) {
    showToast('没有可打开的摘要笔记', 'warning');
    return;
  }
  openEditor(state.lastSummaryNoteId);
}

function createSummarySourceSnapshot(data = {}, tab = {}) {
  return {
    id: '',
    type: 'web-summary-source',
    title: data.title || tab.title || '未命名页面',
    content: data.content || '',
    url: data.url || tab.url || '',
    sourceTitle: data.sourceTitle || data.title || tab.title || '',
    pageType: data.pageType || 'article',
    extractionMethod: data.method || '',
    extractionConfidence: typeof data.confidence === 'number' ? data.confidence : null,
    extractionReason: data.reason || '',
    qualityWarnings: Array.isArray(data.qualityWarnings) ? data.qualityWarnings : [],
    imageOcr: data.imageOcr || null,
    noiseSelectionMethod: data.noiseSelectionMethod || '',
    noiseSelectionConfidence: typeof data.noiseSelectionConfidence === 'number' ? data.noiseSelectionConfidence : null,
    noiseSelectionReason: data.noiseSelectionReason || ''
  };
}

async function createSummaryNoteFromPageSummary(data = {}, tab = {}, summaryResponse = {}) {
  const source = createSummarySourceSnapshot(data, tab);
  const summary = String(summaryResponse.summary || '').trim();
  const savedAt = Date.now();

  const note = await createNote({
    type: 'summarized',
    title: source.title,
    content: '',
    summary,
    excerpt: truncate(summary, 150),
    url: source.url,
    sourceTitle: source.sourceTitle,
    pageType: source.pageType,
    extractionMethod: source.extractionMethod,
    extractionConfidence: source.extractionConfidence,
    extractionReason: source.extractionReason,
    qualityWarnings: source.qualityWarnings,
    imageOcr: source.imageOcr,
    noiseSelectionMethod: source.noiseSelectionMethod,
    noiseSelectionConfidence: source.noiseSelectionConfidence,
    noiseSelectionReason: source.noiseSelectionReason,
    summaryMethod: summaryResponse.method || 'llm',
    summaryStatus: 'saved',
    summarySavedAt: savedAt,
    summaryUsage: summaryResponse.usage || null
  });

  state.lastSummaryNoteId = note.id;
  state.activeNoteId = note.id;
  return note;
}

async function createLearningSummaryNote(payload = {}, summaryResponse = {}) {
  const summary = String(summaryResponse.summary || '').trim();
  const savedAt = Date.now();
  const periodLabel = payload.periodLabel || getLearningPeriodConfig(payload.period).label;
  const warnings = [];

  if (payload.omittedCount > 0) {
    warnings.push(`本次学习总结因数量限制未发送 ${payload.omittedCount} 条较早摘要记录。`);
  }
  if (payload.truncated) {
    warnings.push('本次学习总结的发送内容因长度限制被截断。');
  }

  const note = await createNote({
    type: 'learning-summary',
    title: payload.title || `${periodLabel}学习总结`,
    content: '',
    summary,
    excerpt: truncate(summary, 150),
    categoryId: state.settings.defaultCategoryId || '',
    tags: ['学习总结', periodLabel],
    sourceTitle: `${periodLabel}摘要记录`,
    pageType: 'chat-conversation',
    extractionMethod: 'learning-summary',
    qualityWarnings: warnings,
    summaryMethod: summaryResponse.method || 'llm-learning',
    summaryStatus: 'saved',
    summarySavedAt: savedAt,
    summaryUsage: summaryResponse.usage || null
  });

  state.lastSummaryNoteId = note.id;
  state.activeNoteId = note.id;
  return note;
}

async function summarizeLearningRecords() {
  if (state.activeSummaryRequestId) {
    showToast('摘要正在生成中，请稍候', 'warning');
    return;
  }

  const llmConfig = buildLlmConfig(getSettings());
  if (!isCloudLlmConfigured(llmConfig)) {
    const message = getCloudSummaryConfigError();
    setLearningSummaryStatus('error', '需要先配置云端摘要');
    showToast(message, 'warning');
    return;
  }

  const selection = getLearningSummarySelection(state.learningSummaryPeriod);
  if (selection.notes.length === 0) {
    setLearningSummaryStatus('error', `${selection.periodLabel}暂无可总结的摘要记录`);
    showToast(`${selection.periodLabel}暂无可总结的摘要记录`, 'warning');
    return;
  }

  const payload = buildLearningSummaryInput(selection);
  const preview = await showLearningSummaryPreview(payload, llmConfig);
  if (!preview.confirmed) {
    return;
  }

  if (state.activeSummaryRequestId) {
    showToast('摘要正在生成中，请稍候', 'warning');
    return;
  }

  const requestId = generateLearningRequestId();
  state.cancelledSummaryRequests.delete(requestId);

  try {
    setLearningSummaryStatus('generating', '正在生成学习总结...');
    setLearningSummaryVisible(true);
    setLearningSummaryGeneratingState(true, requestId);

    const response = await sendSummarizeWithTimeout({
      requestId,
      period: payload.period,
      periodLabel: payload.periodLabel,
      rangeLabel: payload.rangeLabel,
      noteCount: payload.notes.length,
      selectedCount: payload.selectedCount,
      omittedCount: payload.omittedCount,
      recordsText: payload.recordsText,
      title: payload.title,
      config: llmConfig,
      mode: 'llm-learning'
    }, CLOUD_SUMMARY_TOTAL_TIMEOUT, 'summarizeLearning');

    if (state.activeSummaryRequestId !== requestId || response?.code === 'CANCELLED') {
      showToast('已取消生成', 'info');
      return;
    }

    if (!response || !response.success || !response.summary) {
      const friendly = getFriendlyErrorView(response?.error || '未知错误', '学习总结');
      setLearningSummaryStatus('error', friendly.detail);
      showToast(`${friendly.title}：${friendly.detail}`, friendly.type);
      return;
    }

    setLearningSummaryStatus('generating', '正在保存学习总结...');
    const note = await createLearningSummaryNote(payload, response);
    renderNoteList();
    setLearningSummaryStatus('saved', `${payload.periodLabel}学习总结已保存`);
    showSummaryResult({ noteId: note.id });
    showToast(`${payload.periodLabel}学习总结已保存`, 'success');
  } catch (err) {
    console.error('[SidePanel] 学习总结生成失败:', err.message || err);
    const friendly = getFriendlyErrorView(err.message || err, '学习总结');
    setLearningSummaryStatus('error', friendly.detail);
    showToast(`${friendly.title}：${friendly.detail}`, friendly.type);
  } finally {
    if (state.activeSummaryRequestId === requestId) {
      setLearningSummaryGeneratingState(false);
    }
    state.cancelledSummaryRequests.delete(requestId);
  }
}

async function summarizeCurrentPage() {
  if (state.activeSummaryRequestId) {
    showToast('摘要正在生成中，请稍候', 'warning');
    return;
  }

  const requestId = generateRequestId();
  state.activeSummaryNoteId = null;
  state.cancelledSummaryRequests.delete(requestId);

  try {
    let tab = state.currentTab;
    if (!tab || !tab.id) {
      tab = await refreshCurrentTabInfo({ force: true });
    }
    if (!tab) {
      updatePageStatusFromTab(null, { force: true });
      setSummaryFlowStatus('error', '请切换到目标网页后重新打开侧边栏');
      showToast('无法获取当前标签页：请切换到目标网页后重新打开侧边栏', 'error');
      return;
    }

    if (!isUsableWebTab(tab)) {
      showUnavailablePageForAction(tab);
      setSummaryFlowStatus('error', '当前页面不可总结，请换到普通网页后重试');
      return;
    }

    const llmConfig = buildLlmConfig(getSettings());
    if (!isCloudLlmConfigured(llmConfig)) {
      const message = getCloudSummaryConfigError();
      setPageStatus('warning', '未配置云端摘要', message, { holdFor: 12000, tabId: tab.id });
      setSummaryFlowStatus('error', '需要先配置 API Key');
      showToast(message, 'warning');
      return;
    }

    setSummaryGeneratingState(true, requestId);
    setSummaryStage('检查选区...');
    const selectedText = await getSelectedTextFromTab(tab);

    let data = null;
    let sourceTab = tab;
    if (selectedText) {
      data = createSelectedTextSummaryData(selectedText, tab);
      state.summarySourceLabel = '选中文字';
      setSummaryStage('准备选中文字...');
      showToast('正在总结选中文字...', 'info');
    } else {
      setSummaryStage('读取页面...');
      showToast('正在读取页面内容...', 'info');
      const extracted = await requestPageExtraction(tab, {
        statusTitle: '正在读取当前页面',
        statusDetail: '读取后会直接生成摘要并保存到本地'
      });

      if (!extracted) {
        setSummaryFlowStatus('error', '未保存，请按提示处理后重试');
        return;
      }

      data = extracted.data;
      sourceTab = extracted.tab || tab;
    }

    if (state.activeSummaryRequestId !== requestId || isSummaryRequestCancelled(requestId)) {
      showToast('已取消生成', 'info');
      return;
    }

    const sourceNote = createSummarySourceSnapshot(data, sourceTab);
    const sourceView = getContentSourceView(sourceNote);

    setSummaryStage('准备云端摘要...');
    setSummaryFlowStatus('generating', '准备云端摘要', sourceView.label);
    const response = await generateCloudSummaryOnly(sourceNote, {
      requestId,
      skipPreview: true,
      previewOptions: { disableSelection: true }
    });

    if (state.activeSummaryRequestId !== requestId || response?.code === 'CANCELLED') {
      showToast('已取消生成', 'info');
      return;
    }

    if (!response || !response.success || !response.summary) {
      const friendly = getFriendlyErrorView(response?.error || '未知错误', '摘要');
      setPageStatus(
        friendly.type,
        friendly.title,
        friendly.detail,
        { holdFor: 12000, tabId: tab.id }
      );
      setSummaryFlowStatus('error', friendly.detail, sourceView.label);
      showToast(`${friendly.title}：${friendly.detail}`, friendly.type);
      return;
    }

    setSummaryStage('保存本地...');
    const note = await createSummaryNoteFromPageSummary(data, sourceTab, response);
    renderNoteList();

    setPageStatus(
      'success',
      '网页摘要已保存',
      note.sourceTitle || note.title || getHostname(note.url || tab.url) || '',
      { holdFor: 12000, tabId: tab.id }
    );

    setSummaryFlowStatus('saved', '摘要已自动保存到本地', getContentSourceView(note).label);
    showSummaryResult({ noteId: note.id });
    showToast('网页摘要已保存', 'success');
  } catch (err) {
    console.error('[SidePanel] 总结当前网页失败:', err.message || err);
    const friendly = getFriendlyErrorView(err.message || err, '摘要');
    setPageStatus(
      friendly.type,
      friendly.title,
      friendly.detail,
      { holdFor: 12000, tabId: state.currentTab?.id || null }
    );
    setSummaryFlowStatus('error', friendly.detail);
    showToast(`${friendly.title}：${friendly.detail}`, friendly.type);
  } finally {
    if (state.activeSummaryRequestId === requestId) {
      setSummaryGeneratingState(false);
    }
    state.cancelledSummaryRequests.delete(requestId);
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

  if (isProtectedContentNote(note)) {
    showToast('原网页正文已保护，不在侧边栏预览完整内容', 'warning');
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

  if (isSummaryOnlyNote(note) || isProtectedContentNote(note)) {
    showToast('当前笔记不展示完整正文，无法插入摘要到正文', 'warning');
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

    const response = await generateCloudSummaryOnly(note, { requestId });
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

      const methodName = getSummaryMethodName(response.method);
      showToast(`摘要生成成功（${methodName}）`, 'success');
      return response;
    } else {
      showFriendlyToast(response?.error || '摘要生成失败', '摘要');
      return response || null;
    }
  } catch (err) {
    console.error('[SidePanel] 摘要生成失败:', err.message || err);
    showFriendlyToast(err.message || err, '摘要');
    return null;
  } finally {
    if (state.activeSummaryRequestId === requestId) {
      setSummaryGeneratingState(false);
    }
    state.cancelledSummaryRequests.delete(requestId);
    updateSummaryUtilityButtons();
  }
}

async function sendSummarizeWithTimeout(payload, timeoutMs, action = 'summarize') {
  let timer = null;
  const requestPromise = sendToSW(action, payload).catch(err => ({
    success: false,
    error: err.message || String(err),
    method: payload.mode || 'none'
  }));
  const timeoutPromise = new Promise(resolve => {
    timer = setTimeout(() => {
      resolve({
        success: false,
        code: 'TIMEOUT',
        error: '云端摘要超时，请稍后重试或缩短待总结内容',
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

async function generateCloudSummaryOnly(note, options = {}) {
  const requestId = options.requestId || generateRequestId();
  const settings = getSettings();
  const llmConfig = buildLlmConfig(settings);
  const pageType = getPageTypeForNote(note);
  const summaryInput = {
    title: note.title,
    content: note.content,
    scope: 'full'
  };

  if (!isCloudLlmConfigured(llmConfig)) {
    return {
      success: false,
      error: getCloudSummaryConfigError(),
      method: 'llm'
    };
  }

  if (isSummaryRequestCancelled(requestId)) {
    return cancelledSummaryResponse();
  }

  if (!options.skipPreview) {
    setSummaryStage('等待云端确认...');
    const preview = await showCloudSummaryPreview(note, llmConfig, options.previewOptions || {});
    if (!preview.confirmed || isSummaryRequestCancelled(requestId)) {
      return cancelledSummaryResponse();
    }

    summaryInput.title = preview.title || note.title;
    summaryInput.content = preview.content || note.content;
    summaryInput.scope = preview.scope || 'full';
  }

  setSummaryStage('调用云端模型...');
  const llmResponse = await sendSummarizeWithTimeout({
    requestId,
    noteId: note.id,
    content: summaryInput.content,
    title: summaryInput.title,
    config: llmConfig,
    mode: 'llm',
    pageType
  }, CLOUD_SUMMARY_TOTAL_TIMEOUT);

  if (llmResponse && llmResponse.success) return llmResponse;
  if (llmResponse?.code === 'CANCELLED' || isSummaryRequestCancelled(requestId)) {
    return cancelledSummaryResponse();
  }

  return {
    success: false,
    code: llmResponse?.code,
    error: llmResponse?.error || '云端摘要生成失败',
    method: 'llm'
  };
}

/** 生成摘要（仅云端 LLM） */
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
  const nextTitle = title || note.title;
  const clearingContent = isClearingExistingEditableContent(note, content);
  const tagsEqual = JSON.stringify(tags) === JSON.stringify(note.tags || []);
  const metadataChanged = nextTitle !== note.title ||
    summary !== note.summary ||
    categoryId !== note.categoryId ||
    pinned !== note.pinned ||
    !tagsEqual;
  const contentChanged = content !== note.content;

  // 只在有变化时保存
  if (!metadataChanged && !contentChanged) {
    return;
  }

  if (clearingContent) {
    if (state.pendingClearContentNoteId !== note.id) {
      state.pendingClearContentNoteId = note.id;
      showToast('正文已清空但尚未保存；点击“保存”并确认后才会清空本地笔记', 'warning');
    }
    if (!metadataChanged) return;
  } else if (state.pendingClearContentNoteId === note.id) {
    state.pendingClearContentNoteId = null;
  }

  const updates = {
    title: nextTitle,
    summary,
    categoryId,
    tags,
    pinned
  };

  if (!clearingContent) {
    updates.content = content;
  }

  await updateNote(state.editingNoteId, updates);

  showAutoSaveIndicator();
  updateSummaryUtilityButtons();
  console.log('[SidePanel] 自动保存完成');
}, 1500);

// ===================== 事件绑定 =====================
function bindEvents() {
  // --- 主页面切换 ---
  if (DOM.savedPageTab) {
    DOM.savedPageTab.addEventListener('click', () => showMainPage('saved'));
  }
  if (DOM.extractPageTab) {
    DOM.extractPageTab.addEventListener('click', () => showMainPage('extract'));
  }
  if (DOM.mainPageTabs) {
    DOM.mainPageTabs.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      showMainPage(state.mainPage === 'saved' ? 'extract' : 'saved');
      const nextTab = state.mainPage === 'saved' ? DOM.savedPageTab : DOM.extractPageTab;
      nextTab?.focus();
    });
  }

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

  // --- 学习总结 ---
  if (DOM.toggleLearningSummaryBtn) {
    DOM.toggleLearningSummaryBtn.addEventListener('click', () => {
      setLearningSummaryVisible(!state.learningSummaryVisible);
    });
  }
  if (DOM.collapseLearningSummaryBtn) {
    DOM.collapseLearningSummaryBtn.addEventListener('click', () => {
      setLearningSummaryVisible(false);
    });
  }
  if (DOM.learningPeriodTabs) {
    DOM.learningPeriodTabs.addEventListener('click', (e) => {
      const periodBtn = e.target.closest('[data-learning-period]');
      if (!periodBtn || periodBtn.disabled) return;
      state.learningSummaryPeriod = periodBtn.dataset.learningPeriod || 'day';
      setLearningSummaryStatus('idle');
    });
  }
  if (DOM.summarizeLearningBtn) {
    DOM.summarizeLearningBtn.addEventListener('click', summarizeLearningRecords);
  }

  // --- 提取页面 ---
  DOM.extractPageBtn.addEventListener('click', startExtractPageFromUserGesture);

  // --- 总结当前网页 ---
  DOM.summarizePageBtn.addEventListener('click', summarizeCurrentPage);

  if (DOM.closeSummaryResultBtn) {
    DOM.closeSummaryResultBtn.addEventListener('click', closeSummaryResultPanel);
  }
  if (DOM.openSavedSummaryBtn) {
    DOM.openSavedSummaryBtn.addEventListener('click', openSavedSummaryNote);
  }
  if (DOM.saveSummaryResultNoteBtn) {
    DOM.saveSummaryResultNoteBtn.addEventListener('click', saveSummaryResultNote);
  }

  // --- 快速添加 URL ---
  DOM.quickUrlBtn.addEventListener('click', quickAddUrl);

  // --- 快速添加选中文本 ---
  DOM.quickSelectionBtn.addEventListener('click', quickAddSelection);

  // --- 设置按钮 ---
  DOM.settingsBtn.addEventListener('click', openSettings);
  if (DOM.openApiSettingsBtn) {
    DOM.openApiSettingsBtn.addEventListener('click', openSettings);
  }

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

  DOM.clearApiKeyBtn.addEventListener('click', () => {
    DOM.llmApiKey.value = '';
    DOM.llmApiKey.type = 'password';
    DOM.toggleApiKeyVisibility.textContent = '👁';
    DOM.llmApiKey.focus();
    showToast('API 密钥已清空，保存设置后生效', 'info');
  });

  if (DOM.toggleTranscriptApiKeyVisibility && DOM.youtubeTranscriptApiKey) {
    DOM.toggleTranscriptApiKeyVisibility.addEventListener('click', () => {
      const input = DOM.youtubeTranscriptApiKey;
      if (input.type === 'password') {
        input.type = 'text';
        DOM.toggleTranscriptApiKeyVisibility.textContent = '🙈';
      } else {
        input.type = 'password';
        DOM.toggleTranscriptApiKeyVisibility.textContent = '👁';
      }
    });
  }

  if (DOM.clearTranscriptApiKeyBtn && DOM.youtubeTranscriptApiKey) {
    DOM.clearTranscriptApiKeyBtn.addEventListener('click', () => {
      DOM.youtubeTranscriptApiKey.value = '';
      DOM.youtubeTranscriptApiKey.type = 'password';
      if (DOM.toggleTranscriptApiKeyVisibility) {
        DOM.toggleTranscriptApiKeyVisibility.textContent = '👁';
      }
      DOM.youtubeTranscriptApiKey.focus();
      showToast('YouTube 字幕后端密钥已清空，保存设置后生效', 'info');
    });
  }

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
      } else if (state.currentView === 'summaryResult') {
        closeSummaryResultPanel();
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
