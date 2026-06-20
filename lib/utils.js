/**
 * 工具函数模块
 * 提供 ID 生成、日期格式化、防抖、HTML 转义等通用功能
 */

/**
 * 生成唯一 ID
 * 格式: n_20260614_a1b2c3d4e5f6
 * @returns {string}
 */
export function generateId() {
  const now = new Date();
  const dateStr = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  const randomHex = Array.from({ length: 12 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
  return `n_${dateStr}_${randomHex}`;
}

/**
 * 格式化时间戳为可读字符串
 * @param {number} timestamp - 毫秒时间戳
 * @param {'full'|'date'|'time'|'relative'} mode - 模式
 * @returns {string}
 */
export function formatDate(timestamp, mode = 'full') {
  const date = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, '0');

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());

  switch (mode) {
    case 'full':
      return `${year}-${month}-${day} ${hours}:${minutes}`;
    case 'date':
      return `${year}-${month}-${day}`;
    case 'time':
      return `${hours}:${minutes}`;
    case 'relative': {
      const now = Date.now();
      const diff = now - timestamp;
      const seconds = Math.floor(diff / 1000);
      const minutesAgo = Math.floor(seconds / 60);
      const hoursAgo = Math.floor(minutesAgo / 60);
      const daysAgo = Math.floor(hoursAgo / 24);

      if (seconds < 60) return '刚刚';
      if (minutesAgo < 60) return `${minutesAgo} 分钟前`;
      if (hoursAgo < 24) return `${hoursAgo} 小时前`;
      if (daysAgo < 7) return `${daysAgo} 天前`;
      if (daysAgo < 30) return `${Math.floor(daysAgo / 7)} 周前`;
      return `${year}-${month}-${day}`;
    }
    default:
      return `${year}-${month}-${day} ${hours}:${minutes}`;
  }
}

/**
 * 防抖函数
 * @param {Function} fn - 要防抖的函数
 * @param {number} delay - 延迟毫秒数
 * @returns {Function} 防抖后的函数
 */
export function debounce(fn, delay = 300) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
      timer = null;
    }, delay);
  };
}

/**
 * HTML 转义，防止 XSS
 * @param {string} str - 原始字符串
 * @returns {string} 转义后的字符串
 */
export function escapeHtml(str) {
  if (!str) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(str).replace(/[&<>"']/g, (char) => map[char]);
}

/**
 * 截断文本并添加省略号
 * @param {string} str - 原始字符串
 * @param {number} maxLen - 最大长度
 * @returns {string}
 */
export function truncate(str, maxLen = 150) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen).trimEnd() + '…';
}

/**
 * 清理标签数组（去空格、去空字符串、去重）
 * @param {string|string[]} tags - 逗号分隔的标签字符串或数组
 * @returns {string[]}
 */
export function normalizeTags(tags) {
  if (!tags) return [];
  if (typeof tags === 'string') {
    return [...new Set(
      tags.split(/[,，]/)
        .map(t => t.trim())
        .filter(Boolean)
    )];
  }
  if (Array.isArray(tags)) {
    return [...new Set(
      tags.map(t => String(t).trim()).filter(Boolean)
    )];
  }
  return [];
}

/**
 * 获取文本的前 N 个字符作为摘要预览
 * @param {string} text - 原始文本
 * @param {number} maxLen - 最大长度
 * @returns {string}
 */
export function getExcerpt(text, maxLen = 150) {
  if (!text) return '';
  // 移除多余空白，取前 maxLen 字符
  const cleaned = String(text).replace(/\s+/g, ' ').trim();
  return truncate(cleaned, maxLen);
}
