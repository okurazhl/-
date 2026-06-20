# OCR Full Transcriptions And Summaries

- Run at: 2026-06-20T14:48:48.215Z
- Total: 10
- Passed: 10
- Failed: 0

## 1. single-image-zh

- Result: 通过
- OCR: recognized=1, failed=0, supported=true
- Summary method: passthrough

### OCR 转写全文

```text
1. 会议长图（920x560）
  会议通知
  报名截止 6月30日
```

### 摘要生成内容

```text
单张中文正文图
正文在图片中。

图片 OCR 转写文字：
会议长图（920x560）：会议通知；报名截止 6月30日。

图片说明：
- 会议长图（920x560）
```

### 提取正文全文

```text
单张中文正文图
正文在图片中。

图片内容：
- 会议长图（920x560）: http://127.0.0.1:51843/img/single-image-zh-1.svg

图片 OCR 文字：
1. 会议长图（920x560）
  会议通知
  报名截止 6月30日
```

## 2. multi-image

- Result: 通过
- OCR: recognized=2, failed=0, supported=true
- Summary method: tfidf

### OCR 转写全文

```text
1. 步骤一（900x520）
  第一步：打开设置

2. 步骤二（900x520）
  第二步：保存笔记
```

### 摘要生成内容

```text
多张正文图
页面由两张图组成。

图片 OCR 转写文字：
步骤一（900x520）：第一步：打开设置。
步骤二（900x520）：第二步：保存笔记。
```

### 提取正文全文

```text
多张正文图
页面由两张图组成。

图片内容：
- 步骤一（900x520）: http://127.0.0.1:51843/img/multi-image-1.svg
- 步骤二（900x520）: http://127.0.0.1:51843/img/multi-image-2.svg

图片 OCR 文字：
1. 步骤一（900x520）
  第一步：打开设置

2. 步骤二（900x520）
  第二步：保存笔记
```

## 3. partial-failure

- Result: 通过
- OCR: recognized=1, failed=1, supported=true
- Summary method: passthrough

### OCR 转写全文

```text
1. 可识别图（900x520）
  可识别文本 A
```

### 摘要生成内容

```text
部分图片识别失败
第二张图模拟浏览器检测异常。

图片 OCR 转写文字：
可识别图（900x520）：可识别文本 A。

图片说明：
- 可识别图（900x520）
- 失败图（900x520）
```

### 提取正文全文

```text
部分图片识别失败
第二张图模拟浏览器检测异常。

图片内容：
- 可识别图（900x520）: http://127.0.0.1:51843/img/partial-failure-1.svg
- 失败图（900x520）: http://127.0.0.1:51843/img/partial-failure-2.svg

图片 OCR 文字：
1. 可识别图（900x520）
  可识别文本 A
```

## 4. unsupported-detector

- Result: 通过
- OCR: recognized=0, failed=0, supported=false
- Summary method: passthrough

### OCR 转写全文

```text
(无 OCR 转写)
```

### 摘要生成内容

```text
浏览器不支持 TextDetector
只有正文图片，浏览器没有 OCR 能力。

图片说明：
- 政策图（900x520）
```

### 提取正文全文

```text
浏览器不支持 TextDetector
只有正文图片，浏览器没有 OCR 能力。

图片内容：
- 政策图（900x520）: http://127.0.0.1:51843/img/unsupported-detector-1.svg
```

## 5. small-image-ignore

- Result: 通过
- OCR: recognized=0, failed=0, supported=n/a
- Summary method: passthrough

### OCR 转写全文

```text
(无 OCR 转写)
```

### 摘要生成内容

```text
小图标不进入 OCR这是一个含小图标的普通短页面，图标不应进入 OCR 候选。
```

### 提取正文全文

```text
小图标不进入 OCR这是一个含小图标的普通短页面，图标不应进入 OCR 候选。
```

## 6. empty-ocr

- Result: 通过
- OCR: recognized=0, failed=0, supported=true
- Summary method: passthrough

### OCR 转写全文

```text
(无 OCR 转写)
```

### 摘要生成内容

```text
OCR 返回空结果
图片可能不含可识别文字。

图片说明：
- 空白图（900x520）
```

### 提取正文全文

```text
OCR 返回空结果
图片可能不含可识别文字。

图片内容：
- 空白图（900x520）: http://127.0.0.1:51843/img/empty-ocr-1.svg
```

## 7. dedupe-lines

