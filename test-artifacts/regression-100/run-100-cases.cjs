const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const root = path.resolve(__dirname, '..', '..');
const outDir = __dirname;
const screenshotDir = path.join(outDir, 'failure-screenshots');
fs.rmSync(screenshotDir, { recursive: true, force: true });
fs.mkdirSync(screenshotDir, { recursive: true });

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitFor(fn, timeoutMs = 15000, intervalMs = 250) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      lastErr = err;
    }
    await sleep(intervalMs);
  }
  if (lastErr) throw lastErr;
  throw new Error('wait timeout');
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);
  const chrome = candidates.find(candidate => fs.existsSync(candidate));
  if (!chrome) throw new Error('Cannot find chrome.exe; set CHROME_PATH to run this test.');
  return chrome;
}

async function startChrome() {
  const port = await findFreePort();
  const profileDir = path.join(outDir, `tmp-chrome-100-${Date.now()}`);
  fs.mkdirSync(profileDir, { recursive: true });

  const proc = spawn(findChrome(), [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--ignore-certificate-errors',
    '--window-size=1280,900',
    'about:blank'
  ], {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });

  let stderr = '';
  proc.stderr.on('data', chunk => { stderr += String(chunk); });

  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`).catch(() => null);
    return response && response.ok;
  }, 15000);

  return {
    port,
    profileDir,
    stderr: () => stderr,
    stop: async () => {
      if (!proc.killed) proc.kill();
      await sleep(800);
    }
  };
}

class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message || 'CDP error'}: ${msg.error.data || ''}`));
        else resolve(msg.result || {});
      } else if (msg.method && this.events.has(msg.method)) {
        for (const fn of [...this.events.get(msg.method)]) fn(msg.params || {});
      }
    });
  }

  on(method, handler) {
    if (!this.events.has(method)) this.events.set(method, new Set());
    this.events.get(method).add(handler);
    return () => this.events.get(method)?.delete(handler);
  }

  once(method, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const off = this.on(method, params => {
        clearTimeout(timer);
        off();
        resolve(params);
      });
      const timer = setTimeout(() => {
        off();
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
    });
  }

  send(method, params = {}, timeoutMs = 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out running CDP command ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression, timeoutMs = 30000) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    }, timeoutMs);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime exception');
    return result.result ? result.result.value : undefined;
  }

  close() {
    try { this.ws.close(); } catch {}
  }
}

async function createTarget(port, url = 'about:blank') {
  let resp = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!resp.ok) resp = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`);
  if (!resp.ok) throw new Error(`create target failed: ${resp.status}`);
  return await resp.json();
}

function page(title, body, head = '') {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <meta name="description" content="${title} test page">
  ${head}
</head>
<body>${body}</body>
</html>`;
}

function articleBody(title, keyword, index, lang = 'en') {
  const text = lang === 'zh' ? [
    `${title} 是一篇用于测试网页笔记助手正文提取的中文文章。`,
    `文章围绕 ${keyword} 展开，包含背景、核心观点、实践步骤和结论。`,
    `第一部分解释 ${keyword} 为什么重要，并给出真实用户在阅读网页时的常见需求。`,
    `第二部分说明提取结果应该排除导航、广告、评论入口和其他控件。`,
    `第三部分强调摘要必须基于页面中真实可见的正文，不应该臆测缺失内容。`,
    `第 ${index} 个案例用于验证标题、段落和正文长度是否保持稳定。`
  ] : [
    `${title} is a deterministic article used to test content extraction in the web note helper.`,
    `The article focuses on ${keyword}, including background, key points, implementation details, and conclusion.`,
    `The first section explains why ${keyword} matters for users who save webpages into notes.`,
    `The second section says extraction should remove navigation, advertisements, comment links, and controls.`,
    `The third section reminds the summarizer to rely only on visible text and avoid inventing missing details.`,
    `Case ${index} verifies that title, paragraphs, and content length remain stable.`
  ];
  return `<article>
    <h1>${title}</h1>
    ${text.map(p => `<p>${p}</p>`).join('\n')}
  </article>`;
}

