const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const outDir = __dirname;
const screenshotDir = path.join(outDir, 'screenshots');
fs.mkdirSync(screenshotDir, { recursive: true });

const pages = [
  {
    name: 'MDN Fetch API 文档',
    category: '长技术文档',
    url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch',
    userTask: '用户想保存一篇长英文开发文档并稍后总结',
    expect: ['Fetch', 'request'],
    minLen: 1200
  },
  {
    name: '共产党员网图片文章',
    category: '中文图片型正文',
    url: 'https://www.12371.cn/2026/06/15/ARTI1781514058487480.shtml',
    userTask: '用户想保存一篇正文主要在长图里的中文文章',
    expect: ['习近平', '党建思想'],
    minLen: 160,
    allowImageOnly: true
  },
  {
    name: 'Wikipedia Readability',
    category: '百科长文',
    url: 'https://en.wikipedia.org/wiki/Readability',
    userTask: '用户想保存百科条目，避免导航和目录污染正文',
    expect: ['Readability', 'reader'],
    minLen: 1200
  },
  {
    name: 'Example.com',
    category: '短网页',
    url: 'https://example.com/',
    userTask: '用户误点或保存很短页面时，应收到合理反馈',
    expect: ['Example Domain'],
    minLen: 80,
    shortPage: true
  },
  {
    name: 'Hacker News 首页',
    category: '列表/聚合页',
    url: 'https://news.ycombinator.com/',
    userTask: '用户想保存当天资讯列表，应知道摘要只基于列表条目',
    expect: ['Hacker News'],
    minLen: 300,
    expectedPageType: 'listing'
  },
  {
    name: 'Hacker News Dropbox 讨论',
    category: '论坛/评论页',
    url: 'https://news.ycombinator.com/item?id=8863',
    userTask: '用户想保存一串讨论和评论观点',
    expect: ['Dropbox', 'Comments'],
    minLen: 1200,
    expectedPageType: 'forum-qa'
  },
  {
    name: 'GitHub OpenAI Codex 仓库',
    category: '项目/README 页',
    url: 'https://github.com/openai/codex',
    userTask: '用户想保存一个项目页的 README 和关键信息',
    expect: ['Codex', 'OpenAI'],
    minLen: 600
  },
  {
    name: 'YouTube 视频页',
    category: '视频页',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    userTask: '用户想总结视频页，应明确没有字幕时只能总结页面可见信息',
    expect: ['YouTube'],
    minLen: 120,
    expectedPageType: 'video',
    allowPartial: true
  },
  {
    name: 'Apple MacBook Air 产品页',
    category: '商品/营销页',
    url: 'https://www.apple.com/macbook-air/',
    userTask: '用户想保存商品卖点，正文不应只剩导航或促销按钮',
    expect: ['MacBook Air', 'Apple'],
    minLen: 600,
    expectedPageType: 'product'
  },
  {
    name: '阮一峰周刊文章',
    category: '受限/反爬页面',
    url: 'https://www.ruanyifeng.com/blog/2024/06/weekly-issue-306.html',
    userTask: '用户遇到防护页时，应得到可理解、可行动的提示',
    expect: ['科技爱好者', '周刊'],
    minLen: 600,
    allowFailure: true
  }
];

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
  const profileDir = path.join(outDir, `tmp-chrome-ux-${Date.now()}`);
  fs.mkdirSync(profileDir, { recursive: true });

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--window-size=1280,900',
    'about:blank'
  ];

  const proc = spawn(findChrome(), args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });

  let stderr = '';
  proc.stderr.on('data', chunk => {
    stderr += String(chunk);
  });

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

  once(method, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const handler = (params) => {
        clearTimeout(timer);
        this.events.get(method)?.delete(handler);
        resolve(params);
      };
      const timer = setTimeout(() => {
        this.events.get(method)?.delete(handler);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      if (!this.events.has(method)) this.events.set(method, new Set());
      this.events.get(method).add(handler);
    });
  }

  async eval(expression, timeoutMs = 30000) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    }, timeoutMs);
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Runtime exception');
    }
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

