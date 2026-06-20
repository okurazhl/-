# 摘要生成补充测试

生成时间：2026-06-20T07:35:38.169Z

| # | 用例 | 页面类型 | 模式 | 方法 | 通过 | 摘要字数 | 问题 |
|---|---|---|---|---|---|---:|---|
| 1 | 中文长文章 | article | tfidf | tfidf | 是 | 138 | 无 |
| 2 | 英文技术文档 | article | tfidf | tfidf | 是 | 338 | 无 |
| 3 | 列表/聚合页 | listing | tfidf | tfidf | 是 | 104 | 无 |
| 4 | 论坛评论页 | forum-qa | tfidf | tfidf | 是 | 315 | 无 |
| 5 | 视频页可见信息 | video | tfidf | tfidf | 是 | 274 | 无 |
| 6 | 商品营销页 | product | tfidf | tfidf | 是 | 284 | 无 |
| 7 | 短网页 | unknown | auto | passthrough | 是 | 92 | 无 |
| 8 | 噪声内容 | unknown | tfidf | tfidf | 是 | 94 | 无 |
| 9 | 长文短摘要 | article | tfidf | tfidf | 是 | 150 | 无 |
| 10 | 空内容 | article | tfidf | none | 是 | 0 | 内容为空，无法生成摘要 |

## 摘要样例

### 1. 中文长文章
习近平党建思想是习近平新时代中国特色社会主义思想的重要组成部分。这一思想围绕新时代党的建设总要求，系统回答了管党治党、兴党强党的重大理论和实践问题。文章指出，全面从严治党必须坚持思想建党和制度治党同向发力。组织建设、干部队伍建设、基层党组织建设和作风纪律建设共同构成实践路径。

### 2. 英文技术文档
The Fetch API provides a JavaScript interface for making HTTP requests and processing responses. Fetch is promise-based and integrates with modern browser features such as service workers and streams. A request can include headers, a method, credentials, and a body. Developers must handle network errors and HTTP status codes separately.

### 3. 列表/聚合页
页面类型：列表/聚合页。页面标题：Hacker News。I Stored a Website in a Favicon。A new database engine improves query speed。

### 4. 论坛评论页
The discussion is about an early Dropbox demo. Several comments praise the simplicity of synchronization across computers. Some users argue that similar workflows could be built with FTP, version control, or network drives. Other comments point out that the value is not only storage but a reliable user experience.

### 5. 视频页可见信息
Video title: Product launch keynote. The page includes a description, view count, publication date, and channel information. No transcript is available in the extracted text. The description says the video introduces new hardware, battery life improvements, and AI features.

### 6. 商品营销页
MacBook Air starts at $1099 and is available in two sizes. The product page emphasizes a thin design, long battery life, and improved performance. It mentions up to 18 hours of battery life and support for Apple Intelligence. Configuration options include memory and storage upgrades.

### 7. 短网页
Example Domain. This domain is for use in documentation examples without needing permission.

### 8. 噪声内容
登录 注册 分享 收藏 更多 广告 推荐。核心正文介绍了浏览器扩展如何从当前页面提取内容并保存为笔记。用户可以编辑标题、标签、分类和摘要。如果页面内容很短，系统应该提醒用户摘要可能不完整。

### 9. 长文短摘要
Rendering performance depends on how quickly the browser can construct the DOM and CSSOM. After parsing HTML and CSS, the browser combines both trees…

### 10. 空内容
内容为空，无法生成摘要