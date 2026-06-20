const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');

const root = path.resolve(__dirname, '..', '..');
const cdpPort = Number(process.env.CDP_PORT || 9335);
const outDir = __dirname;
const screenshotDir = path.join(outDir, 'screenshots');
fs.mkdirSync(screenshotDir, { recursive: true });

const pages = [
  { name: '共产党员网文章', url: 'https://www.12371.cn/2026/06/15/ARTI1781514058487480.shtml', expect: ['习近平', '党建思想'] },
  { name: 'Chrome Extensions Docs', url: 'https://developer.chrome.com/docs/extensions/get-started', expect: ['extension', 'Chrome'] },
  { name: 'MDN Fetch API', url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch', expect: ['Fetch', 'request'] },
  { name: 'web.dev Article', url: 'https://web.dev/articles/critical-rendering-path/render-tree-construction', expect: ['render tree', 'CSSOM'] },
  { name: 'Wikipedia Readability', url: 'https://en.wikipedia.org/wiki/Readability', expect: ['Readability', 'reader'] },
  { name: 'RFC 9110', url: 'https://www.rfc-editor.org/rfc/rfc9110.html', expect: ['HTTP', 'Semantics'] },
  { name: 'Python Tutorial', url: 'https://docs.python.org/3/tutorial/introduction.html', expect: ['Python', 'interpreter'] },
  { name: 'Node.js Intro', url: 'https://nodejs.org/en/learn/getting-started/introduction-to-nodejs', expect: ['Node.js', 'JavaScript'] },
  { name: '阮一峰周刊', url: 'https://www.ruanyifeng.com/blog/2024/06/weekly-issue-306.html', expect: ['科技爱好者', '周刊'] },
  { name: 'Hacker News Item', url: 'https://news.ycombinator.com/item?id=8863', expect: ['Y Combinator', 'Comments'] }
];

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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

async function createTarget(url = 'about:blank') {
  let resp = await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!resp.ok) resp = await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(url)}`);
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
  await sleep(1800);
}

function previewText(text, max = 220) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function scoreExtraction(data, page) {
  if (!data || !data.success || !data.content) {
    return { ok: false, reason: data?.error || 'no content', expectHits: [] };
  }
  const content = `${data.title || ''}\n${data.content || ''}`;
  const len = (data.content || '').trim().length;
  const expectHits = (page.expect || []).filter(token => content.toLowerCase().includes(token.toLowerCase()));
  const hasImageInfo = /图片内容/.test(data.content || '');
  const ok = (len >= 300 || (len >= 180 && hasImageInfo)) &&
    expectHits.length >= Math.min(1, (page.expect || []).length);
  const reason = ok ? (hasImageInfo && len < 300 ? 'ok:image-only-content' : 'ok') :
    `contentLen=${len}, expectHits=${expectHits.length}`;
  return { ok, reason, expectHits };
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
          tab: { id: 900 + idx, url: item.url, title: item.actualTitle || item.name },
          extractResponse: item.extractionSuccess ? {
            success: true,
            data: {
              title: item.actualTitle || item.name,
              content: String(item.content || '').slice(0, 12000),
              url: item.url,
              sourceTitle: item.actualTitle || item.name,
              excerpt: item.excerpt || ''
            }
          } : {
            success: false,
            code: 'NO_CONTENT',
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

async function main() {
  await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null);
    return r && r.ok;
  }, 10000);

  const target = await createTarget('about:blank');
  const client = new CDP(target.webSocketDebuggerUrl);
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
    const row = {
      index: i + 1,
      name: page.name,
      url: page.url,
      extractionSuccess: false,
      displaySuccess: false
    };
    try {
      console.log(`TEST ${i + 1}/10 ${page.name}`);
      await navigate(client, page.url, 60000);
      const actualUrl = await client.eval('location.href', 5000).catch(() => page.url);
      const docTitle = await client.eval('document.title', 5000).catch(() => '');
      await client.eval(`(() => {
        delete window.__contentExtractInitialized;
        delete window.__contentExtractListener;
        window.chrome = {};
        window.chrome.runtime = { onMessage: { addListener(fn) { window.__contentExtractListener = fn; } } };
        return true;
      })()`, 5000);
      await client.eval(`${readability}\n//# sourceURL=readability-test.js`, 15000);
      await client.eval(`${extractor}\n//# sourceURL=content-extract-test.js`, 15000);
      const response = await client.eval(`new Promise(resolve => {
        const listener = window.__contentExtractListener;
        if (!listener) { resolve({ success: false, error: 'listener not registered' }); return; }
        const timer = setTimeout(() => resolve({ success: false, error: 'extract timeout' }), 12000);
        try {
          listener({ action: 'extractPage' }, {}, (resp) => { clearTimeout(timer); resolve(resp); });
        } catch (err) {
          clearTimeout(timer);
          resolve({ success: false, error: err && err.message || String(err) });
        }
      })`, 20000);
      const data = response && response.data ? response.data : response;
      const score = scoreExtraction(data, page);

      row.actualUrl = actualUrl;
      row.docTitle = docTitle;
      row.actualTitle = data?.title || docTitle || page.name;
      row.method = data?.method || '';
      row.contentLength = (data?.content || '').length;
      row.excerpt = data?.excerpt || previewText(data?.content || '', 200);
      row.contentPreview = previewText(data?.content || '', 260);
      row.content = data?.content || '';
      row.containsImageInfo = /图片内容/.test(data?.content || '');
      row.extractionSuccess = !!score.ok;
      row.extractionReason = score.reason;
      row.expectHits = score.expectHits || [];
      row.error = data?.error || response?.error || '';
    } catch (err) {
      row.error = err.message || String(err);
      row.extractionReason = row.error;
    }
    results.push(row);
  }

  const sideServer = await startSidepanelServer(results);
  const uiTarget = await createTarget('about:blank');
  const ui = new CDP(uiTarget.webSocketDebuggerUrl);
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
    const row = results[i];
    try {
      await navigate(ui, `http://127.0.0.1:${sideServer.port}/sidepanel/sidepanel.html?idx=${i}`, 30000);
      await sleep(900);
      await ui.eval('document.querySelector("#extractPageBtn")?.click(); true', 5000);
      await sleep(1000);
      const uiState = await ui.eval(`(() => ({
        statusTitle: document.querySelector('#pageStatusTitle')?.textContent || '',
        statusDetail: document.querySelector('#pageStatusDetail')?.textContent || '',
        editorOpen: !document.querySelector('#editorPanel')?.classList.contains('hidden'),
        noteTitle: document.querySelector('#noteTitle')?.value || '',
        noteContentLength: (document.querySelector('#noteContent')?.value || '').length,
        noteContentPreview: (document.querySelector('#noteContent')?.value || '').replace(/\\s+/g, ' ').trim().slice(0, 180),
        messages: window.__messages || []
      }))()`, 10000);
      row.display = uiState;
      row.displaySuccess = row.extractionSuccess &&
        uiState.editorOpen &&
        uiState.statusTitle === '已提取当前页面内容' &&
        uiState.noteContentLength > 20;
      if (row.displaySuccess) {
        const shot = await ui.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, 15000);
        const shotPath = path.join(screenshotDir, `${String(i + 1).padStart(2, '0')}-sidepanel.png`);
        fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
        row.screenshot = shotPath;
      }
    } catch (err) {
      row.displayError = err.message || String(err);
    }
  }

  sideServer.server.close();
  client.close();
  ui.close();

  const publicResults = results.map(({ content, ...r }) => r);
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(publicResults, null, 2), 'utf8');

  const md = [
    '# 十个网页提取与显示测试结果',
    '',
    `生成时间：${new Date().toISOString()}`,
    '',
    '| # | 网页 | 提取 | 显示 | 标题 | 字数 | 方法 | 说明 |',
    '|---|---|---|---|---|---:|---|---|'
  ];
  for (const r of publicResults) {
    const title = String(r.actualTitle || '').replace(/\|/g, '\\|').slice(0, 80);
    const reason = String(r.extractionReason || r.error || '').replace(/\|/g, '\\|').slice(0, 120);
    md.push(`| ${r.index} | [${r.name}](${r.url}) | ${r.extractionSuccess ? '通过' : '失败'} | ${r.displaySuccess ? '通过' : '失败'} | ${title} | ${r.contentLength || 0} | ${r.method || ''} | ${reason} |`);
  }
  md.push('', '## 内容预览');
  for (const r of publicResults) {
    md.push(
      `\n### ${r.index}. ${r.name}`,
      `- URL: ${r.url}`,
      `- 状态: 提取 ${r.extractionSuccess ? '通过' : '失败'}，显示 ${r.displaySuccess ? '通过' : '失败'}`,
      `- 标题: ${r.actualTitle || ''}`,
      `- 预览: ${r.contentPreview || r.error || ''}`
    );
    if (r.screenshot) md.push(`- 截图: ${r.screenshot}`);
  }
  fs.writeFileSync(path.join(outDir, 'results.md'), md.join('\n'), 'utf8');

  const passedExtraction = results.filter(r => r.extractionSuccess).length;
  const passedDisplay = results.filter(r => r.displaySuccess).length;
  const ok = passedExtraction === pages.length && passedDisplay === pages.length;
  console.log(JSON.stringify({
    ok,
    passedExtraction,
    passedDisplay,
    total: pages.length,
    results: publicResults.map(r => ({
      index: r.index,
      name: r.name,
      url: r.url,
      extractionSuccess: r.extractionSuccess,
      displaySuccess: r.displaySuccess,
      actualTitle: r.actualTitle,
      contentLength: r.contentLength,
      method: r.method,
      containsImageInfo: r.containsImageInfo,
      reason: r.extractionReason || r.error,
      preview: r.contentPreview,
      screenshot: r.screenshot
    })),
    artifacts: {
      resultsJson: path.join(outDir, 'results.json'),
      resultsMd: path.join(outDir, 'results.md'),
      screenshotDir
    }
  }, null, 2));

  process.exit(ok ? 0 : 2);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
