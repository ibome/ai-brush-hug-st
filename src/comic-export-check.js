import { comicRefKey, normalizeComicLayout } from './comic.js';
import { comicPageGeometry, comicLongGeometry, comicBubbleGeometry } from './comic-export.js';
import { comicProtectedRect, comicOverlap } from './comic-layout.js';

export const COMIC_EXPORT_QUALITIES = [['compact', '轻量 · 720px', 720], ['standard', '标准 · 960px', 960], ['high', '高清 · 1440px', 1440]];
export function comicExportWidth(quality) {
  return COMIC_EXPORT_QUALITIES.find(([key]) => key === quality)?.[2] || 960;
}
export function comicPageSelection(value, count) {
  if (!String(value || '').trim()) return Array.from({ length: count }, (_, index) => index + 1);
  if (typeof value !== 'string' || value.length > 120) throw new Error('页码范围无效');
  const selected = new Set();
  for (const part of value.replace(/，/g, ',').split(',')) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error('页码请填写 1、1-3 或 1,3 等格式');
    const start = Number(match[1]), end = Number(match[2] || match[1]);
    if (start < 1 || end < start || end > count) throw new Error(`页码应在 1—${count} 之间`);
    for (let page = start; page <= end; page++) selected.add(page);
  }
  return [...selected].sort((a, b) => a - b);
}
export function comicExportSignature(project) {
  return JSON.stringify([project.id, project.title, project.layout,
    project.panels.map(({ id, image, caption, bubbles, protection }) => ({ id, image, caption, bubbles, protection }))]);
}
export function comicExportInspection(project, { rows = new Map(), states = new Map(), width = 960, selection = '', context } = {}) {
  const pages = comicPageGeometry(project, width, rows), numbers = comicPageSelection(selection, pages.length);
  const selected = pages.filter((page) => numbers.includes(page.number)), issues = [];
  const layout = normalizeComicLayout(project.layout);
  for (const page of selected) for (const rect of page.rects) {
    const panel = project.panels[rect.index], key = comicRefKey(panel.image), state = states.get(key)?.status;
    const issue = (severity, code, message) => issues.push({ severity, code, panelId: panel.id, index: rect.index + 1, message });
    if (!key || state === 'missing' || !rows.has(key)) issue('error', 'missing', `第 ${rect.index + 1} 格缺少原图，请恢复备份或重新选图`);
    else if (state === 'unreachable' || state === 'loading') issue('error', 'unreachable', `第 ${rect.index + 1} 格原图尚不可读取，请检测图片或恢复连接`);
    if (!context) continue;
    const bubbles = [];
    for (const [index, bubble] of panel.bubbles.entries()) {
      if (!bubble.text.trim()) continue;
      try {
        const geometry = comicBubbleGeometry(context, bubble, rect, layout, page.scale);
        if (comicOverlap(geometry, comicProtectedRect(panel, rect)) > geometry.width * geometry.height * 0.03) {
          issue('warning', 'subject-overlap', `第 ${rect.index + 1} 格对白 ${index + 1} 遮挡手动主体保护区，请核对位置`);
        }
        if (geometry.font < layout.fontSize * page.scale * 0.75 || geometry.lines.length > 6) {
          issue('warning', 'dialogue-small', `第 ${rect.index + 1} 格对白 ${index + 1} 较长，字号已缩小，请核对可读性`);
        }
        for (const previous of bubbles) {
          const area = Math.max(0, Math.min(geometry.x + geometry.width, previous.x + previous.width) - Math.max(geometry.x, previous.x))
            * Math.max(0, Math.min(geometry.y + geometry.height, previous.y + previous.height) - Math.max(geometry.y, previous.y));
          if (area > Math.min(geometry.width * geometry.height, previous.width * previous.height) * 0.03) {
            issue('warning', 'bubble-overlap', `第 ${rect.index + 1} 格对白 ${previous.index + 1} 与 ${index + 1} 气泡重叠，请调整位置`);
          }
        }
        bubbles.push({ ...geometry, index });
      } catch { issue('error', 'dialogue-overflow', `第 ${rect.index + 1} 格对白 ${index + 1} 过长，请缩短或增大气泡宽度`); }
    }
  }
  let long = null, longError = '';
  try { long = comicLongGeometry(selected); } catch (error) { longError = error.message; }
  const panelIds = selected.flatMap((page) => page.rects.map((rect) => rect.id));
  return { pages: selected, numbers, width, issues, long, longError, panelIds };
}