function makeArticleCase(i, lang = 'en') {
  const title = lang === 'zh' ? `中文正文提取案例 ${i}` : `English Article Extraction Case ${i}`;
  const keyword = lang === 'zh' ? `知识管理 ${i}` : `knowledge management ${i}`;
  return {
    id: `article-${lang}-${i}`,
    group: lang === 'zh' ? '中文文章' : '英文文章',
    url: `https://articles.example.test/${lang}/${i}`,
    html: page(title, articleBody(title, keyword, i, lang), '<meta property="og:type" content="article">'),
    expectSuccess: true,
    expectedPageType: 'article',
    minLength: lang === 'zh' ? 180 : 320,
    expectedTokens: [keyword.split(' ')[0], title.split(' ')[0]]
  };
}

function makeGenericListingCase(i) {
  const links = Array.from({ length: 18 }, (_, n) => `
    <li><a href="/item-${i}-${n}">Research item ${i}-${n}: browser notes workflow</a>
    <p>Short explanation for item ${n} with enough context for summarization.</p></li>`).join('\n');
  return {
    id: `listing-${i}`,
    group: '通用列表页',
    url: `https://portal.example.test/listing/${i}`,
    html: page(`Listing Case ${i}`, `<main><h1>Listing Case ${i}</h1><ul>${links}</ul></main>`),
    expectSuccess: true,
    expectedPageType: 'listing',
    expectedMethod: 'listing',
    minLength: 500,
    expectedTokens: ['列表/聚合页', 'Research item']
  };
}

function makeSearchCase(i) {
  const results = Array.from({ length: 8 }, (_, n) => `
    <section class="result"><h2><a href="/result-${n}">Search result ${i}-${n} about browser summaries</a></h2>
    <p>This snippet describes search result ${n}, current context, and source details.</p></section>`).join('\n');
  return {
    id: `search-${i}`,
    group: '搜索结果页',
    url: `https://search.example.test/search?q=browser+summary+${i}`,
    html: page(`Search Case ${i}`, `<main>${results}</main>`),
    expectSuccess: true,
    expectedPageType: 'search-results:generic',
    expectedMethod: 'search-results:generic',
    minLength: 450,
    expectedTokens: ['搜索结果页', 'Search result']
  };
}

function makeHackerNewsListingCase(i) {
  const rows = Array.from({ length: 20 }, (_, n) => `
    <tr class="athing" id="${i}${n}">
      <td class="title"><span class="titleline"><a href="https://example.com/story-${n}">HN story ${i}-${n}: local-first browser notes</a></span></td>
    </tr>
    <tr><td class="subtext"><span class="score">${10 + n} points</span> by tester ${n} | <a>${n + 1} comments</a></td></tr>`).join('\n');
  return {
    id: `hn-listing-${i}`,
    group: 'Hacker News 列表',
    url: `https://news.ycombinator.com/${i === 0 ? '' : `news?p=${i}`}`,
    html: page('Hacker News', `<table><tbody>${rows}</tbody></table>`),
    expectSuccess: true,
    expectedPageType: 'listing',
    expectedMethod: 'listing',
    minLength: 650,
    expectedTokens: ['HN story', 'points']
  };
}

function makeForumCase(i) {
  const comments = Array.from({ length: 10 }, (_, n) => `
    <div class="comment"><p>Comment ${n} discusses Dropbox synchronization, user experience, and implementation tradeoffs.</p></div>`).join('\n');
  return {
    id: `forum-${i}`,
    group: '论坛/问答页',
    url: `https://news.ycombinator.com/item?id=${9000 + i}`,
    html: page(`Forum Case ${i}`, `<main><h1>My YC app: Dropbox test ${i}</h1><article><p>The main post introduces Dropbox as a synchronization product.</p>${comments}</article></main>`),
    expectSuccess: true,
    expectedPageType: 'forum-qa',
    minLength: 600,
    expectedTokens: ['Dropbox', 'Comment']
  };
}

