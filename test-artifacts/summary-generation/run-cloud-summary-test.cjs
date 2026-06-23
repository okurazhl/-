const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.resolve(__dirname, '..', '..');
const outDir = __dirname;

const rawEndpoint = process.env.LLM_ENDPOINT || '';
const apiKey = process.env.LLM_API_KEY || '';
const model = process.env.LLM_MODEL || 'deepseek-chat';

const cases = [
  {
    name: '中文文章云端摘要',
    title: '网页笔记助手测试文章',
    pageType: 'article',
    content: [
      '网页笔记助手是一款 Chrome 侧边栏插件，用于提取当前网页正文、保存笔记并生成摘要。',
      '它不声明 host_permissions，而是依赖 activeTab 和 scripting 在用户操作后注入内容脚本。',
      '内容提取完成后，用户可以编辑标题、分类、标签和摘要。',
      '插件仅在用户配置并确认云端 LLM 后生成摘要；未配置或调用失败时不会生成本地摘要。',
      '测试重点包括网页提取质量、摘要准确性、隐私提示以及错误场景的可理解性。'
    ].join('')
  },
  {
    name: '英文技术文档云端摘要',
    title: 'Fetch API Notes',
    pageType: 'article',
    content: [
      'The Fetch API provides a JavaScript interface for making HTTP requests and processing responses.',
      'Fetch is promise-based and integrates with modern browser features such as service workers and streams.',
      'A request can include headers, a method, credentials, and a body.',
      'Developers must handle network errors and HTTP status codes separately.',
      'The API also supports cancellation through AbortController.',
      'These features make Fetch a flexible replacement for XMLHttpRequest in most applications.'
    ].join(' ')
  },
  {
    name: '列表页云端摘要',
    title: 'Hacker News 首页',
    pageType: 'listing',
    content: [
      '页面类型：列表/聚合页。',
      '页面标题：Hacker News。',
      '以下为页面中的主要列表条目：',
      '1. I Stored a Website in a Favicon。',
      '2. A new database engine improves query speed。',
      '3. Show HN: A small local-first notes app。',
      '4. Researchers publish a paper about browser privacy。',
      '这些条目代表页面当前展示的信息流，而不是单篇文章全文。'
    ].join('\n')
  }
];

function redact(value) {
  if (!value) return '';
  return value.replace(/(sk-)[A-Za-z0-9_-]{8,}/g, '$1***');
}

function normalizeCandidates(endpoint) {
  const trimmed = String(endpoint || '').trim().replace(/\/+$/, '');
  if (!trimmed) return [];
  const candidates = [trimmed];
  if (!/\/(?:v\d+\/)?chat\/completions$/i.test(trimmed)) {
    candidates.push(`${trimmed}/chat/completions`);
    candidates.push(`${trimmed}/v1/chat/completions`);
  }
  return [...new Set(candidates)];
}

function hasEnglishSentenceJoinIssue(summary) {
  return /[a-z][.!?][A-Z]/.test(summary || '');
}

async function runCase(generateSummary, endpoint, testCase) {
  const started = Date.now();
  const result = await generateSummary(
    {
      enabled: true,
      endpoint,
      apiEndpoint: endpoint,
      apiKey,
      model,
      length: 'medium'
    },
    testCase.title,
    testCase.content,
    {
      mode: 'llm',
      length: 'medium',
      pageType: testCase.pageType,
      requestId: `cloud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    }
  );

  return {
    name: testCase.name,
    pageType: testCase.pageType,
    success: !!result.success,
    method: result.method || '',
    error: redact(result.error || ''),
    summary: result.summary || '',
    summaryLength: (result.summary || '').length,
    joinIssue: hasEnglishSentenceJoinIssue(result.summary || ''),
    elapsedMs: Date.now() - started,
    usage: result.usage || null
  };
}

async function main() {
  if (!rawEndpoint || !apiKey) {
    throw new Error('LLM_ENDPOINT and LLM_API_KEY are required');
  }

  const { generateSummary } = await import(pathToFileURL(path.join(root, 'lib', 'summarizer.js')).href);
  const endpointResults = [];

  for (const endpoint of normalizeCandidates(rawEndpoint)) {
    const endpointRun = {
      endpoint,
      model,
      cases: []
    };

    for (const testCase of cases) {
      endpointRun.cases.push(await runCase(generateSummary, endpoint, testCase));
    }

    endpointRun.successCount = endpointRun.cases.filter(item => item.success).length;
    endpointRun.failedCount = endpointRun.cases.length - endpointRun.successCount;
    endpointRun.passed = endpointRun.successCount === endpointRun.cases.length &&
      endpointRun.cases.every(item => item.summaryLength > 0 && !item.joinIssue);
    endpointResults.push(endpointRun);

    if (endpointRun.passed) break;
  }

  const best = endpointResults.find(run => run.passed) ||
    endpointResults.slice().sort((a, b) => b.successCount - a.successCount)[0];

  const report = {
    generatedAt: new Date().toISOString(),
    rawEndpoint,
    model,
    bestEndpoint: best?.endpoint || '',
    passed: !!best?.passed,
    endpointResults
  };

  fs.writeFileSync(path.join(outDir, 'cloud-results.json'), JSON.stringify(report, null, 2), 'utf8');

  const md = [
    '# 云端摘要测试',
    '',
    `生成时间：${report.generatedAt}`,
    `模型：${model}`,
    `输入地址：${rawEndpoint}`,
    `最佳地址：${report.bestEndpoint || '-'}`,
    `整体通过：${report.passed ? '是' : '否'}`,
    '',
    '| Endpoint | 用例 | 成功 | 方法 | 摘要字数 | 问题 |',
    '|---|---|---|---|---:|---|'
  ];

  for (const run of endpointResults) {
    for (const item of run.cases) {
      const problem = [
        item.error,
        item.joinIssue ? '英文句子粘连' : '',
        item.success && !item.summary ? '空摘要' : ''
      ].filter(Boolean).join('；') || '无';
      md.push(`| ${run.endpoint} | ${item.name} | ${item.success ? '是' : '否'} | ${item.method || '-'} | ${item.summaryLength} | ${problem} |`);
    }
  }

  md.push('', '## 摘要样例');
  for (const run of endpointResults) {
    md.push('', `### Endpoint: ${run.endpoint}`);
    for (const item of run.cases) {
      md.push('', `#### ${item.name}`, item.summary || item.error || '(空)');
    }
  }

  fs.writeFileSync(path.join(outDir, 'cloud-results.md'), md.join('\n'), 'utf8');

  console.log(JSON.stringify({
    passed: report.passed,
    model,
    rawEndpoint,
    bestEndpoint: report.bestEndpoint,
    artifacts: {
      resultsJson: path.join(outDir, 'cloud-results.json'),
      resultsMd: path.join(outDir, 'cloud-results.md')
    },
    endpointResults: endpointResults.map(run => ({
      endpoint: run.endpoint,
      passed: run.passed,
      successCount: run.successCount,
      failedCount: run.failedCount,
      cases: run.cases.map(item => ({
        name: item.name,
        success: item.success,
        method: item.method,
        error: item.error,
        summaryLength: item.summaryLength,
        joinIssue: item.joinIssue,
        elapsedMs: item.elapsedMs,
        usage: item.usage
      }))
    }))
  }, null, 2));
}

main().catch(err => {
  console.error(redact(err.message || String(err)));
  process.exit(1);
});
