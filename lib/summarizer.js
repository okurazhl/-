/**
 * 摘要引擎（Service Worker 侧）
 * 负责云端 LLM 和 TF-IDF 抽取式摘要。
 * Chrome 内置 Summarizer API 只能在 window 环境中调用，由 sidepanel 编排。
 */

import { callLLM } from './llm-client.js';
import { prepareSummaryContent } from './summary-content.js';

// ========== 常量 ==========
const SUMMARY_LENGTHS = {
  short: { sentences: 2, maxChars: 150 },
  medium: { sentences: 4, maxChars: 400 },
  long: { sentences: 7, maxChars: 800 }
};

// ========== 主入口 ==========

/**
 * 生成摘要
 * @param {object} config - LLM 配置 { endpoint, apiKey, model, enabled }
 * @param {string} title - 文章标题
 * @param {string} content - 文章内容
 * @param {object} options - { length: 'short'|'medium'|'long', mode: 'auto'|'llm'|'tfidf' }
 * @returns {Promise<{success: boolean, summary?: string, method?: string, error?: string, usage?: object}>}
 */
export async function generateSummary(config, title, content, options = {}) {
  const length = options.length || 'medium';
  const mode = options.mode || 'auto';
  const requestId = options.requestId || '';
  const pageType = options.pageType || 'article';
  const signal = options.signal || null;
  const summaryContent = prepareSummaryContent(content);

  if (!summaryContent) {
    return { success: false, error: '内容为空，无法生成摘要', method: 'none' };
  }

  if (signal?.aborted) {
    return { success: false, code: 'CANCELLED', error: '已取消生成', method: 'none' };
  }

  if (summaryContent.trim().length < 100) {
    return {
      success: true,
      summary: summaryContent.trim(),
      method: 'passthrough'
    };
  }

  if (mode === 'llm' || mode === 'auto') {
    const llmResult = await tryLLM(config, title, summaryContent, { length, requestId, pageType, signal });
    if (llmResult.success) return llmResult;
    if (llmResult.code === 'CANCELLED') return llmResult;
    if (mode === 'llm') return llmResult;
  }

  if (signal?.aborted) {
    return { success: false, code: 'CANCELLED', error: '已取消生成', method: 'none' };
  }

  if (mode === 'tfidf' || mode === 'auto') {
    return tryTfidf(summaryContent, length);
  }

  return { success: false, error: `未知摘要模式: ${mode}`, method: 'none' };
}

async function tryLLM(config, title, content, options = {}) {
  const { length = 'medium', requestId = '', pageType = 'article', signal = null } = options;
  if (!config || !config.enabled || !config.apiKey || !config.endpoint) {
    return { success: false, error: '云端 LLM 未配置或未启用', method: 'llm' };
  }

  console.log('[Summarizer] 尝试云端 LLM:', { requestId, contentLength: content.length });
  try {
    const result = await callLLM(config, title, content, { length, requestId, pageType, signal });
    if (result.success && result.summary) {
      console.log('[Summarizer] 云端 LLM 摘要成功:', { requestId });
      return {
        success: true,
        summary: result.summary,
        method: 'llm',
        usage: result.usage || null
      };
    }

    console.warn('[Summarizer] 云端 LLM 失败:', { requestId, error: result.error, code: result.code || '' });
    return {
      success: false,
      code: result.code,
      error: result.error || '云端 LLM 摘要失败',
      method: 'llm'
    };
  } catch (err) {
    console.warn('[Summarizer] 云端 LLM 异常:', { requestId, error: err.message });
    return {
      success: false,
      error: err.message || '云端 LLM 摘要异常',
      method: 'llm'
    };
  }
}

function tryTfidf(content, length) {
  console.log('[Summarizer] 使用 TF-IDF 抽取式摘要');
  try {
    const summary = summarizeOcrContent(content, length) || tfidfSummarize(content, length);
    return {
      success: true,
      summary,
      method: 'tfidf'
    };
  } catch (err) {
    console.error('[Summarizer] TF-IDF 摘要失败:', err);
    return {
      success: false,
      error: 'TF-IDF 摘要失败',
      method: 'tfidf'
    };
  }
}

function summarizeOcrContent(content, length) {
  if (!/图片 OCR 转写文字：/.test(content || '')) return '';

  const config = SUMMARY_LENGTHS[length] || SUMMARY_LENGTHS.medium;
  const [visiblePart, rest = ''] = String(content || '').split('图片 OCR 转写文字：');
  const ocrPart = rest.split(/\n\n图片说明：/)[0].trim();
  if (!ocrPart) return '';

  const parts = [];
  const visible = visiblePart.trim();
  if (visible) parts.push(visible);
  parts.push(`图片 OCR 转写文字：\n${ocrPart}`);

  let summary = parts.join('\n\n').trim();
  if (summary.length > config.maxChars) {
    summary = summary.slice(0, config.maxChars).trimEnd() + '…';
  }
  return summary;
}

