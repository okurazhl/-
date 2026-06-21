// ============================================================
// Service Worker — 消息中枢 + 内容脚本注入 + LLM API 调用
// MV3 ES Module
// ============================================================

import { generateSummary } from './lib/summarizer.js';
import { initStorage, getSettings, createNote } from './lib/storage.js';

const SIDEPANEL_PATH = 'sidepanel/sidepanel.html';

const LAST_ACTIVE_TAB_KEY = 'lastActiveTab';
let lastActiveTab = null;
let pendingActionPanelOpen = null;

chrome.action.onClicked.addListener((tab) => {
  handleActionClick(tab);
});

if (chrome.sidePanel && chrome.sidePanel.onOpened) {
  chrome.sidePanel.onOpened.addListener((info) => {
    rememberActiveTabFromPanelInfo(info);
  });
}

// 新版 Chrome 支持在 action 用户手势里手动打开 tab 级侧边栏。
// 旧版不支持 sidePanel.open 时保留浏览器的自动打开行为作为兼容回退。
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: !chrome.sidePanel.open
  }).catch(err => {
    console.warn('[SW] 设置侧边栏打开行为失败:', { message: err.message || String(err) });
  });
}

// ========== 安装与初始化 ==========
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // 首次安装：写入默认分类和设置
    const defaultCategories = [
      { id: 'cat_1', name: '工作', color: '#4A90D9', order: 0 },
      { id: 'cat_2', name: '个人', color: '#7B61FF', order: 1 },
      { id: 'cat_3', name: '学习', color: '#2ECC71', order: 2 },
      { id: 'cat_4', name: '灵感', color: '#F39C12', order: 3 },
      { id: 'cat_5', name: '归档', color: '#95A5A6', order: 4 }
    ];

      const defaultSettings = {
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

    await chrome.storage.local.set({
      notes: [],
      categories: defaultCategories,
      settings: defaultSettings,
      metadata: {
        noteCount: 0,
        lastBackup: null,
        version: 1
      }
    });

    console.log('[SW] 初始化完成，默认数据已写入');
  }
});

// ========== 跟踪已注入脚本的标签页 ==========
const injectedTabs = new Map();  // tabId -> Set of script names
const activeSummaryRequests = new Map(); // requestId -> AbortController

function isScriptInjected(tabId, scriptName) {
  const scripts = injectedTabs.get(tabId);
  return scripts && scripts.has(scriptName);
}

function markScriptInjected(tabId, scriptName) {
  if (!injectedTabs.has(tabId)) {
    injectedTabs.set(tabId, new Set());
  }
  injectedTabs.get(tabId).add(scriptName);
}

// 标签页关闭时清理
chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
  if (lastActiveTab && lastActiveTab.id === tabId) {
    clearRememberedActiveTab();
  }
});

// 标签页导航到新页面时清理（旧脚本已失效）
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'loading') {
    injectedTabs.delete(tabId);
  }

  if (lastActiveTab && lastActiveTab.id === tabId && (changeInfo.url || changeInfo.title)) {
    rememberActiveTab({
      ...lastActiveTab,
      url: changeInfo.url || lastActiveTab.url,
      title: changeInfo.title || lastActiveTab.title
    }, lastActiveTab.source || 'tab-updated');
  }
});

function handleActionClick(tab) {
  const remembered = rememberActiveTab(tab, 'action');
  if (!remembered || typeof remembered.id !== 'number') {
    console.warn('[SW] 无法绑定 action 标签页:', { reason: 'missing-tab' });
    return;
  }

  if (!chrome.sidePanel || !chrome.sidePanel.open) {
    return;
  }

  markPendingActionPanelOpen(remembered);
  openSidePanelFromActionGesture(remembered);
  ensureSidePanelOptions(remembered);
}

function openSidePanelFromActionGesture(tab) {
  // sidePanel.open 对用户手势非常敏感，必须在 action click 同步链路里尽快调用。
  try {
    chrome.sidePanel.open({ tabId: tab.id }).catch(err => {
      fallbackOpenSidePanelInWindow(tab, err);
    });
  } catch (err) {
    fallbackOpenSidePanelInWindow(tab, err);
  }
}

