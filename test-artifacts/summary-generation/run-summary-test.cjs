const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.resolve(__dirname, '..', '..');
const outDir = __dirname;
fs.mkdirSync(outDir, { recursive: true });

const cases = [
  {
    name: '中文长文章',
    pageType: 'article',
    mode: 'tfidf',
    length: 'medium',
    expected: ['党建', '思想'],
    content: [
      '习近平党建思想是习近平新时代中国特色社会主义思想的重要组成部分。',
      '这一思想围绕新时代党的建设总要求，系统回答了管党治党、兴党强党的重大理论和实践问题。',
      '文章指出，全面从严治党必须坚持思想建党和制度治党同向发力。',
      '组织建设、干部队伍建设、基层党组织建设和作风纪律建设共同构成实践路径。',
      '推进党的自我革命，需要把政治建设摆在首位，同时强化监督体系和责任落实。',
      '这一理论为新时代党的建设提供了根本遵循。'
    ].join('')
  },
  {
    name: '英文技术文档',
    pageType: 'article',
    mode: 'tfidf',
    length: 'medium',
    expected: ['Fetch', 'request'],
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
    name: '列表/聚合页',
    pageType: 'listing',
    mode: 'tfidf',
    length: 'medium',
    expected: ['列表', '条目'],
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
  },
  {
    name: '论坛评论页',
    pageType: 'forum-qa',
    mode: 'tfidf',
    length: 'medium',
    expected: ['Dropbox', 'comments'],
    content: [
      'The discussion is about an early Dropbox demo.',
      'Several comments praise the simplicity of synchronization across computers.',
      'Some users argue that similar workflows could be built with FTP, version control, or network drives.',
      'Other comments point out that the value is not only storage but a reliable user experience.',
      'The thread shows both skepticism and excitement about the product.'
    ].join(' ')
  },
  {
    name: '视频页可见信息',
    pageType: 'video',
    mode: 'tfidf',
    length: 'medium',
    expected: ['video', 'description'],
    content: [
      'Video title: Product launch keynote.',
      'The page includes a description, view count, publication date, and channel information.',
      'No transcript is available in the extracted text.',
      'The description says the video introduces new hardware, battery life improvements, and AI features.',
      'Because there is no transcript, the summary should not claim to know the full spoken content.'
    ].join(' ')
  },
  {
    name: '商品营销页',
    pageType: 'product',
    mode: 'tfidf',
    length: 'medium',
    expected: ['battery', 'price'],
    content: [
      'MacBook Air starts at $1099 and is available in two sizes.',
      'The product page emphasizes a thin design, long battery life, and improved performance.',
      'It mentions up to 18 hours of battery life and support for Apple Intelligence.',
      'Configuration options include memory and storage upgrades.',
      'The page also includes education savings and monthly payment information.'
    ].join(' ')
  },
  {
    name: '短网页',
    pageType: 'unknown',
    mode: 'auto',
    length: 'medium',
    expected: ['Example Domain'],
    content: 'Example Domain. This domain is for use in documentation examples without needing permission.'
  },
  {
    name: '噪声内容',
    pageType: 'unknown',
    mode: 'tfidf',
    length: 'medium',
    expected: ['核心正文'],
    content: [
      '登录 注册 分享 收藏 更多 广告 推荐。',
      '核心正文介绍了浏览器扩展如何从当前页面提取内容并保存为笔记。',
      '用户可以编辑标题、标签、分类和摘要。',
      '登录 注册 分享 收藏 更多 广告 推荐。',
      '如果页面内容很短，系统应该提醒用户摘要可能不完整。',
      '登录 注册 分享 收藏 更多 广告 推荐。'
    ].join('')
  },
  {
    name: '长文短摘要',
    pageType: 'article',
    mode: 'tfidf',
    length: 'short',
    expected: ['performance'],
    content: [
      'Rendering performance depends on how quickly the browser can construct the DOM and CSSOM.',
      'After parsing HTML and CSS, the browser combines both trees into a render tree.',
      'Layout calculates the position and size of each visible element.',
      'Paint converts those layout boxes into pixels on the screen.',
      'Reducing blocking resources can improve performance and user experience.',
      'Developers should measure bottlenecks before applying optimizations.'
    ].join(' ')
  },
  {
    name: '空内容',
    pageType: 'article',
    mode: 'tfidf',
    length: 'medium',
    expectFailure: true,
    content: ''
  }
];

function hasEnglishSentenceJoinIssue(summary) {
  return /[a-z][.!?][A-Z]/.test(summary || '');
}

function isReasonableLength(summary, length) {
  const max = length === 'short' ? 180 : length === 'long' ? 900 : 520;
  return (summary || '').length <= max;
}

async function main() {
  const moduleUrl = pathToFileURL(path.join(root, 'lib', 'summarizer.js')).href;
  const { generateSummary } = await import(moduleUrl);
  const results = [];

  for (const item of cases) {
    const started = Date.now();
    const result = await generateSummary(
      { enabled: false, length: item.length },
      item.name,
      item.content,
      {
        mode: item.mode,
        length: item.length,
        pageType: item.pageType
      }
    );

    const summary = result.summary || '';
    const expectedHits = (item.expected || []).filter(token =>
      summary.toLowerCase().includes(String(token).toLowerCase())
    );
    const joinIssue = hasEnglishSentenceJoinIssue(summary);
    const lengthOk = item.expectFailure ? true : isReasonableLength(summary, item.length);
    const successMatches = item.expectFailure ? !result.success : !!result.success;
    const expectedOk = item.expectFailure || expectedHits.length >= Math.min(1, (item.expected || []).length);

    results.push({
      name: item.name,
      pageType: item.pageType,
      mode: item.mode,
      length: item.length,
      success: !!result.success,
      method: result.method || '',
      summaryLength: summary.length,
      expectedHits,
      joinIssue,
      lengthOk,
      passed: successMatches && expectedOk && lengthOk && !joinIssue,
      error: result.error || '',
      summary,
      elapsedMs: Date.now() - started
    });
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    results
  };

  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(summary, null, 2), 'utf8');

  const md = [
    '# 摘要生成补充测试',
    '',
    `生成时间：${summary.generatedAt}`,
    '',
    '| # | 用例 | 页面类型 | 模式 | 方法 | 通过 | 摘要字数 | 问题 |',
    '|---|---|---|---|---|---|---:|---|'
  ];

  results.forEach((r, index) => {
    const problems = [
      r.error,
      r.joinIssue ? '英文句子粘连' : '',
      !r.lengthOk ? '摘要过长' : '',
      r.expectedHits.length === 0 && r.success ? '关键词缺失' : ''
    ].filter(Boolean).join('；') || '无';
    md.push(`| ${index + 1} | ${r.name} | ${r.pageType} | ${r.mode} | ${r.method || '-'} | ${r.passed ? '是' : '否'} | ${r.summaryLength} | ${problems} |`);
  });

  md.push('', '## 摘要样例');
  results.forEach((r, index) => {
    md.push('', `### ${index + 1}. ${r.name}`, r.summary || r.error || '(空)');
  });

  fs.writeFileSync(path.join(outDir, 'results.md'), md.join('\n'), 'utf8');
  console.log(JSON.stringify({
    total: summary.total,
    passed: summary.passed,
    failed: summary.failed,
    artifacts: {
      resultsJson: path.join(outDir, 'results.json'),
      resultsMd: path.join(outDir, 'results.md')
    },
    failedCases: results.filter(r => !r.passed).map(r => ({
      name: r.name,
      method: r.method,
      error: r.error,
      joinIssue: r.joinIssue,
      summary: r.summary
    }))
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