async function navigate(client, url, timeoutMs = 45000) {
  const loadPromise = client.once('Page.loadEventFired', timeoutMs).catch(() => null);
  await client.send('Page.navigate', { url }, timeoutMs);
  await loadPromise;
  await waitFor(async () => {
    const ready = await client.eval('document.readyState', 5000).catch(() => '');
    return ready === 'interactive' || ready === 'complete';
  }, 10000).catch(() => null);
  await sleep(2200);
}

function previewText(text, max = 260) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function includesExpected(content, page) {
  const haystack = String(content || '').toLowerCase();
  return (page.expect || []).filter(token => haystack.includes(String(token).toLowerCase()));
}

function scoreExtraction(data, page) {
  if (!data || !data.success || !data.content) {
    return {
      status: page.allowFailure ? 'expected-failure' : 'failed',
      okForUx: !!page.allowFailure,
      reason: data?.error || 'no content',
      expectHits: []
    };
  }

  const content = `${data.title || ''}\n${data.content || ''}`;
  const len = (data.content || '').trim().length;
  const expectHits = includesExpected(content, page);
  const hasImageInfo = /图片内容/.test(data.content || '');
  const warnings = Array.isArray(data.qualityWarnings) ? data.qualityWarnings : [];
  const expectedTypeOk = !page.expectedPageType ||
    data.pageType === page.expectedPageType ||
    (page.expectedPageType === 'listing' && String(data.pageType || '').startsWith('search-results'));
  const enoughText = len >= (page.minLen || 300) || (page.allowImageOnly && len >= 150 && hasImageInfo);
  const foundExpected = expectHits.length >= Math.min(1, (page.expect || []).length);
  const noisy = /cookie|sign in|登录|注册|subscribe|advertisement/i.test((data.content || '').slice(0, 1200)) &&
    !warnings.some(w => /导航|控件|重复|登录|验证码/.test(w));

  if (enoughText && foundExpected && expectedTypeOk && !noisy) {
    const reason = hasImageInfo && len < (page.minLen || 300) ? 'usable:image-only-metadata' : 'usable';
    return { status: warnings.length ? 'usable-with-warning' : 'usable', okForUx: true, reason, expectHits };
  }

  const parts = [];
  if (!enoughText) parts.push(`contentLen=${len}<${page.minLen || 300}`);
  if (!foundExpected) parts.push('expected-token-missing');
  if (!expectedTypeOk) parts.push(`pageType=${data.pageType || 'unknown'}, expected=${page.expectedPageType}`);
  if (noisy) parts.push('possible-boilerplate-or-gate-text');

  return {
    status: page.allowPartial ? 'partial' : 'problem',
    okForUx: !!page.allowPartial,
    reason: parts.join('; ') || 'partial extraction',
    expectHits
  };
}