function fallbackOpenSidePanelInWindow(tab, cause) {
  console.warn('[SW] 打开 tab 级侧边栏失败，尝试窗口级回退:', {
    tabId: tab.id,
    windowId: tab.windowId || null,
    message: cause?.message || String(cause)
  });

  if (typeof tab.windowId !== 'number') return;

  try {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(fallbackErr => {
      console.warn('[SW] 打开窗口级侧边栏失败:', {
        windowId: tab.windowId,
        message: fallbackErr.message || String(fallbackErr)
      });
    });
  } catch (fallbackErr) {
    console.warn('[SW] 打开窗口级侧边栏失败:', {
      windowId: tab.windowId,
      message: fallbackErr.message || String(fallbackErr)
    });
  }
}

function ensureSidePanelOptions(tab) {
  if (chrome.sidePanel.setOptions) {
    chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: SIDEPANEL_PATH,
      enabled: true
    }).catch(err => {
      console.warn('[SW] 设置 tab 级侧边栏失败:', {
        tabId: tab.id,
        message: err.message || String(err)
      });
    });
  }
}

function markPendingActionPanelOpen(tab) {
  pendingActionPanelOpen = {
    tabId: tab.id,
    windowId: tab.windowId,
    expiresAt: Date.now() + 5000
  };
}

function isPendingActionPanelOpen(info = {}) {
  if (!pendingActionPanelOpen) return false;

  if (pendingActionPanelOpen.expiresAt < Date.now()) {
    pendingActionPanelOpen = null;
    return false;
  }

  const matchesTab = typeof info.tabId === 'number' &&
    info.tabId === pendingActionPanelOpen.tabId;
  const matchesWindow = typeof info.windowId === 'number' &&
    info.windowId === pendingActionPanelOpen.windowId;
  const noScopeFromChrome = typeof info.tabId !== 'number' &&
    typeof info.windowId !== 'number';

  if (matchesTab || matchesWindow || noScopeFromChrome) {
    pendingActionPanelOpen = null;
    return true;
  }

  return false;
}

function rememberActiveTab(tab, source = 'unknown') {
  if (!tab || typeof tab.id !== 'number') return null;

  const previous = lastActiveTab && lastActiveTab.id === tab.id ? lastActiveTab : null;

  lastActiveTab = {
    id: tab.id,
    windowId: typeof tab.windowId === 'number' ? tab.windowId : previous?.windowId,
    url: tab.url || previous?.url || '',
    title: tab.title || previous?.title || '',
    updatedAt: Date.now(),
    source: source || previous?.source || 'unknown'
  };

  chrome.storage.session.set({ [LAST_ACTIVE_TAB_KEY]: lastActiveTab }).catch(err => {
    console.warn('[SW] 记录当前标签页失败:', { message: err.message || String(err) });
  });

  return lastActiveTab;
}

async function clearRememberedActiveTab() {
  lastActiveTab = null;
  try {
    await chrome.storage.session.remove(LAST_ACTIVE_TAB_KEY);
  } catch (err) {
    console.warn('[SW] 清理当前标签页记录失败:', { message: err.message || String(err) });
  }
}

async function rememberActiveTabFromPanelInfo(info = {}) {
  if (typeof info.tabId === 'number') {
    try {
      const tab = await chrome.tabs.get(info.tabId);
      rememberActiveTab(tab, 'sidepanel-tab');
      return;
    } catch (err) {
      console.warn('[SW] 通过 sidePanel tabId 记录标签页失败:', {
        tabId: info.tabId,
        message: err.message || String(err)
      });
    }
  }

  if (isPendingActionPanelOpen(info)) {
    return;
  }

  await clearRememberedActiveTab();
}

async function getRememberedActiveTab() {
  if (!lastActiveTab) {
    try {
      const result = await chrome.storage.session.get(LAST_ACTIVE_TAB_KEY);
      lastActiveTab = result[LAST_ACTIVE_TAB_KEY] || null;
    } catch (err) {
      console.warn('[SW] 读取当前标签页记录失败:', { message: err.message || String(err) });
    }
  }

  if (!lastActiveTab || typeof lastActiveTab.id !== 'number') {
    return null;
  }

  try {
    const tab = await chrome.tabs.get(lastActiveTab.id);
    return rememberActiveTab({
      id: lastActiveTab.id,
      windowId: typeof tab.windowId === 'number' ? tab.windowId : lastActiveTab.windowId,
      url: tab.url || lastActiveTab.url || '',
      title: tab.title || lastActiveTab.title || ''
    }, lastActiveTab.source || 'stored');
  } catch (err) {
    console.warn('[SW] 当前标签页记录已失效:', { message: err.message || String(err) });
    await clearRememberedActiveTab();
    return null;
  }
}