- Result: 通过
- OCR: recognized=1, failed=0, supported=true
- Summary method: passthrough

### OCR 转写全文

```text
1. 去重图片（900x520）
  重复行
  唯一行
```

### 摘要生成内容

```text
OCR 行去重
同一张图里 OCR 返回重复内容。

图片 OCR 转写文字：
去重图片（900x520）：重复行；唯一行。

图片说明：
- 去重图片（900x520）
```

### 提取正文全文

```text
OCR 行去重
同一张图里 OCR 返回重复内容。

图片内容：
- 去重图片（900x520）: http://127.0.0.1:51843/img/dedupe-lines-1.svg

图片 OCR 文字：
1. 去重图片（900x520）
  重复行
  唯一行
```

## 8. text-rich-unsupported

- Result: 通过
- OCR: recognized=0, failed=0, supported=false
- Summary method: tfidf

### OCR 转写全文

```text
(无 OCR 转写)
```

### 摘要生成内容

```text
正文足够时不制造图片重警告 这是一段足够长的普通正文，用来模拟新闻或文档页面已经有可提取文本。即使页面中包含一张正文图片，OCR 不可用也不应该把整个页面标记为图片正文不可读。用户仍然可以基于这些文本生成摘要，图片信息只作为补充线索保留。这里继续补充一些自然语言内容，确保非图片文本超过阈值并保持页面可读。
```

### 提取正文全文

```text
正文足够时不制造图片重警告
这是一段足够长的普通正文，用来模拟新闻或文档页面已经有可提取文本。 即使页面中包含一张正文图片，OCR 不可用也不应该把整个页面标记为图片正文不可读。 用户仍然可以基于这些文本生成摘要，图片信息只作为补充线索保留。 这里继续补充一些自然语言内容，确保非图片文本超过阈值并保持页面可读。 额外的段落用于模拟真实文章中的背景、事实、观点和结论，确保可见正文已经足够支撑保存和摘要。 这类页面不应该因为 OCR 能力缺失而显示图片正文不可读的强警告，只需要保留图片线索即可。

图片内容：
- 补充图（900x520）: http://127.0.0.1:51843/img/text-rich-unsupported-1.svg
```

## 9. candidate-limit-five

- Result: 通过
- OCR: recognized=5, failed=0, supported=true
- Summary method: tfidf

### OCR 转写全文

```text
1. 正文图 1（900x520）
  OCR-1

2. 正文图 2（900x520）
  OCR-2

3. 正文图 3（900x520）
  OCR-3

4. 正文图 4（900x520）
  OCR-4

5. 正文图 5（900x520）
  OCR-5
```

### 摘要生成内容

```text
最多处理五张正文图
页面包含六张大图，只处理前五张。

图片 OCR 转写文字：
正文图 1（900x520）：OCR-1。
正文图 2（900x520）：OCR-2。
正文图 3（900x520）：OCR-3。
正文图 4（900x520）：OCR-4。
正文图 5（900x520）：OCR-5。
```

### 提取正文全文

```text
最多处理五张正文图
页面包含六张大图，只处理前五张。

图片内容：
- 正文图 1（900x520）: http://127.0.0.1:51843/img/candidate-limit-five-1.svg
- 正文图 2（900x520）: http://127.0.0.1:51843/img/candidate-limit-five-2.svg
- 正文图 3（900x520）: http://127.0.0.1:51843/img/candidate-limit-five-3.svg
- 正文图 4（900x520）: http://127.0.0.1:51843/img/candidate-limit-five-4.svg
- 正文图 5（900x520）: http://127.0.0.1:51843/img/candidate-limit-five-5.svg

图片 OCR 文字：
1. 正文图 1（900x520）
  OCR-1

2. 正文图 2（900x520）
  OCR-2

3. 正文图 3（900x520）
  OCR-3

4. 正文图 4（900x520）
  OCR-4

5. 正文图 5（900x520）
  OCR-5
```

## 10. ocr-timeout

- Result: 通过
- OCR: recognized=0, failed=1, supported=true
- Summary method: passthrough

### OCR 转写全文

```text
(无 OCR 转写)
```

### 摘要生成内容

```text
单图 OCR 超时
这张图模拟 OCR 长时间无响应。

图片说明：
- 超时图（900x520）
```

### 提取正文全文

```text
单图 OCR 超时
这张图模拟 OCR 长时间无响应。

图片内容：
- 超时图（900x520）: http://127.0.0.1:51843/img/ocr-timeout-1.svg
```
