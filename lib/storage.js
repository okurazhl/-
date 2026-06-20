/**
 * 存储层模块
 * 封装 chrome.storage.local 的 CRUD 操作
 * 使用内存缓存，并在 CRUD 操作返回前完成持久化
 */

import { generateId, getExcerpt } from './utils.js';

const DEFAULT_CATEGORIES = [
  { id: 'cat_1', name: '工作', color: '#4A90D9', order: 0 },
  { id: 'cat_2', name: '个人', color: '#7B61FF', order: 1 },
  { id: 'cat_3', name: '学习', color: '#2ECC71', order: 2 },
  { id: 'cat_4', name: '灵感', color: '#F39C12', order: 3 },
  { id: 'cat_5', name: '归档', color: '#95A5A6', order: 4 }
];

const DEFAULT_SETTINGS = {
  theme: 'light',
  autoSummarize: false,
  defaultCategoryId: 'cat_3',
  summaryLength: 'medium',
  exportFormat: 'markdown',
  fontSize: 14,
  privacy: {
    cloudSummaryNoticeAccepted: false
  },
  llm: {
    apiEndpoint: '',
    apiKey: '',
    model: 'gpt-4o-mini',
    enabled: false
  }
};

const DEFAULT_METADATA = {
  noteCount: 0,
  lastBackup: null,
  version: 1
};

// ========== 内存缓存 ==========
let notesCache = [];
let categoriesCache = [];
let settingsCache = {};
let metadataCache = {};

// ========== 初始化状态 ==========
let initialized = false;
let initPromise = null;

// ========== 持久化 ==========
const persistNow = async () => {
  try {
    await chrome.storage.local.set({
      notes: notesCache,
      categories: categoriesCache,
      settings: settingsCache,
      metadata: metadataCache
    });
    console.log('[Storage] 数据已持久化到 chrome.storage.local');
  } catch (err) {
    console.error('[Storage] 持久化失败:', err);
    if (err.message && err.message.includes('QUOTA')) {
      console.warn('[Storage] 存储配额不足！');
    }
    throw err;
  }
};

/** 立即持久化（不等待防抖，用于关键操作） */
async function persistImmediate() {
  await persistNow();
}

function cloneDefaultCategories() {
  return DEFAULT_CATEGORIES.map(c => ({ ...c }));
}

function cloneDefaultSettings() {
  return {
    ...DEFAULT_SETTINGS,
    privacy: { ...DEFAULT_SETTINGS.privacy },
    llm: { ...DEFAULT_SETTINGS.llm }
  };
}

function mergeSettingsWithDefaults(settings = {}) {
  const safeSettings = settings && typeof settings === 'object' ? settings : {};
  return {
    ...cloneDefaultSettings(),
    ...safeSettings,
    privacy: {
      ...DEFAULT_SETTINGS.privacy,
      ...(safeSettings.privacy || {})
    },
    llm: {
      ...DEFAULT_SETTINGS.llm,
      ...(safeSettings.llm || {})
    }
  };
}

function mergeMetadataWithDefaults(metadata = {}) {
  const safeMetadata = metadata && typeof metadata === 'object' ? metadata : {};
  return {
    ...DEFAULT_METADATA,
    ...safeMetadata,
    noteCount: notesCache.length
  };
}

// ========== 初始化 ==========

/**
 * 初始化存储层：从 chrome.storage.local 加载全部数据到内存缓存
 * 多次调用安全（只会初始化一次）
 * @returns {Promise<void>}
 */
export async function initStorage() {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const result = await chrome.storage.local.get(['notes', 'categories', 'settings', 'metadata']);

      notesCache = Array.isArray(result.notes) ? result.notes : [];
      const needDefaultCategories = !Array.isArray(result.categories) || result.categories.length === 0;
      const needDefaultSettings = !result.settings ||
        typeof result.settings !== 'object' ||
        !result.settings.llm ||
        result.settings.defaultCategoryId === undefined ||
        result.settings.summaryLength === undefined ||
        result.settings.fontSize === undefined;
      const needDefaultMetadata = !result.metadata ||
        typeof result.metadata !== 'object' ||
        result.metadata.noteCount !== notesCache.length ||
        result.metadata.version === undefined;

      categoriesCache = needDefaultCategories ? cloneDefaultCategories() : result.categories;
      settingsCache = mergeSettingsWithDefaults(result.settings);
      metadataCache = mergeMetadataWithDefaults(result.metadata);

      initialized = true;

      if (needDefaultCategories || needDefaultSettings || needDefaultMetadata) {
        await persistImmediate();
      }

      console.log('[Storage] 初始化完成，已加载', notesCache.length, '条笔记');
    } catch (err) {
      console.error('[Storage] 初始化失败:', err);
      // 即使失败也标记为已初始化，使用空数据
      notesCache = [];
      categoriesCache = cloneDefaultCategories();
      settingsCache = cloneDefaultSettings();
      metadataCache = { ...DEFAULT_METADATA };
      initialized = true;
    }
  })();

  return initPromise;
}