function makeProductCase(i, host = 'shop.example.test') {
  const product = i % 2 === 0 ? 'MacBook Air' : `Notebook Pro ${i}`;
  return {
    id: `product-${host}-${i}`,
    group: '商品/营销页',
    url: host.includes('apple') ? 'https://www.apple.com/macbook-air/' : `https://${host}/product/${i}`,
    html: page(`${product} Product Case ${i}`, `
      <main>
        <h1>${product}</h1>
        <video src="/hero.mp4"></video>
        <p>Buy ${product} from $${999 + i}. This product page highlights battery life, memory, storage, price, and performance.</p>
        <p>Configure the product, compare tech specs, and choose monthly payment options.</p>
        <button>Buy</button>
      </main>`,
      '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Notebook"}</script>'
    ),
    expectSuccess: true,
    expectedPageType: 'product',
    minLength: 180,
    expectedTokens: ['Buy', 'battery']
  };
}

function makeVideoCase(i) {
  return {
    id: `video-${i}`,
    group: '视频页',
    url: `https://www.youtube.com/watch?v=test${i}`,
    html: page(`Video Case ${i} - YouTube`, `
      <main>
        <h1>Video Case ${i}: browser note workflow</h1>
        <video src="/watch.mp4" controls></video>
        <p>1,234 views. This video description explains browser note workflows and transcript availability.</p>
        <p>No transcript is available in this generated page, so summaries must use only visible description text.</p>
      </main>`,
      '<meta property="og:type" content="video.other">'
    ),
    expectSuccess: true,
    expectedPageType: 'video',
    minLength: 220,
    expectedWarnings: ['视频/音频页'],
    expectedTokens: ['Video Case', 'transcript']
  };
}

function makeGitHubCase(i) {
  const repo = `codex-fixture-${i}`;
  return {
    id: `github-${i}`,
    group: 'GitHub README',
    url: `https://github.com/openai/${repo}`,
    html: page(`GitHub - openai/${repo}`, `
      <main>
        <span itemprop="about">Lightweight coding agent fixture ${i}</span>
        <div id="readme"><article class="markdown-body">
          <h1>${repo}</h1>
          <p>Codex CLI is a coding agent from OpenAI that runs locally on your computer.</p>
          <p>This README explains installation, usage, configuration, authentication, and troubleshooting.</p>
          <p>Users can run commands, inspect diffs, and manage code changes directly from a terminal workflow.</p>
          <h2>Quickstart</h2>
          <p>Install Codex, open a project, and ask it to read the repository before editing files.</p>
        </article></div>
      </main>`),
    expectSuccess: true,
    expectedPageType: 'article',
    expectedMethod: 'github-readme',
    minLength: 350,
    expectedTokens: ['Codex CLI', 'README']
  };
}

function makeImageHeavyCase(i) {
  return {
    id: `image-heavy-${i}`,
    group: '图片正文页',
    url: `https://image.example.test/story/${i}`,
    html: page(`Image Heavy Case ${i}`, `
      <main>
        <h1>Image Heavy Case ${i}</h1>
        <p>发布时间：2026年06月20日 来源：测试站点 编辑：测试员</p>
        <img src="https://cdn.example.test/long-image-${i}.jpg" width="1000" height="3000" alt="Long article image ${i}">
      </main>`),
    expectSuccess: true,
    expectedPageType: 'unknown',
    minLength: 120,
    expectedWarnings: ['未读取图片文字'],
    expectedTokens: ['图片内容', 'Long article image']
  };
}

function makeLoginCase(i) {
  return {
    id: `login-${i}`,
    group: '登录/验证码页',
    url: `https://secure.example.test/login/${i}`,
    html: page(`Login Case ${i}`, `<main><h1>请先登录</h1><p>安全验证，请输入验证码后继续。</p><input type="password"></main>`),
    expectSuccess: false,
    expectedPageType: 'login',
    expectedError: '登录'
  };
}

function makeErrorCase(i) {
  return {
    id: `error-${i}`,
    group: '错误页',
    url: `https://errors.example.test/404/${i}`,
    html: page(`404 Page Not Found ${i}`, `<main><h1>404 Not Found</h1><p>Page not found. The requested page does not exist.</p></main>`),
    expectSuccess: false,
    expectedPageType: 'error',
    expectedError: '错误页'
  };
}

