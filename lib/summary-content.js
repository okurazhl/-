/**
 * 摘要专用内容清洗。
 * 保留笔记原文不变，只在生成摘要前移除图片 URL 噪声并突出 OCR 文本。
 */

export const IMAGE_INFO_TITLE = '图片内容：';
export const IMAGE_OCR_TITLE = '图片 OCR 文字：';

const URL_RE = /https?:\/\/[^\s)）\]】>]+/g;

export function hasImageInfo(content) {
  return String(content || '').includes(IMAGE_INFO_TITLE);
}

export function hasImageOcr(content) {
  return String(content || '').includes(IMAGE_OCR_TITLE);
}

export function getVisibleTextWithoutImageInfo(content) {
  return cleanPlainText(removeImageBlocks(content));
}

export function prepareSummaryContent(content) {
  const raw = String(content || '').trim();
  if (!raw) return '';

  const visibleText = getVisibleTextWithoutImageInfo(raw);
  const ocrText = normalizeOcrText(getImageOcrBlock(raw));
  const imageDescriptions = getImageDescriptions(raw);

  const parts = [];
  if (visibleText) parts.push(visibleText);
  if (ocrText) parts.push(`图片 OCR 转写文字：\n${ocrText}`);
  if (imageDescriptions.length > 0) {
    parts.push(`图片说明：\n${imageDescriptions.map(item => `- ${item}`).join('\n')}`);
  }

  return parts.join('\n\n').trim();
}

function removeImageBlocks(content) {
  return String(content || '')
    .replace(/图片内容：\n[\s\S]*?(?=\n\n图片 OCR 文字：|$)/, '')
    .replace(/图片 OCR 文字：\n[\s\S]*$/, '');
}

function getImageInfoBlock(content) {
  const match = String(content || '').match(/图片内容：\n([\s\S]*?)(?=\n\n图片 OCR 文字：|$)/);
  return match ? match[1].trim() : '';
}

function getImageOcrBlock(content) {
  const match = String(content || '').match(/图片 OCR 文字：\n([\s\S]*)$/);
  return match ? match[1].trim() : '';
}

function getImageDescriptions(content) {
  return uniqueLines(getImageInfoBlock(content)
    .split(/\n+/)
    .map(line => line.replace(/^-\s*/, '').trim())
    .map(line => line.replace(/\s*:\s*https?:\/\/\S+.*$/i, '').trim())
    .map(line => line.replace(URL_RE, '').replace(/\s*[:：]\s*$/, '').trim())
    .filter(Boolean));
}

function normalizeOcrText(block) {
  const lines = splitCleanLines(block);
  if (lines.length === 0) return '';

  const items = [];
  let current = null;

  lines.forEach(line => {
    const labelMatch = line.match(/^\d+\.\s*(.+)$/);
    if (labelMatch) {
      if (current) items.push(current);
      current = { label: labelMatch[1].trim(), texts: [] };
      return;
    }

    if (!current) current = { label: '', texts: [] };
    current.texts.push(line);
  });

  if (current) items.push(current);

  return items.map(item => {
    const label = item.label ? item.label.replace(/\s+/g, ' ').trim() : '';
    const text = uniqueLines(item.texts).join('；');
    if (label && text) return ensureSentence(`${label}：${text}`);
    if (text) return ensureSentence(text);
    return ensureSentence(label);
  }).filter(Boolean).join('\n');
}

function cleanPlainText(text) {
  return splitCleanLines(text)
    .map(line => line.replace(URL_RE, '').replace(/\s+/g, ' ').trim())
    .map(line => line.replace(/\s*[:：]\s*$/, '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function splitCleanLines(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(URL_RE, '')
    .split(/\n+/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function uniqueLines(lines) {
  const seen = new Set();
  const result = [];

  lines.forEach(line => {
    const value = String(line || '').replace(/\s+/g, ' ').trim();
    if (!value) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(value);
  });

  return result;
}

function ensureSentence(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  return /[。！？!?.,，；;]$/.test(value) ? value : `${value}。`;
}
