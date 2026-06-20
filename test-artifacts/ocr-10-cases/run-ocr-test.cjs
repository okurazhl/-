const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const root = path.resolve(__dirname, '..', '..');
const outDir = __dirname;
fs.mkdirSync(outDir, { recursive: true });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const cases = [
  {
    id: 'single-image-zh',
    name: '单张中文正文图',
    textDetector: 'mock',
    body: '<p>正文在图片中。</p>',
    images: [
      { alt: '会议长图', width: 920, height: 560, ocr: ['会议通知', '报名截止 6月30日'] }
    ],
    expect: {
      recognizedCount: 1,
      failedCount: 0,
      includes: ['图片 OCR 文字：', '会议通知', '报名截止 6月30日'],
      summaryIncludes: ['会议通知', '报名截止 6月30日'],
      excludes: ['当前未能读取图片文字', '未能从正文图片识别出文字']
    }
  },
  {
    id: 'multi-image',
    name: '多张正文图',
    textDetector: 'mock',
    body: '<p>页面由两张图组成。</p>',
    images: [
      { alt: '步骤一', width: 900, height: 520, ocr: ['第一步：打开设置'] },
      { alt: '步骤二', width: 900, height: 520, ocr: ['第二步：保存笔记'] }
    ],
    expect: {
      recognizedCount: 2,
      failedCount: 0,
      includes: ['第一步：打开设置', '第二步：保存笔记'],
      summaryIncludes: ['第一步：打开设置', '第二步：保存笔记'],
      excludes: ['未能从正文图片识别出文字']
    }
  },
  {
    id: 'partial-failure',
    name: '部分图片识别失败',
    textDetector: 'mock',
    body: '<p>第二张图模拟浏览器检测异常。</p>',
    images: [
      { alt: '可识别图', width: 900, height: 520, ocr: ['可识别文本 A'] },
      { alt: '失败图', width: 900, height: 520, mode: 'throw' }
    ],
    expect: {
      recognizedCount: 1,
      failedCount: 1,
      includes: ['可识别文本 A', '已识别部分图片文字'],
      summaryIncludes: ['可识别文本 A'],
      excludes: ['未能从正文图片识别出文字']
    }
  },
  {
    id: 'unsupported-detector',
    name: '浏览器不支持 TextDetector',
    textDetector: 'none',
    body: '<p>只有正文图片，浏览器没有 OCR 能力。</p>',
    images: [
      { alt: '政策图', width: 900, height: 520, ocr: ['这段不会被读取'] }
    ],
    expect: {
      supported: false,
      recognizedCount: 0,
      includes: ['检测到正文图片，但当前浏览器未提供可用 OCR 能力'],
      excludes: ['图片 OCR 文字：', '这段不会被读取']
    }
  },
  {
    id: 'small-image-ignore',
    name: '小图标不进入 OCR',
    textDetector: 'mock',
    body: '<p>这是一个含小图标的普通短页面，图标不应进入 OCR 候选。</p>',
    images: [
      { alt: '小图标', width: 120, height: 80, ocr: ['不应出现的小图标文字'] }
    ],
    expect: {
      imageOcr: null,
      includes: ['普通短页面'],
      excludes: ['图片 OCR 文字：', '不应出现的小图标文字']
    }
  },
  {
    id: 'empty-ocr',
    name: 'OCR 返回空结果',
    textDetector: 'mock',
    body: '<p>图片可能不含可识别文字。</p>',
    images: [
      { alt: '空白图', width: 900, height: 520, ocr: [] }
    ],
    expect: {
      recognizedCount: 0,
      failedCount: 0,
      includes: ['未能从正文图片识别出文字'],
      excludes: ['图片 OCR 文字：']
    }
  },
  {
    id: 'dedupe-lines',
    name: 'OCR 行去重',
    textDetector: 'mock',
    body: '<p>同一张图里 OCR 返回重复内容。</p>',
    images: [
      { alt: '去重图片', width: 900, height: 520, ocr: ['重复行\n重复行\n唯一行'] }
    ],
    expect: {
      recognizedCount: 1,
      failedCount: 0,
      includes: ['重复行', '唯一行'],
      summaryIncludes: ['重复行', '唯一行'],
      occurrence: { token: '重复行', count: 1 }
    }
  },
  {
    id: 'text-rich-unsupported',
    name: '正文足够时不制造图片重警告',
    textDetector: 'none',
    body: [
      '<p>这是一段足够长的普通正文，用来模拟新闻或文档页面已经有可提取文本。</p>',
      '<p>即使页面中包含一张正文图片，OCR 不可用也不应该把整个页面标记为图片正文不可读。</p>',
      '<p>用户仍然可以基于这些文本生成摘要，图片信息只作为补充线索保留。</p>',
      '<p>这里继续补充一些自然语言内容，确保非图片文本超过阈值并保持页面可读。</p>',
      '<p>额外的段落用于模拟真实文章中的背景、事实、观点和结论，确保可见正文已经足够支撑保存和摘要。</p>',
      '<p>这类页面不应该因为 OCR 能力缺失而显示图片正文不可读的强警告，只需要保留图片线索即可。</p>'
    ].join(''),
    images: [
      { alt: '补充图', width: 900, height: 520, ocr: ['补充图文字'] }
    ],
    expect: {
      supported: false,
      recognizedCount: 0,
      summaryIncludes: ['已经有可提取文本'],
      includes: ['确保非图片文本超过阈值'],
      excludes: ['检测到正文图片，但当前浏览器未提供可用 OCR 能力', '当前未能读取图片文字']
    }
  },
  {
    id: 'candidate-limit-five',
    name: '最多处理五张正文图',
    textDetector: 'mock',
    body: '<p>页面包含六张大图，只处理前五张。</p>',
    images: Array.from({ length: 6 }, (_, i) => ({
      alt: `正文图 ${i + 1}`,
      width: 900,
      height: 520,
      ocr: [`OCR-${i + 1}`]
    })),
    expect: {
      imageCount: 5,
      recognizedCount: 5,
      failedCount: 0,
      summaryIncludes: ['OCR-1', 'OCR-5'],
      summaryExcludes: ['OCR-6'],
      includes: ['OCR-1', 'OCR-5'],
      excludes: ['OCR-6']
    }
  },
  {
    id: 'ocr-timeout',
    name: '单图 OCR 超时',
    textDetector: 'mock',
    body: '<p>这张图模拟 OCR 长时间无响应。</p>',
    images: [
      { alt: '超时图', width: 900, height: 520, mode: 'hang' }
    ],
    expect: {
      recognizedCount: 0,
      failedCount: 1,
      includes: ['未能从正文图片识别出文字'],
      excludes: ['图片 OCR 文字：']
    }
  }
];

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
}