// ========== 消息路由 ==========
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message;

  console.log('[SW] 收到消息:', {
    action,
    requestId: message.requestId || null,
    mode: message.mode || message.method || null,
    contentLength: typeof message.content === 'string' ? message.content.length : 0
  });

  switch (action) {

    // --- 页面内容提取 ---
    case 'extractPage': {
      handleExtractPage(message.tabId)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;  // 异步响应
    }

    // --- 获取最近一次通过扩展 action 打开的页面 ---
    case 'getActiveTab': {
      getRememberedActiveTab()
        .then(tab => sendResponse(tab ? { success: true, data: tab } : makeError('NO_TAB', '无法获取当前标签页')))
        .catch(err => sendResponse(makeError('NO_TAB', err.message || '无法获取当前标签页')));
      return true;
    }

    // --- 获取选中文本 ---
    case 'getSelectedText': {
      handleGetSelectedText(message.tabId)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    // --- 获取页面基本信息 ---
    case 'getPageInfo': {
      handleGetPageInfo(message.tabId)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    // --- 生成摘要 ---
    case 'summarize': {
      handleSummarize(message)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    // --- 后台总结当前网页并保存摘要笔记 ---
    case 'summarizePageAndSave': {
      handleSummarizePageAndSave(message)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    // --- 取消摘要 ---
    case 'cancelSummarize': {
      handleCancelSummarize(message.requestId)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    default: {
      sendResponse({ success: false, error: `未知消息类型: ${action}` });
      return false;
    }
  }
});

// ========== 页面内容提取 ==========
async function handleExtractPage(tabId) {
  if (!tabId) {
    return makeError('NO_TAB', '缺少 tabId 参数');
  }

  try {
    // 注入 Readability 库 + 内容提取脚本
    await ensureScriptsInjected(tabId, [
      'content/readability.js',
      'content/content-extract.js'
    ]);

    // 向内容脚本发送提取指令
    const response = await chrome.tabs.sendMessage(tabId, { action: 'extractPage' });

    if (response && response.success && response.data && response.data.content) {
      return {
        success: true,
        data: {
          title: response.data.title || '',
          content: response.data.content || '',
          url: response.data.url || '',
          sourceTitle: response.data.title || '',
          excerpt: response.data.excerpt || '',
          method: response.data.method || '',
          pageType: response.data.pageType || '',
          confidence: typeof response.data.confidence === 'number' ? response.data.confidence : null,
          reason: response.data.reason || '',
          qualityWarnings: Array.isArray(response.data.qualityWarnings) ? response.data.qualityWarnings : [],
          imageOcr: response.data.imageOcr || null
        }
      };
    }

    return makeError('NO_CONTENT', response?.error || '提取返回空内容');
  } catch (err) {
    console.error('[SW] extractPage 失败:', err);

    // 如果消息发送失败，尝试直接获取页面信息
    if (err.message && err.message.includes('Could not establish connection')) {
      return makeError('CONNECTION_FAILED', '无法连接到页面，请刷新页面后重试');
    }

    return makeErrorFromInjectionError(err);
  }
}

// ========== 获取选中文本 ==========
async function handleGetSelectedText(tabId) {
  if (!tabId) {
    return makeError('NO_TAB', '缺少 tabId 参数');
  }

  try {
    // 只需注入内容提取脚本（不需要 Readability）
    await ensureScriptsInjected(tabId, ['content/content-extract.js']);

    const response = await chrome.tabs.sendMessage(tabId, { action: 'getSelectedText' });

    if (response && response.success) {
      return {
        success: true,
        data: {
          text: response.data.text || '',
          selectionLength: response.data.selectionLength || 0
        }
      };
    }

    return { success: false, error: '未选中文本' };
  } catch (err) {
    console.error('[SW] getSelectedText 失败:', err);
    return makeErrorFromInjectionError(err, '无法获取选中文本，请确认已打开网页');
  }
}

// ========== 获取页面基本信息 ==========
async function handleGetPageInfo(tabId) {
  if (!tabId) {
    return makeError('NO_TAB', '缺少 tabId 参数');
  }

  try {
    await ensureScriptsInjected(tabId, ['content/content-extract.js']);

    const response = await chrome.tabs.sendMessage(tabId, { action: 'getPageInfo' });

    if (response && response.success) {
      return {
        success: true,
        data: {
          title: response.data.title || '',
          url: response.data.url || '',
          description: response.data.description || '',
          favicon: response.data.favicon || ''
        }
      };
    }

    return { success: false, error: '获取页面信息失败' };
  } catch (err) {
    console.error('[SW] getPageInfo 失败:', err);
    return makeErrorFromInjectionError(err, err.message);
  }
}

// ========== 摘要生成 ==========
async function handleSummarize(payload) {
  const { requestId, noteId, content, title, method, mode, config, pageType } = payload;

  console.log('[SW] 摘要请求:', {
    requestId: requestId || null,
    noteId,
    method,
    mode,
    pageType: pageType || '',
    contentLength: content?.length || 0
  });

  if (!content || !content.trim()) {
    return { success: false, error: '内容为空，无法生成摘要' };
  }

  const controller = new AbortController();
  if (requestId) {
    activeSummaryRequests.set(requestId, controller);
  }

  try {
    const result = await generateSummary(
      config || {},
      title || '',
      content,
      {
        length: config?.length || 'medium',
        mode: mode || method || 'auto',
        requestId,
        pageType: pageType || 'article',
        signal: controller.signal
      }
    );

    if (result.success && result.summary) {
      console.log('[SW] 摘要生成成功:', { requestId: requestId || null, method: result.method });
      return {
        success: true,
        summary: result.summary,
        method: result.method,
        usage: result.usage || null
      };
    }

    return {
      success: false,
      code: result.code,
      error: result.error || '所有摘要方案均失败',
      method: result.method || 'none'
    };
  } catch (err) {
    console.error('[SW] 摘要生成异常:', {
      requestId: requestId || null,
      message: err.message || String(err)
    });
    return {
      success: false,
      error: `摘要生成失败: ${err.message}`
    };
  } finally {
    if (requestId) {
      activeSummaryRequests.delete(requestId);
    }
  }
}

async function handleSummarizePageAndSave(payload) {
  const { tabId, requestId } = payload;

  if (!tabId) {
    return makeError('NO_TAB', '缺少 tabId 参数');
  }

  const summaryRequestId = requestId || `page_sum_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const controller = new AbortController();
  activeSummaryRequests.set(summaryRequestId, controller);

  console.log('[SW] 后台网页摘要请求:', {
    requestId: summaryRequestId,
    tabId
  });

  try {
    await initStorage();

    let tab = null;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (err) {
      console.warn('[SW] 获取摘要目标标签页失败:', { tabId, message: err.message || String(err) });
    }

    const extracted = await handleExtractPage(tabId);
    if (!extracted || !extracted.success || !extracted.data) {
      return extracted || makeError('NO_CONTENT', '提取页面内容失败');
    }

    if (controller.signal.aborted) {
      return { success: false, code: 'CANCELLED', error: '已取消生成', method: 'none' };
    }

    const data = extracted.data;
    const settings = getSettings();
    const llmConfig = buildLlmConfigFromSettings(settings);
    const title = data.title || tab?.title || '未命名页面';
    const sourceUrl = data.url || tab?.url || '';
    const sourceTitle = data.sourceTitle || data.title || tab?.title || sourceUrl;
    const pageType = data.pageType || 'article';

    const summaryResult = await generateSummary(
      llmConfig,
      title,
      data.content || '',
      {
        length: llmConfig.length || 'medium',
        mode: 'auto',
        requestId: summaryRequestId,
        pageType,
        signal: controller.signal
      }
    );

    if (!summaryResult || !summaryResult.success || !summaryResult.summary) {
      return {
        success: false,
        code: summaryResult?.code,
        error: summaryResult?.error || '网页摘要生成失败',
        method: summaryResult?.method || 'none'
      };
    }

    if (controller.signal.aborted) {
      return { success: false, code: 'CANCELLED', error: '已取消生成', method: 'none' };
    }

    const summary = String(summaryResult.summary || '').trim();
    const savedAt = Date.now();
    const note = await createNote({
      type: 'summarized',
      title,
      content: '',
      summary,
      excerpt: getSummaryExcerpt(summary),
      url: sourceUrl,
      sourceTitle,
      pageType,
      extractionMethod: data.method || '',
      extractionConfidence: typeof data.confidence === 'number' ? data.confidence : null,
      extractionReason: data.reason || '',
      qualityWarnings: Array.isArray(data.qualityWarnings) ? data.qualityWarnings : [],
      imageOcr: data.imageOcr || null,
      summaryMethod: summaryResult.method || '',
      summaryStatus: 'saved',
      summarySavedAt: savedAt,
      summaryUsage: summaryResult.usage || null
    });

    console.log('[SW] 后台网页摘要已保存:', {
      requestId: summaryRequestId,
      noteId: note.id,
      method: summaryResult.method || ''
    });

    return {
      success: true,
      data: {
        noteId: note.id,
        title: note.title,
        summary: note.summary,
        url: note.url,
        sourceTitle: note.sourceTitle,
        saved: true,
        savedAt,
        method: note.summaryMethod,
        pageType: note.pageType,
        qualityWarnings: note.qualityWarnings || [],
        usage: note.summaryUsage || null
      }
    };
  } catch (err) {
    console.error('[SW] 后台网页摘要失败:', {
      requestId: summaryRequestId,
      tabId,
      message: err.message || String(err)
    });
    return {
      success: false,
      error: `网页摘要失败: ${err.message || String(err)}`
    };
  } finally {
    activeSummaryRequests.delete(summaryRequestId);
  }
}

function buildLlmConfigFromSettings(settings = {}) {
  return {
    endpoint: settings.llm?.apiEndpoint || '',
    apiKey: settings.llm?.apiKey || '',
    model: settings.llm?.model || 'gpt-4o-mini',
    enabled: settings.llm?.enabled || false,
    length: settings.summaryLength || 'medium'
  };
}

function getSummaryExcerpt(summary, maxLength = 150) {
  const value = String(summary || '').replace(/\s+/g, ' ').trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trim()}…`;
}

async function handleCancelSummarize(requestId) {
  if (!requestId) {
    return makeError('NO_REQUEST', '缺少 requestId 参数');
  }

  const controller = activeSummaryRequests.get(requestId);
  if (!controller) {
    return makeError('REQUEST_NOT_FOUND', '没有找到正在生成的摘要请求');
  }

  controller.abort();
  activeSummaryRequests.delete(requestId);
  console.log('[SW] 摘要请求已取消:', { requestId });
  return { success: true };
}

// ========== 辅助：确保脚本已注入 ==========
/**
 * 向标签页注入脚本（如果尚未注入）
 * @param {number} tabId
 * @param {string[]} scripts - 脚本路径数组（相对于扩展根目录）
 */
async function ensureScriptsInjected(tabId, scripts) {
  // 过滤出尚未注入的脚本
  const missingScripts = scripts.filter(s => !isScriptInjected(tabId, s));

  if (missingScripts.length === 0) {
    console.log('[SW] 所有脚本已注入，跳过');
    return;
  }

  console.log('[SW] 注入脚本:', missingScripts);

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: missingScripts
    });

    // 标记为已注入
    missingScripts.forEach(s => markScriptInjected(tabId, s));

    console.log('[SW] 脚本注入成功');
  } catch (err) {
    console.error('[SW] 脚本注入失败:', err);

    const detail = normalizeInjectionErrorDetail(err);
    const wrapped = new Error(detail.error || `脚本注入失败: ${err.message}`);
    wrapped.code = detail.code;
    throw wrapped;
  }
}

