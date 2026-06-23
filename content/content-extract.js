/**
 * 网页内容提取内容脚本
 * 经典脚本（非 ES module），通过 chrome.runtime.onMessage 接收指令
 * 依赖 content/readability.js（需先注入，暴露 window.Readability）
 */

(function () {
  'use strict';

  // 避免重复注册监听器
  if (window.__contentExtractInitialized) return;
  window.__contentExtractInitialized = true;

  const CONTENT_SELECTORS = [
    '[itemprop="articleBody"]',
    '[data-testid="article-body"]',
    '[data-component="text-block"]',
    'article',
    'main article',
    '.article-content',
    '.article__content',
    '.article-body',
    '.article__body',
    '.post-content',
    '.entry-content',
    '.content-body',
    '.story-body',
    '.story-content',
    '.markdown-body',
    '.theme-doc-markdown',
    '#mw-content-text .mw-parser-output',
    '.mw-parser-output',
    '.dangyuanwang160317_ind01',
    '#font_area',
    '.font_area_mid',
    '.con .word',
    '.col_w900',
    '.cnt_bd',
    '.content_area',
    '[role="main"]',
    'main',
    '#content',
    '.content',
    '#article',
    '.article',
    '#main',
    '.main-content'
  ];

  const NOISE_SELECTORS = [
    'script',
    'style',
    'noscript',
    'iframe',
    'svg',
    'canvas',
    'img[src^="data:"]',
    'form',
    'input',
    'button',
    'select',
    'textarea',
    '[hidden]',
    '[aria-hidden="true"]',
    '[role="banner"]',
    '[role="navigation"]',
    '[role="contentinfo"]',
    '[role="complementary"]',
    '[role="search"]',
    '[aria-modal="true"]',
    '[data-testid*="cookie" i]',
    '[data-testid*="banner" i]',
    '[class*="cookie" i]',
    '[id*="cookie" i]',
    '[class*="consent" i]',
    '[id*="consent" i]',
    '[class*="subscribe" i]',
    '[id*="subscribe" i]',
    '[class*="newsletter" i]',
    '[id*="newsletter" i]',
    '[class*="advert" i]',
    '[id*="advert" i]',
    '[class*="breadcrumb" i]',
    '[id*="breadcrumb" i]',
    '[class*="related" i]',
    '[id*="related" i]',
    '[class*="navbox" i]',
    '[class*="metadata" i]',
    '[class*="vector-page-toolbar" i]',
    '[class*="vector-menu" i]',
    '.infobox',
    '.toc',
    '.catlinks',
    '.reflist',
    '.reference',
    '.mw-editsection',
    '.mw-jump-link',
    '#p-lang-btn',
    '#p-views',
    '#p-cactions',
    '#p-tb',
    '[class*="share" i]',
    '[id*="share" i]',
    'nav',
    'aside',
    'footer'
  ];

  const POSITIVE_RE = /article|body|content|entry|hentry|h-entry|main|page|post|text|blog|story|markdown|doc/i;
  const NEGATIVE_RE = /banner|breadcrumb|comment|community|consent|cookie|extra|footer|gdpr|header|menu|modal|nav|newsletter|popup|promo|related|share|sidebar|social|sponsor|subscribe/i;
  const SITE_TITLE_SEPARATOR_RE = /\s+(?:[-–—•|｜]|::)\s+/;
  const TEXT_NOISE_RE = /uses cookies from Google|Google uses AI technology|AI translations can contain errors|使用集合让一切井井有条|根据您的偏好保存内容并对其进行分类|^本页内容|^In this article$|Article \d+ of \d+|Next:/i;
  const UI_NOISE_LINE_RE = /^(?:百度首页|通知|设置|网页|图片|资讯|视频|笔记|地图|贴吧|文库|更多|更多产品|搜索工具|帮助|举报|用户反馈|企业推广|播报|暂停|发表|退出|上一页|下一页|查看更多视频|换一换热搜榜|热搜榜|民生榜|财经榜|home|new|past|comments|ask|show|jobs|submit|login|sign in|sign up|pricing|resources|platform|solutions|navigation menu|notifications|fork|star|code|issues|pull requests|actions|projects|security|insights)$/i;
  const BAIDU_RESULT_SKIP_RE = /(?:大家还在搜|相关搜索|视频大全|查看更多视频|换一换热搜榜|热搜榜|民生榜|财经榜|帮助举报用户反馈|您确定要退出吗|退出后，个人中心)/;
  const BLOCKED_PAGE_TYPES = new Set(['restricted', 'login', 'error']);
  const SEARCH_RESULT_HOST_RE = /(^|\.)((google|bing|sogou|so|duckduckgo)\.com|google\.[a-z.]+)$/i;
  const CHATGPT_HOST_RE = /(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/i;
  const OCR_MAX_IMAGES = 5;
  const OCR_TOTAL_TIMEOUT_MS = 8000;
  const OCR_PER_IMAGE_TIMEOUT_MS = 3000;
  const OCR_IMAGE_READY_TIMEOUT_MS = 1200;
  const IMAGE_OCR_TITLE = '图片 OCR 文字：';
  const IMAGE_INFO_TITLE = '图片内容：';
  const STALE_IMAGE_OCR_WARNING_RE = /未读取图片文字|只记录了图片信息|OCR 不可用|未能从正文图片识别出文字|未能读取图片文字/;
  const NOISE_CANDIDATE_MAX = 12;
  const NOISE_CANDIDATE_TEXT_LIMIT = 5000;
  const NOISE_CANDIDATE_HTML_LIMIT = 1000;
  const NOISE_CANDIDATE_TOTAL_TEXT_LIMIT = 22000;
  const YOUTUBE_TRANSCRIPT_LIMIT = 30000;
  const YOUTUBE_METADATA_LIMIT = 3000;
  const YOUTUBE_DIRECT_TRANSCRIPT_MIN_LENGTH = 80;
  const YOUTUBE_VISIBLE_TRANSCRIPT_MIN_LINES = 8;
  const YOUTUBE_VISIBLE_TRANSCRIPT_MIN_LENGTH = 500;
  const YOUTUBE_SHORT_VIDEO_MAX_SECONDS = 120;
  const YOUTUBE_SHORT_VISIBLE_TRANSCRIPT_MIN_LENGTH = 160;
  const YOUTUBE_TRANSCRIPT_UNAVAILABLE_WARNING = '未能获取 YouTube 字幕/Transcript；摘要只能基于标题、简介和章节信息，不能代表完整视频内容。';
  const YOUTUBE_PARTIAL_TRANSCRIPT_WARNING = '检测到局部字幕，未作为完整视频摘要依据。';

  /**
   * 提取页面主要内容
   * @returns {{ success: boolean, title?: string, content?: string, htmlContent?: string, excerpt?: string, url?: string, byline?: string, method?: string, error?: string }}
   */
  async function extractPageContent() {
    const url = window.location.href;
    const classification = classifyPage(url);

    if (isYouTubeWatchPage(url)) {
      return applyExtractionMetadata(
        await extractYouTubeWatchPage(url),
        makeClassification('video', 0.92, 'youtube-watch-page')
      );
    }

    if (classification.pageType === 'search-results:baidu') {
      return applyExtractionMetadata(
        extractBaiduSearchResults(url),
        classification,
        ['当前页面是百度搜索结果页，摘要基于搜索结果条目，不代表已阅读每条原文。']
      );
    }

    if (isGitHubRepositoryPage(url)) {
      const githubResult = extractGitHubRepositoryPage(url);
      if (githubResult.success) {
        return applyExtractionMetadata(githubResult, classification);
      }
    }

    if (isChatGptConversationPage(url)) {
      const chatResult = extractChatGptConversationPage(url);
      if (chatResult.success) {
        return applyExtractionMetadata(chatResult, makeClassification(
          'chat-conversation',
          chatResult.confidence || 0.9,
          chatResult.reason || 'chatgpt-message-turns'
        ));
      }
    }

    if (classification.pageType === 'search-results:generic' || classification.pageType === 'listing') {
      return applyExtractionMetadata(extractListingPage(url, classification), classification);
    }

    if (BLOCKED_PAGE_TYPES.has(classification.pageType)) {
      return applyExtractionMetadata(extractBlockedPage(url, classification), classification);
    }

    if (classification.pageType === 'video') {
      const genericVideoResult = await extractGenericVideoPage(url);
      if (genericVideoResult.success && (genericVideoResult.transcriptAvailable || (genericVideoResult.content || '').length >= 120)) {
        return applyExtractionMetadata(genericVideoResult, classification);
      }
    }

    const fallbackResult = fallbackExtract(url);
    let readabilityResult = null;

    if (window.Readability) {
      try {
        const documentClone = makeReadabilityDocumentClone();
        const reader = new window.Readability(documentClone);
        const result = reader.parse();
        let content = cleanExtractedText(result.textContent || stripHtml(result.content || ''));
        if (content.length < 500 && document.body) {
          content = appendImageInfo(content, document.body);
        }
        readabilityResult = {
          success: true,
          title: cleanTitle(result.title || fallbackResult.title || document.title || ''),
          content,
          htmlContent: result.content || '',
          excerpt: cleanExtractedText(result.excerpt || content.slice(0, 200)).slice(0, 200),
          url,
          byline: result.byline || '',
          method: 'readability'
        };
      } catch (err) {
        console.error('[ContentExtract] Readability 解析失败:', err);
      }
    }

    if (classification.pageType === 'listing' &&
        !isArticleLikeExtraction(readabilityResult) &&
        !isArticleLikeExtraction(fallbackResult)) {
      return applyExtractionMetadata(extractListingPage(url, classification), classification);
    }

    let best = shouldUseFallback(readabilityResult, fallbackResult) ? fallbackResult : readabilityResult || fallbackResult;
    if (classification.pageType === 'listing' && isArticleLikeExtraction(best)) {
      best = {
        ...best,
        pageType: 'article',
        confidence: Math.max(classification.confidence || 0, 0.72),
        reason: 'article-content-after-readability'
      };
    }

    if (!best || !best.content || best.content.length < 20) {
      return applyExtractionMetadata({
        success: false,
        error: '未能提取到可用正文内容',
        title: cleanTitle(document.title || ''),
        url
      }, classification);
    }

    return applyExtractionMetadata({
      ...best,
      success: true,
      title: cleanTitle(best.title || document.title || ''),
      excerpt: cleanExtractedText(best.excerpt || best.content.slice(0, 200)).slice(0, 200),
      url
    }, classification);
  }

  async function extractPageContentWithOcr() {
    const result = await extractPageContent();
    if (!result || !result.success) return result;
    return enhanceResultWithImageOcr(result);
  }

  function classifyPage(url) {
    const parsed = safeParseUrl(url);
    const bodyText = normalizeText(document.body ? document.body.innerText || document.body.textContent || '' : '');
    const title = normalizeText(document.title || '');

    if (!parsed || !/^https?:$/i.test(parsed.protocol)) {
      return makeClassification('restricted', 0.98, 'non-http-url');
    }

    if (isBaiduSearchPage(url)) {
      return makeClassification('search-results:baidu', 0.98, 'baidu-search-url');
    }

    if (isLikelyErrorPage(title, bodyText)) {
      return makeClassification('error', 0.86, 'error-page-text');
    }

    if (isLikelyLoginPage(parsed, title, bodyText)) {
      return makeClassification('login', 0.84, 'login-or-captcha');
    }

    if (isLikelySearchResultsPage(parsed)) {
      return makeClassification('search-results:generic', 0.78, 'search-url');
    }

    if (isChatGptConversationPage(parsed) && hasChatGptMessageNodes()) {
      return makeClassification('chat-conversation', 0.9, 'chatgpt-message-turns');
    }

    if (isLikelyForumQaPage(parsed)) {
      return makeClassification('forum-qa', 0.72, 'forum-or-qa-structure');
    }

    if (isLikelyProductPage(parsed)) {
      return makeClassification('product', 0.74, 'product-schema-or-price');
    }

    if (isLikelyVideoPage(parsed)) {
      return makeClassification('video', 0.78, 'video-url-or-player');
    }

    if (isLikelyListingPage()) {
      return makeClassification('listing', 0.68, 'dense-link-list');
    }

    if (isLikelyArticlePage()) {
      return makeClassification('article', 0.72, 'article-structure');
    }

    if (/\.pdf(?:$|[?#])/i.test(parsed.pathname)) {
      return makeClassification('pdf-document', 0.75, 'pdf-url');
    }

    return makeClassification('unknown', 0.35, 'no-strong-signal');
  }

  function makeClassification(pageType, confidence, reason) {
    return { pageType, confidence, reason };
  }

  function safeParseUrl(url) {
    try {
      return new URL(url);
    } catch (err) {
      return null;
    }
  }

  function isLikelyErrorPage(title, bodyText) {
    const titleText = normalizeText(title);
    const sample = normalizeText(bodyText.slice(0, 1200));
    const titleLooksError = /^(?:404|403|500|not found|page not found|access denied|页面不存在|网页不存在|访问出错|无法访问|服务器错误|没有权限)\b/i.test(titleText) ||
      /(?:404|403|500|页面不存在|网页不存在|百度安全验证|安全验证)$/.test(titleText);
    const shortBodyLooksError = bodyText.length < 1500 &&
      /(?:404\s+not\s+found|page not found|access denied|页面不存在|网页不存在|访问出错|服务器错误|没有权限访问|请求被拒绝)/i.test(sample);

    return titleLooksError || shortBodyLooksError;
  }

  function isLikelyLoginPage(parsed, title, bodyText) {
    const path = `${parsed.pathname || ''}${parsed.search || ''}`;
    const hasPasswordInput = !!document.querySelector('input[type="password"]');
    const captchaNode = document.querySelector('[class*="captcha" i], [id*="captcha" i], [class*="verify" i], [id*="verify" i], [class*="wappass" i], [id*="wappass" i]');
    const captchaText = normalizeText(captchaNode ? captchaNode.textContent || '' : '');
    const routeLooksLogin = /login|signin|sign-in|passport|oauth|captcha|verify|account/i.test(path);
    const sample = normalizeText(`${title}\n${bodyText.slice(0, 1000)}`);
    const textLooksLogin = /(?:登录|登陆|注册|验证码|请先登录|安全验证|身份验证|sign in|log in|captcha|security check)/i.test(sample);
    const nodeLooksCaptcha = !!captchaNode &&
      /(?:验证码|安全验证|身份验证|captcha|security check|wappass)/i.test(`${captchaText}\n${sample}`);
    const shortSecurityGate = bodyText.length < 1600 &&
      /(?:正在进行安全验证|防护恶意自动程序|验证您不是自动程序|安全服务防护|security check|checking your browser|verify you are human)/i.test(sample);
    const chatGptNeedsLoginOrUnavailable = CHATGPT_HOST_RE.test(parsed.hostname) &&
      !hasChatGptMessageNodes() &&
      /(?:登录以获取|登录|免费注册|log in|sign up|this content is unavailable|unavailable or not found|此内容不可用|未找到)/i.test(sample);

    return chatGptNeedsLoginOrUnavailable ||
      (hasPasswordInput && textLooksLogin) ||
      nodeLooksCaptcha ||
      shortSecurityGate ||
      (routeLooksLogin && textLooksLogin);
  }

  function isLikelySearchResultsPage(parsed) {
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const hasQuery = ['q', 'query', 'wd', 'word', 'keyword', 'search'].some(name => parsed.searchParams.has(name));
    if (SEARCH_RESULT_HOST_RE.test(host) && hasQuery) return true;
    if (/\/search|\/s$|\/web/i.test(path) && hasQuery && getLikelyResultLinks().length >= 5) return true;
    return false;
  }

  function isLikelyVideoPage(parsed) {
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (/youtube\.com|youtu\.be|bilibili\.com|haokan\.baidu\.com|v\.qq\.com|youku\.com|iqiyi\.com|douyin\.com/.test(host) &&
        /watch|video|\/v\/|\/av|\/bv|\/x\/page|play/i.test(path)) {
      return true;
    }
    if (document.querySelector('[itemtype*="VideoObject"], meta[property="og:video"], meta[property="og:type"][content*="video" i]')) {
      return true;
    }
    if (document.querySelector('video')) {
      const sample = normalizeText(`${document.title || ''}\n${document.body ? document.body.innerText.slice(0, 1600) : ''}`);
      if (/(?:watch|video|播放|观看|订阅|subscribe|views|次观看|transcript|字幕)/i.test(sample) &&
          !/(?:buy|shop|price|from\s+\$|\$\d|product|specs|购买|商品|产品|价格|加入购物车|立即购买)/i.test(sample)) {
        return true;
      }
    }
    return false;
  }

  function isYouTubeWatchPage(url) {
    const parsed = safeParseUrl(url);
    if (!parsed) return false;
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (/(^|\.)youtube\.com$/.test(host)) {
      return path === '/watch' || path.startsWith('/shorts/') || path.startsWith('/live/');
    }
    return /(^|\.)youtu\.be$/.test(host);
  }

  async function extractYouTubeWatchPage(url) {
    const playerResponse = getYouTubePlayerResponse();
    const initialData = getYouTubeInitialData();
    const videoId = getYouTubeVideoId(url, playerResponse);
    const durationSeconds = getYouTubeVideoDurationSeconds(playerResponse);
    const metadata = getYouTubeVideoMetadata(playerResponse, initialData);
    const transcript = await extractYouTubeTranscriptWithProviders(playerResponse, initialData, videoId, durationSeconds);
    const chapters = getYouTubeChapters(playerResponse, initialData);

    const parts = [];
    if (metadata.title) parts.push(`YouTube 视频标题：${metadata.title}`);
    if (metadata.channel) parts.push(`频道：${metadata.channel}`);

    const warnings = [];
    let method = 'youtube-metadata';
    let reason = 'youtube-metadata-fallback';

    if (transcript.text) {
      method = 'youtube-transcript';
      reason = transcript.source || 'youtube-transcript';
      parts.push(`字幕/Transcript：\n${truncateText(transcript.text, YOUTUBE_TRANSCRIPT_LIMIT)}`);
    } else {
      warnings.push(YOUTUBE_TRANSCRIPT_UNAVAILABLE_WARNING);
      if (hasPartialVisibleTranscriptAttempt(transcript.attempts)) {
        warnings.push(YOUTUBE_PARTIAL_TRANSCRIPT_WARNING);
      }
      if (transcript.error) {
        warnings.push(`YouTube 字幕读取失败：${truncateText(transcript.error, 180)}`);
      }
    }

    if (metadata.description) {
      parts.push(`简介：\n${truncateText(metadata.description, YOUTUBE_METADATA_LIMIT)}`);
    }

    if (chapters.length > 0) {
      parts.push(`章节：\n${chapters.map((item, index) => {
        const time = item.time ? `${item.time} ` : '';
        return `${index + 1}. ${time}${item.title}`;
      }).join('\n')}`);
    }

    if (!transcript.text) {
      parts.unshift(YOUTUBE_TRANSCRIPT_UNAVAILABLE_WARNING);
    }

    const content = cleanExtractedText(parts.filter(Boolean).join('\n\n'));
    if (!content || content.length < 20) {
      return {
        success: false,
        title: metadata.title || cleanTitle(document.title || ''),
        content,
        htmlContent: '',
        excerpt: content.slice(0, 200),
        url,
        byline: metadata.channel || '',
        method,
        pageType: 'video',
        confidence: 0.45,
        reason,
        error: '未能从 YouTube 页面提取到可用的字幕、简介或章节信息',
        qualityWarnings: warnings
      };
    }

    return {
      success: true,
      title: metadata.title || cleanTitle(document.title || ''),
      content,
      htmlContent: '',
      excerpt: content.slice(0, 200),
      url,
      byline: metadata.channel || '',
      method,
      pageType: 'video',
      confidence: transcript.text ? 0.92 : 0.76,
      reason,
      transcriptAvailable: !!transcript.text,
      transcriptSource: transcript.source || '',
      transcriptProvider: transcript.provider || '',
      transcriptAttempts: transcript.attempts || [],
      youtube: {
        videoId,
        title: metadata.title || '',
        channel: metadata.channel || '',
        description: metadata.description || '',
        chapters,
        transcriptAvailable: !!transcript.text,
        transcriptSource: transcript.source || '',
        transcriptProvider: transcript.provider || '',
        transcriptAttempts: transcript.attempts || [],
        hasDescription: !!metadata.hasDescription,
        descriptionSource: metadata.descriptionSource || '',
        chapterCount: chapters.length,
        durationSeconds
      },
      qualityWarnings: warnings
    };
  }

  function getYouTubeVideoMetadata(playerResponse, initialData) {
    const videoDetails = playerResponse?.videoDetails || {};
    const microformat = playerResponse?.microformat?.playerMicroformatRenderer || {};
    const title = cleanTitle(
      videoDetails.title ||
      extractSimpleText(microformat.title) ||
      getMetaContent('meta[property="og:title"], meta[name="title"]') ||
      getFirstText([
        'h1.ytd-watch-metadata',
        'h1.title',
        '#title h1',
        'yt-formatted-string.ytd-watch-metadata'
      ]) ||
      document.title ||
      ''
    );
    const channel = normalizeText(
      videoDetails.author ||
      extractSimpleText(microformat.ownerChannelName) ||
      getMetaContent('link[itemprop="name"]') ||
      getFirstText([
        '#owner #channel-name a',
        'ytd-video-owner-renderer #channel-name a',
        '#upload-info #channel-name a'
      ])
    );
    const descriptionCandidates = [
      { source: 'videoDetails.shortDescription', text: videoDetails.shortDescription || '' },
      { source: 'microformat.description', text: extractSimpleText(microformat.description) },
      { source: 'watch-description-dom', text: getFirstText([
        '#description-inline-expander',
        'ytd-text-inline-expander',
        '#description',
        '#meta-contents #description'
      ]) },
      { source: 'meta.description', text: getMetaContent('meta[name="description"], meta[property="og:description"]') }
    ];

    let description = '';
    let descriptionSource = '';
    for (const candidate of descriptionCandidates) {
      const cleaned = sanitizeYouTubeText(candidate.text, YOUTUBE_METADATA_LIMIT);
      if (!cleaned || isGenericYouTubeDescription(cleaned)) continue;
      description = cleaned;
      descriptionSource = candidate.source;
      break;
    }

    return {
      title,
      channel,
      description,
      descriptionSource,
      hasDescription: !!description
    };
  }

  function getMetaContent(selector) {
    const node = document.querySelector(selector);
    if (!node) return '';
    return normalizeText(node.getAttribute('content') || node.getAttribute('href') || '');
  }

  function getFirstText(selectors) {
    for (const selector of selectors) {
      try {
        const node = document.querySelector(selector);
        const text = normalizeText(node ? node.textContent || '' : '');
        if (text) return text;
      } catch (err) {
        // Ignore unsupported selectors on host pages.
      }
    }
    return '';
  }

  function extractSimpleText(value) {
    if (!value) return '';
    if (typeof value === 'string') return normalizeText(value);
    if (typeof value.simpleText === 'string') return normalizeText(value.simpleText);
    if (Array.isArray(value.runs)) {
      return normalizeText(value.runs.map(run => run.text || '').join(''));
    }
    return '';
  }

  function sanitizeYouTubeText(text, maxLength = YOUTUBE_METADATA_LIMIT) {
    const lines = splitCleanLines(text)
      .filter(line => !/^(?:subscribe|subscribed|join|share|clip|save|thanks|download|more|show less|show more|sign in|log in)$/i.test(line))
      .filter(line => !/^https?:\/\//i.test(line));
    return truncateText(lines.join('\n'), maxLength);
  }

  function isGenericYouTubeDescription(text) {
    const value = normalizeText(text);
    return /Enjoy the videos and music you love|upload original content|share it all with friends|在\s*YouTube\s*上.*视频.*音乐.*上传原创内容|畅享你喜爱的视频和音乐/i.test(value);
  }

  async function extractGenericVideoPage(url) {
    const metadata = getGenericVideoMetadata();
    const transcript = await extractGenericPageTranscript();
    const parts = [];
    const warnings = [];

    if (metadata.title) parts.push(`视频标题：${metadata.title}`);
    if (transcript.text) {
      parts.push(`字幕/Transcript：\n${truncateText(transcript.text, YOUTUBE_TRANSCRIPT_LIMIT)}`);
    } else {
      warnings.push('未能获取页面字幕/Transcript；摘要只能基于页面标题、简介和可见视频元数据，不能代表完整视频内容。');
      if (transcript.error) warnings.push(`字幕读取失败：${truncateText(transcript.error, 180)}`);
    }
    if (metadata.description) {
      parts.push(`简介：\n${truncateText(metadata.description, YOUTUBE_METADATA_LIMIT)}`);
    }

    const content = cleanExtractedText(parts.filter(Boolean).join('\n\n'));
    return {
      success: content.length >= 20,
      title: metadata.title || cleanTitle(document.title || ''),
      content,
      htmlContent: '',
      excerpt: content.slice(0, 200),
      url,
      byline: metadata.byline || '',
      method: transcript.text ? 'video-transcript' : 'video-metadata',
      pageType: 'video',
      confidence: transcript.text ? 0.86 : 0.58,
      reason: transcript.text ? transcript.source || 'generic-video-transcript' : 'generic-video-metadata',
      transcriptAvailable: !!transcript.text,
      transcriptSource: transcript.source || '',
      qualityWarnings: warnings
    };
  }

  function getGenericVideoMetadata() {
    const title = cleanTitle(
      getMetaContent('meta[property="og:title"], meta[name="twitter:title"], meta[name="title"]') ||
      getFirstText(['h1', '[itemprop="name"]']) ||
      document.title ||
      ''
    );
    const description = cleanExtractedText(
      getMetaContent('meta[property="og:description"], meta[name="description"], meta[name="twitter:description"]') ||
      getFirstText(['[itemprop="description"]', '.description', '#description']) ||
      ''
    );
    const byline = normalizeText(
      getMetaContent('meta[name="author"], meta[property="article:author"]') ||
      getFirstText(['[rel="author"]', '.author', '.byline'])
    );
    return {
      title,
      description: truncateText(description, YOUTUBE_METADATA_LIMIT),
      byline
    };
  }

  async function extractGenericPageTranscript() {
    const visibleTranscript = getVisibleGenericTranscriptText();
    if (visibleTranscript) {
      return { text: visibleTranscript, source: 'visible-transcript' };
    }

    const tracks = getHtmlCaptionTracks();
    const errors = [];
    for (const track of tracks.slice(0, 4)) {
      try {
        const text = await fetchGenericCaptionTrack(track);
        if (text) {
          return {
            text,
            source: `html-track:${track.srclang || track.label || 'unknown'}`
          };
        }
        errors.push(`字幕轨道为空：${track.src}`);
      } catch (err) {
        errors.push(err.message || String(err));
      }
    }

    return {
      text: '',
      source: '',
      error: errors.join('；') || '页面未暴露可访问的字幕轨道'
    };
  }

  function getVisibleGenericTranscriptText() {
    const containerSelectors = [
      '[class*="transcript" i]',
      '[id*="transcript" i]',
      '[aria-label*="transcript" i]',
      '[class*="caption" i]',
      '[id*="caption" i]',
      '[class*="subtitle" i]',
      '[id*="subtitle" i]'
    ];
    const lines = [];

    containerSelectors.forEach(selector => {
      let nodes = [];
      try {
        nodes = Array.from(document.querySelectorAll(selector)).slice(0, 8);
      } catch (err) {
        nodes = [];
      }

      nodes.forEach(node => {
        if (!isVisibleElement(node)) return;
        const clone = node.cloneNode(true);
        cleanupClone(clone);
        splitCleanLines(clone.textContent || '').forEach(line => {
          const text = normalizeCaptionLine(line);
          if (text && !isYouTubeTimestamp(text) && !isLowValueTranscriptLine(text)) {
            lines.push(text);
          }
        });
      });
    });

    const text = collectCaptionLines(lines).join('\n');
    return text.length >= 80 ? text : '';
  }

  function isLowValueTranscriptLine(line) {
    return /^(?:transcript|captions?|subtitles?|show transcript|hide transcript|download|share|copy|settings|auto-scroll|search)$/i.test(line || '');
  }

  function getHtmlCaptionTracks() {
    return Array.from(document.querySelectorAll('track'))
      .map(track => ({
        src: track.getAttribute('src') || '',
        kind: track.getAttribute('kind') || '',
        srclang: track.getAttribute('srclang') || '',
        label: track.getAttribute('label') || ''
      }))
      .filter(track => track.src && /^(?:captions|subtitles)?$/i.test(track.kind || 'captions'))
      .sort((a, b) => scoreHtmlCaptionTrack(b) - scoreHtmlCaptionTrack(a));
  }

  function scoreHtmlCaptionTrack(track) {
    const lang = String(track.srclang || track.label || '').toLowerCase();
    const preferred = [navigator.language, document.documentElement.lang, 'zh', 'en']
      .map(value => String(value || '').slice(0, 2).toLowerCase())
      .filter(Boolean);
    let score = /caption|subtitle/i.test(track.kind || '') ? 4 : 1;
    preferred.forEach((prefix, index) => {
      if (prefix && lang.startsWith(prefix)) score += 10 - index;
    });
    return score;
  }

  async function fetchGenericCaptionTrack(track) {
    const url = new URL(track.src, window.location.href).href;
    const response = await fetch(url, {
      credentials: 'omit',
      cache: 'no-store'
    });
    if (!response.ok) {
      throw new Error(`字幕轨道请求失败 HTTP ${response.status}`);
    }
    const raw = await response.text();
    return parseYouTubeCaptionPayload(raw);
  }

  async function extractYouTubeTranscriptWithProviders(playerResponse, initialData, videoId, videoDurationSeconds = 0) {
    const attempts = [];
    const visibleProbeAttempt = makeVisibleTranscriptProbeAttempt();
    if (visibleProbeAttempt) attempts.push(visibleProbeAttempt);

    const providers = getYouTubeTranscriptProviders(playerResponse, initialData, videoId, videoDurationSeconds);

    for (const provider of providers) {
      const startedAt = Date.now();
      try {
        const result = normalizeTranscriptProviderResult(
          await provider.run(),
          provider.id,
          startedAt,
          videoDurationSeconds
        );
        attempts.push(result.attempt);
        if (result.text) {
          return {
            text: result.text,
            source: result.source || provider.id,
            provider: provider.id,
            attempts,
            error: ''
          };
        }
      } catch (err) {
        attempts.push(makeTranscriptProviderAttempt(provider.id, startedAt, '', err.message || String(err)));
      }
    }

    return {
      text: '',
      source: '',
      provider: '',
      attempts,
      error: summarizeTranscriptProviderErrors(attempts) || '未能读取 YouTube Transcript'
    };
  }

  function getYouTubeTranscriptProviders(playerResponse, initialData, videoId, videoDurationSeconds = 0) {
    return [
      {
        id: 'player-response-caption-tracks',
        run: () => fetchYouTubeCaptionTracksFromList(
          getYouTubeCaptionTracks(playerResponse),
          'player-response'
        )
      },
      {
        id: 'youtubei-player-caption-tracks',
        run: async () => {
          if (!videoId) return { text: '', error: '缺少 YouTube videoId' };
          const youtubeiResult = await fetchYouTubePlayerCaptionTracks(videoId);
          if (youtubeiResult.error && (!youtubeiResult.tracks || youtubeiResult.tracks.length === 0)) {
            return { text: '', source: youtubeiResult.source || 'youtubei-player', error: youtubeiResult.error };
          }
          return fetchYouTubeCaptionTracksFromList(
            youtubeiResult.tracks,
            youtubeiResult.source || 'youtubei-player'
          );
        }
      },
      {
        id: 'youtube-get-transcript-endpoint',
        run: () => fetchYouTubeTranscriptEndpoint(initialData)
      },
      {
        id: 'visible-transcript-panel-click',
        run: () => revealAndReadYouTubeTranscriptPanel(videoDurationSeconds)
      }
    ];
  }

  async function fetchYouTubeCaptionTracksFromList(tracks, source) {
    const track = getPreferredYouTubeCaptionTrack(tracks);
    if (!track) {
      return { text: '', source, error: '页面未暴露可用 captionTracks' };
    }

    try {
      const text = await fetchYouTubeCaptionTrack(track);
      return {
        text,
        source: text ? `${source}:${track.languageCode || track.vssId || 'unknown'}` : source,
        error: text ? '' : 'captionTracks 返回为空'
      };
    } catch (err) {
      return { text: '', source, error: err.message || String(err) };
    }
  }

  function normalizeTranscriptProviderResult(result, providerId, startedAt, videoDurationSeconds = 0) {
    const text = cleanExtractedText(result?.text || '');
    const source = result?.source || providerId;
    const lineCount = typeof result?.lineCount === 'number' ? result.lineCount : countTranscriptLines(text);
    let error = text ? '' : (result?.error || 'provider 返回空字幕');
    let partial = !!result?.partial;
    let reason = result?.reason || '';

    if (text) {
      const completeness = validateYouTubeTranscriptCompleteness(providerId, source, text, lineCount, videoDurationSeconds);
      if (!completeness.ok) {
        error = completeness.error;
        partial = true;
        reason = completeness.reason;
      }
    }

    return {
      text: error ? '' : text,
      source,
      attempt: makeTranscriptProviderAttempt(providerId, startedAt, source, error, text.length, {
        lineCount,
        partial,
        reason
      })
    };
  }

  function makeTranscriptProviderAttempt(providerId, startedAt, source = '', error = '', textLength = 0, extra = {}) {
    return {
      provider: providerId,
      source,
      success: textLength > 0 && !error,
      textLength,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      error: error ? truncateText(String(error), 180) : '',
      ...extra
    };
  }

  function makeVisibleTranscriptProbeAttempt() {
    const startedAt = Date.now();
    const snapshot = getVisibleYouTubeTranscriptSnapshot();
    if (!snapshot.text) {
      return makeTranscriptProviderAttempt(
        'visible-transcript-dom',
        startedAt,
        'visible-transcript-dom',
        '页面未显示可读取的 Transcript DOM',
        0,
        { lineCount: 0 }
      );
    }

    return makeTranscriptProviderAttempt(
      'visible-transcript-dom',
      startedAt,
      'youtube-visible-transcript-probe',
      '可见 Transcript DOM 仅作为候选探测，优先使用完整字幕来源',
      snapshot.text.length,
      {
        lineCount: snapshot.lineCount,
        partial: true,
        reason: 'visible transcript appears partial'
      }
    );
  }

  function validateYouTubeTranscriptCompleteness(providerId, source, text, lineCount, videoDurationSeconds = 0) {
    if (!text) return { ok: false, error: 'provider 返回空字幕', reason: 'empty' };

    if (isVisibleTranscriptProvider(providerId, source)) {
      if (isVisibleTranscriptComplete(text, lineCount, videoDurationSeconds)) {
        return { ok: true, error: '', reason: '' };
      }
      return {
        ok: false,
        error: '可见 Transcript 片段未达到完整性门槛，疑似只包含当前渲染区域',
        reason: 'visible transcript appears partial'
      };
    }

    if (text.length < YOUTUBE_DIRECT_TRANSCRIPT_MIN_LENGTH) {
      return {
        ok: false,
        error: '字幕文本过短，疑似不完整',
        reason: 'direct transcript too short'
      };
    }

    return { ok: true, error: '', reason: '' };
  }

  function isVisibleTranscriptProvider(providerId, source) {
    return /visible-transcript/i.test(`${providerId || ''} ${source || ''}`);
  }

  function isVisibleTranscriptComplete(text, lineCount, videoDurationSeconds = 0) {
    const length = String(text || '').trim().length;
    if (videoDurationSeconds > 0 && videoDurationSeconds < YOUTUBE_SHORT_VIDEO_MAX_SECONDS) {
      return length >= YOUTUBE_SHORT_VISIBLE_TRANSCRIPT_MIN_LENGTH;
    }
    return lineCount >= YOUTUBE_VISIBLE_TRANSCRIPT_MIN_LINES &&
      length >= YOUTUBE_VISIBLE_TRANSCRIPT_MIN_LENGTH;
  }

  function countTranscriptLines(text) {
    return splitCleanLines(text).length;
  }

  function hasPartialVisibleTranscriptAttempt(attempts = []) {
    return (attempts || []).some(attempt =>
      attempt?.partial && isVisibleTranscriptProvider(attempt.provider, attempt.source)
    );
  }

  function summarizeTranscriptProviderErrors(attempts) {
    const errors = (attempts || [])
      .map(attempt => attempt?.error || '')
      .filter(Boolean);
    return uniqueLines(errors).join('；');
  }

  async function extractYouTubeTranscript(playerResponse, initialData, videoId) {
    return extractYouTubeTranscriptWithProviders(
      playerResponse,
      initialData,
      videoId,
      getYouTubeVideoDurationSeconds(playerResponse)
    );
  }

  function getVisibleYouTubeTranscriptText() {
    return getVisibleYouTubeTranscriptSnapshot().text;
  }

  function getVisibleYouTubeTranscriptSnapshot() {
    const selectors = [
      'ytd-transcript-segment-renderer .segment-text',
      'ytd-transcript-segment-renderer yt-formatted-string',
      '[class*="transcript"] [class*="segment"]',
      '[class*="segment-text"]'
    ];
    const lines = [];
    selectors.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(node => {
          const text = normalizeCaptionLine(node.textContent || '');
          if (text && !isYouTubeTimestamp(text)) lines.push(text);
        });
      } catch (err) {
        // Skip selectors that are not valid on the current page.
      }
    });
    const unique = collectCaptionLines(lines);
    return {
      text: unique.join('\n'),
      lines: unique,
      lineCount: unique.length
    };
  }

  async function revealAndReadYouTubeTranscriptPanel(videoDurationSeconds = 0) {
    const originalScrollY = window.scrollY || 0;
    try {
      const existing = await collectVisibleYouTubeTranscriptByScrolling(videoDurationSeconds, 1000);
      if (existing.text) {
        return existing;
      }

      scrollYouTubeMetadataIntoView();
      await delay(800);
      clickYouTubeDescriptionExpanders();
      await delay(350);

      const buttons = findYouTubeTranscriptButtons();
      if (buttons.length === 0) {
        return { text: '', source: '', error: '页面未找到可点击的 Transcript 入口' };
      }

      for (const button of buttons.slice(0, 5)) {
        clickElement(button);
        const result = await collectVisibleYouTubeTranscriptByScrolling(videoDurationSeconds, 5000);
        if (result.text) {
          return result;
        }
      }

      return { text: '', source: '', error: '已尝试打开 Transcript 面板但未出现字幕段落' };
    } catch (err) {
      return { text: '', source: '', error: err.message || String(err) };
    } finally {
      if (!getVisibleYouTubeTranscriptText()) {
        try { window.scrollTo(0, originalScrollY); } catch (err) {}
      }
    }
  }

  async function collectVisibleYouTubeTranscriptByScrolling(videoDurationSeconds = 0, timeoutMs = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const snapshot = getVisibleYouTubeTranscriptSnapshot();
      if (snapshot.text) {
        const container = findYouTubeTranscriptScrollContainer();
        const lines = await collectYouTubeTranscriptLinesFromScrollContainer(
          container,
          Math.max(600, timeoutMs - (Date.now() - started))
        );
        const finalLines = lines.length ? lines : snapshot.lines;
        const text = collectCaptionLines(finalLines).join('\n');
        const lineCount = countTranscriptLines(text);
        const complete = isVisibleTranscriptComplete(text, lineCount, videoDurationSeconds);
        return {
          text,
          source: 'youtube-visible-transcript-scroll',
          lineCount,
          partial: !complete,
          reason: complete ? '' : 'visible transcript appears partial',
          error: complete ? '' : '可见 Transcript 片段未达到完整性门槛，疑似只包含当前渲染区域'
        };
      }
      await delay(250);
    }

    return { text: '', source: '', lineCount: 0, error: '页面未显示可读取的 Transcript DOM' };
  }

  async function collectYouTubeTranscriptLinesFromScrollContainer(container, timeoutMs = 5000) {
    const target = makeScrollTarget(container);
    const lines = [];
    const seen = new Set();
    const started = Date.now();

    const addVisibleLines = () => {
      getVisibleYouTubeTranscriptSnapshot().lines.forEach(line => {
        const key = line.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          lines.push(line);
        }
      });
    };

    addVisibleLines();
    if (!target) return lines;

    const originalTop = target.getTop();
    try {
      target.setTop(0);
      await delay(180);
      addVisibleLines();

      let stableScrolls = 0;
      while (Date.now() - started < timeoutMs) {
        addVisibleLines();
        if (target.isAtBottom()) break;

        const before = target.getTop();
        target.scrollPage();
        await delay(220);
        addVisibleLines();

        if (Math.abs(target.getTop() - before) < 2) {
          stableScrolls += 1;
          if (stableScrolls >= 2) break;
        } else {
          stableScrolls = 0;
        }
      }
    } finally {
      try {
        target.setTop(originalTop);
      } catch (err) {
        // Restoring scroll position is best-effort only.
      }
    }

    return lines;
  }

  function makeScrollTarget(container) {
    if (container && container !== document.documentElement && container !== document.body) {
      return {
        getTop: () => container.scrollTop || 0,
        setTop: value => { container.scrollTop = value; },
        scrollPage: () => {
          container.scrollTop += Math.max(240, Math.floor((container.clientHeight || 600) * 0.85));
        },
        isAtBottom: () => (container.scrollTop || 0) + (container.clientHeight || 0) >= (container.scrollHeight || 0) - 4
      };
    }

    const scrollingElement = document.scrollingElement || document.documentElement || document.body;
    if (!scrollingElement) return null;
    return {
      getTop: () => window.scrollY || scrollingElement.scrollTop || 0,
      setTop: value => {
        try {
          window.scrollTo(0, value);
        } catch (err) {
          scrollingElement.scrollTop = value;
        }
      },
      scrollPage: () => {
        try {
          window.scrollBy(0, Math.max(320, Math.floor(window.innerHeight * 0.75)));
        } catch (err) {
          scrollingElement.scrollTop += Math.max(320, Math.floor((scrollingElement.clientHeight || 700) * 0.75));
        }
      },
      isAtBottom: () => {
        const top = window.scrollY || scrollingElement.scrollTop || 0;
        const height = window.innerHeight || scrollingElement.clientHeight || 0;
        return top + height >= (scrollingElement.scrollHeight || 0) - 4;
      }
    };
  }

  function findYouTubeTranscriptScrollContainer() {
    const selectors = [
      'ytd-transcript-renderer #segments-container',
      '#segments-container',
      'ytd-transcript-search-panel-renderer',
      'ytd-transcript-renderer',
      'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
      '[target-id="engagement-panel-searchable-transcript"]',
      '[class*="transcript" i]',
      '[id*="transcript" i]'
    ];

    for (const selector of selectors) {
      try {
        const nodes = Array.from(document.querySelectorAll(selector));
        for (const node of nodes) {
          const scrollable = findScrollableElement(node);
          if (scrollable) return scrollable;
        }
      } catch (err) {
        // Try the next selector.
      }
    }

    const firstSegment = document.querySelector('ytd-transcript-segment-renderer, [class*="segment-text"]');
    let node = firstSegment;
    while (node && node !== document.body) {
      if (isScrollableElement(node)) return node;
      node = node.parentElement;
    }

    return document.scrollingElement || document.documentElement || document.body;
  }

  function findScrollableElement(root) {
    if (!root || !isVisibleElement(root)) return null;
    if (isScrollableElement(root)) return root;
    const descendants = Array.from(root.querySelectorAll ? root.querySelectorAll('*') : []);
    return descendants.find(node => isVisibleElement(node) && isScrollableElement(node)) || null;
  }

  function isScrollableElement(node) {
    if (!node || node.nodeType !== 1) return false;
    const heightDelta = (node.scrollHeight || 0) - (node.clientHeight || 0);
    if (heightDelta <= 24) return false;
    const style = window.getComputedStyle ? window.getComputedStyle(node) : null;
    const overflow = `${style?.overflowY || ''} ${style?.overflow || ''}`;
    return /auto|scroll|overlay/i.test(overflow) || /transcript|segments/i.test(`${node.id || ''} ${node.className || ''}`);
  }

  function scrollYouTubeMetadataIntoView() {
    const selectors = [
      'ytd-watch-metadata',
      '#below',
      '#primary-inner',
      '#description',
      '#meta'
    ];
    for (const selector of selectors) {
      try {
        const node = document.querySelector(selector);
        if (node && typeof node.scrollIntoView === 'function') {
          node.scrollIntoView({ block: 'center', inline: 'nearest' });
          return;
        }
      } catch (err) {
        // Try the next selector.
      }
    }
    window.scrollBy(0, Math.max(600, Math.floor(window.innerHeight * 0.85)));
  }

  function clickYouTubeDescriptionExpanders() {
    const selectors = [
      '#description-inline-expander #expand',
      'ytd-text-inline-expander #expand',
      '#description tp-yt-paper-button#expand',
      '#description-inline-expander tp-yt-paper-button#expand'
    ];
    selectors.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(node => {
          if (isVisibleElement(node)) clickElement(node);
        });
      } catch (err) {
        // Ignore unsupported selectors.
      }
    });
  }

  function findYouTubeTranscriptButtons() {
    const directSelectors = [
      'ytd-video-description-transcript-section-renderer button',
      'button[aria-label*="transcript" i]',
      'button[aria-label*="文字记录" i]',
      'tp-yt-paper-button[aria-label*="transcript" i]'
    ];
    const candidates = [];
    directSelectors.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(node => candidates.push(node));
      } catch (err) {
        // Ignore unsupported selectors.
      }
    });

    document.querySelectorAll('button, tp-yt-paper-button, yt-button-shape button, a[role="button"]').forEach(node => {
      const label = normalizeText([
        node.getAttribute('aria-label') || '',
        node.getAttribute('title') || '',
        node.textContent || ''
      ].join(' '));
      if (isYouTubeTranscriptButtonLabel(label)) candidates.push(node);
    });

    const seen = new Set();
    return candidates.filter(node => {
      if (!node || seen.has(node) || !isVisibleElement(node)) return false;
      seen.add(node);
      const label = normalizeText([
        node.getAttribute('aria-label') || '',
        node.getAttribute('title') || '',
        node.textContent || ''
      ].join(' '));
      return isYouTubeTranscriptButtonLabel(label);
    });
  }

  function isYouTubeTranscriptButtonLabel(label) {
    const text = normalizeText(label || '');
    if (!text || /(?:hide|close|关闭|隱藏|隐藏|收起)/i.test(text)) return false;
    return /(?:show|open|view)?\s*transcript|文字记录|文字稿|转录|轉錄|文字起こし|transcrição|transkript/i.test(text);
  }

  async function waitForYouTubeVisibleTranscript(timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const text = getVisibleYouTubeTranscriptText();
      if (text && text.length >= 80) return text;
      await delay(250);
    }
    return '';
  }

  function clickElement(node) {
    if (!node) return;
    try {
      node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
      node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      node.click();
    } catch (err) {
      // Some custom elements only expose click().
      try { node.click(); } catch (innerErr) {}
    }
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getYouTubeCaptionTracks(playerResponse) {
    const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    return Array.isArray(tracks) ? tracks.filter(track => track && track.baseUrl) : [];
  }

  async function fetchYouTubePlayerCaptionTracks(videoId) {
    const config = getYouTubeInnertubeConfig();
    if (!config.apiKey) {
      return { tracks: [], source: '', error: '页面未暴露可用 captionTracks，且缺少 INNERTUBE_API_KEY' };
    }

    try {
      const response = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(config.apiKey)}`, {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          context: config.context || makeDefaultYouTubeInnertubeContext(config),
          videoId,
          contentCheckOk: true,
          racyCheckOk: true
        })
      });

      if (!response.ok) {
        return { tracks: [], source: 'youtubei-player', error: `youtubei/player 请求失败 HTTP ${response.status}` };
      }

      const data = await response.json();
      return {
        tracks: getYouTubeCaptionTracks(data),
        source: 'youtubei-player',
        error: ''
      };
    } catch (err) {
      return { tracks: [], source: 'youtubei-player', error: err.message || String(err) };
    }
  }

  async function fetchYouTubeTranscriptEndpoint(initialData) {
    const endpoint = getYouTubeTranscriptEndpoint(initialData);
    if (!endpoint?.params) {
      return { text: '', source: '', error: '页面未暴露 getTranscriptEndpoint' };
    }

    const config = getYouTubeInnertubeConfig();
    if (!config.apiKey) {
      return { text: '', source: '', error: 'getTranscriptEndpoint 缺少 INNERTUBE_API_KEY' };
    }

    try {
      const response = await fetch(`https://www.youtube.com/youtubei/v1/get_transcript?key=${encodeURIComponent(config.apiKey)}`, {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          context: config.context || makeDefaultYouTubeInnertubeContext(config),
          params: endpoint.params
        })
      });

      if (!response.ok) {
        return { text: '', source: 'youtube-get-transcript', error: `get_transcript 请求失败 HTTP ${response.status}` };
      }

      const data = await response.json();
      const text = parseYouTubeTranscriptEndpointResponse(data);
      return {
        text,
        source: text ? 'youtube-get-transcript' : '',
        error: text ? '' : 'get_transcript 返回为空'
      };
    } catch (err) {
      return { text: '', source: 'youtube-get-transcript', error: err.message || String(err) };
    }
  }

  function getYouTubeTranscriptEndpoint(initialData) {
    const endpoints = collectYouTubeRenderers(initialData, 'getTranscriptEndpoint');
    return endpoints.find(endpoint => endpoint && endpoint.params) || null;
  }

  function parseYouTubeTranscriptEndpointResponse(data) {
    const lines = collectYouTubeRenderers(data, 'transcriptSegmentRenderer')
      .map(renderer => extractSimpleText(renderer.snippet))
      .filter(Boolean);
    return collectCaptionLines(lines).join('\n');
  }

  function getYouTubeInnertubeConfig() {
    const runtimeConfig = {};
    try {
      if (window.ytcfg && typeof window.ytcfg.get === 'function') {
        runtimeConfig.apiKey = window.ytcfg.get('INNERTUBE_API_KEY') || '';
        runtimeConfig.context = window.ytcfg.get('INNERTUBE_CONTEXT') || null;
        runtimeConfig.clientName = window.ytcfg.get('INNERTUBE_CLIENT_NAME') || '';
        runtimeConfig.clientVersion = window.ytcfg.get('INNERTUBE_CLIENT_VERSION') || '';
      }
    } catch (err) {
      // Fall back to script parsing below.
    }

    const scriptConfig = parseYouTubeConfigFromScripts();
    return {
      apiKey: runtimeConfig.apiKey || scriptConfig.apiKey || '',
      context: runtimeConfig.context || scriptConfig.context || null,
      clientName: runtimeConfig.clientName || scriptConfig.clientName || '',
      clientVersion: runtimeConfig.clientVersion || scriptConfig.clientVersion || ''
    };
  }

  function makeDefaultYouTubeInnertubeContext(config = {}) {
    return {
      client: {
        clientName: config.clientName || 'WEB',
        clientVersion: config.clientVersion || '2.20240101.00.00'
      }
    };
  }

  function parseYouTubeConfigFromScripts() {
    const result = {
      apiKey: '',
      context: null,
      clientName: '',
      clientVersion: ''
    };

    const scripts = Array.from(document.scripts || []);
    for (const script of scripts) {
      const text = script.textContent || '';
      if (!text) continue;

      if (!result.apiKey) {
        const apiKeyMatch = text.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
        if (apiKeyMatch) result.apiKey = apiKeyMatch[1];
      }
      if (!result.clientName) {
        const clientNameMatch = text.match(/"INNERTUBE_CLIENT_NAME"\s*:\s*"([^"]+)"/);
        if (clientNameMatch) result.clientName = clientNameMatch[1];
      }
      if (!result.clientVersion) {
        const clientVersionMatch = text.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/);
        if (clientVersionMatch) result.clientVersion = clientVersionMatch[1];
      }

      if (!result.context) {
        const config = parseYtcfgSetObject(text);
        if (config) {
          result.apiKey = result.apiKey || config.INNERTUBE_API_KEY || '';
          result.context = config.INNERTUBE_CONTEXT || null;
          result.clientName = result.clientName || config.INNERTUBE_CLIENT_NAME || '';
          result.clientVersion = result.clientVersion || config.INNERTUBE_CLIENT_VERSION || '';
        }
      }
    }

    return result;
  }

  function parseYtcfgSetObject(scriptText) {
    const marker = 'ytcfg.set(';
    const markerIndex = String(scriptText || '').indexOf(marker);
    if (markerIndex === -1) return null;
    const start = scriptText.indexOf('{', markerIndex + marker.length);
    if (start === -1) return null;
    const jsonText = readBalancedJsonObject(scriptText, start);
    if (!jsonText) return null;
    try {
      return JSON.parse(jsonText);
    } catch (err) {
      return null;
    }
  }

  function getPreferredYouTubeCaptionTrack(tracks) {
    if (!Array.isArray(tracks) || tracks.length === 0) return null;
    const preferredLanguages = [
      navigator.language,
      document.documentElement.lang,
      'zh',
      'zh-CN',
      'en'
    ].map(lang => String(lang || '').toLowerCase()).filter(Boolean);

    return [...tracks].sort((a, b) =>
      scoreYouTubeCaptionTrack(b, preferredLanguages) - scoreYouTubeCaptionTrack(a, preferredLanguages)
    )[0];
  }

  function scoreYouTubeCaptionTrack(track, preferredLanguages) {
    const lang = String(track.languageCode || track.vssId || '').toLowerCase();
    let score = 0;
    if (track.isTranslatable) score += 1;
    if (track.kind !== 'asr') score += 3;
    if (track.vssId && !String(track.vssId).includes('a.')) score += 1;
    preferredLanguages.forEach((preferred, index) => {
      if (preferred && lang.startsWith(preferred.slice(0, 2))) {
        score += 10 - index;
      }
    });
    return score;
  }

  async function fetchYouTubeCaptionTrack(track) {
    const response = await fetch(ensureYouTubeCaptionFormat(track.baseUrl), {
      credentials: 'omit',
      cache: 'no-store'
    });
    if (!response.ok) {
      throw new Error(`字幕请求失败 HTTP ${response.status}`);
    }
    const raw = await response.text();
    return parseYouTubeCaptionPayload(raw);
  }

  function ensureYouTubeCaptionFormat(rawUrl) {
    try {
      const parsed = new URL(rawUrl, window.location.href);
      parsed.searchParams.set('fmt', 'json3');
      return parsed.href;
    } catch (err) {
      const joiner = String(rawUrl || '').includes('?') ? '&' : '?';
      return `${rawUrl}${joiner}fmt=json3`;
    }
  }

  function parseYouTubeCaptionPayload(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';

    try {
      const json = JSON.parse(text);
      const parsed = parseYouTubeJson3Caption(json);
      if (parsed) return parsed;
    } catch (err) {
      // Fall through to XML/VTT parsers.
    }

    if (/^</.test(text)) {
      return parseYouTubeXmlCaption(text);
    }

    return parseYouTubeVttCaption(text);
  }

  function parseYouTubeJson3Caption(json) {
    const lines = [];
    (json?.events || []).forEach(event => {
      if (!Array.isArray(event.segs)) return;
      const line = event.segs.map(seg => seg.utf8 || '').join('');
      if (line) lines.push(line);
    });
    return collectCaptionLines(lines).join('\n');
  }

  function parseYouTubeXmlCaption(raw) {
    try {
      const doc = new DOMParser().parseFromString(raw, 'text/xml');
      return collectCaptionLines(Array.from(doc.querySelectorAll('text'))
        .map(node => node.textContent || '')).join('\n');
    } catch (err) {
      return '';
    }
  }

  function parseYouTubeVttCaption(raw) {
    const lines = String(raw || '').split(/\n+/)
      .map(line => normalizeCaptionLine(line))
      .filter(line => line && !/^WEBVTT/i.test(line) && !isYouTubeTimestamp(line) && !/^\d+$/.test(line));
    return collectCaptionLines(lines).join('\n');
  }

  function collectCaptionLines(lines) {
    const result = [];
    const seen = new Set();
    for (const line of lines) {
      const cleaned = normalizeCaptionLine(line);
      if (!cleaned || isYouTubeTimestamp(cleaned)) continue;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(cleaned);
      if (result.join('\n').length >= YOUTUBE_TRANSCRIPT_LIMIT) break;
    }
    return result;
  }

  function normalizeCaptionLine(line) {
    return normalizeText(line)
      .replace(/<[^>]+>/g, '')
      .replace(/\[[^\]]{1,40}\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isYouTubeTimestamp(text) {
    return /^(?:\d{1,2}:)?\d{1,2}:\d{2}(?:\.\d+)?(?:\s*-->\s*(?:\d{1,2}:)?\d{1,2}:\d{2}(?:\.\d+)?)?$/.test(text || '');
  }

  function getYouTubePlayerResponse() {
    if (window.ytInitialPlayerResponse && typeof window.ytInitialPlayerResponse === 'object') {
      return window.ytInitialPlayerResponse;
    }
    return parseYouTubeJsonFromScripts([
      'ytInitialPlayerResponse =',
      'var ytInitialPlayerResponse =',
      '"ytInitialPlayerResponse":'
    ]);
  }

  function getYouTubeVideoId(url, playerResponse) {
    if (playerResponse?.videoDetails?.videoId) {
      return String(playerResponse.videoDetails.videoId);
    }

    const parsed = safeParseUrl(url);
    if (!parsed) return '';
    if (/(^|\.)youtu\.be$/i.test(parsed.hostname)) {
      return parsed.pathname.split('/').filter(Boolean)[0] || '';
    }
    if (parsed.searchParams.has('v')) {
      return parsed.searchParams.get('v') || '';
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    if ((parts[0] === 'shorts' || parts[0] === 'live') && parts[1]) {
      return parts[1];
    }
    return '';
  }

  function getYouTubeVideoDurationSeconds(playerResponse) {
    const raw = playerResponse?.videoDetails?.lengthSeconds ||
      playerResponse?.microformat?.playerMicroformatRenderer?.lengthSeconds ||
      '';
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function getYouTubeInitialData() {
    if (window.ytInitialData && typeof window.ytInitialData === 'object') {
      return window.ytInitialData;
    }
    return parseYouTubeJsonFromScripts([
      'ytInitialData =',
      'var ytInitialData =',
      '"ytInitialData":'
    ]);
  }

  function parseYouTubeJsonFromScripts(markers) {
    const scripts = Array.from(document.scripts || []);
    for (const script of scripts) {
      const text = script.textContent || '';
      if (!text) continue;
      for (const marker of markers) {
        const markerIndex = text.indexOf(marker);
        if (markerIndex === -1) continue;
        const start = text.indexOf('{', markerIndex + marker.length);
        if (start === -1) continue;
        const jsonText = readBalancedJsonObject(text, start);
        if (!jsonText) continue;
        try {
          return JSON.parse(jsonText);
        } catch (err) {
          // Try the next marker/script.
        }
      }
    }
    return null;
  }

  function readBalancedJsonObject(text, start) {
    let depth = 0;
    let inString = false;
    let quote = '';
    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const char = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === quote) {
          inString = false;
        }
        continue;
      }

      if (char === '"' || char === "'") {
        inString = true;
        quote = char;
      } else if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }

    return '';
  }

  function findYouTubeDescriptionInInitialData(initialData) {
    const renderers = collectYouTubeRenderers(initialData, 'attributedDescriptionBodyText');
    for (const renderer of renderers) {
      const text = extractSimpleText(renderer?.content || renderer);
      if (text) return text;
    }
    return '';
  }

  function getYouTubeChapters(playerResponse, initialData) {
    const chapters = [];
    addYouTubeChaptersFromObject(chapters, playerResponse);
    const seen = new Set();
    return chapters.filter(item => {
      const key = `${item.time || ''}|${item.title || ''}`.toLowerCase();
      if (!item.title || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 40);
  }

  function addYouTubeChaptersFromObject(chapters, root) {
    const renderers = collectYouTubeRenderers(root, 'macroMarkersListItemRenderer');
    renderers.forEach(renderer => {
      const title = extractSimpleText(renderer.title);
      const time = extractSimpleText(renderer.timeDescription);
      if (title) chapters.push({ title, time });
    });
  }

  function collectYouTubeRenderers(root, keyName) {
    if (!root || typeof root !== 'object') return [];
    const result = [];
    const stack = [root];
    let scanned = 0;

    while (stack.length > 0 && scanned < 25000) {
      const current = stack.pop();
      scanned++;
      if (!current || typeof current !== 'object') continue;

      if (current[keyName]) result.push(current[keyName]);

      if (Array.isArray(current)) {
        current.forEach(item => {
          if (item && typeof item === 'object') stack.push(item);
        });
      } else {
        Object.keys(current).forEach(key => {
          const value = current[key];
          if (value && typeof value === 'object') stack.push(value);
        });
      }
    }

    return result;
  }

  function isGitHubRepositoryPage(url) {
    const parsed = safeParseUrl(url);
    if (!parsed || !/(^|\.)github\.com$/i.test(parsed.hostname)) return false;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return false;
    if (['issues', 'pulls', 'pull', 'actions', 'projects', 'wiki', 'security', 'pulse', 'graphs', 'settings'].includes(parts[2])) return false;
    return true;
  }

  function isChatGptConversationPage(urlOrParsed) {
    const parsed = typeof urlOrParsed === 'string' ? safeParseUrl(urlOrParsed) : urlOrParsed;
    if (hasChatGptMessageNodes()) return true;
    if (!parsed || !CHATGPT_HOST_RE.test(parsed.hostname)) return false;
    return /^\/(?:c|share)\//i.test(parsed.pathname);
  }

  function hasChatGptMessageNodes() {
    return !!document.querySelector('[data-message-author-role], article[data-testid^="conversation-turn-"]');
  }

  function extractChatGptConversationPage(url) {
    const messages = collectChatGptMessages();
    const content = messages.map((message, index) => {
      const label = getChatGptRoleLabel(message.role);
      return `${index + 1}. ${label}：\n${message.text}`;
    }).join('\n\n').trim();

    if (messages.length === 0 || content.length < 40) {
      return {
        success: false,
        title: getPageTitle() || 'ChatGPT 会话',
        content,
        htmlContent: '',
        excerpt: content.slice(0, 200).trim(),
        url,
        byline: '',
        method: 'chatgpt-conversation',
        error: '未能找到可提取的 ChatGPT 会话消息'
      };
    }

    const title = getChatGptConversationTitle(messages);
    return {
      success: true,
      title,
      content,
      htmlContent: '',
      excerpt: content.slice(0, 200).trim(),
      url,
      byline: '',
      method: 'chatgpt-conversation',
      pageType: 'chat-conversation',
      confidence: 0.9,
      reason: 'chatgpt-message-turns'
    };
  }

  function collectChatGptMessages() {
    const roleNodes = Array.from(document.querySelectorAll('[data-message-author-role]'));
    if (roleNodes.length > 0) {
      return roleNodes.map(node => {
        const role = node.getAttribute('data-message-author-role') || '';
        return makeChatGptMessage(role, node);
      }).filter(Boolean);
    }

    return Array.from(document.querySelectorAll('article[data-testid^="conversation-turn-"]'))
      .map((node, index) => {
        const contentNode = node.querySelector('.markdown, .whitespace-pre-wrap, [class*="prose"], [dir="auto"]') || node;
        const role = index % 2 === 0 ? 'user' : 'assistant';
        return makeChatGptMessage(role, contentNode);
      })
      .filter(Boolean);
  }

  function makeChatGptMessage(role, node) {
    const clone = node.cloneNode(true);
    cleanupClone(clone);
    cleanupChatGptMessageClone(clone);
    const text = cleanChatGptMessageText(getChatGptMessageText(clone));
    if (!text || text.length < 2) return null;
    return { role: role || 'message', text };
  }

  function getChatGptMessageText(root) {
    const blockSelectors = 'p, li, pre, blockquote, h1, h2, h3, h4, h5, h6';
    const blocks = Array.from(root.querySelectorAll(blockSelectors))
      .map(node => normalizeText(node.textContent || ''))
      .filter(Boolean);

    if (blocks.length > 0) {
      return blocks.join('\n');
    }

    return root.textContent || '';
  }

  function cleanupChatGptMessageClone(root) {
    const selectors = [
      '[class*="sr-only" i]',
      '[data-testid*="copy" i]',
      '[data-testid*="feedback" i]',
      '[data-testid*="voice" i]',
      '[aria-label*="Copy" i]',
      '[aria-label*="Read aloud" i]',
      '[aria-label*="Good response" i]',
      '[aria-label*="Bad response" i]'
    ];

    selectors.forEach(selector => {
      try {
        root.querySelectorAll(selector).forEach(el => el.parentNode && el.parentNode.removeChild(el));
      } catch (e) { /* skip invalid selector */ }
    });
  }

  function cleanChatGptMessageText(text) {
    const lines = splitCleanLines(text)
      .map(line => normalizeText(line)
        .replace(/^(?:You said|ChatGPT said)\s*[:：]\s*/i, '')
        .trim())
      .filter(line => line && !isChatGptUiLine(line) && !isChatGptArtifactLine(line));

    return lines.join('\n').trim();
  }

  function isChatGptUiLine(line) {
    return /^(?:ChatGPT can make mistakes|Check important info|New chat|Search chats|Library|Explore GPTs|Upgrade plan|Share|Copy|Edit|Regenerate|Read aloud|Good response|Bad response|Sources?|Search the web|Canvas|Reasoned for \d|Thought for \d)/i.test(line);
  }

  function getChatGptRoleLabel(role) {
    const normalized = String(role || '').toLowerCase();
    if (normalized === 'user') return '用户';
    if (normalized === 'assistant') return 'ChatGPT';
    if (normalized === 'system') return '系统';
    if (normalized === 'tool') return '工具';
    return '消息';
  }

  function getChatGptConversationTitle(messages) {
    const pageTitle = cleanTitle(getPageTitle() || document.title || '');
    if (pageTitle && !/^ChatGPT$/i.test(pageTitle)) return pageTitle;

    const firstUserMessage = messages.find(message => message.role === 'user') || messages[0];
    const firstLine = splitCleanLines(firstUserMessage?.text || '')[0] || '';
    return truncateText(firstLine, 80) || 'ChatGPT 会话';
  }

  function extractGitHubRepositoryPage(url) {
    const parts = safeParseUrl(url)?.pathname.split('/').filter(Boolean) || [];
    const repoName = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : cleanTitle(document.title || 'GitHub');
    const readme = document.querySelector('#readme article.markdown-body, article.markdown-body, [data-testid="readme"] .markdown-body, [data-testid="readme"] article');
    const description = normalizeText(
      document.querySelector('[data-testid="repository-description"], [itemprop="about"]')?.textContent || ''
    );

    if (!readme) {
      return {
        success: false,
        title: repoName,
        content: '',
        htmlContent: '',
        excerpt: '',
        url,
        byline: '',
        method: 'github-readme',
        error: '未能找到 GitHub README 内容'
      };
    }

    const clone = readme.cloneNode(true);
    cleanupClone(clone);
    const readmeText = cleanExtractedText(clone.textContent || '');
    const content = [
      `仓库：${repoName}`,
      description ? `简介：${description}` : '',
      readmeText
    ].filter(Boolean).join('\n\n').trim();

    if (content.length < 180) {
      return {
        success: false,
        title: repoName,
        content,
        htmlContent: '',
        excerpt: content.slice(0, 200).trim(),
        url,
        byline: '',
        method: 'github-readme',
        error: 'GitHub README 内容过短'
      };
    }

    return {
      success: true,
      title: repoName,
      content,
      htmlContent: '',
      excerpt: content.slice(0, 200).trim(),
      url,
      byline: '',
      method: 'github-readme',
      pageType: 'article',
      confidence: 0.86,
      reason: 'github-readme'
    };
  }

  function isHackerNewsListingPage() {
    const parsed = safeParseUrl(window.location.href);
    if (!parsed || !/(^|\.)news\.ycombinator\.com$/i.test(parsed.hostname)) return false;
    return parsed.pathname === '/' || /^(?:\/news|\/newest|\/front|\/ask|\/show|\/jobs)$/i.test(parsed.pathname);
  }

  function collectHackerNewsItems() {
    const rows = Array.from(document.querySelectorAll('tr.athing'));
    return rows.map(row => {
      const link = row.querySelector('.titleline > a, .title a');
      const title = cleanListingLine(link ? link.textContent || '' : '');
      if (!title || UI_NOISE_LINE_RE.test(title)) return null;

      const subtext = row.nextElementSibling;
      const score = cleanListingLine(subtext?.querySelector('.score')?.textContent || '');
      const comments = Array.from(subtext?.querySelectorAll('a') || [])
        .map(a => cleanListingLine(a.textContent || ''))
        .find(text => /\bcomment/i.test(text));
      const context = [score, comments].filter(Boolean).join(' · ');
      return { title, context };
    }).filter(Boolean).slice(0, 30);
  }

  function isLikelyDomainOrHandle(text) {
    const value = normalizeText(text);
    if (!value) return false;
    if (/^[\w.-]+\.(?:com|org|net|io|dev|cn|de|co|ai|app|edu|gov)(?:\s+\(\w+\))?$/i.test(value)) return true;
    if (/^(?:by\s+)?[a-z0-9_-]{3,24}$/i.test(value) && !/\s/.test(value)) return true;
    return false;
  }

  function isLowValueListingTitle(text) {
    const value = normalizeText(text);
    if (!value) return true;
    if (UI_NOISE_LINE_RE.test(value) || BAIDU_RESULT_SKIP_RE.test(value)) return true;
    if (isLikelyDomainOrHandle(value)) return true;
    if (/^\d+\s*(?:points?|comments?)$/i.test(value)) return true;
    return false;
  }

  function getImageOnlyTextLength(content) {
    return normalizeText(removeImageInfoBlock(content)
      .replace(IMAGE_OCR_TITLE, '')
      .replace(/https?:\/\/\S+/g, ''));
  }

  function isImageHeavyExtraction(content) {
    return hasImageInfoBlock(content) && !hasImageOcrText(content) && getImageOnlyTextLength(content).length < 220;
  }

  function hasImageInfoBlock(content) {
    return String(content || '').includes(IMAGE_INFO_TITLE);
  }

  function hasImageOcrText(content) {
    return String(content || '').includes(IMAGE_OCR_TITLE);
  }

  function removeImageInfoBlock(content) {
    return String(content || '').replace(/图片内容：[\s\S]*?(?=\n\n图片 OCR 文字：|$)/, '');
  }

  function getProductSignals(parsed) {
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const bodySample = document.body ? document.body.innerText.slice(0, 5000) : '';
    let score = 0;

    if (/news\.ycombinator\.com|reddit\.com|stackoverflow\.com|segmentfault\.com|v2ex\.com|tieba\.baidu\.com|zhihu\.com/.test(host)) {
      return 0;
    }

    if (hasJsonLdType('Product')) score += 4;
    if (document.querySelector('[itemtype*="Product"]')) score += 3;
    if (document.querySelector('[class*="price" i], [id*="price" i], [class*="buy" i], [id*="buy" i], [class*="cart" i], [id*="cart" i]')) score += 2;
    if (/(?:price|from\s+\$|\$\d|buy|shop|configure|specs|product|memory|storage|battery|商品|产品|购买|价格|加入购物车|立即购买)/i.test(bodySample)) score += 2;
    if (/\/(?:item|product|products|goods|detail|sku|shop|store|buy)\b/i.test(path)) score += 2;
    if (/apple\.com$/.test(host) && /(?:macbook|iphone|ipad|watch|airpods|vision|mac)\b/i.test(path) && /(?:buy|from\s+\$|\$\d|tech specs|compare|battery)/i.test(bodySample)) score += 3;

    return score;
  }

  function isLikelyProductPage(parsed) {
    return getProductSignals(parsed) >= 3;
  }

  function hasJsonLdType(typeName) {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    return scripts.some(script => {
      const text = script.textContent || '';
      return new RegExp(`"@type"\\s*:\\s*"?${typeName}"?`, 'i').test(text);
    });
  }

  function isLikelyForumQaPage(parsed) {
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (/zhihu\.com|tieba\.baidu\.com|reddit\.com|news\.ycombinator\.com|stackoverflow\.com|segmentfault\.com|v2ex\.com/.test(host) &&
        /question|answer|\/p\/|comments|item|topic|thread|t\//i.test(path + parsed.search)) {
      return true;
    }
    if (document.querySelector('[itemtype*="QAPage"], [itemtype*="DiscussionForumPosting"], [class*="comment" i], [id*="comment" i]') &&
        getLikelyResultLinks().length < 20) {
      return true;
    }
    return false;
  }

  function isLikelyArticlePage() {
    if (hasStrongArticleContainer()) return true;

    const explicitArticleSignal = document.querySelector('[itemtype*="Article"], [property="article:published_time"], meta[property="og:type"][content="article" i]');
    if (explicitArticleSignal) {
      const mainText = normalizeText((document.querySelector('article, main, [role="main"], #content, .content') || document.body)?.textContent || '');
      if (mainText.length >= 120) return true;
    }

    const article = document.querySelector('article, [itemtype*="Article"], [property="article:published_time"], meta[property="og:type"][content="article" i]');
    if (article) {
      const root = article.tagName ? article : document.body;
      const text = normalizeText(root.textContent || '');
      if (text.length >= 300) return true;
    }

    const h1 = document.querySelector('h1');
    const main = document.querySelector('main, [role="main"], #content, .content, #article, .article') || document.body;
    const paragraphText = Array.from(main ? main.querySelectorAll('p') : [])
      .map(p => normalizeText(p.textContent || ''))
      .filter(text => text.length >= 40);
    return !!h1 && paragraphText.length >= 3 && paragraphText.join('').length >= 500;
  }

  function isLikelyListingPage() {
    const dominantList = hasDominantListStructure();
    if (hasStrongArticleContainer() && !dominantList) return false;

    const links = getLikelyResultLinks();
    if (links.length < 12) return false;
    const main = document.querySelector('main, [role="main"], #content, .content, #main') || document.body;
    const linkDensity = main ? getLinkDensity(main) : 0;
    const paragraphCount = main ? Array.from(main.querySelectorAll('p')).filter(p => normalizeText(p.textContent || '').length > 60).length : 0;
    return dominantList || linkDensity > 0.35 || (links.length >= 18 && paragraphCount < links.length / 2);
  }

  function hasDominantListStructure() {
    const scope = document.querySelector('main, [role="main"], #content, .content, #main') || document.body;
    if (!scope) return false;

    const links = getLikelyResultLinks();
    if (links.length < 12) return false;

    const listItems = Array.from(scope.querySelectorAll('li'))
      .map(li => normalizeText(li.textContent || ''))
      .filter(text => text.length >= 40);
    if (listItems.length < 10) return false;

    const paragraphs = Array.from(scope.querySelectorAll('p'))
      .map(p => normalizeText(p.textContent || ''))
      .filter(text => text.length >= 40);
    const scopeTextLength = normalizeText(scope.textContent || '').length;
    const listTextLength = listItems.reduce((sum, text) => sum + text.length, 0);
    const listTextRatio = scopeTextLength > 0 ? listTextLength / scopeTextLength : 0;

    return listTextRatio > 0.55 && listItems.length >= Math.max(10, paragraphs.length * 0.75);
  }

  function hasStrongArticleContainer() {
    const candidates = [
      document.querySelector('article'),
      document.querySelector('#mw-content-text .mw-parser-output'),
      document.querySelector('.mw-parser-output'),
      document.querySelector('main, [role="main"], #content, .content, #article, .article')
    ].filter(Boolean);

    return candidates.some(node => {
      const paragraphs = Array.from(node.querySelectorAll('p'))
        .map(p => normalizeText(p.textContent || ''))
        .filter(text => text.length >= 60);
      const paragraphTextLength = paragraphs.reduce((sum, text) => sum + text.length, 0);
      const linkDensity = getLinkDensity(node);
      return paragraphs.length >= 3 &&
        paragraphTextLength >= 700 &&
        linkDensity < 0.45;
    });
  }

  function isArticleLikeExtraction(result) {
    const content = normalizeText(result?.content || '');
    if (content.length < 700) return false;
    if (result?.method === 'listing') return false;
    return !/^页面类型：(?:列表|搜索结果)/.test(content);
  }

  function getLikelyResultLinks() {
    const scope = document.querySelector('main, [role="main"], #content, .content, #main') || document.body;
    if (!scope) return [];
    return Array.from(scope.querySelectorAll('a'))
      .map(link => cleanListingLine(link.textContent || link.getAttribute('title') || ''))
      .filter(text => text.length >= 6 && text.length <= 120 && !isLowValueListingTitle(text));
  }

  function collectNoiseCandidates(result, classification) {
    const candidates = [];
    const seen = new Set();
    const usedIds = new Set();
    let totalTextLength = 0;

    const addCandidate = candidate => {
      if (!candidate || candidates.length >= NOISE_CANDIDATE_MAX) return;

      const text = cleanExtractedText(candidate.text || '');
      if (text.length < 40) return;

      const key = normalizeText(text).slice(0, 1000).toLowerCase();
      if (!key || seen.has(key)) return;

      const remaining = NOISE_CANDIDATE_TOTAL_TEXT_LIMIT - totalTextLength;
      if (remaining <= 0) return;

      const maxTextLength = Math.min(NOISE_CANDIDATE_TEXT_LIMIT, remaining);
      const finalText = text.length > maxTextLength ? truncateText(text, maxTextLength) : text;
      seen.add(key);
      totalTextLength += finalText.length;

      const baseId = makeNoiseCandidateId(candidate.id || `${candidate.type || 'candidate'}-${candidates.length + 1}`);
      const id = makeUniqueNoiseCandidateId(baseId, usedIds);
      usedIds.add(id);

      candidates.push({
        id,
        type: candidate.type || 'candidate',
        text: finalText,
        htmlSnippet: truncateCandidateHtml(candidate.htmlSnippet || ''),
        score: typeof candidate.score === 'number' ? Math.round(candidate.score) : null,
        sourceSelector: candidate.sourceSelector || '',
        linkDensity: typeof candidate.linkDensity === 'number' ? Number(candidate.linkDensity.toFixed(3)) : null,
        textLength: text.length
      });
    };

    addCandidate({
      id: `local-${result?.method || 'extract'}`,
      type: result?.method || 'local-result',
      text: result?.content || '',
      htmlSnippet: result?.htmlContent || '',
      score: typeof result?.confidence === 'number' ? result.confidence * 10000 : (result?.content || '').length,
      sourceSelector: result?.method || 'local-result'
    });

    if (window.Readability && result?.method !== 'readability') {
      try {
        const reader = new window.Readability(makeReadabilityDocumentClone());
        const parsed = reader.parse();
        addCandidate({
          id: 'readability',
          type: 'readability',
          text: parsed.textContent || stripHtml(parsed.content || ''),
          htmlSnippet: parsed.content || '',
          score: parsed.length || (parsed.textContent || '').length,
          sourceSelector: 'readability'
        });
      } catch (err) {
        console.warn('[ContentExtract] 生成 Readability 候选失败:', err);
      }
    }

    collectSelectorNoiseCandidates(addCandidate);
    collectListingNoiseCandidate(addCandidate, classification);
    collectImageNoiseCandidate(addCandidate, result?.content || '');

    return candidates;
  }

  function collectSelectorNoiseCandidates(addCandidate) {
    let added = 0;

    for (const selector of CONTENT_SELECTORS) {
      if (added >= 7) break;

      let nodes = [];
      try {
        nodes = Array.from(document.querySelectorAll(selector)).slice(0, 4);
      } catch (err) {
        continue;
      }

      for (const node of nodes) {
        if (added >= 7) break;
        const candidate = makeElementNoiseCandidate(node, selector);
        if (!candidate) continue;
        addCandidate(candidate);
        added++;
      }
    }
  }

  function makeElementNoiseCandidate(node, selector) {
    if (!node) return null;

    const clone = node.cloneNode(true);
    cleanupClone(clone);
    let text = cleanExtractedText(clone.textContent || '');
    const importantImages = getImportantImages(node);
    if (text.length < 500 && importantImages.length > 0) {
      text = appendImageInfo(text, node);
    }

    if (text.length < 80 && importantImages.length === 0) return null;

    const linkDensity = getLinkDensity(node);
    if (text.length < 500 && linkDensity > 0.58) return null;

    return {
      id: `selector-${selector}`,
      type: 'selector',
      text,
      htmlSnippet: clone.innerHTML || '',
      score: scoreElement(node, text.length, linkDensity, importantImages),
      sourceSelector: selector,
      linkDensity
    };
  }

  function collectListingNoiseCandidate(addCandidate, classification) {
    const items = collectListingItems();
    if (items.length < 5) return;

    const pageType = classification?.pageType || 'listing';
    const isSearch = pageType.startsWith('search-results');
    const lines = [
      `页面类型：${isSearch ? '搜索结果页' : '列表/聚合页'}`,
      `页面标题：${getPageTitle() || cleanTitle(document.title || '未命名页面')}`,
      isSearch ? '以下为页面中的主要搜索结果条目：' : '以下为页面中的主要列表条目：',
      ''
    ];

    items.slice(0, 25).forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title}`);
      if (item.context) lines.push(`说明：${item.context}`);
      lines.push('');
    });

    addCandidate({
      id: 'listing-items',
      type: isSearch ? 'search-results' : 'listing-items',
      text: lines.join('\n'),
      score: items.length * 100,
      sourceSelector: 'collectListingItems'
    });
  }

  function collectImageNoiseCandidate(addCandidate, content) {
    const value = String(content || '');
    if (!hasImageInfoBlock(value) && !hasImageOcrText(value)) return;

    const imageInfoMatch = value.match(/图片内容：[\s\S]*?(?=\n\n图片 OCR 文字：|$)/);
    const imageOcrMatch = value.match(/图片 OCR 文字：[\s\S]*$/);
    const text = [
      imageOcrMatch ? imageOcrMatch[0] : '',
      imageInfoMatch ? imageInfoMatch[0] : ''
    ].filter(Boolean).join('\n\n').trim();

    addCandidate({
      id: 'image-ocr-info',
      type: hasImageOcrText(value) ? 'image-ocr' : 'image-info',
      text,
      score: hasImageOcrText(value) ? 1200 : 500,
      sourceSelector: 'image-blocks'
    });
  }

  function makeNoiseCandidateId(value) {
    const normalized = String(value || 'candidate')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    return normalized || 'candidate';
  }

  function makeUniqueNoiseCandidateId(baseId, usedIds) {
    if (!usedIds.has(baseId)) return baseId;
    let index = 2;
    let next = `${baseId}-${index}`;
    while (usedIds.has(next)) {
      index++;
      next = `${baseId}-${index}`;
    }
    return next;
  }

  function truncateCandidateHtml(html) {
    const value = String(html || '').replace(/\s+/g, ' ').trim();
    if (!value) return '';
    return value.length > NOISE_CANDIDATE_HTML_LIMIT
      ? `${value.slice(0, NOISE_CANDIDATE_HTML_LIMIT - 1).trim()}…`
      : value;
  }

  function applyExtractionMetadata(result, classification, extraWarnings = []) {
    const content = result && result.content ? result.content : '';
    const warnings = uniqueLines([
      ...(Array.isArray(result?.qualityWarnings) ? result.qualityWarnings : []),
      ...extraWarnings,
      ...getQualityWarnings(content, classification, result?.method || '')
    ]);

    const metadata = {
      ...(result || {}),
      pageType: result?.pageType || classification.pageType,
      confidence: typeof result?.confidence === 'number' ? result.confidence : classification.confidence,
      reason: result?.reason || classification.reason,
      qualityWarnings: warnings
    };

    if (metadata.success && content) {
      metadata.noiseCandidates = collectNoiseCandidates(metadata, classification);
    }

    return metadata;
  }

  function getQualityWarnings(content, classification, method) {
    const warnings = [];
    const pageType = classification.pageType || 'unknown';

    if (pageType.startsWith('search-results')) {
      warnings.push('当前页面是搜索结果页，摘要基于页面条目而非原文全文。');
    } else if (pageType === 'listing') {
      warnings.push('当前页面更像列表/聚合页，摘要基于页面条目而非具体文章全文。');
    } else if (pageType === 'video') {
      warnings.push('当前页面可能是视频/音频页；如果没有字幕或简介，正文提取可能不完整。');
    } else if (pageType === 'pdf-document') {
      warnings.push('当前页面可能是 PDF/文档；仅能提取浏览器暴露出的文本层。');
    } else if (pageType === 'unknown') {
      warnings.push('页面类型不明确，已使用通用正文提取。');
    }

    if (content && content.length < 120) {
      warnings.push('提取内容较短，摘要可能不完整。');
    }

    if (content && isImageHeavyExtraction(content)) {
      warnings.push('页面正文可能主要在图片中；当前未能读取图片文字。');
    }

    if (content && looksNoisy(content)) {
      warnings.push('提取内容可能包含导航、控件或重复文本。');
    }

    if (method === 'fallback' && pageType !== 'article') {
      warnings.push('当前页面未匹配专用提取器，已使用通用回退提取。');
    }

    return warnings;
  }

  function looksNoisy(content) {
    const lines = splitCleanLines(content);
    if (lines.length < 8) return false;
    const uniqueCount = uniqueLines(lines).length;
    const duplicateRatio = 1 - uniqueCount / lines.length;
    const uiHits = lines.filter(line => UI_NOISE_LINE_RE.test(line) || /^(?:登录|注册|分享|收藏|展开|收起|更多|广告|推荐)$/.test(line)).length;
    return duplicateRatio > 0.28 || uiHits >= 4;
  }

  function extractBlockedPage(url, classification) {
    const messages = {
      restricted: '当前页面受浏览器限制，无法提取内容',
      login: '当前页面像登录、验证码或权限页面，请登录后打开具体内容页再提取',
      error: '当前页面像错误页或无内容页，无法生成可靠摘要'
    };
    return {
      success: false,
      title: getPageTitle() || cleanTitle(document.title || ''),
      content: '',
      htmlContent: '',
      excerpt: '',
      url,
      byline: '',
      method: classification.pageType,
      error: messages[classification.pageType] || '当前页面无法提取'
    };
  }

  function isBaiduSearchPage(url) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return /(^|\.)baidu\.com$/.test(host) &&
        parsed.pathname === '/s' &&
        (parsed.searchParams.has('wd') || parsed.searchParams.has('word'));
    } catch (err) {
      return false;
    }
  }

  function getBaiduSearchQuery(url) {
    try {
      const parsed = new URL(url);
      return normalizeText(parsed.searchParams.get('wd') || parsed.searchParams.get('word') || '');
    } catch (err) {
      return '';
    }
  }

  function extractListingPage(url, classification) {
    const pageType = classification.pageType || 'listing';
    const isSearch = pageType.startsWith('search-results');
    const title = getPageTitle() || cleanTitle(document.title || '');
    const items = collectListingItems();

    if (items.length < 5) {
      return {
        success: false,
        title,
        content: '',
        htmlContent: '',
        excerpt: '',
        url,
        byline: '',
        method: isSearch ? 'search-results:generic' : 'listing',
        error: isSearch ? '未能提取到足够的搜索结果条目' : '当前页面更像列表页，但未能提取到足够条目',
        qualityWarnings: [
          isSearch ? '当前搜索结果页暂未适配专用提取器。' : '当前页面更像列表/聚合页，建议打开具体条目后再提取正文。'
        ]
      };
    }

    const lines = [
      `页面类型：${isSearch ? '搜索结果页' : '列表/聚合页'}`,
      `页面标题：${title || '未命名页面'}`,
      isSearch ? '以下为页面中的主要搜索结果条目：' : '以下为页面中的主要列表条目：',
      ''
    ];

    items.slice(0, 20).forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title}`);
      if (item.context) lines.push(`说明：${item.context}`);
      lines.push('');
    });

    const content = cleanExtractedText(lines.join('\n')).slice(0, 6000).trim();

    return {
      success: true,
      title,
      content,
      htmlContent: '',
      excerpt: content.slice(0, 200).trim(),
      url,
      byline: '',
      method: isSearch ? 'search-results:generic' : 'listing',
      qualityWarnings: [
        isSearch ? '当前页面是搜索结果页，摘要基于页面条目而非原文全文。' : '当前页面更像列表/聚合页，摘要基于页面条目而非具体文章全文。'
      ]
    };
  }

  function collectListingItems() {
    if (isHackerNewsListingPage()) {
      return collectHackerNewsItems();
    }

    const scope = document.querySelector('main, [role="main"], #content_left, #content, .content, #main') || document.body;
    if (!scope) return [];

    const selector = [
      'article a',
      'h1 a',
      'h2 a',
      'h3 a',
      '[role="heading"] a',
      '.result a',
      '.item a',
      '.card a',
      'li a',
      'a'
    ].join(',');

    const seen = new Set();
    const items = [];

    Array.from(scope.querySelectorAll(selector)).forEach(link => {
      const href = link.getAttribute('href') || '';
      if (/^(?:#|javascript:|mailto:|tel:)/i.test(href)) return;

      const title = cleanListingLine(link.textContent || link.getAttribute('title') || '');
      if (!title || title.length < 6 || title.length > 120) return;
      if (isLowValueListingTitle(title)) return;

      const key = title.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);

      const context = getListingItemContext(link, title);
      items.push({ title, context });
    });

    return items.slice(0, 40);
  }

  function getListingItemContext(link, title) {
    const root = link.closest('article, li, section, .result, .item, .card, [class*="result" i], [class*="item" i]') || link.parentElement;
    if (!root) return '';

    const lines = splitCleanLines(root.textContent || '')
      .map(cleanListingLine)
      .filter(line => line && line !== title && line.length >= 12 && line.length <= 180)
      .filter(line => !isLowValueListingTitle(line));

    return uniqueLines(lines).slice(0, 2).join(' ');
  }

  function cleanListingLine(text) {
    return normalizeText(text)
      .replace(/[\uE000-\uF8FF]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^(?:广告|推广|置顶|热|新)\s*/i, '')
      .trim();
  }

  function extractBaiduSearchResults(url) {
    const query = getBaiduSearchQuery(url);
    const title = cleanTitle(query ? `百度搜索：${query}` : document.title || '百度搜索');
    const container = document.querySelector('#content_left');

    if (!container) {
      return {
        success: false,
        title,
        content: '',
        htmlContent: '',
        excerpt: '',
        url,
        byline: '',
        method: 'search-results:baidu',
        error: '未能找到百度搜索结果列表'
      };
    }

    const nodes = Array.from(container.children)
      .filter(isBaiduResultNode)
      .slice(0, 16);
    const results = [];

    for (const node of nodes) {
      const item = parseBaiduResultNode(node);
      if (!item) continue;
      results.push(item);
      if (results.length >= 10) break;
    }

    if (results.length === 0) {
      return {
        success: false,
        title,
        content: '',
        htmlContent: '',
        excerpt: '',
        url,
        byline: '',
        method: 'search-results:baidu',
        error: '未能提取到百度搜索结果'
      };
    }

    const lines = [
      `搜索词：${query || title.replace(/^百度搜索：/, '')}`,
      '以下为百度搜索结果页提取的主要结果：',
      ''
    ];

    results.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title}`);
      if (item.meta) lines.push(`来源/时间：${item.meta}`);
      if (item.snippet) lines.push(`摘要：${item.snippet}`);
      lines.push(`链接文本：${item.linkText || item.title}`);
      lines.push('');
    });

    const content = cleanExtractedText(lines.join('\n')).slice(0, 6000).trim();

    return {
      success: true,
      title,
      content,
      htmlContent: '',
      excerpt: content.slice(0, 200).trim(),
      url,
      byline: '',
      method: 'search-results:baidu'
    };
  }

  function isBaiduResultNode(node) {
    if (!node || node.nodeType !== 1) return false;
    if (!node.querySelector('h3, .c-title, a')) return false;

    const text = normalizeText(node.textContent || '');
    if (!text || text.length < 30) return false;
    if (BAIDU_RESULT_SKIP_RE.test(text)) return false;

    const classAndId = `${node.className || ''} ${node.id || ''}`;
    if (/(?:rs|page|page-inner|content_right|con-ar|hint|relativewords)/i.test(classAndId)) return false;

    return true;
  }

  function parseBaiduResultNode(node) {
    const titleLink = node.querySelector('h3 a, .c-title a, h3, .c-title, a');
    const title = cleanBaiduResultLine(titleLink ? titleLink.textContent || '' : '');
    if (!title || title.length < 4 || BAIDU_RESULT_SKIP_RE.test(title)) return null;

    const lines = getBaiduResultLines(node, title);
    const metaParts = extractBaiduMetaParts(node, lines);
    const snippet = buildBaiduSnippet(lines, title, metaParts);

    if (!snippet || snippet.length < 20) return null;

    return {
      title,
      meta: uniqueLines(metaParts).join(' · '),
      snippet: snippet.slice(0, 360),
      linkText: title
    };
  }

  function getBaiduResultLines(node, title) {
    const clone = node.cloneNode(true);
    cleanupBaiduResultClone(clone);
    return splitCleanLines(clone.textContent || '')
      .map(cleanBaiduResultLine)
      .filter(line => line && line !== title && !BAIDU_RESULT_SKIP_RE.test(line));
  }

  function cleanupBaiduResultClone(root) {
    const selectors = [
      'script',
      'style',
      'svg',
      'canvas',
      'button',
      '[role="button"]',
      '.c-tools',
      '.c-gap-top-small',
      '.c-recommend',
      '.c-icon',
      '.c-img',
      '.op-img-address-link-type',
      '.opr-recommends-merge-content'
    ];

    selectors.forEach(selector => {
      try {
        root.querySelectorAll(selector).forEach(el => el.parentNode && el.parentNode.removeChild(el));
      } catch (err) { /* ignore selector differences */ }
    });
  }

  function extractBaiduMetaParts(node, lines) {
    const meta = [];
    const metaSelectors = [
      '.c-color-gray',
      '.c-color-gray2',
      '.c-source',
      '.c-showurl',
      '[class*="source" i]',
      '[class*="time" i]'
    ];

    metaSelectors.forEach(selector => {
      try {
        node.querySelectorAll(selector).forEach(el => {
          const text = cleanBaiduResultLine(el.textContent || '');
          if (isUsefulBaiduMeta(text)) meta.push(text);
        });
      } catch (err) { /* ignore selector differences */ }
    });

    lines.forEach(line => {
      const timePrefix = line.match(/^(?:\d+\s*分钟前|\d+\s*小时前|今天|昨天|前天|\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日)/);
      if (timePrefix) meta.push(timePrefix[0].replace(/\s+/g, ''));
      if (isUsefulBaiduMeta(line)) meta.push(line);
    });

    return uniqueLines(meta).slice(0, 3);
  }

  function isUsefulBaiduMeta(text) {
    if (!text || text.length > 60) return false;
    if (UI_NOISE_LINE_RE.test(text) || BAIDU_RESULT_SKIP_RE.test(text)) return false;
    return /(?:\d+\s*分钟前|\d+\s*小时前|今天|昨天|前天|\d{4}年|\d{1,2}月\d{1,2}日|新闻|日报|时报|央视|新华社|南方都市报|新浪|红歌会网|深港在线|财经|网|报|客户端)$/.test(text);
  }

  function buildBaiduSnippet(lines, title, metaParts) {
    const metaSet = new Set(metaParts);
    const snippetLines = [];

    lines.forEach(line => {
      let cleaned = line;
      cleaned = cleaned.replace(new RegExp(escapeRegExp(title), 'g'), ' ');
      metaParts.forEach(meta => {
        if (meta) cleaned = cleaned.replace(new RegExp(escapeRegExp(meta), 'g'), ' ');
      });
      cleaned = cleaned.replace(/^(?:\d+\s*分钟前|\d+\s*小时前|今天|昨天|前天|\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日)/, '');
      cleaned = cleanBaiduResultLine(cleaned);
      if (!cleaned || cleaned === title) return;
      if (metaSet.has(cleaned) || isUsefulBaiduMeta(cleaned)) return;
      if (BAIDU_RESULT_SKIP_RE.test(cleaned) || UI_NOISE_LINE_RE.test(cleaned)) return;
      if (/^(?:https?:\/\/|www\.|[\w.-]+\.(?:com|cn|net|org)\b)/i.test(cleaned)) return;
      if (cleaned.length < 8) return;
      snippetLines.push(cleaned);
    });

    return uniqueLines(snippetLines).join(' ').replace(/\s+/g, ' ').trim();
  }

  function escapeRegExp(text) {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function cleanBaiduResultLine(text) {
    return normalizeText(text)
      .replace(/[\uE000-\uF8FF]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/百度快照|播报|暂停/g, '')
      .trim();
  }

  function shouldUseFallback(readabilityResult, fallbackResult) {
    if (!readabilityResult || !readabilityResult.content) return true;
    if (!fallbackResult || !fallbackResult.content) return false;

    const readLen = readabilityResult.content.length;
    const fallbackLen = fallbackResult.content.length;

    if (readLen < 300 && fallbackLen > 500) return true;
    if (readLen < 700 && fallbackLen > readLen * 2.2) return true;
    if (fallbackResult.content.includes('图片内容') && readLen < 500) return true;
    if (looksLikeBoilerplate(readabilityResult.content.slice(0, 240)) && fallbackLen > readLen * 1.4) return true;

    return false;
  }

  function looksLikeBoilerplate(text) {
    return /cookie|uses cookies|跳至主要内容|skip to|sign in|register|登录|注册|导航|menu/i.test(text || '');
  }

  /**
   * 回退方案：清理 DOM 后选择最合适的主内容区域
   */
  function fallbackExtract(url) {
    const title = getPageTitle();
    const body = document.body;
    if (!body) {
      return {
        success: false,
        title,
        content: '',
        htmlContent: '',
        excerpt: '',
        url,
        byline: '',
        method: 'fallback'
      };
    }

    const clone = body.cloneNode(true);
    cleanupClone(clone);

    const container = findBestContainer(clone) || clone;
    const metadata = getArticleMetadata();
    const textContent = cleanExtractedText(container.textContent || '');
    const content = appendImageInfo([metadata, textContent].filter(Boolean).join('\n\n'), container);

    return {
      success: true,
      title,
      content,
      htmlContent: '',
      excerpt: content.slice(0, 200).trim(),
      url,
      byline: '',
      method: 'fallback'
    };
  }

  function cleanupClone(root) {
    for (const selector of NOISE_SELECTORS) {
      try {
        const nodes = root.querySelectorAll(selector);
        nodes.forEach(el => el.parentNode && el.parentNode.removeChild(el));
      } catch (e) { /* skip invalid selector */ }
    }

    const inlineHidden = root.querySelectorAll('[style*="display:none"], [style*="display: none"], [style*="visibility:hidden"], [style*="visibility: hidden"]');
    inlineHidden.forEach(el => el.parentNode && el.parentNode.removeChild(el));

    const textNoise = root.querySelectorAll('div, section, aside, header, nav, p, span, ul, ol');
    for (let i = textNoise.length - 1; i >= 0; i--) {
      const el = textNoise[i];
      const text = normalizeText(el.textContent || '');
      if (text && text.length < 500 && TEXT_NOISE_RE.test(text)) {
        el.parentNode && el.parentNode.removeChild(el);
      }
    }
  }

  function makeReadabilityDocumentClone() {
    const documentClone = document.cloneNode(true);
    if (documentClone.body) {
      cleanupClone(documentClone.body);
    }
    return documentClone;
  }

  function isVisibleElement(node) {
    if (!node || node.nodeType !== 1) return false;
    const style = window.getComputedStyle ? window.getComputedStyle(node) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)) {
      return false;
    }
    const rect = typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null;
    if (rect && rect.width === 0 && rect.height === 0) return false;
    return true;
  }

  function findBestContainer(root) {
    let best = null;

    for (const selector of CONTENT_SELECTORS) {
      let nodes;
      try {
        nodes = root.querySelectorAll(selector);
      } catch (e) {
        continue;
      }

      nodes.forEach(node => {
        const text = normalizeText(node.textContent || '');
        const importantImages = getImportantImages(node);
        if (text.length < 120 && importantImages.length === 0) return;

        const linkDensity = getLinkDensity(node);
        if (text.length < 500 && linkDensity > 0.5) return;

        const score = scoreElement(node, text.length, linkDensity, importantImages);
        if (!best || score > best.score) {
          best = { node, score };
        }
      });
    }

    return best ? best.node : null;
  }

  function scoreElement(node, textLength, linkDensity, importantImages = []) {
    const tag = node.tagName ? node.tagName.toLowerCase() : '';
    const classAndId = `${node.className || ''} ${node.id || ''}`;
    let score = textLength * (1 - Math.min(linkDensity, 0.85));

    if (tag === 'article') score += 1000;
    if (tag === 'main') score += 600;
    if (POSITIVE_RE.test(classAndId)) score += 500;
    if (NEGATIVE_RE.test(classAndId)) score -= 1200;
    if (importantImages.length > 0) {
      score += importantImages.reduce((sum, img) => sum + getImageScore(img), 0);
    }

    return score;
  }

  function getImageScore(img) {
    if (img.width && img.height) {
      return Math.min(img.width * img.height / 1000, 2500);
    }
    if (img.width >= 800 || img.height >= 500) {
      return 1200;
    }
    return 0;
  }

  function getLinkDensity(node) {
    const textLength = normalizeText(node.textContent || '').length;
    if (!textLength) return 1;

    let linkTextLength = 0;
    const links = node.querySelectorAll('a');
    links.forEach(link => {
      linkTextLength += normalizeText(link.textContent || '').length;
    });

    return linkTextLength / textLength;
  }

  function getPageTitle() {
    const metaTitle = document.querySelector(
      'meta[property="og:title"], meta[name="og:title"], meta[name="twitter:title"], meta[property="twitter:title"]'
    );
    const metaText = metaTitle ? metaTitle.getAttribute('content') : '';
    if (metaText) return cleanTitle(metaText);

    const h1 = document.querySelector('h1');
    const h1Text = h1 ? normalizeText(h1.textContent || '') : '';
    if (h1Text && h1Text.length >= 4 && (document.title || '').includes(h1Text)) {
      return cleanTitle(h1Text);
    }

    let title = document.title || '';
    if (SITE_TITLE_SEPARATOR_RE.test(title)) {
      const parts = title.split(SITE_TITLE_SEPARATOR_RE).map(p => p.trim()).filter(p => p.length >= 3);
      if (parts.length > 1) title = parts[0];
    }
    return cleanTitle(title);
  }

  function getImportantImageCandidates(root, options = {}) {
    const images = Array.from(root.querySelectorAll('img'));
    return images.map(img => {
      const width = img.naturalWidth || img.width || 0;
      const height = img.naturalHeight || img.height || 0;
      const src = toAbsoluteUrl(img.currentSrc || img.getAttribute('src') || img.src || '');
      const alt = normalizeText(img.alt || img.title || '');
      const candidate = { width, height, src, alt };
      if (options.includeElement) candidate.element = img;
      return candidate;
    }).filter(img => {
      if (!img.src) return false;
      if (/logo|icon|sprite|ewm|qrcode|qr|avatar|tx|toux|qx0609|dcy_|photoAlbum\/templet|photoAlbum\/page\/performance/i.test(img.src)) return false;
      return img.width >= 800 || img.height >= 500 || (img.width * img.height) >= 300000;
    }).slice(0, OCR_MAX_IMAGES);
  }

  function getImportantImages(root) {
    return getImportantImageCandidates(root).map(img => ({
      width: img.width,
      height: img.height,
      src: img.src,
      alt: img.alt
    }));
  }

  function appendImageInfo(content, root) {
    const images = getImportantImages(root);
    if (images.length === 0) return content;

    const imageLines = images.map((img, index) => {
      const label = img.alt || `图片 ${index + 1}`;
      const size = img.width && img.height ? `（${img.width}x${img.height}）` : '';
      return `- ${label}${size}: ${img.src}`;
    });

    return `${content}\n\n${IMAGE_INFO_TITLE}\n${imageLines.join('\n')}`.trim();
  }

  async function enhanceResultWithImageOcr(result) {
    const candidates = document.body
      ? getImportantImageCandidates(document.body, { includeElement: true })
      : [];

    if (candidates.length === 0) return result;

    const imageOcr = {
      attempted: false,
      supported: false,
      imageCount: candidates.length,
      recognizedCount: 0,
      failedCount: 0
    };

    if (!canUseTextDetector()) {
      return withImageOcrResult(
        result,
        imageOcr,
        [],
        isImageHeavyExtraction(result.content)
          ? ['检测到正文图片，但当前浏览器未提供可用 OCR 能力，已保留图片信息。']
          : []
      );
    }

    imageOcr.attempted = true;
    imageOcr.supported = true;

    let recognition;
    try {
      recognition = await withTimeout(
        recognizeImageText(candidates),
        OCR_TOTAL_TIMEOUT_MS,
        'OCR_TOTAL_TIMEOUT'
      );
    } catch (err) {
      recognition = {
        items: [],
        failedCount: candidates.length,
        error: err.message || String(err)
      };
    }

    const ocrItems = Array.isArray(recognition.items) ? recognition.items : [];
    imageOcr.recognizedCount = ocrItems.length;
    imageOcr.failedCount = Number(recognition.failedCount || 0);
    if (recognition.error) imageOcr.error = recognition.error;

    const warnings = [];
    if (ocrItems.length === 0 && isImageHeavyExtraction(result.content)) {
      warnings.push('未能从正文图片识别出文字；可能是图片不含文字、跨域或浏览器 OCR 限制。');
    } else if (imageOcr.failedCount > 0 && ocrItems.length > 0) {
      warnings.push('已识别部分图片文字；少量图片可能因加载、跨域或浏览器 OCR 限制未读取。');
    }

    return withImageOcrResult(result, imageOcr, ocrItems, warnings);
  }

  function canUseTextDetector() {
    return typeof globalThis.TextDetector === 'function';
  }

  async function recognizeImageText(candidates) {
    const detector = new globalThis.TextDetector();
    const items = [];
    let failedCount = 0;

    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      try {
        const text = await recognizeSingleImage(detector, candidate);
        if (text) {
          items.push({
            index,
            src: candidate.src,
            alt: candidate.alt,
            width: candidate.width,
            height: candidate.height,
            text
          });
        }
      } catch (err) {
        failedCount++;
        console.warn('[ContentExtract] 图片 OCR 失败:', {
          src: candidate.src,
          message: err.message || String(err)
        });
      }
    }

    return { items, failedCount };
  }

  async function recognizeSingleImage(detector, candidate) {
    const img = candidate.element;
    if (!img) return '';

    await waitForImageReady(img, OCR_IMAGE_READY_TIMEOUT_MS);

    const detections = await withTimeout(
      detector.detect(img),
      OCR_PER_IMAGE_TIMEOUT_MS,
      'OCR_IMAGE_TIMEOUT'
    );

    return collectDetectedText(detections);
  }

  function collectDetectedText(detections) {
    if (!Array.isArray(detections) || detections.length === 0) return '';

    const lines = detections.flatMap(item => {
      const raw = item?.rawValue || item?.rawText || item?.text || item?.value || '';
      return String(raw || '').split(/\n+/);
    }).map(cleanOcrLine).filter(line => line.length >= 2);

    return uniqueLines(lines).join('\n');
  }

  function cleanOcrLine(line) {
    return normalizeText(line)
      .replace(/[|｜]{2,}/g, '|')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function waitForImageReady(img, timeoutMs) {
    if (!img) return Promise.resolve(false);
    if (img.complete && (img.naturalWidth || img.width)) return Promise.resolve(true);

    return new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        img.removeEventListener('load', handleLoad);
        img.removeEventListener('error', handleError);
        resolve(value);
      };
      const handleLoad = () => finish(true);
      const handleError = () => finish(false);
      const timer = setTimeout(() => finish(false), timeoutMs);

      img.addEventListener('load', handleLoad, { once: true });
      img.addEventListener('error', handleError, { once: true });
    });
  }

  async function withTimeout(promise, timeoutMs, code) {
    let timer = null;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(code)), timeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function withImageOcrResult(result, imageOcr, ocrItems, warnings = []) {
    const content = ocrItems.length > 0
      ? appendImageOcrText(result.content || '', ocrItems)
      : result.content || '';
    const excerptSource = ocrItems.length > 0 ? content : (result.excerpt || content.slice(0, 200));

    const cleanedWarnings = (Array.isArray(result.qualityWarnings) ? result.qualityWarnings : [])
      .filter(warning => !STALE_IMAGE_OCR_WARNING_RE.test(String(warning || '')));

    return {
      ...result,
      content,
      excerpt: cleanExtractedText(excerptSource).slice(0, 200),
      qualityWarnings: uniqueLines([
        ...cleanedWarnings,
        ...warnings
      ]),
      imageOcr
    };
  }

  function appendImageOcrText(content, ocrItems) {
    if (!Array.isArray(ocrItems) || ocrItems.length === 0) return content;

    const blocks = ocrItems.map((item, index) => {
      const label = item.alt || `图片 ${index + 1}`;
      const size = item.width && item.height ? `（${item.width}x${item.height}）` : '';
      const text = String(item.text || '')
        .split(/\n+/)
        .map(line => `  ${line}`)
        .join('\n');
      return `${index + 1}. ${label}${size}\n${text}`;
    });

    return `${content}\n\n${IMAGE_OCR_TITLE}\n${blocks.join('\n\n')}`.trim();
  }

  function getArticleMetadata() {
    const candidates = [
      '.title_bottom .time',
      '.title_mobile_bottom .time',
      '.time',
      '[class*="source" i]',
      '[class*="info" i]'
    ];
    const lines = [];

    for (const selector of candidates) {
      let node = null;
      try {
        node = document.querySelector(selector);
      } catch (e) {
        node = null;
      }
      const text = normalizeText(node ? node.textContent || '' : '');
      if (!text || text.length > 220) continue;
      if (/发布时间|来源|编辑|责任编辑|作者|日期|时间/.test(text) && !lines.includes(text)) {
        lines.push(text);
      }
    }

    return lines.join('\n');
  }

  function toAbsoluteUrl(value) {
    if (!value) return '';
    try {
      return new URL(value, document.baseURI).href;
    } catch (e) {
      return value;
    }
  }

  function cleanTitle(title) {
    let cleaned = normalizeText(title).replace(/\s+/g, ' ').trim();
    if (SITE_TITLE_SEPARATOR_RE.test(cleaned)) {
      const parts = cleaned.split(SITE_TITLE_SEPARATOR_RE).map(p => p.trim()).filter(p => p.length >= 3);
      if (parts.length > 1) cleaned = parts[0];
    }
    return cleaned;
  }

  function normalizeText(text) {
    return String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/([。！？!?])([^\s"'”’）】》])/g, '$1 $2')
      .trim();
  }

  function cleanExtractedText(text) {
    return dedupeAndFilterLines(normalizeText(text)
      .replace(/[\uE000-\uF8FF]/g, '')
      .replace(/Article\s+\d+\s+of\s+\d+/gi, '')
      .replace(/Next:\s*([A-Z][^\n]{0,120})/g, '')
      .replace(/In this article/gi, '')
      .replace(/^本页内容\s*/gm, '')
      .trim());
  }

  function splitCleanLines(text) {
    return String(text || '')
      .replace(/[\uE000-\uF8FF]/g, '')
      .split(/\n+/)
      .map(line => normalizeText(line).replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  function uniqueLines(lines) {
    const seen = new Set();
    const result = [];

    lines.forEach(line => {
      const value = normalizeText(line).replace(/\s+/g, ' ').trim();
      if (!value) return;
      const key = value.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      result.push(value);
    });

    return result;
  }

  function dedupeAndFilterLines(text) {
    const lines = splitCleanLines(text);
    const filtered = [];
    const seen = new Set();

    lines.forEach(line => {
      if (!line) return;
      if (UI_NOISE_LINE_RE.test(line)) return;
      if (isChatGptArtifactLine(line)) return;
      if (/^(?:[<＞>]*\s*)?(?:上一页|下一页|帮助|举报|用户反馈|企业推广)\s*$/.test(line)) return;
      if (/^(?:百度首页|hao123|地图|视频|贴吧|学术|更多产品)/.test(line) && line.length < 80) return;

      const key = line.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      filtered.push(line);
    });

    return filtered.join('\n').trim();
  }

  function isChatGptArtifactLine(line) {
    const value = normalizeText(line);
    if (!value || value.length > 120) return false;
    if (isRuntimeMarkdownArtifact(value)) return true;
    if (isIsolatedArtifactToken(value)) return true;

    const segments = value
      .split(/[\u3001\uFF0C,\u3002;\uFF1B]+|\.\s+|\s+(?=#{1,6}\s*\d)|\s{2,}/)
      .map(part => normalizeText(part))
      .filter(Boolean);

    return segments.length >= 2 && segments.every(segment =>
      isRuntimeMarkdownArtifact(segment) || isIsolatedArtifactToken(segment) || isEmptyArtifactHeading(segment)
    );
  }

  function isRuntimeMarkdownArtifact(line) {
    return /^runtime\.[a-z0-9_.-]+\.md$/i.test(normalizeText(line));
  }

  function isIsolatedArtifactToken(line) {
    const value = normalizeArtifactToken(line);
    return /^(?:config|webpack|sync|runtime|tabs|body|md)$/i.test(value);
  }

  function isEmptyArtifactHeading(line) {
    return normalizeArtifactToken(line) === '';
  }

  function normalizeArtifactToken(line) {
    return normalizeText(line)
      .replace(/^#{1,6}\s*/, '')
      .replace(/^\d+[.)\u3001\uFF0E]?\s*/, '')
      .replace(/[.\u3002]+$/g, '')
      .trim();
  }

  function truncateText(text, maxLength) {
    const value = normalizeText(text);
    if (value.length <= maxLength) return value;
    return `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
  }

  function stripHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html || '';
    return div.textContent || '';
  }

  /**
   * 获取页面选中文本
   */
  function getSelectedText() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      return { success: false, text: '', reason: 'no_selection' };
    }

    const text = selection.toString().trim();
    if (!text) {
      return { success: false, text: '', reason: 'empty_selection' };
    }

    return {
      success: true,
      text: text,
      selectionLength: text.length
    };
  }

  /**
   * 获取页面基本信息（无需 Readability）
   */
  function getPageInfo() {
    const info = {
      title: getPageTitle(),
      url: window.location.href,
      description: '',
      favicon: ''
    };

    const metaDesc = document.querySelector('meta[name="description"], meta[property="og:description"]');
    if (metaDesc) {
      info.description = metaDesc.getAttribute('content') || '';
    }

    const faviconLink = document.querySelector('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
    if (faviconLink) {
      info.favicon = faviconLink.getAttribute('href') || '';
      if (info.favicon && !info.favicon.startsWith('http') && !info.favicon.startsWith('data:')) {
        try {
          info.favicon = new URL(info.favicon, document.baseURI).href;
        } catch (e) {
          info.favicon = '';
        }
      }
    }

    return info;
  }

  // ========== 消息监听 ==========
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { action } = message;

    console.log('[ContentExtract] 收到消息:', action);

    switch (action) {
      case 'extractPage': {
        extractPageContentWithOcr()
          .then(result => {
            sendResponse({ success: result.success, data: result, error: result.error });
          })
          .catch(err => {
            console.error('[ContentExtract] 提取页面失败:', err);
            sendResponse({ success: false, error: err.message || String(err) });
          });
        return true;
      }

      case 'getSelectedText': {
        const result = getSelectedText();
        sendResponse({ success: result.success, data: result });
        break;
      }

      case 'getPageInfo': {
        const result = getPageInfo();
        sendResponse({ success: true, data: result });
        break;
      }

      default: {
        sendResponse({ success: false, error: `未知操作: ${action}` });
      }
    }

    return true;
  });

  console.log('[ContentExtract] 内容提取脚本已就绪');
})();
