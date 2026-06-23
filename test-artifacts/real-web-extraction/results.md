# 真实网页内容提取与总结验收报告

生成时间：2026-06-22T05:41:55.208Z
真实浏览器：可用（C:\Program Files\Google\Chrome\Application\chrome.exe）
CDP 端口：52459

## 总体结论

- 通过：9
- 失败：1
- 阻塞：0
- 未测试：0

## 验收项

| # | 验收项 | 结论 | 证据 |
|---|---|---|---|
| 1 | 普通文章正文提取并过滤导航、广告、页脚、评论、推荐 | pass | article-webdev-render-tree: pass (正文命中预期关键词，未命中导航/页脚/评论/推荐类禁词。)<br>article-chrome-docs: pass (正文命中预期关键词，未命中导航/页脚/评论/推荐类禁词。)<br>readability_uses_clean_document_clone: pass (Readability 使用清理后的 document clone，避免修改真实页面并减少噪声。) |
| 2 | 普通视频页优先提取可见 Transcript 或 HTML 字幕轨道 | pass | generic-video-track-vtt: pass (generic transcript extracted; source=html-track:en)<br>generic-video-visible-transcript: pass (generic transcript extracted; source=visible-transcript) |
| 3 | YouTube 视频页优先提取字幕/Transcript | fail | youtube-transcript-preferred: fail (method=youtube-metadata, transcript=false, fallback=true, uiNoise=)<br>youtube-fixture-player-caption-track: pass (fixture passed; method=youtube-transcript; source=player-response:en; fetches=1)<br>youtube-fixture-partial-visible-prefers-caption: pass (fixture passed; method=youtube-transcript; source=player-response:en; fetches=1)<br>youtube-fixture-youtubei-caption-track: pass (fixture passed; method=youtube-transcript; source=youtubei-player:en; fetches=2)<br>youtube-fixture-scrollable-transcript-panel: pass (fixture passed; method=youtube-transcript; source=youtube-visible-transcript-scroll; fetches=1)<br>youtube-fixture-get-transcript-endpoint: pass (fixture passed; method=youtube-transcript; source=youtube-get-transcript; fetches=2)<br>sw_user_transcript_api_success: pass (Service Worker 使用用户后端字幕升级 YouTube 内容，并清洗 HTML payload。)<br>youtube_transcript_provider_pipeline: pass (YouTube 字幕提取已整理为 provider 管线，可继续接入可选外部 provider。)<br>youtube_user_transcript_api_static: pass (Service Worker 已接入可选用户 YouTube 字幕后端，后端以 yt-dlp 为第一 provider。) |
| 4 | YouTube 字幕不可用时降级标题、简介、章节并明确提示 | pass | youtube-caption-blocked-fallback: pass (YouTube 使用专用提取路径，未把整页 body 文本作为摘要主体。)<br>youtube-fixture-partial-visible-fallback: pass (fixture passed; method=youtube-metadata; source=-; fetches=1)<br>youtube-fixture-short-description-fallback: pass (fixture passed; method=youtube-metadata; source=-; fetches=1)<br>youtube-fixture-generic-meta-description: pass (fixture passed; method=youtube-metadata; source=-; fetches=1)<br>sw_user_transcript_api_failure_fallback: pass (用户字幕后端失败时保留 YouTube metadata fallback，并明确提示用户。) |
| 5 | YouTube 不使用整页 document.body.innerText 作为主要总结内容 | pass | youtube_no_body_innertext_main_path: pass (YouTube 专用分支不以 document.body.innerText 作为主体内容来源。) |
| 6 | 长网页有长度控制 | pass | prompt_content_limit: pass (requestBodyLength=8735) |
| 7 | 动态网页加载后可重新提取 | pass | youtube-dynamic-reextract: pass (initialLength=270, afterLength=270, method=youtube-metadata) |
| 8 | 模型请求只包含必要内容和摘要输入 | pass | sw_user_transcript_api_minimal_request: pass (用户字幕后端请求只包含 videoId/url/languages/maxChars，密钥只在 Authorization header。)<br>request_no_api_key_in_body: pass (API Key 只能出现在 Authorization header，不能进入 JSON prompt body。)<br>image_url_stripped_before_prompt: pass (prepareSummaryContent 应移除图片 URL 噪声。)<br>extract_removes_forms_and_passwords: pass (提取前 DOM clone 清理 form/input/textarea，并识别 password/login 页面。)<br>extract_does_not_read_cookie: pass (提取、摘要和 LLM 客户端源码不得读取 document.cookie。)<br>webpage_summary_uses_extracted_content_only: pass (总结当前网页时使用提取正文生成摘要，保存摘要笔记时正文为空，不把历史/手写笔记拼进网页摘要请求。) |
| 9 | Prompt 明确把网页内容和字幕视为不可信输入 | pass | prompt_untrusted_boundary: pass (系统 prompt 和用户 prompt 必须声明网页内容/字幕/Transcript 不可信，并要求简体中文输出。) |
| 10 | 模型返回内容安全渲染防 XSS | pass | llm_response_captured_for_xss_check: pass (假模型返回 HTML payload，后续由 UI 静态断言确认使用 textContent/value 渲染。)<br>summary_render_uses_textcontent: pass (摘要结果使用 textContent，编辑器 textarea 使用 value，列表 HTML 插值经过 escapeHtml。) |

## 真实网页结果

