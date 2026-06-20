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
  const OCR_MAX_IMAGES = 5;
  const OCR_TOTAL_TIMEOUT_MS = 8000;
  const OCR_PER_IMAGE_TIMEOUT_MS = 3000;
  const OCR_IMAGE_READY_TIMEOUT_MS = 1200;
  const IMAGE_OCR_TITLE = '图片 OCR 文字：';
  const IMAGE_INFO_TITLE = '图片内容：';
  const STALE_IMAGE_OCR_WARNING_RE = /未读取图片文字|只记录了图片信息|OCR 不可用|未能从正文图片识别出文字|未能读取图片文字/;

  /**
   * 提取页面主要内容
   * @returns {{ success: boolean, title?: string, content?: string, htmlContent?: string, excerpt?: string, url?: string, byline?: string, method?: string, error?: string }}
   */
  function extractPageContent() {
    const url = window.location.href;
    const classification = classifyPage(url);

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

    if (classification.pageType === 'search-results:generic' || classification.pageType === 'listing') {
      return applyExtractionMetadata(extractListingPage(url, classification), classification);
    }

    if (BLOCKED_PAGE_TYPES.has(classification.pageType)) {
      return applyExtractionMetadata(extractBlockedPage(url, classification), classification);
    }

    const fallbackResult = fallbackExtract(url);
    let readabilityResult = null;

    if (window.Readability) {
      try {
        const reader = new window.Readability(document);
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

    const best = shouldUseFallback(readabilityResult, fallbackResult) ? fallbackResult : readabilityResult || fallbackResult;

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
    const result = extractPageContent();
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

    return (hasPasswordInput && textLooksLogin) || nodeLooksCaptcha || shortSecurityGate || (routeLooksLogin && textLooksLogin);
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

  function isGitHubRepositoryPage(url) {
    const parsed = safeParseUrl(url);
    if (!parsed || !/(^|\.)github\.com$/i.test(parsed.hostname)) return false;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return false;
    if (['issues', 'pulls', 'pull', 'actions', 'projects', 'wiki', 'security', 'pulse', 'graphs', 'settings'].includes(parts[2])) return false;
    return true;
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
    const links = getLikelyResultLinks();
    if (links.length < 12) return false;
    const main = document.querySelector('main, [role="main"], #content, .content, #main') || document.body;
    const linkDensity = main ? getLinkDensity(main) : 0;
    const paragraphCount = main ? Array.from(main.querySelectorAll('p')).filter(p => normalizeText(p.textContent || '').length > 60).length : 0;
    return linkDensity > 0.35 || (links.length >= 18 && paragraphCount < links.length / 2);
  }

  function getLikelyResultLinks() {
    const scope = document.querySelector('main, [role="main"], #content, .content, #main') || document.body;
    if (!scope) return [];
    return Array.from(scope.querySelectorAll('a'))
      .map(link => cleanListingLine(link.textContent || link.getAttribute('title') || ''))
      .filter(text => text.length >= 6 && text.length <= 120 && !isLowValueListingTitle(text));
  }

  function applyExtractionMetadata(result, classification, extraWarnings = []) {
    const content = result && result.content ? result.content : '';
    const warnings = uniqueLines([
      ...(Array.isArray(result?.qualityWarnings) ? result.qualityWarnings : []),
      ...extraWarnings,
      ...getQualityWarnings(content, classification, result?.method || '')
    ]);

    return {
      ...(result || {}),
      pageType: result?.pageType || classification.pageType,
      confidence: typeof result?.confidence === 'number' ? result.confidence : classification.confidence,
      reason: result?.reason || classification.reason,
      qualityWarnings: warnings
    };
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
      if (/^(?:[<＞>]*\s*)?(?:上一页|下一页|帮助|举报|用户反馈|企业推广)\s*$/.test(line)) return;
      if (/^(?:百度首页|hao123|地图|视频|贴吧|学术|更多产品)/.test(line) && line.length < 80) return;

      const key = line.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      filtered.push(line);
    });

    return filtered.join('\n').trim();
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