async function startSidepanelServer(extractedResults) {
  const html = fs.readFileSync(path.join(root, 'sidepanel', 'sidepanel.html'), 'utf8');
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png'
  };

  const server = http.createServer((req, res) => {
    try {
      const parsed = new URL(req.url, 'http://127.0.0.1');
      if (parsed.pathname === '/sidepanel/sidepanel.html') {
        const idx = Number(parsed.searchParams.get('idx') || 0);
        const item = extractedResults[idx];
        const payload = {
          tab: { id: 1200 + idx, url: item.url, title: item.actualTitle || item.name },
          extractResponse: item.rawSuccess ? {
            success: true,
            data: {
              title: item.actualTitle || item.name,
              content: String(item.content || ''),
              url: item.actualUrl || item.url,
              sourceTitle: item.actualTitle || item.name,
              excerpt: item.excerpt || '',
              method: item.method || '',
              pageType: item.pageType || '',
              confidence: item.confidence ?? null,
              reason: item.classifyReason || '',
              qualityWarnings: item.qualityWarnings || []
            }
          } : {
            success: false,
            code: item.errorCode || 'NO_CONTENT',
            error: item.error || '提取失败'
          }
        };
        const json = JSON.stringify(payload).replace(/<\//g, '<\\/');
        const mock = `<script>
(() => {
  const payload = ${json};
  window.__messages = [];
  window.__store = { notes: [], categories: [], settings: {}, metadata: {} };
  window.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) return Object.fromEntries(keys.map(k => [k, window.__store[k]]));
          if (typeof keys === 'string') return { [keys]: window.__store[keys] };
          return { ...window.__store };
        },
        async set(obj) { Object.assign(window.__store, obj); }
      },
      session: { async get() { return {}; }, async set() {}, async remove() {} }
    },
    runtime: {
      async sendMessage(message) {
        window.__messages.push(message);
        if (message.action === 'getActiveTab') return { success: true, data: payload.tab };
        if (message.action === 'extractPage') return payload.extractResponse;
        if (message.action === 'summarize') return { success: true, summary: '测试摘要', method: 'llm' };
        return { success: false, error: 'unknown action ' + message.action };
      }
    },
    tabs: { async query() { return [payload.tab]; } }
  };
})();
</script>`;
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html.replace('</head>', mock + '\n</head>'));
        return;
      }

      const rel = decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'sidepanel/sidepanel.html';
      const full = path.normalize(path.join(root, rel));
      if (!full.startsWith(root)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      fs.readFile(full, (err, buf) => {
        if (err) {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        res.writeHead(200, { 'content-type': mime[path.extname(full)] || 'application/octet-stream' });
        res.end(buf);
      });
    } catch (err) {
      res.writeHead(500);
      res.end(String(err.message || err));
    }
  });

  const port = await findFreePort();
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { server, port };
}

async function extractFromPage(client, page, readability, extractor) {
  const started = Date.now();
  await navigate(client, page.url, 65000);
  const actualUrl = await client.eval('location.href', 5000).catch(() => page.url);
  const docTitle = await client.eval('document.title', 5000).catch(() => '');
  const bodySample = await client.eval('document.body ? document.body.innerText.slice(0, 500) : ""', 5000).catch(() => '');

  await client.eval(`(() => {
    delete window.__contentExtractInitialized;
    delete window.__contentExtractListener;
    window.chrome = {};
    window.chrome.runtime = { onMessage: { addListener(fn) { window.__contentExtractListener = fn; } } };
    return true;
  })()`, 5000);
  await client.eval(`${readability}\n//# sourceURL=readability-ux-test.js`, 15000);
  await client.eval(`${extractor}\n//# sourceURL=content-extract-ux-test.js`, 15000);
  const response = await client.eval(`new Promise(resolve => {
    const listener = window.__contentExtractListener;
    if (!listener) { resolve({ success: false, error: 'listener not registered' }); return; }
    const timer = setTimeout(() => resolve({ success: false, error: 'extract timeout' }), 15000);
    try {
      listener({ action: 'extractPage' }, {}, (resp) => { clearTimeout(timer); resolve(resp); });
    } catch (err) {
      clearTimeout(timer);
      resolve({ success: false, error: err && err.message || String(err) });
    }
  })`, 22000);

  const data = response && response.data ? response.data : response;
  const score = scoreExtraction(data, page);
  return {
    name: page.name,
    category: page.category,
    userTask: page.userTask,
    url: page.url,
    actualUrl,
    docTitle,
    bodySample: previewText(bodySample, 180),
    rawSuccess: !!(data && data.success && data.content),
    uxStatus: score.status,
    okForUx: score.okForUx,
    extractionReason: score.reason,
    expectHits: score.expectHits,
    actualTitle: data?.title || docTitle || page.name,
    method: data?.method || '',
    pageType: data?.pageType || '',
    confidence: typeof data?.confidence === 'number' ? data.confidence : null,
    classifyReason: data?.reason || '',
    qualityWarnings: Array.isArray(data?.qualityWarnings) ? data.qualityWarnings : [],
    contentLength: (data?.content || '').length,
    excerpt: data?.excerpt || previewText(data?.content || '', 200),
    contentPreview: previewText(data?.content || '', 320),
    content: data?.content || '',
    error: data?.error || response?.error || '',
    errorCode: response?.code || '',
    extractionMs: Date.now() - started
  };
}

async function runSidepanelDisplayTest(port, ui, result, index) {
  await navigate(ui, `http://127.0.0.1:${port}/sidepanel/sidepanel.html?idx=${index}`, 30000);
  await sleep(900);
  await ui.eval('document.querySelector("#extractPageBtn")?.click(); true', 5000);
  await sleep(1000);
  const uiState = await ui.eval(`(() => {
    const warning = ${JSON.stringify((result.qualityWarnings || [])[0] || '')};
    const actionRow = document.querySelector('.action-row');
    const toolbar = document.querySelector('#toolbar');
    const bodyText = document.body.textContent || '';
    return {
      statusTitle: document.querySelector('#pageStatusTitle')?.textContent || '',
      statusDetail: document.querySelector('#pageStatusDetail')?.textContent || '',
      editorOpen: !document.querySelector('#editorPanel')?.classList.contains('hidden'),
      noteTitle: document.querySelector('#noteTitle')?.value || '',
      noteContentLength: (document.querySelector('#noteContent')?.value || '').length,
      noteContentPreview: (document.querySelector('#noteContent')?.value || '').replace(/\\s+/g, ' ').trim().slice(0, 220),
      hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      actionRowOverflows: actionRow ? actionRow.scrollWidth > actionRow.clientWidth : false,
      toolbarOverflows: toolbar ? toolbar.scrollWidth > toolbar.clientWidth : false,
      warningVisible: !!warning && bodyText.includes(warning),
      bodyTextPreview: bodyText.replace(/\\s+/g, ' ').trim().slice(0, 260),
      messages: window.__messages || []
    };
  })()`, 10000);
  result.display = uiState;
  result.displaySuccess = result.rawSuccess ?
    uiState.editorOpen && ['已提取当前页面内容', '已提取部分页面内容'].includes(uiState.statusTitle) && uiState.noteContentLength > 20 :
    !uiState.editorOpen && uiState.statusTitle === '提取失败';

  const shot = await ui.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, 15000);
  const shotPath = path.join(screenshotDir, `${String(index + 1).padStart(2, '0')}-sidepanel.png`);
  fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
  result.screenshot = shotPath;
}

