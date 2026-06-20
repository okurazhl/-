# UX 十网页提取测试结果

生成时间：2026-06-20T07:37:08.804Z

| # | 网页 | 场景 | UX 状态 | 显示 | 类型 | 字数 | 方法 | 说明 |
|---|---|---|---|---|---|---:|---|---|
| 1 | [MDN Fetch API 文档](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch) | 长技术文档 | usable | 通过 | article | 13813 | readability | Using the Fetch API: usable |
| 2 | [共产党员网图片文章](https://www.12371.cn/2026/06/15/ARTI1781514058487480.shtml) | 中文图片型正文 | problem | 通过 | unknown | 240 | fallback | 习近平党建思想内涵要义: possible-boilerplate-or-gate-text |
| 3 | [Wikipedia Readability](https://en.wikipedia.org/wiki/Readability) | 百科长文 | usable | 通过 | article | 50791 | readability | Readability: usable |
| 4 | [Example.com](https://example.com/) | 短网页 | usable-with-warning | 通过 | unknown | 115 | readability | Example Domain: usable |
| 5 | [Hacker News 首页](https://news.ycombinator.com/) | 列表/聚合页 | usable-with-warning | 通过 | listing | 1497 | listing | Hacker News: usable |
| 6 | [Hacker News Dropbox 讨论](https://news.ycombinator.com/item?id=8863) | 论坛/评论页 | usable | 通过 | forum-qa | 23810 | readability | My YC app: Dropbox: usable |
| 7 | [GitHub OpenAI Codex 仓库](https://github.com/openai/codex) | 项目/README 页 | usable | 通过 | article | 1916 | github-readme | openai/codex: usable |
| 8 | [YouTube 视频页](https://www.youtube.com/watch?v=dQw4w9WgXcQ) | 视频页 | failed | 通过 | login | 0 | login | https://www.youtube.com/watch? v=dQw4w9WgXcQ: 当前页面像登录、验证码或权限页面，请登录后打开具体内容页再提取 |
| 9 | [Apple MacBook Air 产品页](https://www.apple.com/macbook-air/) | 商品/营销页 | usable | 通过 | product | 11073 | readability | MacBook Air 13-inch and MacBook Air 15-inch: usable |
| 10 | [阮一峰周刊文章](https://www.ruanyifeng.com/blog/2024/06/weekly-issue-306.html) | 受限/反爬页面 | expected-failure | 通过 | login | 0 | login | 请稍候…: 当前页面像登录、验证码或权限页面，请登录后打开具体内容页再提取 |

## 逐页观察

### 1. MDN Fetch API 文档
- 用户场景: 用户想保存一篇长英文开发文档并稍后总结
- URL: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
- 状态: usable; sidepanel 显示 通过
- 标题: Using the Fetch API
- 类型/方法: article / readability
- 字数: 13813
- 质量提示: 无
- 预览: Using the Fetch APIThe Fetch API provides a JavaScript interface for making HTTP requests and processing the responses.Fetch is the modern replacement for XMLHttpRequest: unlike XMLHttpRequest, which uses callbacks, Fetch is promise-based and is integrated with features of the modern web such as service workers and Cro
- 截图: C:\Users\okura\Desktop\code\chrome插件日记\test-artifacts\ux-10-webpages\screenshots\01-sidepanel.png

### 2. 共产党员网图片文章
- 用户场景: 用户想保存一篇正文主要在长图里的中文文章
- URL: https://www.12371.cn/2026/06/15/ARTI1781514058487480.shtml
- 状态: problem; sidepanel 显示 通过
- 标题: 习近平党建思想内涵要义
- 类型/方法: unknown / fallback
- 字数: 240
- 质量提示: 页面类型不明确，已使用通用正文提取。；页面正文可能主要在图片中；当前只记录了图片信息，未读取图片文字。；当前页面未匹配专用提取器，已使用通用回退提取。
- 预览: 发布时间：2026年06月15日 17:10 来源：新华社 编辑：徐瑶 习近平党建思想内涵要义 共产党员网 打印 纠错 请先登录 微信扫一扫 × 收听本文 00:00/00:00 发布时间：2026年06月15日 17:10 来源：新华社 编辑：徐瑶 图片内容： - 图片 1（1000x4071）: https://p5.img.cctvpic.com/photoworkspace/contentimg/2026/06/15/2026061517005871012.jpg
- 截图: C:\Users\okura\Desktop\code\chrome插件日记\test-artifacts\ux-10-webpages\screenshots\02-sidepanel.png

### 3. Wikipedia Readability
- 用户场景: 用户想保存百科条目，避免导航和目录污染正文
- URL: https://en.wikipedia.org/wiki/Readability
- 状态: usable; sidepanel 显示 通过
- 标题: Readability
- 类型/方法: article / readability
- 字数: 50791
- 质量提示: 无
- 预览: ReadabilityFrom Wikipedia, the free encyclopediaFor the website, see Readability (service). For code readability, see Computer programming § Readability of source code.Readability is the ease with which a reader can understand a written text. The concept exists in both natural language and programming languages, though
- 截图: C:\Users\okura\Desktop\code\chrome插件日记\test-artifacts\ux-10-webpages\screenshots\03-sidepanel.png

### 4. Example.com
- 用户场景: 用户误点或保存很短页面时，应收到合理反馈
- URL: https://example.com/
- 状态: usable-with-warning; sidepanel 显示 通过
- 标题: Example Domain
- 类型/方法: unknown / readability
- 字数: 115
- 质量提示: 页面类型不明确，已使用通用正文提取。；提取内容较短，摘要可能不完整。
- 预览: Example DomainThis domain is for use in documentation examples without needing permission. Avoid use in operations.
- 截图: C:\Users\okura\Desktop\code\chrome插件日记\test-artifacts\ux-10-webpages\screenshots\04-sidepanel.png

### 5. Hacker News 首页
- 用户场景: 用户想保存当天资讯列表，应知道摘要只基于列表条目
- URL: https://news.ycombinator.com/
- 状态: usable-with-warning; sidepanel 显示 通过
- 标题: Hacker News
- 类型/方法: listing / listing
- 字数: 1497
- 质量提示: 当前页面更像列表/聚合页，摘要基于页面条目而非具体文章全文。
- 预览: 页面类型：列表/聚合页 页面标题：Hacker News 以下为页面中的主要列表条目： 1. I Stored a Website in a Favicon 说明：68 points · 25 comments 2. Data Compression Explained (2012) 说明：92 points · 7 comments 3. There are no instances in ATProto 说明：416 points · 216 comments 4. The discovery that changed how scientists think about memory 说明：31 points · 3 comm
- 截图: C:\Users\okura\Desktop\code\chrome插件日记\test-artifacts\ux-10-webpages\screenshots\05-sidepanel.png

### 6. Hacker News Dropbox 讨论
- 用户场景: 用户想保存一串讨论和评论观点
- URL: https://news.ycombinator.com/item?id=8863
- 状态: usable; sidepanel 显示 通过
- 标题: My YC app: Dropbox
- 类型/方法: forum-qa / readability
- 字数: 23810
- 质量提示: 无
- 预览: I have a few qualms with this app:1. For a Linux user, you can already build such a system yourself quite trivially by getting an FTP account, mounting it locally with curlftpfs, and then using SVN or CVS on the mounted filesystem. From Windows or Mac, this FTP account could be accessed through built-in software.2. It 
- 截图: C:\Users\okura\Desktop\code\chrome插件日记\test-artifacts\ux-10-webpages\screenshots\06-sidepanel.png

### 7. GitHub OpenAI Codex 仓库
- 用户场景: 用户想保存一个项目页的 README 和关键信息
- URL: https://github.com/openai/codex
- 状态: usable; sidepanel 显示 通过
- 标题: openai/codex
- 类型/方法: article / github-readme
- 字数: 1916
- 质量提示: 无
- 预览: 仓库：openai/codex Codex CLI is a coding agent from OpenAI that runs locally on your computer. If you want Codex in your code editor (VS Code, Cursor, Windsurf), install in your IDE. If you want the desktop app experience, run codex app or visit the Codex App page. If you are looking for the cloud-based agent from OpenAI,
- 截图: C:\Users\okura\Desktop\code\chrome插件日记\test-artifacts\ux-10-webpages\screenshots\07-sidepanel.png

### 8. YouTube 视频页
- 用户场景: 用户想总结视频页，应明确没有字幕时只能总结页面可见信息
- URL: https://www.youtube.com/watch?v=dQw4w9WgXcQ
- 状态: failed; sidepanel 显示 通过
- 标题: https://www.youtube.com/watch? v=dQw4w9WgXcQ
- 类型/方法: login / login
- 字数: 0
- 质量提示: 无
- 预览: 当前页面像登录、验证码或权限页面，请登录后打开具体内容页再提取
- 截图: C:\Users\okura\Desktop\code\chrome插件日记\test-artifacts\ux-10-webpages\screenshots\08-sidepanel.png

### 9. Apple MacBook Air 产品页
- 用户场景: 用户想保存商品卖点，正文不应只剩导航或促销按钮
- URL: https://www.apple.com/macbook-air/
- 状态: usable; sidepanel 显示 通过
- 标题: MacBook Air 13-inch and MacBook Air 15-inch
- 类型/方法: product / readability
- 字数: 11073
- 质量提示: 无
- 预览: Buy MacBook Air starting at $999 with education savings.ShopFrom $1099 or $91.58/mo. for 12 mo.The M5 chip isn’t just an upgrade, it’s a game changer, delivering phenomenal performance. Prepare for liftoff.Up to 18 hours of battery life. Won’t call it a day until you do.A powerful platform for AI. And Apple Intelligenc
- 截图: C:\Users\okura\Desktop\code\chrome插件日记\test-artifacts\ux-10-webpages\screenshots\09-sidepanel.png

### 10. 阮一峰周刊文章
- 用户场景: 用户遇到防护页时，应得到可理解、可行动的提示
- URL: https://www.ruanyifeng.com/blog/2024/06/weekly-issue-306.html
- 状态: expected-failure; sidepanel 显示 通过
- 标题: 请稍候…
- 类型/方法: login / login
- 字数: 0
- 质量提示: 无
- 预览: 当前页面像登录、验证码或权限页面，请登录后打开具体内容页再提取
- 截图: C:\Users\okura\Desktop\code\chrome插件日记\test-artifacts\ux-10-webpages\screenshots\10-sidepanel.png

## 截图索引
- 1. MDN Fetch API 文档: ![](screenshots/01-sidepanel.png)
- 2. 共产党员网图片文章: ![](screenshots/02-sidepanel.png)
- 3. Wikipedia Readability: ![](screenshots/03-sidepanel.png)
- 4. Example.com: ![](screenshots/04-sidepanel.png)
- 5. Hacker News 首页: ![](screenshots/05-sidepanel.png)
- 6. Hacker News Dropbox 讨论: ![](screenshots/06-sidepanel.png)
- 7. GitHub OpenAI Codex 仓库: ![](screenshots/07-sidepanel.png)
- 8. YouTube 视频页: ![](screenshots/08-sidepanel.png)
- 9. Apple MacBook Air 产品页: ![](screenshots/09-sidepanel.png)
- 10. 阮一峰周刊文章: ![](screenshots/10-sidepanel.png)