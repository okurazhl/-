# 网页笔记助手

网页笔记助手是一款 Chrome MV3 侧边栏扩展，用来在浏览网页时提取正文、生成 AI 摘要、保存个人笔记并管理本地知识记录。项目使用原生 JavaScript、HTML、CSS 编写，没有前端框架和构建步骤。

## 功能特性

- 侧边栏笔记管理：新建、编辑、搜索、置顶、分类、标签和自动保存。
- 当前网页提取：通过按需注入 content script 提取文章正文、页面信息、选中文字和链接。
- 一键总结并保存：提取当前网页内容后调用 OpenAI 兼容 LLM 生成中文摘要，并自动保存为本地笔记。
- 手动笔记摘要：对已有笔记正文生成摘要，支持查看将发送给云端模型的内容。
- 学习复盘：按本日、本周、本月汇总已保存摘要，生成学习过程总结。
- YouTube 支持：优先读取页面字幕；不可用时可调用自建 YouTube 字幕后端，失败时退回标题、简介和章节信息。
- 图片文字辅助：在浏览器能力允许时尝试识别正文图片中的文字，并把 OCR 结果并入提取内容。
- 多格式导出：支持 Markdown、JSON、CSV 和纯文本导出。
- 本地优先：笔记、分类、设置和 API 密钥都保存在 `chrome.storage.local`。

## 快速开始

本项目没有构建或编译步骤，直接在 Chrome 中加载源码目录即可。

1. 打开 `chrome://extensions`
2. 开启右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择本项目根目录
5. 打开任意网页，点击扩展图标或使用快捷键 `Ctrl+Shift+Y`

修改代码后，在 `chrome://extensions` 页面点击该扩展的刷新图标即可重新加载。

## LLM 摘要配置

当前版本摘要功能只调用云端 LLM，不再执行本地摘要回退。打开侧边栏后进入“设置”，填写：

- API 地址：OpenAI 兼容的 chat completions 接口，例如 `https://api.openai.com/v1/chat/completions`
- API 密钥：对应服务商的密钥
- 模型名称：例如 `gpt-4o-mini`、`deepseek-chat` 或其他兼容模型
- 启用云端摘要：勾选后才会发送摘要请求

注意：API 密钥以明文形式保存在本机浏览器的 `chrome.storage.local` 中。调用云端摘要时，扩展只会把摘要所需正文和配置的 Authorization 请求头发送到你填写的接口地址。

## YouTube 字幕后端

仓库包含一个可选的 FastAPI 后端，用于在扩展无法从 YouTube 页面直接读取字幕时获取公开字幕。

```powershell
cd backend\youtube-transcript-api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

编辑 `.env`，至少配置：

```env
TRANSCRIPT_API_KEY=change-me
CORS_ALLOW_ORIGIN=chrome-extension://your-extension-id
```

扩展默认后端地址是：

```text
http://127.0.0.1:8788/v1/youtube/transcript
```

建议按默认端口启动：

```powershell
uvicorn app:app --host 127.0.0.1 --port 8788
```

如果使用其他端口，请在扩展设置里的“YouTube 字幕后端”同步修改后端地址和密钥。更多说明见 [backend/youtube-transcript-api/README.md](backend/youtube-transcript-api/README.md)。

## 项目结构

```text
.
├── manifest.json                  # Chrome MV3 扩展清单
├── service-worker.js              # 消息中枢、标签页绑定、LLM 调用、YouTube 后端调用
├── sidepanel/
│   ├── sidepanel.html             # 侧边栏界面
│   ├── sidepanel.css              # 侧边栏样式
│   └── sidepanel.js               # UI 状态、笔记操作、设置、导出、摘要流程
├── content/
│   ├── readability.js             # Readability，全局挂载给经典 content script 使用
│   └── content-extract.js         # 页面正文、YouTube 字幕、图片 OCR、选中文字提取
├── lib/
│   ├── storage.js                 # chrome.storage.local 封装
│   ├── summarizer.js              # 云端摘要入口
│   ├── llm-client.js              # OpenAI 兼容接口调用和提示词
│   ├── summary-content.js         # 摘要输入清理
│   ├── export.js                  # Markdown / JSON / CSV / 文本导出
│   └── utils.js                   # 通用工具函数
├── backend/youtube-transcript-api/ # 可选 YouTube 字幕 FastAPI 后端
└── test-artifacts/                # 回归、OCR、摘要、UX 等测试脚本与结果
```

## 架构流程

```text
sidepanel/  <->  service-worker.js  <->  content/
    |                |
    |                +-> OpenAI 兼容 LLM API
    |                +-> 可选 YouTube 字幕后端
    |
    +-> lib/storage.js / lib/export.js
```

- Side Panel 负责界面、用户操作、笔记编辑和设置管理。
- Service Worker 负责消息转发、按需注入 content script、绑定当前标签页、调用 LLM 和可选后端。
- Content Script 是经典脚本，不能使用 `import` / `export`，通过 `window.Readability` 使用 Readability。
- 所有笔记和设置默认写入 `chrome.storage.local`。

## 数据与隐私

- 笔记、分类、摘要、设置和密钥都保存在本地浏览器。
- 云端摘要只在启用 LLM 且用户触发生成时调用。
- YouTube 字幕后端请求只应包含 `videoId`、`url`、`languages` 和 `maxChars`，密钥只放在 Authorization 请求头。
- 页面提取会尽量避开登录、验证码、表单和密码页；遇到受限页面会提示降级或失败原因。

## 开发说明

- 扩展是纯静态项目，不需要 `npm install`。
- 修改前端、content script 或 service worker 后，需要在 `chrome://extensions` 刷新扩展。
- `content/content-extract.js` 通过 `chrome.scripting.executeScript({ files: [...] })` 注入，必须保持经典脚本写法。
- 分类以 `categoryId` 关联笔记，重命名分类不会改动笔记数据。
- `service-worker.js` 中的长耗时摘要请求带有取消和超时逻辑，避免用户界面长期无响应。
- 当前 `manifest.json` 包含 `host_permissions: ["<all_urls>"]`。如准备提交 Chrome Web Store，请根据审核策略评估是否改回仅依赖 `activeTab` 和 `scripting` 的按需注入方案。

## 测试与验证

测试脚本和结果保存在 `test-artifacts/` 下，可按需运行对应脚本：

```powershell
node test-artifacts\summary-generation\run-summary-test.cjs
node test-artifacts\ocr-10-cases\run-ocr-test.cjs
node test-artifacts\regression-100\run-100-cases.cjs
node test-artifacts\ux-10-webpages\run-ux-test.cjs
node test-artifacts\real-web-extraction\run-real-web-extraction-test.cjs
```

部分测试会启动或控制浏览器页面，请确认本机 Chrome 环境可用。

## 常见问题

### 点击总结没有结果

先检查“设置”里的云端摘要是否启用，API 地址、密钥和模型名称是否填写正确。接口还需要允许浏览器扩展跨域访问。

### YouTube 视频只能总结标题和简介

说明页面字幕读取失败，且可选 YouTube 字幕后端没有配置成功。启动后端后，在扩展设置中填写后端地址和密钥，再重新提取。

### 修改代码后扩展没有变化

Chrome 扩展不会自动监听源码变化。请回到 `chrome://extensions`，点击该扩展卡片上的刷新图标。

### 可以把数据同步到云端吗

当前版本只使用 `chrome.storage.local`，没有账号系统和云同步。需要备份时可以通过导出功能保存 Markdown、JSON、CSV 或纯文本文件。