| 用例 | URL | 结论 | 方法 | 长度 | 证据 |
|---|---|---|---|---:|---|
| web.dev Render-tree construction | https://web.dev/articles/critical-rendering-path/render-tree-construction | pass | readability | 1921 | 正文命中预期关键词，未命中导航/页脚/评论/推荐类禁词。 |
| Chrome Extensions Get started | https://developer.chrome.com/docs/extensions/get-started | pass | readability | 1151 | 正文命中预期关键词，未命中导航/页脚/评论/推荐类禁词。 |
| YouTube transcript available | https://www.youtube.com/watch?v=dQw4w9WgXcQ | fail | youtube-metadata | 2244 | method=youtube-metadata, transcript=false, fallback=true, uiNoise= |
| YouTube transcript blocked fallback | https://www.youtube.com/watch?v=arj7oStGLkU | pass | youtube-metadata | 1787 | YouTube 使用专用提取路径，未把整页 body 文本作为摘要主体。 |
| YouTube dynamic re-extract | https://www.youtube.com/watch?v=jNQXAC9IVRw | pass | youtube-metadata | 270 | initialLength=270, afterLength=270, method=youtube-metadata |

## YouTube 专项结论


## YouTube Fixture Results

| Case | Conclusion | Method | Transcript | Evidence |
|---|---|---|---|---|
| YouTube fixture: playerResponse captionTracks | pass | youtube-transcript | yes | fixture passed; method=youtube-transcript; source=player-response:en; fetches=1 |
| YouTube fixture: partial visible transcript prefers captionTracks | pass | youtube-transcript | yes | fixture passed; method=youtube-transcript; source=player-response:en; fetches=1 |
| YouTube fixture: youtubei/player captionTracks | pass | youtube-transcript | yes | fixture passed; method=youtube-transcript; source=youtubei-player:en; fetches=2 |
| YouTube fixture: partial visible transcript falls back to metadata | pass | youtube-metadata | no | fixture passed; method=youtube-metadata; source=-; fetches=1 |
| YouTube fixture: scrollable transcript panel | pass | youtube-transcript | yes | fixture passed; method=youtube-transcript; source=youtube-visible-transcript-scroll; fetches=1 |
| YouTube fixture: get_transcript endpoint | pass | youtube-transcript | yes | fixture passed; method=youtube-transcript; source=youtube-get-transcript; fetches=2 |
| YouTube fixture: metadata fallback with description | pass | youtube-metadata | no | fixture passed; method=youtube-metadata; source=-; fetches=1 |
| YouTube fixture: generic meta description ignored | pass | youtube-metadata | no | fixture passed; method=youtube-metadata; source=-; fetches=1 |

## Generic Video Fixture Results

| Case | Conclusion | Method | Transcript | Evidence |
|---|---|---|---|---|
| Generic video fixture: HTML track VTT | pass | video-transcript | yes | generic transcript extracted; source=html-track:en |
| Generic video fixture: visible transcript | pass | video-transcript | yes | generic transcript extracted; source=visible-transcript |

## User Transcript API Results

| Case | Conclusion | Method | Transcript | Evidence |
|---|---|---|---|---|
| sw_user_transcript_api_success | pass | youtube-transcript | yes | Service Worker 使用用户后端字幕升级 YouTube 内容，并清洗 HTML payload。 |
| sw_user_transcript_api_minimal_request | pass | - | no | 用户字幕后端请求只包含 videoId/url/languages/maxChars，密钥只在 Authorization header。 |
| sw_user_transcript_api_failure_fallback | pass | youtube-metadata | no | 用户字幕后端失败时保留 YouTube metadata fallback，并明确提示用户。 |

## YouTube Special Conclusion

- YouTube transcript available: fail; method=youtube-metadata; transcript=no; method=youtube-metadata, transcript=false, fallback=true, uiNoise=
- YouTube transcript blocked fallback: pass; method=youtube-metadata; transcript=no; YouTube 使用专用提取路径，未把整页 body 文本作为摘要主体。
- YouTube dynamic re-extract: pass; method=youtube-metadata; transcript=no; initialLength=270, afterLength=270, method=youtube-metadata
- YouTube fixture: playerResponse captionTracks: pass; method=youtube-transcript; transcript=yes; fixture passed; method=youtube-transcript; source=player-response:en; fetches=1
- YouTube fixture: partial visible transcript prefers captionTracks: pass; method=youtube-transcript; transcript=yes; fixture passed; method=youtube-transcript; source=player-response:en; fetches=1
- YouTube fixture: youtubei/player captionTracks: pass; method=youtube-transcript; transcript=yes; fixture passed; method=youtube-transcript; source=youtubei-player:en; fetches=2
- YouTube fixture: partial visible transcript falls back to metadata: pass; method=youtube-metadata; transcript=no; fixture passed; method=youtube-metadata; source=-; fetches=1
- YouTube fixture: scrollable transcript panel: pass; method=youtube-transcript; transcript=yes; fixture passed; method=youtube-transcript; source=youtube-visible-transcript-scroll; fetches=1
- YouTube fixture: get_transcript endpoint: pass; method=youtube-transcript; transcript=yes; fixture passed; method=youtube-transcript; source=youtube-get-transcript; fetches=2
- YouTube fixture: metadata fallback with description: pass; method=youtube-metadata; transcript=no; fixture passed; method=youtube-metadata; source=-; fetches=1
- YouTube fixture: generic meta description ignored: pass; method=youtube-metadata; transcript=no; fixture passed; method=youtube-metadata; source=-; fetches=1
- Service Worker user transcript API success: pass; method=youtube-transcript; transcript=yes; Service Worker 使用用户后端字幕升级 YouTube 内容，并清洗 HTML payload。
- Service Worker user transcript API failure fallback: pass; method=youtube-metadata; transcript=no; 用户字幕后端失败时保留 YouTube metadata fallback，并明确提示用户。