function buildHtml(testCase) {
  const images = (testCase.images || []).map((img, index) => {
    const src = `/img/${testCase.id}-${index + 1}.svg`;
    const ocr = Array.isArray(img.ocr) ? img.ocr.join('||') : '';
    const mode = img.mode || '';
    return `<img src="${src}" alt="${escapeAttr(img.alt || '')}" width="${img.width}" height="${img.height}" data-ocr="${escapeAttr(ocr)}" data-ocr-mode="${escapeAttr(mode)}">`;
  }).join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(testCase.name)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 32px; max-width: 860px; }
    img { display: block; margin: 16px 0; max-width: 100%; height: auto; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${escapeHtml(testCase.name)}</h1>
      ${testCase.body || ''}
      ${images}
    </article>
  </main>
</body>
</html>`;
}

function makeSvg(width, height, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#f5f7fb"/>
  <rect x="24" y="24" width="${Math.max(1, width - 48)}" height="${Math.max(1, height - 48)}" fill="#ffffff" stroke="#6b7280" stroke-width="4"/>
  <text x="48" y="96" font-size="40" font-family="Arial, sans-serif" fill="#111827">${escapeHtml(label || 'OCR Test Image')}</text>
</svg>`;
}

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
  const profileDir = path.join(outDir, `tmp-chrome-ocr-${Date.now()}`);
  fs.mkdirSync(profileDir, { recursive: true });

  const proc = spawn(findChrome(), [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
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
      await sleep(600);
      try {
        if (path.resolve(profileDir).startsWith(path.resolve(outDir))) {
          fs.rmSync(profileDir, { recursive: true, force: true });
        }
      } catch {}
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
    this.ws.addEventListener('message', ev => {
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
      const handler = params => {
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

async function createTarget(cdpPort, url = 'about:blank') {
  let resp = await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!resp.ok) resp = await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(url)}`);
  if (!resp.ok) throw new Error(`create target failed: ${resp.status}`);
  return await resp.json();
}

async function navigate(client, url, timeoutMs = 30000) {
  const loadPromise = client.once('Page.loadEventFired', timeoutMs).catch(() => null);
  await client.send('Page.navigate', { url }, timeoutMs);
  await loadPromise;
  await waitFor(async () => {
    const ready = await client.eval('document.readyState', 5000).catch(() => '');
    return ready === 'interactive' || ready === 'complete';
  }, 10000).catch(() => null);
  await client.eval(`Promise.all(Array.from(document.images || []).map(img => {
    if (img.complete) return true;
    return new Promise(resolve => {
      const done = () => resolve(true);
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
      setTimeout(done, 800);
    });
  }))`, 3000).catch(() => null);
}

async function startFixtureServer() {
  const imageMap = new Map();
  for (const testCase of cases) {
    (testCase.images || []).forEach((img, index) => {
      imageMap.set(`/img/${testCase.id}-${index + 1}.svg`, {
        width: img.width,
        height: img.height,
        label: img.alt || `${testCase.id}-${index + 1}`
      });
    });
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pageMatch = url.pathname.match(/^\/case\/([^/]+)$/);
    if (pageMatch) {
      const testCase = cases.find(item => item.id === pageMatch[1]);
      if (!testCase) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(buildHtml(testCase));
      return;
    }

    if (imageMap.has(url.pathname)) {
      const img = imageMap.get(url.pathname);
      res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store' });
      res.end(makeSvg(img.width, img.height, img.label));
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  const port = await findFreePort();
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { server, port };
}

function installRuntimeMock(testCase) {
  const detectorMode = testCase.textDetector;
  return `(() => {
    delete window.__contentExtractInitialized;
    delete window.__contentExtractListener;
    window.chrome = {};
    window.chrome.runtime = { onMessage: { addListener(fn) { window.__contentExtractListener = fn; } } };
    Object.defineProperty(window, 'TextDetector', {
      configurable: true,
      writable: true,
      value: ${detectorMode === 'none' ? 'undefined' : `class MockTextDetector {
        async detect(image) {
          const mode = image && image.dataset ? image.dataset.ocrMode : '';
          if (mode === 'throw') throw new Error('mock OCR failure');
          if (mode === 'hang') return new Promise(() => {});
          const raw = image && image.dataset ? image.dataset.ocr || '' : '';
          if (!raw) return [];
          return raw.split('||').filter(Boolean).map(rawValue => ({ rawValue }));
        }
      }`}
    });
    return true;
  })()`;
}

function textIncludes(haystack, needle) {
  return String(haystack || '').includes(String(needle || ''));
}

function countOccurrences(haystack, needle) {
  return String(haystack || '').split(String(needle || '')).length - 1;
}

function scoreCase(testCase, data, summaryText = '') {
  const failures = [];
  const content = String(data?.content || '');
  const summary = String(summaryText || '');
  const warnings = (data?.qualityWarnings || []).join('\n');
  const combined = `${content}\n${warnings}`;
  const imageOcr = data?.imageOcr || null;
  const expect = testCase.expect || {};

  if (!data || !data.success || !content) failures.push('未提取到内容');
  if ('imageOcr' in expect && expect.imageOcr === null && imageOcr !== null) failures.push('不应产生 imageOcr 状态');
  if (expect.imageOcr !== null && !('imageOcr' in expect) && !imageOcr) failures.push('缺少 imageOcr 状态');
  if (imageOcr && 'supported' in expect && imageOcr.supported !== expect.supported) failures.push(`supported=${imageOcr.supported}，期望 ${expect.supported}`);
  if (imageOcr && 'imageCount' in expect && imageOcr.imageCount !== expect.imageCount) failures.push(`imageCount=${imageOcr.imageCount}，期望 ${expect.imageCount}`);
  if (imageOcr && 'recognizedCount' in expect && imageOcr.recognizedCount !== expect.recognizedCount) failures.push(`recognizedCount=${imageOcr.recognizedCount}，期望 ${expect.recognizedCount}`);
  if (imageOcr && 'failedCount' in expect && imageOcr.failedCount !== expect.failedCount) failures.push(`failedCount=${imageOcr.failedCount}，期望 ${expect.failedCount}`);

  for (const token of expect.includes || []) {
    if (!textIncludes(combined, token)) failures.push(`缺少期望文本：${token}`);
  }
  for (const token of expect.excludes || []) {
    if (textIncludes(combined, token)) failures.push(`出现不应有文本：${token}`);
  }
  if (summary && /https?:\/\/|\.svg\b/i.test(summary)) {
    failures.push('摘要包含图片 URL 噪声');
  }
  for (const token of expect.summaryIncludes || []) {
    if (!textIncludes(summary, token)) failures.push(`摘要缺少期望文本：${token}`);
  }
  for (const token of expect.summaryExcludes || []) {
    if (textIncludes(summary, token)) failures.push(`摘要出现不应有文本：${token}`);
  }
  if (expect.occurrence) {
    const actual = countOccurrences(content, expect.occurrence.token);
    if (actual !== expect.occurrence.count) {
      failures.push(`${expect.occurrence.token} 出现 ${actual} 次，期望 ${expect.occurrence.count} 次`);
    }
  }

  return failures;
}

function preview(value, max = 160) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function extractOcrText(content) {
  const match = String(content || '').match(/图片 OCR 文字：\n([\s\S]*)$/);
  return match ? match[1].trim() : '';
}

function writeReports(payload) {
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(payload, null, 2), 'utf8');

  const md = [
    '# OCR 10 Cases Test Results',
    '',
    `- Run at: ${new Date(payload.runAt).toISOString()}`,
    `- Total: ${payload.total}`,
    `- Passed: ${payload.passed}`,
    `- Failed: ${payload.failed}`,
    `- Native TextDetector available before mock: ${payload.nativeTextDetectorAvailable ? 'yes' : 'no'}`,
    '',
    '| # | Case | Result | OCR status | Recognized | Failed | Evaluation | Preview |',
    '|---:|---|---|---|---:|---:|---|---|'
  ];

  for (const row of payload.results) {
    const status = row.imageOcr
      ? `${row.imageOcr.supported ? 'supported' : 'unsupported'}, attempted=${row.imageOcr.attempted}`
      : 'no candidate';
    md.push([
      row.index,
      row.id,
      row.passed ? '通过' : '失败',
      status,
      row.imageOcr?.recognizedCount ?? 0,
      row.imageOcr?.failedCount ?? 0,
      row.failures.length ? row.failures.join('; ') : '符合预期',
      preview(row.contentPreview, 120).replace(/\|/g, '\\|')
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  fs.writeFileSync(path.join(outDir, 'results.md'), md.join('\n'), 'utf8');

  const full = [
    '# OCR Full Transcriptions And Summaries',
    '',
    `- Run at: ${new Date(payload.runAt).toISOString()}`,
    `- Total: ${payload.total}`,
    `- Passed: ${payload.passed}`,
    `- Failed: ${payload.failed}`,
    ''
  ];

  for (const row of payload.results) {
    full.push(`## ${row.index}. ${row.id}`);
    full.push('');
    full.push(`- Result: ${row.passed ? '通过' : '失败'}`);
    full.push(`- OCR: recognized=${row.imageOcr?.recognizedCount ?? 0}, failed=${row.imageOcr?.failedCount ?? 0}, supported=${row.imageOcr?.supported ?? 'n/a'}`);
    full.push(`- Summary method: ${row.summaryMethod || 'none'}`);
    full.push('');
    full.push('### OCR 转写全文');
    full.push('');
    full.push('```text');
    full.push(row.ocrText || '(无 OCR 转写)');
    full.push('```');
    full.push('');
    full.push('### 摘要生成内容');
    full.push('');
    full.push('```text');
    full.push(row.summary || '(无摘要)');
    full.push('```');
    full.push('');
    full.push('### 提取正文全文');
    full.push('');
    full.push('```text');
    full.push(row.content || '(无正文)');
    full.push('```');
    full.push('');
  }

  fs.writeFileSync(path.join(outDir, 'full-output.md'), full.join('\n'), 'utf8');
}

async function run() {
  const server = await startFixtureServer();
  const chrome = await startChrome();
  const clients = [];

  try {
    const target = await createTarget(chrome.port);
    const client = new CDP(target.webSocketDebuggerUrl);
    clients.push(client);
    await client.connect();
    await client.send('Page.enable');
    await client.send('Runtime.enable');

    const readability = fs.readFileSync(path.join(root, 'content', 'readability.js'), 'utf8');
    const extractor = fs.readFileSync(path.join(root, 'content', 'content-extract.js'), 'utf8');
    const { generateSummary } = await import(pathToFileURL(path.join(root, 'lib', 'summarizer.js')).href);
    const nativeTextDetectorAvailable = await client.eval('typeof globalThis.TextDetector === "function"', 5000).catch(() => false);
    const results = [];

    for (let i = 0; i < cases.length; i++) {
      const testCase = cases[i];
      const started = Date.now();
      const row = {
        index: i + 1,
        id: testCase.id,
        name: testCase.name,
        passed: false,
        failures: []
      };

      try {
        const url = `http://127.0.0.1:${server.port}/case/${testCase.id}`;
        await navigate(client, url);
        await client.eval(installRuntimeMock(testCase), 5000);
        await client.eval(`${readability}\n//# sourceURL=readability-ocr-test.js`, 15000);
        await client.eval(`${extractor}\n//# sourceURL=content-extract-ocr-test.js`, 15000);
        const response = await client.eval(`new Promise(resolve => {
          const listener = window.__contentExtractListener;
          if (!listener) { resolve({ success: false, error: 'listener not registered' }); return; }
          const timer = setTimeout(() => resolve({ success: false, error: 'extract timeout' }), 12000);
          try {
            listener({ action: 'extractPage' }, {}, resp => { clearTimeout(timer); resolve(resp); });
          } catch (err) {
            clearTimeout(timer);
            resolve({ success: false, error: err && err.message || String(err) });
          }
        })`, 16000);
        const data = response?.data || response || {};
        row.rawSuccess = !!(data.success && data.content);
        row.title = data.title || '';
        row.method = data.method || '';
        row.pageType = data.pageType || '';
        row.contentLength = (data.content || '').length;
        row.content = data.content || '';
        row.contentPreview = preview(data.content, 260);
        row.qualityWarnings = Array.isArray(data.qualityWarnings) ? data.qualityWarnings : [];
        row.imageOcr = data.imageOcr || null;
        row.ocrText = extractOcrText(data.content || '');
        if (data.success && data.content) {
          const summaryResult = await generateSummary(
            { enabled: false },
            data.title || testCase.name,
            data.content,
            { mode: 'tfidf', length: 'medium', pageType: data.pageType || 'unknown' }
          );
          row.summary = summaryResult.success ? summaryResult.summary : '';
          row.summaryMethod = summaryResult.method || '';
          row.summaryError = summaryResult.error || '';
        } else {
          row.summary = '';
          row.summaryMethod = '';
          row.summaryError = data.error || response?.error || '';
        }
        row.failures = scoreCase(testCase, data, row.summary);
        row.passed = row.failures.length === 0;
      } catch (err) {
        row.failures = [err.message || String(err)];
      }

      row.elapsedMs = Date.now() - started;
      results.push(row);
      console.log(`${row.passed ? 'PASS' : 'FAIL'} ${row.index}/10 ${row.id}`);
    }

    const payload = {
      runAt: Date.now(),
      total: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
      nativeTextDetectorAvailable,
      results
    };
    writeReports(payload);
    console.log(JSON.stringify({
      total: payload.total,
      passed: payload.passed,
      failed: payload.failed,
      nativeTextDetectorAvailable,
      artifacts: {
        resultsJson: path.join(outDir, 'results.json'),
        resultsMd: path.join(outDir, 'results.md'),
        fullOutput: path.join(outDir, 'full-output.md')
      },
      failedCases: results.filter(r => !r.passed).map(r => ({
        id: r.id,
        failures: r.failures
      }))
    }, null, 2));

    if (payload.failed > 0) process.exitCode = 1;
  } finally {
    clients.forEach(client => client.close());
    await chrome.stop();
    await new Promise(resolve => server.server.close(resolve));
  }
}

run().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
