const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.resolve(__dirname, '..', '..');
const outDir = __dirname;
fs.mkdirSync(outDir, { recursive: true });

const cloudConfig = {
  enabled: true,
  endpoint: 'https://api.example.test',
  apiKey: 'sk-test',
  model: 'mock-model',
  length: 'medium'
};

function installMockFetch(summary = 'Mock cloud summary.') {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: summary } }],
        usage: { total_tokens: 12 }
      })
    };
  };
  return calls;
}

const cases = [
  {
    name: '未配置云端摘要',
    title: 'No cloud config',
    content: 'This content should not be summarized because cloud LLM is not configured.',
    config: { enabled: false },
    options: { mode: 'llm', length: 'medium', pageType: 'article' },
    expectSuccess: false,
    expectMethod: 'llm',
    expectErrorIncludes: '未配置云端摘要'
  },
  {
    name: '拒绝非 LLM 模式',
    title: 'Reject local mode',
    content: 'This content is long enough, but the old local mode must be rejected.',
    config: cloudConfig,
    options: { mode: 'tfidf', length: 'medium', pageType: 'article' },
    expectSuccess: false,
    expectMethod: 'none',
    expectErrorIncludes: '仅支持云端 LLM'
  },
  {
    name: '短内容仍调用云端',
    title: 'Short content',
    content: 'Short page text.',
    config: cloudConfig,
    options: { mode: 'llm', length: 'short', pageType: 'unknown' },
    mockSummary: '短内容云端摘要。',
    expectSuccess: true,
    expectMethod: 'llm',
    expectSummaryIncludes: '短内容云端摘要'
  },
  {
    name: '正常云端摘要',
    title: 'Cloud summary',
    content: 'The extension extracts page text, confirms cloud sending, and stores the cloud summary locally.',
    config: cloudConfig,
    options: { mode: 'llm', length: 'medium', pageType: 'article' },
    mockSummary: '网页内容会经确认后发送云端，并把摘要保存到本地。',
    expectSuccess: true,
    expectMethod: 'llm',
    expectSummaryIncludes: '发送云端'
  },
  {
    name: '空内容失败',
    title: 'Empty content',
    content: '',
    config: cloudConfig,
    options: { mode: 'llm', length: 'medium', pageType: 'article' },
    expectSuccess: false,
    expectMethod: 'none',
    expectErrorIncludes: '内容为空'
  }
];

async function main() {
  const moduleUrl = pathToFileURL(path.join(root, 'lib', 'summarizer.js')).href;
  const { generateSummary } = await import(moduleUrl);
  const results = [];

  for (const item of cases) {
    const started = Date.now();
    const calls = installMockFetch(item.mockSummary || 'Mock cloud summary.');
    const result = await generateSummary(
      item.config,
      item.title,
      item.content,
      item.options
    );

    const summary = result.summary || '';
    const error = result.error || '';
    const passed =
      !!result.success === item.expectSuccess &&
      (result.method || '') === item.expectMethod &&
      (!item.expectSummaryIncludes || summary.includes(item.expectSummaryIncludes)) &&
      (!item.expectErrorIncludes || error.includes(item.expectErrorIncludes)) &&
      (!item.expectSuccess || calls.length > 0);

    results.push({
      name: item.name,
      mode: item.options.mode,
      success: !!result.success,
      method: result.method || '',
      summaryLength: summary.length,
      cloudCallCount: calls.length,
      passed,
      error,
      summary,
      elapsedMs: Date.now() - started
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    results
  };

  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(report, null, 2), 'utf8');

  const md = [
    '# 云端摘要契约测试',
    '',
    `生成时间：${report.generatedAt}`,
    '',
    '| # | 用例 | 模式 | 方法 | 通过 | 云端调用 | 摘要字数 | 问题 |',
    '|---|---|---|---|---|---:|---:|---|'
  ];

  results.forEach((r, index) => {
    md.push(`| ${index + 1} | ${r.name} | ${r.mode} | ${r.method || '-'} | ${r.passed ? '是' : '否'} | ${r.cloudCallCount} | ${r.summaryLength} | ${r.error || '无'} |`);
  });

  fs.writeFileSync(path.join(outDir, 'results.md'), md.join('\n'), 'utf8');
  console.log(JSON.stringify({
    total: report.total,
    passed: report.passed,
    failed: report.failed,
    artifacts: {
      resultsJson: path.join(outDir, 'results.json'),
      resultsMd: path.join(outDir, 'results.md')
    },
    failedCases: results.filter(r => !r.passed)
  }, null, 2));

  if (report.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