function makeShortCase(i) {
  return {
    id: `short-${i}`,
    group: '短页面',
    url: `https://short.example.test/${i}`,
    html: page(`Short Case ${i}`, `<main><h1>Short Case ${i}</h1><p>Short documentation example for browser notes.</p></main>`),
    expectSuccess: true,
    expectedPageType: 'unknown',
    minLength: 40,
    expectedWarnings: ['提取内容较短'],
    expectedTokens: ['Short Case']
  };
}

function buildCases() {
  const cases = [];
  for (let i = 1; i <= 10; i++) cases.push(makeArticleCase(i, 'en'));
  for (let i = 1; i <= 10; i++) cases.push(makeArticleCase(i, 'zh'));
  for (let i = 1; i <= 8; i++) cases.push(makeGenericListingCase(i));
  for (let i = 1; i <= 5; i++) cases.push(makeSearchCase(i));
  for (let i = 0; i < 5; i++) cases.push(makeHackerNewsListingCase(i));
  for (let i = 1; i <= 10; i++) cases.push(makeForumCase(i));
  for (let i = 1; i <= 8; i++) cases.push(makeProductCase(i));
  cases.push(makeProductCase(101, 'www.apple.com'), makeProductCase(102, 'www.apple.com'));
  for (let i = 1; i <= 8; i++) cases.push(makeVideoCase(i));
  for (let i = 1; i <= 8; i++) cases.push(makeGitHubCase(i));
  for (let i = 1; i <= 8; i++) cases.push(makeImageHeavyCase(i));
  for (let i = 1; i <= 5; i++) cases.push(makeLoginCase(i));
  for (let i = 1; i <= 3; i++) cases.push(makeErrorCase(i));
  for (let i = 1; i <= 12; i++) cases.push(makeShortCase(i));
  return cases.slice(0, 100);
}

function previewText(text, max = 220) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function scoreCase(testCase, data, summaryResult) {
  const failures = [];
  const warnings = Array.isArray(data?.qualityWarnings) ? data.qualityWarnings : [];

  if (testCase.expectSuccess) {
    if (!data?.success || !data?.content) failures.push(data?.error || 'expected success but got no content');
    if (testCase.expectedPageType && data?.pageType !== testCase.expectedPageType) {
      failures.push(`pageType=${data?.pageType || 'none'}, expected=${testCase.expectedPageType}`);
    }
    if (testCase.expectedMethod && data?.method !== testCase.expectedMethod) {
      failures.push(`method=${data?.method || 'none'}, expected=${testCase.expectedMethod}`);
    }
    if ((data?.content || '').length < (testCase.minLength || 80)) {
      failures.push(`contentLength=${(data?.content || '').length}<${testCase.minLength || 80}`);
    }
    for (const token of testCase.expectedTokens || []) {
      if (!`${data?.title || ''}\n${data?.content || ''}`.toLowerCase().includes(String(token).toLowerCase())) {
        failures.push(`missing token: ${token}`);
      }
    }
    for (const warning of testCase.expectedWarnings || []) {
      if (!warnings.some(item => item.includes(warning))) failures.push(`missing warning: ${warning}`);
    }
    if ((data?.content || '').length >= 100 && !summaryResult?.success) {
      failures.push(`summary failed: ${summaryResult?.error || 'unknown'}`);
    }
  } else {
    if (data?.success) failures.push('expected failure but extraction succeeded');
    if (testCase.expectedPageType && data?.pageType !== testCase.expectedPageType) {
      failures.push(`pageType=${data?.pageType || 'none'}, expected=${testCase.expectedPageType}`);
    }
    if (testCase.expectedError && !String(data?.error || '').includes(testCase.expectedError)) {
      failures.push(`error missing: ${testCase.expectedError}`);
    }
  }

  return failures;
}

async function navigate(client, url, timeoutMs = 25000) {
  const loadPromise = client.once('Page.loadEventFired', timeoutMs).catch(() => null);
  await client.send('Page.navigate', { url }, timeoutMs);
  await loadPromise;
  await waitFor(async () => {
    const ready = await client.eval('document.readyState', 5000).catch(() => '');
    return ready === 'interactive' || ready === 'complete';
  }, 8000).catch(() => null);
  await sleep(120);
}