function makeError(code, error) {
  return { success: false, code, error };
}

function makeErrorFromInjectionError(err, fallback = '提取失败') {
  const detail = normalizeInjectionErrorDetail(err);
  return makeError(detail.code, detail.error || fallback);
}

function normalizeInjectionErrorDetail(err) {
  if (err && err.code) {
    return {
      code: err.code,
      error: err.message || '提取失败'
    };
  }

  const message = err && err.message ? err.message : String(err || '');
  const mentionsWebUrl = /https?:\/\//i.test(message);

  if (/Missing host permission|host permission|The activeTab permission|manifest must request permission/i.test(message) ||
      (/Cannot access contents of url/i.test(message) && mentionsWebUrl)) {
    return {
      code: 'MISSING_HOST_PERMISSION',
      error: '缺少当前网页访问授权，请允许扩展访问此网站后重试'
    };
  }

  if (/No tab with id/i.test(message)) {
    return {
      code: 'NO_TAB',
      error: '当前标签页已关闭或不可用，请切换到目标网页后重试'
    };
  }

  if (/chrome:|chrome-extension:|edge:|about:|view-source:|file:|extensions gallery/i.test(message) ||
      /Cannot access contents of url/i.test(message)) {
    return {
      code: 'RESTRICTED_PAGE',
      error: '无法在系统页面、扩展页面或受限页面提取内容'
    };
  }

  if (/Could not establish connection|Receiving end does not exist/i.test(message)) {
    return {
      code: 'CONNECTION_FAILED',
      error: '无法连接到页面，请刷新页面后重试'
    };
  }

  return {
    code: 'UNKNOWN',
    error: message
  };
}

function normalizeInjectionError(err) {
  return normalizeInjectionErrorDetail(err).error;
}

console.log('[SW] Service Worker 已启动');
