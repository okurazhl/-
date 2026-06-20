/**
 * 导出模块
 * 将笔记导出为 Markdown / JSON / CSV / 纯文本格式
 * 通过创建 Blob 并触发下载实现
 */

import { formatDate, escapeHtml } from './utils.js';

// ========== 格式信息 ==========
const FORMAT_INFO = {
  markdown: { mime: 'text/markdown;charset=utf-8', ext: '.md' },
  json: { mime: 'application/json;charset=utf-8', ext: '.json' },
  csv: { mime: 'text/csv;charset=utf-8', ext: '.csv' },
  text: { mime: 'text/plain;charset=utf-8', ext: '.txt' }
};

// ========== CSV 字段定义 ==========
const CSV_COLUMNS = [
  { key: 'title', label: '标题' },
  { key: 'content', label: '内容' },
  { key: 'summary', label: '摘要' },
  { key: 'type', label: '类型' },
  { key: 'categoryId', label: '分类ID' },
  { key: 'categoryName', label: '分类名称' },
  { key: 'tags', label: '标签' },
  { key: 'url', label: '来源URL' },
  { key: 'sourceTitle', label: '来源标题' },
  { key: 'createdAt', label: '创建时间' },
  { key: 'updatedAt', label: '更新时间' },
  { key: 'pinned', label: '置顶' }
];

// ========== 格式化函数 ==========

/**
 * 格式化笔记为 Markdown
 * @param {Array} notes
 * @param {Function} getCategoryName - (categoryId) => name
 * @returns {string}
 */
function formatMarkdown(notes, getCategoryName) {
  const lines = [];
  const now = formatDate(Date.now(), 'full');

  // 头部
  lines.push('# 网页笔记助手 — 导出');
  lines.push('');
  lines.push(`> 导出时间：${now}`);
  lines.push(`> 笔记数量：${notes.length}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // 每条笔记
  notes.forEach((note, index) => {
    const title = note.title || '未命名笔记';
    const categoryName = getCategoryName ?
      (getCategoryName(note.categoryId) || '未分类') : (note.categoryId || '未分类');

    lines.push(`## ${index + 1}. ${title}`);
    lines.push('');

    // 元数据表格
    lines.push('| 属性 | 值 |');
    lines.push('|------|-----|');
    lines.push(`| 类型 | ${getTypeLabel(note.type)} |`);
    lines.push(`| 分类 | ${categoryName} |`);
    if (note.tags && note.tags.length > 0) {
      lines.push(`| 标签 | ${note.tags.join(', ')} |`);
    }
    lines.push(`| 创建时间 | ${formatDate(note.createdAt, 'full')} |`);
    lines.push(`| 更新时间 | ${formatDate(note.updatedAt, 'full')} |`);
    if (note.pinned) {
      lines.push('| 置顶 | 📌 是 |');
    }
    if (note.url) {
      lines.push(`| 来源 | [${note.sourceTitle || note.url}](${note.url}) |`);
    }
    lines.push('');

    // 摘要
    if (note.summary) {
      lines.push('### 摘要');
      lines.push('');
      lines.push(note.summary);
      lines.push('');
    }

    // 正文
    if (note.content) {
      lines.push('### 内容');
      lines.push('');
      lines.push(note.content);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  });

  // 页脚
  lines.push(`*由「网页笔记助手」Chrome 扩展生成*`);

  return lines.join('\n');
}

/**
 * 格式化笔记为 JSON
 * @param {Array} notes
 * @returns {string}
 */
function formatJSON(notes) {
  const exportData = {
    exportedAt: Date.now(),
    exportedAtFormatted: formatDate(Date.now(), 'full'),
    count: notes.length,
    notes: notes.map(note => ({
      ...note,
      createdAtFormatted: formatDate(note.createdAt, 'full'),
      updatedAtFormatted: formatDate(note.updatedAt, 'full'),
      tagsFormatted: note.tags ? note.tags.join(', ') : ''
    }))
  };

  return JSON.stringify(exportData, null, 2);
}

/**
 * 格式化笔记为 CSV
 * @param {Array} notes
 * @param {Function} getCategoryName
 * @returns {string}
 */
function formatCSV(notes, getCategoryName) {
  const lines = [];

  // 表头
  lines.push(CSV_COLUMNS.map(c => csvEscape(c.label)).join(','));

  // 数据行
  notes.forEach(note => {
    const categoryName = getCategoryName ?
      (getCategoryName(note.categoryId) || '') : (note.categoryId || '');

    const row = CSV_COLUMNS.map(col => {
      let value = '';
      switch (col.key) {
        case 'title':
          value = note.title || '';
          break;
        case 'content':
          value = (note.content || '').replace(/\n/g, ' ').slice(0, 500);
          break;
        case 'summary':
          value = note.summary || '';
          break;
        case 'type':
          value = getTypeLabel(note.type);
          break;
        case 'categoryId':
          value = note.categoryId || '';
          break;
        case 'categoryName':
          value = categoryName;
          break;
        case 'tags':
          value = (note.tags || []).join('; ');
          break;
        case 'url':
          value = note.url || '';
          break;
        case 'sourceTitle':
          value = note.sourceTitle || '';
          break;
        case 'createdAt':
          value = formatDate(note.createdAt, 'full');
          break;
        case 'updatedAt':
          value = formatDate(note.updatedAt, 'full');
          break;
        case 'pinned':
          value = note.pinned ? '是' : '否';
          break;
        default:
          value = '';
      }
      return csvEscape(value);
    });

    lines.push(row.join(','));
  });

  return lines.join('\n');
}