// ========== 笔记 CRUD ==========

/**
 * 获取所有笔记
 * @returns {Array} 笔记数组（按 pinned + updatedAt 排序）
 */
export function getAllNotes() {
  return [...notesCache].sort((a, b) => {
    // 置顶优先
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    // 按更新时间倒序
    return (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt);
  });
}

/**
 * 根据 ID 获取单条笔记
 * @param {string} id
 * @returns {object|undefined}
 */
export function getNoteById(id) {
  return notesCache.find(n => n.id === id);
}

/**
 * 创建笔记
 * @param {object} noteData - 笔记数据（不含 id、createdAt、updatedAt）
 * @returns {object} 创建的笔记（含完整字段）
 */
export async function createNote(noteData = {}) {
  const now = Date.now();
  const note = {
    id: generateId(),
    type: noteData.type || 'manual',
    title: noteData.title || '未命名笔记',
    content: noteData.content || '',
    url: noteData.url || '',
    sourceTitle: noteData.sourceTitle || '',
    excerpt: noteData.excerpt || getExcerpt(noteData.content || '', 150),
    pageType: noteData.pageType || '',
    extractionMethod: noteData.extractionMethod || noteData.method || '',
    extractionConfidence: typeof noteData.extractionConfidence === 'number' ? noteData.extractionConfidence : null,
    extractionReason: noteData.extractionReason || noteData.reason || '',
    qualityWarnings: Array.isArray(noteData.qualityWarnings) ? noteData.qualityWarnings : [],
    categoryId: noteData.categoryId || settingsCache.defaultCategoryId || '',
    tags: noteData.tags || [],
    summary: noteData.summary || '',
    createdAt: now,
    updatedAt: now,
    pinned: noteData.pinned || false
  };

  notesCache.push(note);
  metadataCache.noteCount = notesCache.length;
  await persistImmediate();

  return { ...note };
}

/**
 * 更新笔记
 * @param {string} id - 笔记 ID
 * @param {object} updates - 要更新的字段
 * @returns {object|null} 更新后的笔记，或 null（未找到）
 */
export async function updateNote(id, updates = {}) {
  const index = notesCache.findIndex(n => n.id === id);
  if (index === -1) return null;

  const now = Date.now();
  const updated = {
    ...notesCache[index],
    ...updates,
    id: notesCache[index].id,           // 禁止修改 ID
    createdAt: notesCache[index].createdAt, // 禁止修改创建时间
    updatedAt: now
  };

  // 如果更新了 content，自动更新 excerpt
  if (updates.content !== undefined && !updates.excerpt) {
    updated.excerpt = getExcerpt(updates.content, 150);
  }

  notesCache[index] = updated;
  await persistImmediate();

  return { ...updated };
}

/**
 * 删除笔记
 * @param {string} id - 笔记 ID
 * @returns {boolean} 是否成功
 */
export async function deleteNote(id) {
  const index = notesCache.findIndex(n => n.id === id);
  if (index === -1) return false;

  notesCache.splice(index, 1);
  metadataCache.noteCount = notesCache.length;
  await persistImmediate();

  return true;
}

/**
 * 批量删除笔记
 * @param {string[]} ids - 笔记 ID 数组
 * @returns {number} 实际删除的数量
 */
export async function deleteNotes(ids = []) {
  const before = notesCache.length;
  notesCache = notesCache.filter(n => !ids.includes(n.id));
  const deleted = before - notesCache.length;
  metadataCache.noteCount = notesCache.length;
  if (deleted > 0) await persistImmediate();
  return deleted;
}

/**
 * 搜索笔记（关键词匹配标题、内容、标签、摘要、来源标题）
 * @param {string} query - 搜索关键词
 * @returns {Array} 匹配的笔记数组
 */
export function searchNotes(query) {
  if (!query || !query.trim()) return getAllNotes();

  const q = query.trim().toLowerCase();
  return getAllNotes().filter(note => {
    return (
      (note.title && note.title.toLowerCase().includes(q)) ||
      (note.content && note.content.toLowerCase().includes(q)) ||
      (note.summary && note.summary.toLowerCase().includes(q)) ||
      (note.sourceTitle && note.sourceTitle.toLowerCase().includes(q)) ||
      (note.excerpt && note.excerpt.toLowerCase().includes(q)) ||
      (note.tags && note.tags.some(t => t.toLowerCase().includes(q))) ||
      (note.url && note.url.toLowerCase().includes(q))
    );
  });
}

// ========== 分类 CRUD ==========

/**
 * 获取所有分类（按 order 排序）
 * @returns {Array}
 */
export function getAllCategories() {
  return [...categoriesCache].sort((a, b) => (a.order || 0) - (b.order || 0));
}

