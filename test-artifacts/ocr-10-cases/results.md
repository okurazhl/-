# OCR 10 Cases Test Results

- Run at: 2026-06-20T14:48:48.215Z
- Total: 10
- Passed: 10
- Failed: 0
- Native TextDetector available before mock: no

| # | Case | Result | OCR status | Recognized | Failed | Evaluation | Preview |
|---:|---|---|---|---:|---:|---|---|
| 1 | single-image-zh | 通过 | supported, attempted=true | 1 | 0 | 符合预期 | 单张中文正文图 正文在图片中。 图片内容： - 会议长图（920x560）: http://127.0.0.1:51843/img/single-image-zh-1.svg 图片 OCR 文字： 1. 会议长图（920x560） 会议通知 |
| 2 | multi-image | 通过 | supported, attempted=true | 2 | 0 | 符合预期 | 多张正文图 页面由两张图组成。 图片内容： - 步骤一（900x520）: http://127.0.0.1:51843/img/multi-image-1.svg - 步骤二（900x520）: http://127.0.0.1:5184 |
| 3 | partial-failure | 通过 | supported, attempted=true | 1 | 1 | 符合预期 | 部分图片识别失败 第二张图模拟浏览器检测异常。 图片内容： - 可识别图（900x520）: http://127.0.0.1:51843/img/partial-failure-1.svg - 失败图（900x520）: http://1 |
| 4 | unsupported-detector | 通过 | unsupported, attempted=false | 0 | 0 | 符合预期 | 浏览器不支持 TextDetector 只有正文图片，浏览器没有 OCR 能力。 图片内容： - 政策图（900x520）: http://127.0.0.1:51843/img/unsupported-detector-1.svg |
| 5 | small-image-ignore | 通过 | no candidate | 0 | 0 | 符合预期 | 小图标不进入 OCR这是一个含小图标的普通短页面，图标不应进入 OCR 候选。 |
| 6 | empty-ocr | 通过 | supported, attempted=true | 0 | 0 | 符合预期 | OCR 返回空结果 图片可能不含可识别文字。 图片内容： - 空白图（900x520）: http://127.0.0.1:51843/img/empty-ocr-1.svg |
| 7 | dedupe-lines | 通过 | supported, attempted=true | 1 | 0 | 符合预期 | OCR 行去重 同一张图里 OCR 返回重复内容。 图片内容： - 去重图片（900x520）: http://127.0.0.1:51843/img/dedupe-lines-1.svg 图片 OCR 文字： 1. 去重图片（900x52 |
| 8 | text-rich-unsupported | 通过 | unsupported, attempted=false | 0 | 0 | 符合预期 | 正文足够时不制造图片重警告 这是一段足够长的普通正文，用来模拟新闻或文档页面已经有可提取文本。 即使页面中包含一张正文图片，OCR 不可用也不应该把整个页面标记为图片正文不可读。 用户仍然可以基于这些文本生成摘要，图片信息只作为补充线索保留 |
| 9 | candidate-limit-five | 通过 | supported, attempted=true | 5 | 0 | 符合预期 | 最多处理五张正文图 页面包含六张大图，只处理前五张。 图片内容： - 正文图 1（900x520）: http://127.0.0.1:51843/img/candidate-limit-five-1.svg - 正文图 2（900x520 |
| 10 | ocr-timeout | 通过 | supported, attempted=true | 0 | 1 | 符合预期 | 单图 OCR 超时 这张图模拟 OCR 长时间无响应。 图片内容： - 超时图（900x520）: http://127.0.0.1:51843/img/ocr-timeout-1.svg |