function writeReports(results) {
  const report = {
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    extractionSuccess: results.filter(r => r.extractionSuccess).length,
    expectedFailures: results.filter(r => !r.expectSuccess && r.passed).length,
    summaryPassed: results.filter(r => r.summaryChecked && r.summarySuccess).length,
    groups: {}
  };

  for (const result of results) {
    if (!report.groups[result.group]) {
      report.groups[result.group] = { total: 0, passed: 0, failed: 0 };
    }
    report.groups[result.group].total += 1;
    if (result.passed) report.groups[result.group].passed += 1;
    else report.groups[result.group].failed += 1;
  }

  const payload = { ...report, results };
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(payload, null, 2), 'utf8');

  const md = [
    '# 100 用例回归测试结果',
    '',
    `生成时间：${report.generatedAt}`,
    '',
    `总数：${report.total}；通过：${report.passed}；失败：${report.failed}`,
    '',
    '| 分组 | 总数 | 通过 | 失败 |',
    '|---|---:|---:|---:|'
  ];
  Object.entries(report.groups).forEach(([group, stats]) => {
    md.push(`| ${group} | ${stats.total} | ${stats.passed} | ${stats.failed} |`);
  });

  md.push('', '## 失败用例');
  const failed = results.filter(r => !r.passed);
  if (failed.length === 0) {
    md.push('无。');
  } else {
    for (const item of failed) {
      md.push(
        '',
        `### ${item.id}`,
        `- 分组: ${item.group}`,
        `- URL: ${item.url}`,
        `- 类型/方法: ${item.pageType || '-'} / ${item.method || '-'}`,
        `- 失败原因: ${item.failures.join('；')}`,
        `- 预览: ${item.contentPreview || item.error || ''}`,
        item.screenshot ? `- 截图: ${item.screenshot}` : ''
      );
    }
  }

  md.push('', '## 全量明细');
  md.push('| # | 用例 | 分组 | 通过 | 类型 | 方法 | 字数 | 摘要 | 问题 |');
  md.push('|---:|---|---|---|---|---|---:|---|---|');
  results.forEach((item, index) => {
    md.push(`| ${index + 1} | ${item.id} | ${item.group} | ${item.passed ? '是' : '否'} | ${item.pageType || '-'} | ${item.method || '-'} | ${item.contentLength || 0} | ${item.summaryChecked ? (item.summarySuccess ? '通过' : '失败') : '-'} | ${item.failures.join('；') || '无'} |`);
  });

  fs.writeFileSync(path.join(outDir, 'results.md'), md.join('\n'), 'utf8');
  return report;
}