/**
 * 根据 ID 获取分类
 * @param {string} id
 * @returns {object|undefined}
 */
export function getCategoryById(id) {
  return categoriesCache.find(c => c.id === id);
}

/**
 * 创建分类
 * @param {object} categoryData
 * @returns {object}
 */
export async function createCategory(categoryData = {}) {
  const category = {
    id: `cat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: categoryData.name || '新分类',
    color: categoryData.color || '#95A5A6',
    order: categoryData.order !== undefined ? categoryData.order : categoriesCache.length
  };

  categoriesCache.push(category);
  await persistImmediate();

  return { ...category };
}

/**
 * 更新分类（重命名、改颜色等）
 * 笔记通过 categoryId 引用，所以只改分类自身即可
 * @param {string} id - 分类 ID
 * @param {object} updates
 * @returns {object|null}
 */
export async function updateCategory(id, updates = {}) {
  const index = categoriesCache.findIndex(c => c.id === id);
  if (index === -1) return null;

  categoriesCache[index] = {
    ...categoriesCache[index],
    ...updates,
    id: categoriesCache[index].id  // 禁止修改 ID
  };
  await persistImmediate();

  return { ...categoriesCache[index] };
}

/**
 * 删除分类
 * 同时把属于该分类的笔记移到默认分类
 * @param {string} id - 分类 ID
 * @returns {boolean}
 */
export async function deleteCategory(id) {
  const index = categoriesCache.findIndex(c => c.id === id);
  if (index === -1) return false;

  categoriesCache.splice(index, 1);

  // 把属于该分类的笔记移到默认分类（或取消分类）
  let fallbackId = settingsCache.defaultCategoryId || '';
  if (fallbackId === id || !categoriesCache.some(c => c.id === fallbackId)) {
    fallbackId = (categoriesCache[0] && categoriesCache[0].id) || '';
    settingsCache.defaultCategoryId = fallbackId;
  }

  for (const note of notesCache) {
    if (note.categoryId === id) {
      note.categoryId = fallbackId;
      note.updatedAt = Date.now();
    }
  }

  await persistImmediate();
  return true;
}

// ========== 设置 CRUD ==========

/**
 * 获取设置（返回副本，防止外部直接修改缓存）
 * @returns {object}
 */
export function getSettings() {
  return { ...settingsCache, llm: { ...settingsCache.llm } };
}

/**
 * 更新设置（部分更新）
 * @param {object} updates
 * @returns {object} 更新后的设置
 */
export async function updateSettings(updates = {}) {
  const nextUpdates = { ...updates };

  // 深度合并 llm 设置
  if (nextUpdates.llm) {
    settingsCache.llm = {
      ...(settingsCache.llm || {}),
      ...nextUpdates.llm
    };
    delete nextUpdates.llm;
  }

  if (nextUpdates.privacy) {
    settingsCache.privacy = {
      ...(settingsCache.privacy || {}),
      ...nextUpdates.privacy
    };
    delete nextUpdates.privacy;
  }

  settingsCache = mergeSettingsWithDefaults({
    ...settingsCache,
    ...nextUpdates
  });
  await persistImmediate();

  return getSettings();
}

// ========== 元数据 ==========

/**
 * 获取元数据
 * @returns {object}
 */
export function getMetadata() {
  return { ...metadataCache };
}

// ========== 批量操作 ==========

/**
 * 导入数据（用于恢复备份）
 * @param {object} data - { notes, categories, settings, metadata }
 * @returns {Promise<void>}
 */
export async function importData(data = {}) {
  if (Array.isArray(data.notes)) notesCache = data.notes;
  categoriesCache = Array.isArray(data.categories) && data.categories.length > 0 ?
    data.categories : cloneDefaultCategories();
  settingsCache = mergeSettingsWithDefaults(data.settings);
  metadataCache = mergeMetadataWithDefaults(data.metadata);
  await persistImmediate();
}

/**
 * 导出全部数据（用于备份）
 * @returns {object}
 */
export function exportAllData() {
  return {
    notes: [...notesCache],
    categories: [...categoriesCache],
    settings: getSettings(),
    metadata: getMetadata(),
    exportedAt: Date.now()
  };
}

/**
 * 清除所有数据
 * @returns {Promise<void>}
 */
export async function clearAllData() {
  notesCache = [];
  categoriesCache = cloneDefaultCategories();
  settingsCache = cloneDefaultSettings();
  metadataCache = { ...DEFAULT_METADATA };
  await persistImmediate();
}

// ========== 内部方法（供测试和调试使用） ==========

/**
 * 获取内存缓存状态（仅调试用）
 * @returns {object}
 */
export function _getCacheState() {
  return {
    initialized,
    notesCount: notesCache.length,
    categoriesCount: categoriesCache.length,
    hasSettings: Object.keys(settingsCache).length > 0
  };
}
