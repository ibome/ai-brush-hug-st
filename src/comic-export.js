import JSZip from 'jszip';
import { escapeHtml } from './config.js';
import { normalizeComicLayout, comicRefKey } from './comic.js';

const MAX_PIXELS = 24000000;
const MAX_BYTES = 64 * 1024 * 1024;
const ratio = { portrait: 1.25, square: 1, landscape: 0.7 };
export function comicPageGeometry(project, width = 960, dimensions = new Map()) {
  const layout = normalizeComicLayout(project.layout), scale = width / 960;
  const gap = Math.round(layout.gap * scale), margin = Math.max(6, gap);
  const columns = layout.mode === 'strip' ? 1 : 2;
  const cellWidth = (width - margin * 2 - gap * (columns - 1)) / columns;
  const perPage = layout.mode === 'grid' ? 4 : 12, pages = [];
  for (let offset = 0; offset < project.panels.length; offset += perPage) {
    const panels = project.panels.slice(offset, offset + perPage);
    const rects = [], header = Math.round(68 * scale), footer = Math.round(32 * scale);
    let y = header + margin;
    for (let row = 0; row < Math.ceil(panels.length / columns); row++) {
      const rowPanels = panels.slice(row * columns, row * columns + columns);
      const imageHeights = rowPanels.map((panel) => {
        const size = dimensions.get(comicRefKey(panel.image));
        const heightRatio = layout.aspect === 'auto'
          ? size?.width > 0 && size?.height > 0 ? Math.max(0.35, Math.min(2.5, size.height / size.width)) : 1
          : ratio[layout.aspect];
        return Math.round(cellWidth * heightRatio);
      });
      const captionHeights = rowPanels.map((panel) => panel.caption ? panel.caption.split('\n').reduce((count, line) =>
        count + Math.max(1, Math.ceil(Array.from(line).length
          / Math.max(4, Math.floor((cellWidth - 24 * scale) / (layout.fontSize * scale))))), 0)
        * layout.fontSize * scale * 1.45 + 20 * scale : 0);
      const rowHeight = Math.max(...imageHeights.map((height, index) => height + captionHeights[index]));
      rowPanels.forEach((panel, col) => {
        const column = layout.direction === 'rtl' ? columns - 1 - col : col;
        rects.push({ id: panel.id, index: offset + row * columns + col, x: margin + column * (cellWidth + gap),
          y, width: cellWidth, imageHeight: imageHeights[col], height: rowHeight, captionHeight: rowHeight - imageHeights[col] });
      });
      y += rowHeight + gap;
    }
    const height = Math.ceil(y + footer);
    if (height > 16000 || height * width > MAX_PIXELS) throw new Error('画布过大，请减少画格、缩短旁白或使用四格分页');
    pages.push({ width, height, rects, scale, number: pages.length + 1 });
  }
  return pages;
}
export function comicLongGeometry(pages) {
  const width = pages[0]?.width || 960, height = pages.reduce((sum, page) => sum + page.height, 0);
  if (!height || height > 16000 || width * height > MAX_PIXELS) throw new Error('长图超过安全尺寸，请改用分页图片导出');
  return { width, height };
}
export function wrapComicText(context, value, maxWidth) {
  const lines = [];
  const closing = /^[，。！？、；：）》」』】〕〉…”’,.!?;:%)]$/u;
  const opening = /[（《「『【〔〈(“‘]$/u;
  for (const paragraph of String(value).split('\n')) {
    let line = '';
    const chars = typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(paragraph)].map((entry) => entry.segment)
      : Array.from(paragraph);
    for (const char of chars) {
      if (line && context.measureText(line + char).width > maxWidth) {
        if (closing.test(char)) {
          const previous = Array.from(line), carry = [];
          do { carry.unshift(previous.pop()); } while (previous.length && closing.test(carry[0]));
          if (previous.length && opening.test(previous.at(-1))) carry.unshift(previous.pop());
          if (previous.length) lines.push(previous.join(''));
          line = carry.join('') + char; continue;
        }
        let carry = '';
        if (opening.test(line)) {
          const previous = Array.from(line); carry = previous.pop(); line = previous.join('');
        }
        if (line) lines.push(line);
        line = carry;
      }
      line += char;
    }
    lines.push(line);
  }
  return lines;
}
function rounded(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath(); context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r); context.closePath();
}
async function decode(blob, signal) {
  if (!blob || !['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) || blob.size > 20 * 1024 * 1024) throw new Error('漫画图片格式无效或超过 20 MB');
  signal?.throwIfAborted();
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      const stop = () => { image.src = ''; reject(new DOMException('已取消', 'AbortError')); };
      const done = (callback) => { signal?.removeEventListener('abort', stop); callback(); };
      image.onload = () => done(resolve); image.onerror = () => done(() => reject(new Error('漫画图片无法解码')));
      signal?.addEventListener('abort', stop, { once: true });
      image.src = url;
    });
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 40000000) throw new Error('漫画原图尺寸超过安全限制');
    return image;
  } finally { URL.revokeObjectURL(url); }
}
function drawFitted(ctx, image, rect, fit) {
  const { x, y, width, imageHeight: height } = rect;
  const factor = Math[fit === 'contain' ? 'min' : 'max'](width / image.naturalWidth, height / image.naturalHeight);
  const w = image.naturalWidth * factor, h = image.naturalHeight * factor;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
  ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h); ctx.restore();
}
export function comicBubbleGeometry(ctx, bubble, rect, layout, scale) {
  let width = rect.width * bubble.width / 100;
  const padding = 12 * scale;
  const body = [bubble.speaker && bubble.speakerVisible !== false ? `${bubble.speaker}：` : '', bubble.text].join('');
  let font = (bubble.fontSize || layout.fontSize) * scale, lines;
  ctx.font = `${font}px sans-serif`;
  if (bubble.autoFit !== false) {
    while (wrapComicText(ctx, body, width - padding * 2).length > 3 && width < rect.width * 0.86) {
      width = Math.min(rect.width * 0.86, width + rect.width * 0.04);
    }
  }
  const tailLength = bubble.tail === 'none' ? 0 : (bubble.tailLength ?? 10) * scale;
  const side = bubble.tail || 'bottom', inset = 3 * scale;
  width = Math.min(width, rect.width - inset * 2 - (['left', 'right'].includes(side) ? tailLength : 0));
  const maxHeight = rect.imageHeight - padding * 2 - (['top', 'bottom'].includes(side) ? tailLength : 0);
  do {
    ctx.font = `${font}px sans-serif`;
    lines = wrapComicText(ctx, body, width - padding * 2);
    if (lines.length * font * 1.4 + padding * 2 <= maxHeight || font <= 14 * scale) break;
    font -= scale;
  } while (font > 0);
  const height = lines.length * font * 1.4 + padding * 2;
  if (height > maxHeight) throw new Error('对白过长，请缩短文字或增大气泡宽度');
  const x = Math.max(rect.x + inset + (side === 'left' ? tailLength : 0),
    Math.min(rect.x + rect.width - width - inset - (side === 'right' ? tailLength : 0), rect.x + rect.width * bubble.x / 100 - width / 2));
  const y = Math.max(rect.y + inset + (side === 'top' ? tailLength : 0),
    Math.min(rect.y + rect.imageHeight - height - inset - (side === 'bottom' ? tailLength : 0), rect.y + rect.imageHeight * bubble.y / 100 - height / 2));
  return { x, y, width, height, font, lines, padding };
}
export function comicTailGeometry(bubble, geometry, scale = 1) {
  const side = bubble.tail || 'bottom';
  if (side === 'none') return null;
  const { x, y, width, height } = geometry, length = (bubble.tailLength ?? 10) * scale;
  const horizontal = side === 'top' || side === 'bottom';
  const span = horizontal ? width : height, start = horizontal ? x : y;
  const position = Math.max(8 * scale, Math.min(span - 8 * scale, span * (bubble.tailPosition ?? 30) / 100));
  const half = Math.min(7 * scale, span * 0.08);
  const edge = side === 'top' ? y : side === 'bottom' ? y + height : side === 'left' ? x : x + width;
  const sign = side === 'top' || side === 'left' ? -1 : 1;
  const center = start + position;
  return horizontal ? { a: [center - half, edge], tip: [center, edge + length * sign], b: [center + half, edge] }
    : { a: [edge, center - half], tip: [edge + length * sign, center], b: [edge, center + half] };
}
function drawBubble(ctx, bubble, rect, layout, scale) {
  if (!bubble.text.trim()) return null;
  const geometry = comicBubbleGeometry(ctx, bubble, rect, layout, scale);
  const { x, y, width, height, font, lines, padding } = geometry;
  ctx.font = `${font}px sans-serif`;
  ctx.save(); ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#242424'; ctx.lineWidth = Math.max(1, 1.8 * scale);
  if (bubble.type === 'thought') ctx.setLineDash([5 * scale, 3 * scale]);
  rounded(ctx, x, y, width, height, bubble.type === 'thought' ? 30 * scale : 16 * scale);
  ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
  const tail = comicTailGeometry(bubble, geometry, scale);
  if (tail && bubble.type === 'speech') {
    ctx.beginPath(); ctx.moveTo(...tail.a); ctx.lineTo(...tail.tip); ctx.lineTo(...tail.b); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(2, 3 * scale);
    ctx.beginPath(); ctx.moveTo(...tail.a); ctx.lineTo(...tail.b); ctx.stroke();
  } else if (tail) {
    const center = tail.a.map((value, index) => (value + tail.b[index] + tail.tip[index] * 2) / 4);
    ctx.beginPath(); ctx.ellipse(...center, 4 * scale, 3 * scale, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.fillStyle = '#1c1c1c'; ctx.textAlign = bubble.align || 'left'; ctx.textBaseline = 'top';
  const textX = bubble.align === 'center' ? x + width / 2 : bubble.align === 'right' ? x + width - padding : x + padding;
  lines.forEach((line, index) => ctx.fillText(line, textX, y + padding + index * font * 1.4));
  ctx.restore();
  return geometry;
}
function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('图片导出失败，请使用分页导出')), 'image/png'));
}
export async function renderComicPages(project, imageBlobs, { width = 960, signal, progress = () => {}, pageNumbers, dimensions = new Map() } = {}) {
  for (const panel of project.panels) {
    const key = comicRefKey(panel.image), blob = imageBlobs.get(key);
    if (project.layout.aspect === 'auto' && blob && !(dimensions.get(key)?.width > 0 && dimensions.get(key)?.height > 0)) {
      const image = await decode(blob, signal);
      dimensions.set(key, { width: image.naturalWidth, height: image.naturalHeight });
      image.src = '';
    }
  }
  const pages = comicPageGeometry(project, width, dimensions), result = [], layout = normalizeComicLayout(project.layout);
  let total = 0;
  for (const page of pages) {
    if (pageNumbers && !pageNumbers.includes(page.number)) continue;
    signal?.throwIfAborted();
    const canvas = document.createElement('canvas'); canvas.width = page.width; canvas.height = page.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器无法创建漫画画布');
    try {
      const bubbles = [];
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#1c1c1c'; ctx.font = `600 ${26 * page.scale}px sans-serif`; ctx.textBaseline = 'middle';
      ctx.fillText(project.title, 20 * page.scale, 34 * page.scale, width - 40 * page.scale);
      for (const rect of page.rects) {
        signal?.throwIfAborted();
        const panel = project.panels[rect.index], blob = imageBlobs.get(comicRefKey(panel.image));
        ctx.fillStyle = '#eeeeee'; ctx.fillRect(rect.x, rect.y, rect.width, rect.imageHeight);
        if (blob) {
          const image = await decode(blob, signal);
          try { drawFitted(ctx, image, rect, layout.fit); } finally { image.src = ''; }
        }
        else {
          ctx.fillStyle = '#666666'; ctx.font = `${22 * page.scale}px sans-serif`; ctx.textAlign = 'center';
          ctx.fillText(`第 ${rect.index + 1} 格 · 暂无图片`, rect.x + rect.width / 2, rect.y + rect.imageHeight / 2); ctx.textAlign = 'left';
        }
        ctx.strokeStyle = '#242424'; ctx.lineWidth = Math.max(1, 2 * page.scale);
        ctx.strokeRect(rect.x, rect.y, rect.width, rect.imageHeight);
        for (const bubble of panel.bubbles) {
          const geometry = drawBubble(ctx, bubble, rect, layout, page.scale);
          if (geometry) bubbles.push({ ...geometry, id: bubble.id, panelId: panel.id, rect });
        }
        if (panel.caption) {
          const font = layout.fontSize * page.scale;
          ctx.font = `${font}px sans-serif`; ctx.fillStyle = '#202020'; ctx.textBaseline = 'top';
          const lines = wrapComicText(ctx, panel.caption, rect.width - 24 * page.scale);
          lines.forEach((line, index) => ctx.fillText(line, rect.x + 12 * page.scale, rect.y + rect.imageHeight + 10 * page.scale + index * font * 1.45));
        }
        progress(`正在排版第 ${rect.index + 1} / ${project.panels.length} 格`);
      }
      ctx.fillStyle = '#666666'; ctx.font = `${16 * page.scale}px sans-serif`; ctx.textBaseline = 'bottom'; ctx.textAlign = 'center';
      ctx.fillText(`${page.number} / ${pages.length}`, width / 2, page.height - 8 * page.scale);
      const blob = await canvasBlob(canvas); total += blob.size;
      if (total > MAX_BYTES) throw new Error('漫画导出超过 64 MB，请分成多个项目');
      result.push({ blob, width: page.width, height: page.height, number: page.number, bubbles, rects: page.rects });
    } finally { canvas.width = 1; canvas.height = 1; }
  }
  return result;
}
export async function comicLongImage(pages, signal) {
  const { width, height } = comicLongGeometry(pages), canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器无法创建长图画布');
    let y = 0;
    for (const page of pages) {
      signal?.throwIfAborted();
      ctx.drawImage(await decode(page.blob, signal), 0, y); y += page.height;
    }
    return await canvasBlob(canvas);
  } finally { canvas.width = 1; canvas.height = 1; }
}
export async function comicPageArchive(pages, signal) {
  const zip = new JSZip();
  for (const [index, page] of pages.entries()) {
    signal?.throwIfAborted();
    zip.file(`${String(page.number || index + 1).padStart(3, '0')}.png`, await page.blob.arrayBuffer());
  }
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}
export async function comicOfflineHTML(project, pages, signal, { panelNumbers = [] } = {}) {
  let total = 0;
  const images = [];
  for (const page of pages) {
    signal?.throwIfAborted();
    const bytes = new Uint8Array(await page.blob.arrayBuffer()); total += bytes.length;
    if (total > MAX_BYTES) throw new Error('离线漫画超过 64 MB，请使用分页图片');
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    images.push(`<img src="data:image/png;base64,${btoa(binary)}" width="${page.width}" height="${page.height}" alt="第 ${page.number || images.length + 1} 页" loading="lazy">`);
  }
  const title = escapeHtml(project.title);
  return new Blob([`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${title}</title><style>body{margin:0;background:#eee;color:#222;font-family:sans-serif}main{max-width:960px;margin:auto}h1{font-size:22px;padding:16px}img{display:block;width:100%;height:auto;margin:12px 0}details{padding:20px}p{white-space:pre-wrap}</style></head><body><main><h1>${title}</h1>${images.join('')}<details><summary>漫画文字</summary>${project.panels.map((panel, index) => `<section><h2>第 ${Number(panelNumbers[index]) || index + 1} 格</h2><p>${escapeHtml(panel.caption)}</p>${panel.bubbles.map((bubble) => `<p>${escapeHtml([bubble.speaker, bubble.text].filter(Boolean).join('：'))}</p>`).join('')}</section>`).join('')}</details></main></body></html>`], { type: 'text/html;charset=utf-8' });
}