function writeReports(results) {
  const publicResults = results.map(({ content, ...r }, idx) => ({ index: idx + 1, ...r }));
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(publicResults, null, 2), 'utf8');

  const md = [
    '# UX 十网页提取测试结果',
    '',
    `生成时间：${new Date().toISOString()}`,
    '',
    '| # | 网页 | 场景 | UX 状态 | 显示 | 类型 | 字数 | 方法 | 说明 |',
    '|---|---|---|---|---|---|---:|---|---|'
  ];

  for (const r of publicResults) {
    const title = String(r.actualTitle || r.name || '').replace(/\|/g, '\\|').slice(0, 80);
    const reason = String(r.extractionReason || r.error || '').replace(/\|/g, '\\|').slice(0, 120);
    md.push(`| ${r.index} | [${r.name}](${r.url}) | ${r.category} | ${r.uxStatus} | ${r.displaySuccess ? '通过' : '失败'} | ${r.pageType || '-'} | ${r.contentLength || 0} | ${r.method || '-'} | ${title}: ${reason} |`);
  }

  md.push('', '## 逐页观察');
  for (const r of publicResults) {
    md.push(
      '',
      `### ${r.index}. ${r.name}`,
      `- 用户场景: ${r.userTask}`,
      `- URL: ${r.url}`,
      `- 状态: ${r.uxStatus}; sidepanel 显示 ${r.displaySuccess ? '通过' : '失败'}`,
      `- 标题: ${r.actualTitle || ''}`,
      `- 类型/方法: ${r.pageType || '-'} / ${r.method || '-'}`,
      `- 字数: ${r.contentLength || 0}`,
      `- 质量提示: ${(r.qualityWarnings || []).join('；') || '无'}`,
      `- 预览: ${r.contentPreview || r.error || ''}`,
      `- 截图: ${r.screenshot || ''}`
    );
  }

  md.push('', '## 截图索引');
  for (const r of publicResults) {
    if (r.screenshot) {
      const rel = path.relative(outDir, r.screenshot).replace(/\\/g, '/');
      md.push(`- ${r.index}. ${r.name}: ![](${rel})`);
    }
  }

  fs.writeFileSync(path.join(outDir, 'results.md'), md.join('\n'), 'utf8');

  const sheet = [
    '<!doctype html><meta charset="utf-8"><title>UX test screenshots</title>',
    '<style>body{font-family:system-ui,sans-serif;margin:24px;background:#f6f7f9;color:#111} .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px} figure{margin:0;background:white;border:1px solid #ddd;border-radius:8px;padding:10px} img{width:100%;height:auto;border:1px solid #eee} figcaption{font-size:13px;margin-top:8px;line-height:1.4}</style>',
    '<h1>UX 十网页测试截图</h1><div class="grid">'
  ];
  for (const r of publicResults) {
    if (!r.screenshot) continue;
    const rel = path.relative(outDir, r.screenshot).replace(/\\/g, '/');
    sheet.push(`<figure><img src="${rel}" alt=""><figcaption>${r.index}. ${r.name}<br>${r.uxStatus} / ${r.pageType || '-'}</figcaption></figure>`);
  }
  sheet.push('</div>');
  fs.writeFileSync(path.join(outDir, 'contact-sheet.html'), sheet.join('\n'), 'utf8');

  return publicResults;
}