/**
 * 格式化笔记为纯文本
 * @param {Array} notes
 * @param {Function} getCategoryName
 * @returns {string}
 */
function formatText(notes, getCategoryName) {
  const lines = [];
  const now = formatDate(Date.now(), 'full');

  lines.push('='.repeat(60));
  lines.push('  网页笔记助手 — 导出');
  lines.push(`  时间：${now}  |  数量：${notes.length} 条`);
  lines.push('='.repeat(60));
  lines.push('');

  notes.forEach((note, index) => {
    const categoryName = getCategoryName ?
      (getCategoryName(note.categoryId) || '未分类') : (note.categoryId || '未分类');

    lines.push(`【${index + 1}】${note.title || '未命名笔记'}`);
    lines.push('-'.repeat(50));
    lines.push(`类型：${getTypeLabel(note.type)}  |  分类：${categoryName}  |  ${note.pinned ? '📌 置顶  |  ' : ''}`);
    lines.push(`创建：${formatDate(note.createdAt, 'full')}  |  更新：${formatDate(note.updatedAt, 'full')}`);
    if (note.tags && note.tags.length > 0) {
      lines.push(`标签：${note.tags.join(', ')}`);
    }
    if (note.url) {
      lines.push(`来源：${note.url}`);
    }
    lines.push('');

    if (note.summary) {
      lines.push('【摘要】');
      lines.push(note.summary);
      lines.push('');
    }

    if (note.content) {
      lines.push('【内容】');
      lines.push(note.content);
      lines.push('');
    }

    lines.push('');
  });

  lines.push('='.repeat(60));
  lines.push('由「网页笔记助手」Chrome 扩展生成');

  return lines.join('\n');
}

// ========== 主导出函数 ==========

/**
 * 格式化笔记为指定格式的字符串
 * @param {Array} notes - 笔记数组
 * @param {string} format - 'markdown' | 'json' | 'csv' | 'text'
 * @param {object} options - { getCategoryName, fileName }
 * @returns {{ content: string, mime: string, ext: string, fileName: string }}
 */
export function formatNotes(notes, format = 'markdown', options = {}) {
  const { getCategoryName } = options;
  const info = FORMAT_INFO[format] || FORMAT_INFO.markdown;

  let content = '';

  switch (format) {
    case 'markdown':
      content = formatMarkdown(notes, getCategoryName);
      break;
    case 'json':
      content = formatJSON(notes);
      break;
    case 'csv':
      content = formatCSV(notes, getCategoryName);
      break;
    case 'text':
      content = formatText(notes, getCategoryName);
      break;
    default:
      content = formatMarkdown(notes, getCategoryName);
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `笔记导出_${dateStr}${info.ext}`;

  return {
    content,
    mime: info.mime,
    ext: info.ext,
    fileName
  };
}

/**
 * 导出笔记并触发浏览器下载
 * @param {Array} notes - 笔记数组
 * @param {string} format - 导出格式 ('markdown' | 'json' | 'csv' | 'text')
 * @param {object} options - { getCategoryName }
 * @returns {Promise<{success: boolean, fileName?: string, error?: string}>}
 */
export async function exportNotes(notes, format = 'markdown', options = {}) {
  if (!notes || notes.length === 0) {
    return { success: false, error: '没有可导出的笔记' };
  }

  try {
    const { content, mime, fileName } = formatNotes(notes, format, options);

    // 创建 Blob
    const blob = new Blob(['﻿' + content], { type: mime });  // BOM 确保 Excel 正确识别中文 CSV

    // 方案1: 使用 Chrome downloads API（如果在 Service Worker 中）
    if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
      const url = URL.createObjectURL(blob);
      try {
        const downloadId = await chrome.downloads.download({
          url: url,
          filename: fileName,
          saveAs: true
        });

        // 延迟释放 URL（确保下载已开始）
        setTimeout(() => URL.revokeObjectURL(url), 5000);

        return { success: true, fileName, downloadId };
      } catch (err) {
        URL.revokeObjectURL(url);
        throw err;
      }
    }

    // 方案2: 使用 Blob URL + 隐藏链接（在侧边栏中）
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    // 清理
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);

    return { success: true, fileName };
  } catch (err) {
    console.error('[Export] 导出失败:', err);
    return { success: false, error: `导出失败: ${err.message}` };
  }
}

/**
 * 获取格式信息（MIME、扩展名）
 * @param {string} format
 * @returns {{ mime: string, ext: string }}
 */
export function getFormatInfo(format) {
  return FORMAT_INFO[format] || FORMAT_INFO.markdown;
}

// ========== 辅助 ==========

/** CSV 值转义 */
function csvEscape(value) {
  const str = String(value || '');
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/** 笔记类型中文标签 */
function getTypeLabel(type) {
  const labels = {
    'manual': '手动创建',
    'extracted': '页面提取',
    'summarized': 'AI 摘要',
    'quick-url': '快速链接',
    'quick-selection': '选中文本'
  };
  return labels[type] || type || '未知';
}
