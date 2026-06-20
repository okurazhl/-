/**
 * 简化版 Mozilla Readability 内容提取库
 * 经典脚本（非 ES module），挂载到 window.Readability
 *
 * 基于 Mozilla Readability.js 的核心算法：
 * - 对段落/div 进行文本密度评分
 * - 识别主要内容容器
 * - 剥离导航、侧边栏、广告等非内容元素
 */

(function () {
  'use strict';

  // ========== 正则与常量 ==========
  const REGEXPS = {
    // 不太可能包含内容的元素（会被移除）
    unlikelyCandidates: /banner|breadcrumb|combx|comment|community|consent|cookie|cover-wrap|disqus|extra|footer|gdpr|header|legends|menu|newsletter|promo|related|remark|replies|rss|share|shoutbox|sidebar|skyscraper|social|sponsor|subscribe|ad-break|agegate|pagination|pager|popup/i,
    // 很可能包含内容的元素
    likelyCandidates: /and|article|body|column|content|main|shadow/i,
    // 非内容的负面标签
    negative: /hidden|^hidden$|^nomobile$|^combx$|^comment$|^community$|^disqus$|^extra$|^foot$|^footer$|^gdpr$|^header$|^legends$|^menu$|^modal$|^nav$|^related$|^remark$|^replies$|^rss$|^shoutbox$|^sidebar$|^skyscraper$|^social$|^sponsor$|^supplemental$|^tools$/i,
    // 正面类名
    positive: /article|body|content|entry|hentry|h-entry|main|page|pagination|post|text|blog|story/i,
    // 需要清理的无关标签
    divToPElems: /<(a|blockquote|dl|div|img|ol|p|pre|table|ul)/i,
    // 替换标签
    replaceBrs: /(<br[^>]*>[ \n\r\t]*){2,}/gi,
    replaceFonts: /<(\/?)font[^>]*>/gi,
    replaceLineBreaks: /<p[^>]*><br[^>]*><\/p[^>]*>/gi,
    // 空白规范化
    normalize: /\s{2,}/g,
    // 段落分隔
    paragraph: /<p[^>]*>(.*?)<\/p[^>]*>/gi,
    // 标题
    siteTitleSeparator: /\s+(?:[-–—•|｜]|::)\s+/,
    // 视频
    video: /\/\/(www\.)?((dailymotion|youtube|youtube-nocookie|player\.vimeo|v\.qq|bilibili)\.com|(archive|upload\.wikimedia)\.org|bbc\.co\.uk)\//i
  };

  // 需要完全移除的标签
  const REMOVE_TAGS = 'script,style,noscript,iframe,svg,canvas,img[src^="data:"],link[rel="stylesheet"],input,button,select,textarea,form,meta,link,head,source,embed,object,param,map,area,base,applet,video[src=""],audio[src=""],template,slot'.split(',');

  const NOISE_SELECTORS = [
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

  const ARTICLE_SELECTORS = [
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
    '[role="main"]',
    'main'
  ];

  const TEXT_NOISE_RE = /uses cookies from Google|Google uses AI technology|AI translations can contain errors|使用集合让一切井井有条|根据您的偏好保存内容并对其进行分类|^本页内容|^In this article$|Article \d+ of \d+|Next:/i;

  // 需要保留但转换为 div 的标签
  const PRESERVE_TAGS = ['article', 'section', 'header', 'footer', 'aside', 'nav', 'figure', 'figcaption', 'main', 'details', 'summary'];

  // 标签分数
  const TAG_SCORES = {
    'article': 25, 'section': 10, 'main': 30,
    'div': 5, 'p': 1, 'pre': 3, 'td': 3, 'blockquote': 3,
    'li': -3, 'address': -3, 'ol': -3, 'ul': -3,
    'dl': -3, 'dd': -3, 'dt': -3, 'form': -3,
    'h1': -5, 'h2': -5, 'h3': -5, 'h4': -5, 'h5': -5, 'h6': -5,
    'th': 5
  };

  // ========== 辅助函数 ==========

  /** 获取元素的文本长度 */
  function getTextLength(node) {
    return normalizeText(node.textContent || '').length;
  }

  /** 获取链接文本长度 */
  function getLinkTextLength(node) {
    const links = node.getElementsByTagName('a');
    let len = 0;
    for (let i = 0; i < links.length; i++) {
      len += (links[i].textContent || '').trim().length;
    }
    return len;
  }

  /** 获取链接密度（链接文本占总文本的比例） */
  function getLinkDensity(node) {
    const textLen = getTextLength(node);
    if (textLen === 0) return 1;
    return getLinkTextLength(node) / textLen;
  }

  /** 逗号密度（逗号越多越可能是正文） */
  function getCommaCount(node) {
    return (node.textContent || '').split(',').length - 1;
  }

  /** 检查 className/id 是否匹配正则 */
  function hasMatch(node, regex) {
    const className = (node.className && (typeof node.className === 'string' ? node.className : node.className.baseVal)) || '';
    const id = (node.id && (typeof node.id === 'string' ? node.id : node.id.baseVal)) || '';
    return regex.test(className) || regex.test(id);
  }

  /** 获取元素的所有祖先 */
  function getAncestors(node, maxDepth) {
    maxDepth = maxDepth || 5;
    const ancestors = [];
    let current = node.parentElement;
    let depth = 0;
    while (current && depth < maxDepth) {
      ancestors.push(current);
      current = current.parentElement;
      depth++;
    }
    return ancestors;
  }

  /** 清理空白文本节点 */
  function cleanWhitespace(node) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
    const remove = [];
    while (walker.nextNode()) {
      const textNode = walker.currentNode;
      if (!textNode.textContent || !textNode.textContent.trim()) {
        remove.push(textNode);
      }
    }
    remove.forEach(n => n.parentNode && n.parentNode.removeChild(n));
  }

  function normalizeText(text) {
    return String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function removeTextNoise(root) {
    const elems = root.querySelectorAll('div, section, aside, header, nav, p, span, ul, ol');
    for (let i = elems.length - 1; i >= 0; i--) {
      const el = elems[i];
      const text = normalizeText(el.textContent || '');
      if (text && text.length < 500 && TEXT_NOISE_RE.test(text)) {
        el.parentNode && el.parentNode.removeChild(el);
      }
    }
  }

  // ========== 核心类 ==========

  class Readability {
    /**
     * @param {Document|Element} doc - 要解析的文档/元素
     * @param {object} options
     */
    constructor(doc, options) {
      this._doc = doc || document;
      this._options = options || {};
      this._articleTitle = null;
      this._articleContent = null;
      this._articleText = null;
      this._articleExcerpt = null;
      this._articleByline = null;
      this._flags = {};
    }

    /**
     * 执行提取，返回结果对象
     * @returns {{ title: string, content: string, textContent: string, excerpt: string, byline: string, length: number }}
     */
    parse() {
      // 1. 克隆 body（避免修改原始 DOM）
      const body = this._doc.body || this._doc.documentElement;
      if (!body) {
        return this._emptyResult();
      }

      this._articleTitle = this._getTitle();

      // 克隆整个 body
      const clone = body.cloneNode(true);

      // 2. 预处理：移除无关标签
      this._prepDocument(clone);

      // 3. 对有明确正文容器的网站优先使用结构化候选
      const directCandidate = this._findDirectCandidate(clone);

      // 4. 寻找最可能是内容的容器
      const candidates = this._scoreNodes(clone);

      // 5. 选出最佳候选
      const topCandidate = directCandidate || this._selectBest(candidates);

      // 6. 清理并构建最终内容
      if (topCandidate) {
        this._articleContent = topCandidate.node;
        this._cleanContent();
        this._articleText = normalizeText(this._articleContent.textContent || '').replace(REGEXPS.normalize, ' ');
        this._articleExcerpt = this._articleText.slice(0, 200).trim();
      } else {
        // 退回到 body
        this._articleContent = clone;
        this._cleanContent();
        this._articleText = normalizeText(clone.textContent || '').replace(REGEXPS.normalize, ' ');
        this._articleExcerpt = this._articleText.slice(0, 200).trim();
      }

      // 尝试提取作者
      this._articleByline = this._getByline(clone);

      return {
        title: this._articleTitle || '',
        content: this._articleContent ? this._articleContent.innerHTML : '',
        textContent: this._articleText || '',
        excerpt: this._articleExcerpt || '',
        byline: this._articleByline || '',
        length: this._articleText ? this._articleText.length : 0
      };
    }

    /** 获取网页标题 */
    _getTitle() {
      let title = '';
      const doc = this._doc;

      const metaTitle = doc.querySelector(
        'meta[property="og:title"], meta[name="og:title"], meta[name="twitter:title"], meta[property="twitter:title"]'
      );
      if (metaTitle) {
        title = metaTitle.getAttribute('content') || '';
        if (title) return this._cleanTitle(title);
      }

      title = doc.title || '';

      const h1 = doc.querySelector('h1');
      const h1Text = h1 ? normalizeText(h1.textContent || '') : '';
      if (h1Text && h1Text.length >= 4 && title.includes(h1Text)) {
        return this._cleanTitle(h1Text);
      }

      if (REGEXPS.siteTitleSeparator.test(title)) {
        const parts = title.split(REGEXPS.siteTitleSeparator).map(p => p.trim()).filter(p => p.length >= 3);
        if (parts.length > 1) {
          title = parts[0];
        }
      }

      return this._cleanTitle(title);
    }

    _cleanTitle(title) {
      let cleaned = normalizeText(title).replace(/\s+/g, ' ').trim();
      if (REGEXPS.siteTitleSeparator.test(cleaned)) {
        const parts = cleaned.split(REGEXPS.siteTitleSeparator).map(p => p.trim()).filter(p => p.length >= 3);
        if (parts.length > 1) cleaned = parts[0];
      }
      return cleaned;
    }

    /** 预处理 DOM */
    _prepDocument(node) {
      // 移除注释
      const iterator = document.createNodeIterator(node, NodeFilter.SHOW_COMMENT);
      const remove = [];
      while (iterator.nextNode()) {
        remove.push(iterator.referenceNode);
      }
      remove.forEach(n => n.parentNode && n.parentNode.removeChild(n));

      // 移除 script/style/noscript 等标签
      REMOVE_TAGS.forEach(selector => {
        try {
          const elems = node.querySelectorAll(selector);
          elems.forEach(el => el.parentNode && el.parentNode.removeChild(el));
        } catch (e) { /* 忽略无效选择器 */ }
      });

      NOISE_SELECTORS.forEach(selector => {
        try {
          const elems = node.querySelectorAll(selector);
          elems.forEach(el => el.parentNode && el.parentNode.removeChild(el));
        } catch (e) { /* 忽略无效选择器 */ }
      });

      removeTextNoise(node);

      // 移除 hidden 元素
      const allElems = node.querySelectorAll('[hidden], [aria-hidden="true"], [style*="display:none"], [style*="display: none"]');
      allElems.forEach(el => {
        // 检查是否真的是 display:none
        const style = el.getAttribute('style') || '';
        const hidden = el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true';
        if (hidden || /display\s*:\s*none/.test(style)) {
          el.parentNode && el.parentNode.removeChild(el);
        }
      });
    }

    _findDirectCandidate(root) {
      let best = null;
      for (const selector of ARTICLE_SELECTORS) {
        let elems;
        try {
          elems = root.querySelectorAll(selector);
        } catch (e) {
          continue;
        }

        elems.forEach(el => {
          const textLen = getTextLength(el);
          if (textLen < 250) return;

          const linkDensity = getLinkDensity(el);
          if (linkDensity > 0.45) return;

          let score = textLen * (1 - linkDensity);
          const tagName = el.tagName.toLowerCase();
          if (tagName === 'article') score += 1000;
          if (tagName === 'main') score += 500;
          if (hasMatch(el, REGEXPS.positive)) score += 500;
          if (hasMatch(el, REGEXPS.negative)) score -= 1000;

          if (!best || score > best.score) {
            best = { node: el, score };
          }
        });
      }

      return best;
    }

    /** 对段落节点评分 */
    _scoreNodes(root) {
      const candidates = [];
      const allParagraphs = root.querySelectorAll('p, td, pre, div, article, section, main, blockquote, li, h1, h2, h3, h4, h5, h6');

      for (let i = 0; i < allParagraphs.length; i++) {
        const node = allParagraphs[i];
        const tagName = node.tagName.toLowerCase();

        // 跳过极小文本
        const textLen = getTextLength(node);
        if (textLen < 25) continue;

        // 跳过链接密度过高的节点（导航等）
        const linkDensity = getLinkDensity(node);
        if (linkDensity > 0.5) continue;

        // 跳过看起来不像内容的节点
        if (hasMatch(node, REGEXPS.unlikelyCandidates) &&
            !hasMatch(node, REGEXPS.likelyCandidates)) {
          continue;
        }

        // 基础分
        let score = 1;

        // 标签加权
        score += (TAG_SCORES[tagName] || 0);

        // 文本长度加分
        score += Math.min(Math.floor(textLen / 100), 5);

        // 逗号密度加分
        const commas = getCommaCount(node);
        score += Math.min(commas, 5);

        // 类名/ID 加分
        if (hasMatch(node, REGEXPS.positive)) score += 10;

        // 类名/ID 减分
        if (hasMatch(node, REGEXPS.negative)) score -= 25;
        if (hasMatch(node, REGEXPS.unlikelyCandidates)) score -= 10;

        // 把分数传播给祖先节点，找到最合适的容器
        const ancestors = getAncestors(node, 5);
        const weightByDepth = 1 - 0.1;  // 深层节点分数打折

        for (let j = 0; j < ancestors.length; j++) {
          const ancestor = ancestors[j];
          const aTag = ancestor.tagName.toLowerCase();

          // 跳过 body/html
          if (aTag === 'body' || aTag === 'html') continue;

          // 初始化或累加祖先分数
          if (!ancestor._readabilityScore) {
            ancestor._readabilityScore = 0;
            // 初始加分
            if (aTag === 'article' || aTag === 'main') ancestor._readabilityScore += 30;
            if (hasMatch(ancestor, REGEXPS.positive)) ancestor._readabilityScore += 15;
          }

          // 传播分数（距离越远折扣越多）
          const depthFactor = 1 - j * 0.15;
          const contribution = score * depthFactor * weightByDepth;

          if (node === allParagraphs[i]) {
            ancestor._readabilityScore += contribution;
          }

          // 记录候选
          if (ancestor._readabilityScore > 40 &&
              !candidates.includes(ancestor)) {
            candidates.push(ancestor);
          }
        }
      }

      return candidates;
    }

    /** 选择最佳候选 */
    _selectBest(candidates) {
      if (candidates.length === 0) return null;

      // 按分数排序
      candidates.sort((a, b) => {
        const s = (b._readabilityScore || 0) - (a._readabilityScore || 0);
        if (s !== 0) return s;
        // 分数相同，优先文本更长的
        return getTextLength(b) - getTextLength(a);
      });

      // 检查链接密度是否仍过高
      for (let i = 0; i < Math.min(candidates.length, 5); i++) {
        const candidate = candidates[i];
        const density = getLinkDensity(candidate);
        if (density < 0.4) {
          return { node: candidate, score: candidate._readabilityScore || 0 };
        }
      }

      // 如果前 5 个链接密度都高，取第一个
      return { node: candidates[0], score: candidates[0]._readabilityScore || 0 };
    }

    /** 清理内容 */
    _cleanContent() {
      const node = this._articleContent;
      if (!node) return;

      // 移除残留的不可能候选
      const allDescendants = node.querySelectorAll('*');
      for (let i = allDescendants.length - 1; i >= 0; i--) {
        const el = allDescendants[i];

        // 移除链接过多的段落
        if (getTextLength(el) < 20) {
          const density = getLinkDensity(el);
          if (density > 0.5) {
            el.parentNode && el.parentNode.removeChild(el);
            continue;
          }
        }

        // 移除不可能的内容块
        if (hasMatch(el, REGEXPS.unlikelyCandidates) &&
            !hasMatch(el, REGEXPS.likelyCandidates) &&
            getTextLength(el) < 100) {
          el.parentNode && el.parentNode.removeChild(el);
          continue;
        }
      }

      // 清理空白
      cleanWhitespace(this._articleContent);
    }

    /** 获取作者 */
    _getByline(doc) {
      // 尝试 meta 标签
      const metaAuthor = doc.querySelector('meta[name="author"], meta[property="article:author"]');
      if (metaAuthor) {
        const content = metaAuthor.getAttribute('content');
        if (content) return content.trim();
      }

      // 尝试常见作者选择器
      const selectors = [
        '[rel="author"]', '.author', '.byline', '.article-author',
        '.post-author', '[itemprop="author"]', '.author-name',
        '.contributor-name', '.entry-author', 'a[href*="/author/"]'
      ];

      for (const sel of selectors) {
        try {
          const el = doc.querySelector(sel);
          if (el && getTextLength(el) > 0 && getTextLength(el) < 100) {
            return el.textContent.trim().replace(/^by\s+/i, '').replace(/\s+/g, ' ');
          }
        } catch (e) { /* skip */ }
      }

      return '';
    }

    /** 空结果 */
    _emptyResult() {
      return {
        title: '',
        content: '',
        textContent: '',
        excerpt: '',
        byline: '',
        length: 0
      };
    }
  }

  // ========== 暴露到全局 ==========
  window.Readability = Readability;
})();