// ========== TF-IDF 抽取式摘要 ==========

/**
 * TF-IDF 抽取式摘要算法
 * 1. 句子分割 → 2. 分词 → 3. TF-IDF 评分 → 4. 位置加权 → 5. 冗余去除 → 6. 排序输出
 */
function tfidfSummarize(text, length) {
  const config = SUMMARY_LENGTHS[length] || SUMMARY_LENGTHS.medium;
  const targetSentences = config.sentences;

  const sentences = splitSentences(text);

  if (sentences.length <= targetSentences) {
    return text.trim();
  }

  const tokenizedSentences = sentences.map((s, idx) => ({
    index: idx,
    text: s,
    tokens: tokenize(s)
  }));

  const totalDocs = sentences.length;
  const df = new Map();
  const tf = tokenizedSentences.map(ts => {
    const freqMap = new Map();
    const seen = new Set();
    ts.tokens.forEach(token => {
      freqMap.set(token, (freqMap.get(token) || 0) + 1);
      if (!seen.has(token)) {
        seen.add(token);
        df.set(token, (df.get(token) || 0) + 1);
      }
    });
    return { index: ts.index, text: ts.text, freqMap, tokenCount: ts.tokens.length };
  });

  const idf = new Map();
  df.forEach((count, token) => {
    idf.set(token, Math.log(totalDocs / (count + 1)) + 1);
  });

  let sentenceScores = tf.map(item => {
    let score = 0;
    item.freqMap.forEach((count, token) => {
      const tfVal = count / item.tokenCount;
      const idfVal = idf.get(token) || 0;
      score += tfVal * idfVal;
    });
    score = item.tokenCount > 0 ? score / Math.sqrt(item.tokenCount) : 0;
    return { index: item.index, text: item.text, score };
  });

  const n = sentenceScores.length;
  sentenceScores = sentenceScores.map(item => {
    let positionWeight = 1.0;
    const posRatio = item.index / n;

    if (posRatio < 0.2) {
      positionWeight = 1.5 - posRatio * 2.5;
    } else if (posRatio > 0.85) {
      positionWeight = 1.0 + (posRatio - 0.85) * 3;
    } else {
      positionWeight = 0.85;
    }

    return { ...item, score: item.score * positionWeight };
  });

  sentenceScores.sort((a, b) => b.score - a.score);

  const selected = [];
  const selectedTexts = [];

  for (const candidate of sentenceScores) {
    if (selected.length >= targetSentences + 2) break;

    let isRedundant = false;
    for (const st of selectedTexts) {
      const similarity = jaccardSimilarity(candidate.text, st);
      if (similarity > 0.6) {
        isRedundant = true;
        break;
      }
    }

    if (!isRedundant) {
      selected.push(candidate);
      selectedTexts.push(candidate.text);
    }
  }

  selected.sort((a, b) => a.index - b.index);

  const finalSentences = selected.slice(0, targetSentences);
  let summary = joinSummarySentences(finalSentences.map(s => s.text));
  if (summary.length > config.maxChars) {
    summary = summary.slice(0, config.maxChars).trimEnd() + '…';
  }

  return summary;
}

function joinSummarySentences(sentences) {
  return sentences.reduce((result, sentence) => {
    const current = String(sentence || '').trim();
    if (!current) return result;
    if (!result) return current;

    const needsSpace = /[A-Za-z0-9.!?)"'\]]$/.test(result) && /^[A-Za-z0-9("'[]/.test(current);
    return `${result}${needsSpace ? ' ' : ''}${current}`;
  }, '');
}

// ========== 句子分割 ==========

function splitSentences(text) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];

  const raw = cleaned.split(/(?<=[。！？.!?\n])\s*/);

  const sentences = [];
  for (let s of raw) {
    s = s.trim();
    if (!s || s.length < 2) continue;
    if (/^[\d\s\p{P}]+$/u.test(s) && s.length < 5) continue;
    sentences.push(s);
  }

  return sentences;
}

// ========== 分词（中英文混合） ==========

function tokenize(text) {
  if (!text) return [];

  const tokens = [];
  const parts = text.split(/([a-zA-Z0-9]+)/);

  for (const part of parts) {
    if (/^[a-zA-Z0-9]+$/.test(part)) {
      tokens.push(part.toLowerCase());
    } else {
      for (const char of part) {
        if (/[\s\p{P}]/u.test(char)) continue;
        if (/[一-鿿㐀-䶿]/.test(char)) {
          tokens.push(char);
        } else if (char.trim()) {
          tokens.push(char);
        }
      }
    }
  }

  return tokens;
}

// ========== Jaccard 相似度（用于去重） ==========

function jaccardSimilarity(textA, textB) {
  const setA = new Set(tokenize(textA));
  const setB = new Set(tokenize(textB));

  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  setA.forEach(token => {
    if (setB.has(token)) intersection++;
  });

  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}