async function main() {
  const chrome = await startChrome();
  const clients = [];
  let sideServer = null;

  try {
    const target = await createTarget(chrome.port, 'about:blank');
    const client = new CDP(target.webSocketDebuggerUrl);
    clients.push(client);
    await client.connect();
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');
    await client.send('Page.setBypassCSP', { enabled: true }).catch(() => null);

    const readability = fs.readFileSync(path.join(root, 'content', 'readability.js'), 'utf8');
    const extractor = fs.readFileSync(path.join(root, 'content', 'content-extract.js'), 'utf8');
    const results = [];

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const started = Date.now();
      const rowBase = {
        name: page.name,
        category: page.category,
        userTask: page.userTask,
        url: page.url,
        rawSuccess: false,
        uxStatus: 'failed',
        okForUx: false,
        displaySuccess: false
      };
      try {
        console.log(`TEST ${i + 1}/10 ${page.name}`);
        const row = await extractFromPage(client, page, readability, extractor);
        results.push(row);
      } catch (err) {
        results.push({
          ...rowBase,
          error: err.message || String(err),
          extractionReason: err.message || String(err),
          extractionMs: Date.now() - started
        });
      }
    }

    sideServer = await startSidepanelServer(results);
    const uiTarget = await createTarget(chrome.port, 'about:blank');
    const ui = new CDP(uiTarget.webSocketDebuggerUrl);
    clients.push(ui);
    await ui.connect();
    await ui.send('Page.enable');
    await ui.send('Runtime.enable');
    await ui.send('Emulation.setDeviceMetricsOverride', {
      width: 420,
      height: 760,
      deviceScaleFactor: 1,
      mobile: false
    });

    for (let i = 0; i < results.length; i++) {
      try {
        await runSidepanelDisplayTest(sideServer.port, ui, results[i], i);
      } catch (err) {
        results[i].displayError = err.message || String(err);
      }
    }

    const publicResults = writeReports(results);
    const summary = {
      total: publicResults.length,
      usable: publicResults.filter(r => r.okForUx).length,
      rawSuccess: publicResults.filter(r => r.rawSuccess).length,
      displaySuccess: publicResults.filter(r => r.displaySuccess).length,
      artifacts: {
        resultsJson: path.join(outDir, 'results.json'),
        resultsMd: path.join(outDir, 'results.md'),
        contactSheet: path.join(outDir, 'contact-sheet.html'),
        screenshotDir
      },
      results: publicResults.map(r => ({
        index: r.index,
        name: r.name,
        uxStatus: r.uxStatus,
        displaySuccess: r.displaySuccess,
        pageType: r.pageType,
        method: r.method,
        contentLength: r.contentLength,
        reason: r.extractionReason || r.error,
        warnings: r.qualityWarnings,
        screenshot: r.screenshot
      }))
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (sideServer) sideServer.server.close();
    clients.forEach(client => client.close());
    await chrome.stop();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
