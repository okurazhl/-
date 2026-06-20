# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Chrome 浏览器侧边栏笔记插件（MV3），提供网页内容提取、AI 摘要、笔记管理功能。纯原生 JS/HTML/CSS，零框架依赖。

## 开发命令

没有构建/编译步骤。直接在 Chrome 中加载未打包的扩展：

```
chrome://extensions → 开启"开发者模式" → "加载已解压的扩展程序" → 选择项目根目录
```

修改代码后在 `chrome://extensions` 点击刷新图标即可热加载。

## 架构要点

```
sidepanel/  ←→  service-worker.js  ←→  content/（按需注入）
    ↑              ↑（LLM API 也在这里调用）
    └── lib/（storage, summarizer, export, utils）
```

- **Side Panel**：主 UI，通过 `chrome.runtime.sendMessage` 与 SW 通信
- **Service Worker**：消息中枢 + LLM API 调用（避免 CORS），ES Module 模式
- **Content Script**：**经典脚本**（不能使用 ES module），通过 `chrome.scripting.executeScript` 按需注入，Readability 挂 `window` 全局变量

## 关键约束

1. **不声明 `host_permissions`**：`activeTab` + `scripting` 组合足够注入到当前标签页，声明全站权限会被 CWS 拒审
2. **Content Script 是经典脚本**：通过 `executeScript({files: [...]})` 注入的脚本不能用 `import`/`export`，直接操作 `window` 全局
3. **分类用 ID 引用**：笔记存 `categoryId` 而非名称字符串，重命名分类时笔记数据不受影响
4. **SW 保活**：LLM API 调用可能超 30 秒，期间发心跳防 SW 被终止，60 秒超时回退
5. **所有数据存 `chrome.storage.local`**：含 API 密钥（明文），UI 中需标注"密钥仅存本地"

## 三级摘要回退

```
云端 LLM API（OpenAI 兼容）→ Chrome 内置 Summarizer API → TF-IDF 抽取式
```