async function main() {
  const testCases = buildCases();
  if (testCases.length !== 100) throw new Error(`Expected 100 cases, got ${testCases.length}`);

  const chrome = await startChrome();
  const clients = [];
  let currentCase = null;
  const htmlByUrl = new Map(testCases.map(item => [item.url, item.html]));

  try {
    const target = await createTarget(chrome.port, 'about:blank');
    const client = new CDP(target.webSocketDebuggerUrl);
    clients.push(client);
    await client.connect();
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });

    client.on('Fetch.requestPaused', async params => {
      try {
        if (params.resourceType === 'Document') {
          const html = htmlByUrl.get(params.request.url) || currentCase?.html || page('not found', '<main>not found</main>');
          await client.send('Fetch.fulfillRequest', {
            requestId: params.requestId,
            responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
            body: Buffer.from(html, 'utf8').toString('base64')
          });
        } else {
          await client.send('Fetch.fulfillRequest', {
            requestId: params.requestId,
            responseCode: 204,
            body: ''
          }).catch(() => null);
        }
      } catch (err) {
        await client.send('Fetch.continueRequest', { requestId: params.requestId }).catch(() => null);
      }
    });

    const readability = fs.readFileSync(path.join(root, 'content', 'readability.js'), 'utf8');
    const extractor = fs.readFileSync(path.join(root, 'content', 'content-extract.js'), 'utf8');
    const { generateSummary } = await import(pathToFileURL(path.join(root, 'lib', 'summarizer.js')).href);
    const results = [];

    for (let i = 0; i < testCases.length; i++) {
      currentCase = testCases[i];
      const started = Date.now();
      const row = {
        index: i + 1,
        id: currentCase.id,
        group: currentCase.group,
        url: currentCase.url,
        expectSuccess: currentCase.expectSuccess,
        passed: false,
        failures: []
      };
      try {
        await navigate(client, currentCase.url);
        await client.eval(`(() => {
          delete window.__contentExtractInitialized;
          delete window.__contentExtractListener;
          window.chrome = {};
          window.chrome.runtime = { onMessage: { addListener(fn) { window.__contentExtractListener = fn; } } };
          return true;
        })()`, 5000);
        await client.eval(`${readability}\n//# sourceURL=readability-100.js`, 15000);
        await client.eval(`${extractor}\n//# sourceURL=content-extract-100.js`, 15000);
        const response = await client.eval(`new Promise(resolve => {
          const listener = window.__contentExtractListener;
          if (!listener) { resolve({ success: false, error: 'listener not registered' }); return; }
          const timer = setTimeout(() => resolve({ success: false, error: 'extract timeout' }), 10000);
          try {
            listener({ action: 'extractPage' }, {}, (resp) => { clearTimeout(timer); resolve(resp); });
          } catch (err) {
            clearTimeout(timer);
            resolve({ success: false, error: err && err.message || String(err) });
          }
        })`, 15000);

        const data = response?.data || response || {};
        let summaryResult = null;
        if (data.success && data.content && data.content.length >= 100) {
          summaryResult = await generateSummary(
            { enabled: false, length: 'medium' },
            data.title || currentCase.id,
            data.content,
            { mode: 'tfidf', length: 'medium', pageType: data.pageType || 'unknown' }
          );
        }

        row.extractionSuccess = !!(data.success && data.content);
        row.title = data.title || '';
        row.pageType = data.pageType || '';
        row.method = data.method || '';
        row.contentLength = (data.content || '').length;
        row.contentPreview = previewText(data.content || '');
        row.error = data.error || response?.error || '';
        row.warnings = Array.isArray(data.qualityWarnings) ? data.qualityWarnings : [];
        row.summaryChecked = !!summaryResult;
        row.summarySuccess = summaryResult ? !!summaryResult.success : false;
        row.summaryMethod = summaryResult?.method || '';
        row.summaryPreview = previewText(summaryResult?.summary || '', 180);
        row.failures = scoreCase(currentCase, data, summaryResult);
        row.passed = row.failures.length === 0;
      } catch (err) {
        row.failures = [err.message || String(err)];
      }

      row.elapsedMs = Date.now() - started;
      if (!row.passed) {
        try {
          const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, 15000);
          const shotPath = path.join(screenshotDir, `${String(i + 1).padStart(3, '0')}-${row.id}.png`);
          fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
          row.screenshot = shotPath;
        } catch {}
      }
      results.push(row);
      if ((i + 1) % 10 === 0) console.log(`Completed ${i + 1}/100`);
    }

    const report = writeReports(results);
    console.log(JSON.stringify({
      total: report.total,
      passed: report.passed,
      failed: report.failed,
      extractionSuccess: report.extractionSuccess,
      expectedFailures: report.expectedFailures,
      summaryPassed: report.summaryPassed,
      artifacts: {
        resultsJson: path.join(outDir, 'results.json'),
        resultsMd: path.join(outDir, 'results.md'),
        failureScreenshots: screenshotDir
      },
      failedCases: results.filter(r => !r.passed).map(r => ({
        id: r.id,
        group: r.group,
        failures: r.failures,
        pageType: r.pageType,
        method: r.method,
        contentLength: r.contentLength
      }))
    }, null, 2));
  } finally {
    clients.forEach(client => client.close());
    await chrome.stop();
    const base = outDir;
    for (const target of fs.readdirSync(base).filter(name => /^tmp-chrome-100-/.test(name))) {
      fs.rmSync(path.join(base, target), { recursive: true, force: true });
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
