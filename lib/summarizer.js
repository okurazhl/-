/**
 * 摘要引擎（Service Worker 侧）
 * 当前版本只支持云端 LLM 摘要，不再执行本地摘要或直通回退。
 */

import { callLLM } from './llm-client.js';
import { prepareSummaryContent } from './summary-content.js';

/**
 * 生成云端摘要
 * @param {object} config - LLM 配置 { endpoint, apiKey, model, enabled }
 * @param {string} title - 文章标题
 * @param {string} content - 文章内容
 * @param {object} options - { length: 'short'|'medium'|'long', mode: 'llm' }
 * @returns {Promise<{success: boolean, summary?: string, method?: string, error?: string, usage?: object}>}
 */
export async function generateSummary(config, title, content, options = {}) {
  const length = options.length || 'medium';
  const mode = options.mode || 'llm';
  const requestId = options.requestId || '';
  const pageType = options.pageType || 'article';
  const signal = options.signal || null;

  if (mode !== 'llm') {
    return {
      success: false,
      error: '当前版本仅支持云端 LLM 摘要',
      method: 'none'
    };
  }

  const summaryContent = prepareSummaryContent(content);
  if (!summaryContent) {
    return { success: false, error: '内容为空，无法生成摘要', method: 'none' };
  }

  if (signal?.aborted) {
    return { success: false, code: 'CANCELLED', error: '已取消生成', method: 'none' };
  }

  if (!config || !config.enabled || !config.apiKey || !config.endpoint) {
    return {
      success: false,
      error: '未配置云端摘要，请先在设置中启用云端摘要并填写 API 地址和密钥',
      method: 'llm'
    };
  }

  console.log('[Summarizer] 调用云端 LLM:', { requestId, contentLength: summaryContent.length });

  try {
    const result = await callLLM(config, title, summaryContent, {
      length,
      requestId,
      pageType,
      signal
    });

    if (result.success && result.summary) {
      console.log('[Summarizer] 云端 LLM 摘要成功:', { requestId });
      return {
        success: true,
        summary: result.summary,
        method: 'llm',
        usage: result.usage || null
      };
    }

    console.warn('[Summarizer] 云端 LLM 摘要失败:', {
      requestId,
      error: result.error,
      code: result.code || ''
    });

    return {
      success: false,
      code: result.code,
      error: result.error || '云端 LLM 摘要失败',
      method: 'llm'
    };
  } catch (err) {
    console.warn('[Summarizer] 云端 LLM 摘要异常:', { requestId, error: err.message });
    return {
      success: false,
      error: err.message || '云端 LLM 摘要异常',
      method: 'llm'
    };
  }
}
