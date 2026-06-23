// ============================================================
// Service Worker — 消息中枢 + 内容脚本注入 + LLM API 调用
// MV3 ES Module
// ============================================================

import { generateSummary } from './lib/summarizer.js';
import { callLearningSummaryLLM, selectNoiseWithLLM } from './lib/llm-client.js';
import { initStorage, getSettings } from './lib/storage.js';

const SIDEPANEL_PATH = 'sidepanel/sidepanel.html';
const YOUTUBE_BACKEND_TRANSCRIPT_LIMIT = 60000;
const LOCAL_YOUTUBE_TRANSCRIPT_API = {
  enabled: true,
  endpoint: 'http://127.0.0.1:8788/v1/youtube/transcript',
  apiKey: 'local-dev-transcript-key',
  preferredLanguages: ['zh-CN', 'zh', 'en'],
  timeoutMs: 20000
};

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
        enabled: false,
        noiseSelectionEnabled: false
      },
      youtubeTranscriptApi: {
        ...LOCAL_YOUTUBE_TRANSCRIPT_API,
        preferredLanguages: [...LOCAL_YOUTUBE_TRANSCRIPT_API.preferredLanguages]
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
    contentLength: typeof message.content === 'string' ?
      message.content.length :
      (typeof message.recordsText === 'string' ? message.recordsText.length : 0)
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

    // --- 生成本地摘要记录的学习过程总结 ---
    case 'summarizeLearning': {
      handleSummarizeLearning(message)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    // --- 旧版后台总结入口（已弃用，摘要由 sidepanel 编排云端发送确认） ---
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

  let tab = null;
  let primaryYouTubeTranscriptData = null;

  try {
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (err) {
      console.warn('[SW] 获取提取目标标签页失败，继续使用页面脚本提取:', {
        tabId,
        message: err.message || String(err)
      });
    }

    primaryYouTubeTranscriptData = await maybeExtractYouTubeTranscriptFromTab(tab);
    if (isYouTubeTranscriptExtraction(primaryYouTubeTranscriptData)) {
      const data = await maybeApplyCloudNoiseSelection(primaryYouTubeTranscriptData);
      return {
        success: true,
        data: stripInternalExtractionFields(data)
      };
    }

    // 注入 Readability 库 + 内容提取脚本
    await ensureScriptsInjected(tabId, [
      'content/readability.js',
      'content/content-extract.js'
    ]);

    // 向内容脚本发送提取指令
    const response = await chrome.tabs.sendMessage(tabId, { action: 'extractPage' });

    if (response && response.success && response.data && response.data.content) {
      let data = {
        title: response.data.title || '',
        content: response.data.content || '',
        url: response.data.url || '',
        sourceTitle: response.data.title || '',
        excerpt: response.data.excerpt || '',
        method: response.data.method || '',
        pageType: response.data.pageType || '',
        confidence: typeof response.data.confidence === 'number' ? response.data.confidence : null,
        reason: response.data.reason || '',
        transcriptAvailable: !!response.data.transcriptAvailable,
        transcriptSource: response.data.transcriptSource || '',
        transcriptProvider: response.data.transcriptProvider || '',
        transcriptAttempts: Array.isArray(response.data.transcriptAttempts) ? response.data.transcriptAttempts : [],
        youtube: response.data.youtube && typeof response.data.youtube === 'object' ? response.data.youtube : null,
        qualityWarnings: Array.isArray(response.data.qualityWarnings) ? response.data.qualityWarnings : [],
        imageOcr: response.data.imageOcr || null,
        noiseCandidates: Array.isArray(response.data.noiseCandidates) ? response.data.noiseCandidates : []
      };

      if (hasYouTubeTranscriptApiAttempt(primaryYouTubeTranscriptData)) {
        data = mergeYouTubeTranscriptApiFallback(data, primaryYouTubeTranscriptData);
      } else {
        data = await maybeApplyYouTubeTranscriptApi(data);
      }
      data = await maybeApplyCloudNoiseSelection(data);

      return {
        success: true,
        data: stripInternalExtractionFields(data)
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

async function maybeExtractYouTubeTranscriptFromTab(tab) {
  const seedData = buildYouTubeTabSeedData(tab);
  if (!seedData) return null;
  return maybeApplyYouTubeTranscriptApi(seedData);
}

function buildYouTubeTabSeedData(tab) {
  const url = tab?.url || '';
  if (!url || !isYouTubeUrl(url)) return null;

  const videoId = getYouTubeVideoIdFromUrl(url);
  if (!videoId) return null;

  const title = cleanYouTubeTabTitle(tab?.title || '') || 'YouTube Video';

  return {
    title,
    content: '',
    url,
    sourceTitle: title,
    excerpt: '',
    method: 'youtube-transcript-api-primary',
    pageType: 'video',
    confidence: 0.7,
    reason: 'youtube-transcript-api-primary',
    transcriptAvailable: false,
    transcriptSource: '',
    transcriptProvider: '',
    transcriptAttempts: [],
    youtube: {
      videoId,
      title
    },
    qualityWarnings: [],
    imageOcr: null,
    noiseCandidates: []
  };
}

function cleanYouTubeTabTitle(title) {
  return String(title || '')
    .replace(/\s+-\s+YouTube\s*$/i, '')
    .trim();
}

function isYouTubeTranscriptExtraction(data) {
  return !!data && data.method === 'youtube-transcript' && !!data.transcriptAvailable && !!String(data.content || '').trim();
}

function hasYouTubeTranscriptApiAttempt(data) {
  const attempts = Array.isArray(data?.transcriptAttempts) ? data.transcriptAttempts : [];
  return attempts.some(attempt => {
    const provider = String(attempt?.provider || attempt?.source || '');
    return provider === 'user-youtube-transcript-api' || provider.startsWith('user-transcript-api:');
  });
}

function mergeYouTubeTranscriptApiFallback(data, transcriptData) {
  const attempts = mergeTranscriptAttempts(data?.transcriptAttempts, transcriptData?.transcriptAttempts);
  return {
    ...data,
    transcriptAttempts: attempts,
    qualityWarnings: uniqueStrings([
      ...(Array.isArray(data?.qualityWarnings) ? data.qualityWarnings : []),
      ...(Array.isArray(transcriptData?.qualityWarnings) ? transcriptData.qualityWarnings : [])
    ]),
    youtube: {
      ...(data?.youtube || {}),
      transcriptAttempts: attempts
    }
  };
}

function mergeTranscriptAttempts(currentAttempts, nextAttempts) {
  const merged = [];
  const seen = new Set();
  for (const attempt of [
    ...(Array.isArray(currentAttempts) ? currentAttempts : []),
    ...(Array.isArray(nextAttempts) ? nextAttempts : [])
  ]) {
    if (!attempt || typeof attempt !== 'object') continue;
    const key = [
      attempt.provider || '',
      attempt.source || '',
      attempt.error || '',
      attempt.ok === true ? 'ok' : 'fail'
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(attempt);
  }
  return merged;
}

async function maybeApplyYouTubeTranscriptApi(data) {
  if (!shouldTryYouTubeTranscriptApi(data)) {
    return data;
  }

  let settings = {};
  try {
    await initStorage();
    settings = getSettings();
  } catch (err) {
    console.warn('[SW] 读取 YouTube 字幕后端设置失败，跳过:', err.message || String(err));
    return data;
  }

  const config = normalizeYouTubeTranscriptApiConfig(settings.youtubeTranscriptApi);
  if (!config.enabled || !config.endpoint || !config.apiKey) {
    return data;
  }

  const videoId = data.youtube?.videoId || getYouTubeVideoIdFromUrl(data.url);
  if (!videoId) {
    return withYouTubeTranscriptApiWarning(data, '未能识别 YouTube videoId');
  }

  const attempt = {
    provider: 'user-youtube-transcript-api',
    ok: false,
    error: ''
  };

  try {
    const result = await callUserYouTubeTranscriptApi(config, {
      videoId,
      url: data.url || '',
      languages: config.preferredLanguages,
      maxChars: YOUTUBE_BACKEND_TRANSCRIPT_LIMIT
    });

    if (!result.success || !result.text) {
      attempt.error = result.message || result.error || result.code || '用户字幕后端未返回可用字幕';
      return withYouTubeTranscriptApiWarning(appendYouTubeTranscriptAttempt(data, attempt), attempt.error);
    }

    const backendProvider = result.provider || result.source || 'youtube-transcript-api';
    const providerLabel = `user-transcript-api:${backendProvider}`;
    attempt.ok = true;
    attempt.provider = providerLabel;
    const transcriptText = truncateText(result.text, YOUTUBE_BACKEND_TRANSCRIPT_LIMIT);
    const content = buildYouTubeTranscriptContent(data, transcriptText);
    const warnings = uniqueStrings([
      ...(Array.isArray(data.qualityWarnings) ? data.qualityWarnings : []),
      result.warning || '',
      ...(Array.isArray(result.warnings) ? result.warnings : [])
    ]);

    return appendYouTubeTranscriptAttempt({
      ...data,
      content,
      excerpt: getTextExcerpt(content, 200),
      method: 'youtube-transcript',
      confidence: 0.9,
      reason: providerLabel,
      transcriptAvailable: true,
      transcriptSource: result.language ? `${providerLabel}:${result.language}` : providerLabel,
      transcriptProvider: providerLabel,
      qualityWarnings: warnings,
      youtube: {
        ...(data.youtube || {}),
        videoId,
        transcriptAvailable: true,
        transcriptSource: result.language ? `${providerLabel}:${result.language}` : providerLabel,
        transcriptProvider: providerLabel,
        transcriptApiSource: backendProvider,
        transcriptLanguage: result.language || '',
        transcriptIsGenerated: typeof result.isGenerated === 'boolean' ? result.isGenerated : null
      }
    }, attempt);
  } catch (err) {
    attempt.error = normalizeTranscriptApiError(err);
    return withYouTubeTranscriptApiWarning(appendYouTubeTranscriptAttempt(data, attempt), attempt.error);
  }
}

function shouldTryYouTubeTranscriptApi(data) {
  if (!data || data.pageType !== 'video') return false;
  if (data.transcriptAvailable || data.method === 'youtube-transcript') return false;
  return isYouTubeUrl(data.url || '') || !!data.youtube?.videoId;
}

function normalizeYouTubeTranscriptApiConfig(config = {}) {
  const endpoint = normalizeTranscriptEndpoint(config.endpoint || '');
  const preferredLanguages = Array.isArray(config.preferredLanguages) ?
    config.preferredLanguages.map(item => String(item || '').trim()).filter(Boolean) :
    ['zh-CN', 'zh', 'en'];
  const timeoutMs = Math.max(3000, Math.min(Number(config.timeoutMs) || 20000, 60000));

  return {
    enabled: !!config.enabled,
    endpoint,
    apiKey: String(config.apiKey || '').trim(),
    preferredLanguages: preferredLanguages.length ? preferredLanguages : ['zh-CN', 'zh', 'en'],
    timeoutMs
  };
}

function normalizeTranscriptEndpoint(endpoint) {
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

async function callUserYouTubeTranscriptApi(config, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        videoId: payload.videoId,
        url: payload.url,
        languages: payload.languages,
        maxChars: payload.maxChars
      }),
      signal: controller.signal,
      credentials: 'omit'
    });

    const bodyText = await response.text();
    let body = {};
    if (bodyText) {
      try {
        body = JSON.parse(bodyText);
      } catch (err) {
        body = { success: false, message: bodyText.slice(0, 500) };
      }
    }

    if (!response.ok) {
      return {
        success: false,
        code: body.code || `HTTP_${response.status}`,
        message: body.message || `用户字幕后端返回 HTTP ${response.status}`
      };
    }

    return normalizeTranscriptApiResponse(body);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeTranscriptApiResponse(body = {}) {
  const segments = Array.isArray(body.segments) ? body.segments : [];
  const text = typeof body.text === 'string' && body.text.trim() ?
    body.text :
    segments.map(segment => String(segment?.text || '').trim()).filter(Boolean).join('\n');

  return {
    success: body.success !== false && !!text.trim(),
    text: cleanPlainText(text),
    language: body.language || body.languageCode || '',
    provider: body.provider || '',
    source: body.source || 'youtube-transcript-api',
    isGenerated: body.isGenerated,
    warnings: Array.isArray(body.warnings) ? body.warnings : [],
    warning: body.warning || '',
    code: body.code || '',
    message: body.message || body.error || ''
  };
}

function buildYouTubeTranscriptContent(data, transcriptText) {
  const youtube = data.youtube || {};
  const parts = [];
  const title = youtube.title || data.title || '';
  if (title) parts.push(`YouTube 视频标题：${title}`);
  if (youtube.channel) parts.push(`频道：${youtube.channel}`);
  parts.push(`字幕/Transcript：\n${transcriptText}`);

  if (youtube.description) {
    parts.push(`简介：\n${truncateText(youtube.description, 4000)}`);
  }

  if (Array.isArray(youtube.chapters) && youtube.chapters.length > 0) {
    parts.push(`章节：\n${youtube.chapters.map((item, index) => {
      const time = item.time ? `${item.time} ` : '';
      return `${index + 1}. ${time}${item.title || ''}`.trim();
    }).join('\n')}`);
  }

  return cleanPlainText(parts.filter(Boolean).join('\n\n'));
}

function appendYouTubeTranscriptAttempt(data, attempt) {
  const attempts = [
    ...(Array.isArray(data.transcriptAttempts) ? data.transcriptAttempts : []),
    attempt
  ];

  return {
    ...data,
    transcriptAttempts: attempts,
    youtube: {
      ...(data.youtube || {}),
      transcriptAttempts: attempts
    }
  };
}

function withYouTubeTranscriptApiWarning(data, reason) {
  return {
    ...data,
    qualityWarnings: uniqueStrings([
      ...(Array.isArray(data.qualityWarnings) ? data.qualityWarnings : []),
      `YouTube 用户字幕后端不可用，已保留标题、简介和章节降级结果：${reason}`
    ])
  };
}

function isYouTubeUrl(url) {
  try {
    const parsed = new URL(url);
    return /(^|\.)youtube\.com$/i.test(parsed.hostname) || /(^|\.)youtu\.be$/i.test(parsed.hostname);
  } catch (err) {
    return false;
  }
}

function getYouTubeVideoIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (/(^|\.)youtu\.be$/.test(host)) {
      return parsed.pathname.split('/').filter(Boolean)[0] || '';
    }
    if (/(^|\.)youtube\.com$/.test(host)) {
      if (parsed.pathname === '/watch') return parsed.searchParams.get('v') || '';
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (['shorts', 'live', 'embed'].includes(parts[0])) return parts[1] || '';
    }
  } catch (err) {
    return '';
  }
  return '';
}

function cleanPlainText(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function truncateText(text, maxLength) {
  const value = String(text || '').trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizeTranscriptApiError(err) {
  if (err?.name === 'AbortError') {
    return '用户字幕后端请求超时';
  }
  return err?.message || String(err || '用户字幕后端请求失败');
}

async function maybeApplyCloudNoiseSelection(data) {
  if (!data || !Array.isArray(data.noiseCandidates) || data.noiseCandidates.length === 0) {
    return data;
  }

  let settings = {};
  try {
    await initStorage();
    settings = getSettings();
  } catch (err) {
    console.warn('[SW] 读取云端判噪设置失败，跳过:', err.message || String(err));
    return data;
  }

  if (!shouldUseCloudNoiseSelection(settings, data)) {
    return data;
  }

  const requestId = `noise_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const llmConfig = buildLlmConfigFromSettings(settings);

  try {
    const result = await selectNoiseWithLLM(llmConfig, data, { requestId });
    if (!result || !result.success || !result.content) {
      return withNoiseSelectionWarning(data, result?.error || '云端正文去噪未返回可用结果');
    }

    console.log('[SW] 云端正文去噪成功:', {
      requestId,
      selectedCandidateIds: result.selectedCandidateIds || []
    });

    return {
      ...data,
      content: result.content,
      excerpt: getTextExcerpt(result.content, 200),
      method: 'llm-noise-select',
      confidence: typeof result.confidence === 'number' ? result.confidence : data.confidence,
      reason: result.reason || 'llm-noise-selection',
      originalExtractionMethod: data.method || '',
      noiseSelectionMethod: result.method || 'llm-noise-select',
      noiseSelectionConfidence: typeof result.confidence === 'number' ? result.confidence : null,
      noiseSelectionReason: result.reason || '',
      selectedCandidateIds: Array.isArray(result.selectedCandidateIds) ? result.selectedCandidateIds : [],
      discardedCandidateIds: Array.isArray(result.discardedCandidateIds) ? result.discardedCandidateIds : [],
      qualityWarnings: uniqueStrings([
        ...(Array.isArray(data.qualityWarnings) ? data.qualityWarnings : []),
        '已使用云端模型从本地候选块中选择正文。'
      ])
    };
  } catch (err) {
    console.warn('[SW] 云端正文去噪异常，回退本地结果:', err.message || String(err));
    return withNoiseSelectionWarning(data, err.message || '云端正文去噪异常');
  }
}

function shouldUseCloudNoiseSelection(settings, data) {
  const llm = settings?.llm || {};
  if (!llm.enabled || !llm.noiseSelectionEnabled || !llm.apiEndpoint || !llm.apiKey) return false;
  if (!Array.isArray(data.noiseCandidates) || data.noiseCandidates.length < 2) return false;
  if (data.method === 'llm-noise-select') return false;

  const content = String(data.content || '').trim();
  const warnings = (Array.isArray(data.qualityWarnings) ? data.qualityWarnings : []).join('\n');
  const confidence = typeof data.confidence === 'number' ? data.confidence : 1;
  const pageType = data.pageType || 'unknown';
  const method = data.method || '';

  return confidence < 0.75 ||
    /噪声|导航|控件|重复文本|通用回退|页面类型不明确/.test(warnings) ||
    (method === 'fallback' && pageType !== 'article') ||
    content.length < 120 ||
    content.length > 30000;
}

function withNoiseSelectionWarning(data, reason) {
  return {
    ...data,
    qualityWarnings: uniqueStrings([
      ...(Array.isArray(data.qualityWarnings) ? data.qualityWarnings : []),
      `云端正文去噪未生效，已保留本地提取结果：${reason}`
    ])
  };
}

function stripInternalExtractionFields(data) {
  const { noiseCandidates, selectedCandidateIds, discardedCandidateIds, ...safeData } = data || {};
  return safeData;
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
  const summaryMode = mode || method || 'llm';

  console.log('[SW] 摘要请求:', {
    requestId: requestId || null,
    noteId,
    method,
    mode: summaryMode,
    pageType: pageType || '',
    contentLength: content?.length || 0
  });

  if (summaryMode !== 'llm') {
    return {
      success: false,
      error: '当前版本仅支持云端 LLM 摘要',
      method: 'none'
    };
  }

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
        mode: 'llm',
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
      error: result.error || '云端摘要生成失败',
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

async function handleSummarizeLearning(payload) {
  const {
    requestId,
    recordsText,
    periodLabel,
    rangeLabel,
    noteCount,
    selectedCount
  } = payload || {};

  console.log('[SW] 学习总结请求:', {
    requestId: requestId || null,
    periodLabel: periodLabel || '',
    rangeLabel: rangeLabel || '',
    noteCount: noteCount || 0,
    selectedCount: selectedCount || 0,
    contentLength: recordsText?.length || 0
  });

  if (!recordsText || !String(recordsText).trim()) {
    return { success: false, error: '摘要记录为空，无法生成学习总结', method: 'llm-learning' };
  }

  const controller = new AbortController();
  if (requestId) {
    activeSummaryRequests.set(requestId, controller);
  }

  try {
    let llmConfig = payload.config || {};
    if (!llmConfig.endpoint && !llmConfig.apiKey) {
      try {
        await initStorage();
        llmConfig = buildLlmConfigFromSettings(getSettings());
      } catch (err) {
        console.warn('[SW] 读取学习总结 LLM 设置失败:', err.message || String(err));
      }
    }

    const result = await callLearningSummaryLLM(
      llmConfig,
      {
        period: payload.period || '',
        periodLabel: periodLabel || '本周期',
        rangeLabel: rangeLabel || '',
        noteCount: noteCount || 0,
        selectedCount: selectedCount || noteCount || 0,
        omittedCount: payload.omittedCount || 0,
        recordsText: String(recordsText || '')
      },
      {
        requestId,
        signal: controller.signal
      }
    );

    if (result.success && result.summary) {
      console.log('[SW] 学习总结生成成功:', { requestId: requestId || null, method: result.method });
      return {
        success: true,
        summary: result.summary,
        method: result.method || 'llm-learning',
        usage: result.usage || null
      };
    }

    return {
      success: false,
      code: result.code,
      error: result.error || '学习总结生成失败',
      method: result.method || 'llm-learning'
    };
  } catch (err) {
    console.error('[SW] 学习总结异常:', {
      requestId: requestId || null,
      message: err.message || String(err)
    });
    return {
      success: false,
      error: `学习总结生成失败: ${err.message}`,
      method: 'llm-learning'
    };
  } finally {
    if (requestId) {
      activeSummaryRequests.delete(requestId);
    }
  }
}

async function handleSummarizePageAndSave(payload) {
  console.warn('[SW] summarizePageAndSave 已弃用:', {
    requestId: payload?.requestId || null,
    tabId: payload?.tabId || null
  });
  return {
    success: false,
    code: 'DEPRECATED',
    error: '当前版本仅支持由侧边栏确认发送内容后调用云端 LLM 摘要',
    method: 'none'
  };
}

function buildLlmConfigFromSettings(settings = {}) {
  return {
    endpoint: settings.llm?.apiEndpoint || '',
    apiKey: settings.llm?.apiKey || '',
    model: settings.llm?.model || 'gpt-4o-mini',
    enabled: settings.llm?.enabled || false,
    noiseSelectionEnabled: settings.llm?.noiseSelectionEnabled || false,
    length: settings.summaryLength || 'medium'
  };
}

function getTextExcerpt(text, maxLength = 150) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trim()}…`;
}

function uniqueStrings(items) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(items) ? items : []) {
    const value = String(item || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
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
