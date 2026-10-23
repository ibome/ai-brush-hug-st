import { normalizeComicLayout, normalizeComicProtection, comicRefKey } from './comic.js';
import { comicPageGeometry, comicBubbleGeometry } from './comic-export.js';

export const COMIC_LAYOUT_TEMPLATES = [
  { id: 'scroll', title: '竖屏条漫', layout: { mode: 'strip', aspect: 'auto', fit: 'contain', gap: 18, fontSize: 28 } },
  { id: 'four', title: '经典四格', layout: { mode: 'grid', aspect: 'square', fit: 'contain', gap: 12, fontSize: 26 } },
  { id: 'wide', title: '横向双列', layout: { mode: 'double', aspect: 'landscape', fit: 'contain', gap: 12, fontSize: 24 } },
  { id: 'portrait', title: '竖幅双列', layout: { mode: 'grid', aspect: 'portrait', fit: 'contain', gap: 16, fontSize: 26 } },
];
export function comicLayoutTemplate(layout, id) {
  const template = COMIC_LAYOUT_TEMPLATES.find((row) => row.id === id);
  if (!template) throw new Error('请选择有效的排版模板');
  return normalizeComicLayout({ ...layout, ...template.layout });
}
export function comicProtectedRect(panel, rect) {
  const region = normalizeComicProtection(panel.protection);
  return region.enabled ? { x: rect.x + region.x / 100 * rect.width, y: rect.y + region.y / 100 * rect.imageHeight,
    width: region.width / 100 * rect.width, height: region.height / 100 * rect.imageHeight } : null;
}
export function comicProtectionGesture(region, mode, start, point) {
  const original = normalizeComicProtection(region);
  if (![start.x, start.y, point.x, point.y].every(Number.isFinite)) return original;
  const dx = point.x - start.x, dy = point.y - start.y;
  if (mode === 'draw') return normalizeComicProtection({ enabled: true,
    x: Math.min(start.x, point.x), y: Math.min(start.y, point.y),
    width: Math.abs(dx), height: Math.abs(dy) });
  if (mode === 'move') return normalizeComicProtection({ ...original, x: original.x + dx, y: original.y + dy });
  if (mode === 'resize') return normalizeComicProtection({ ...original,
    width: Math.min(100 - original.x, original.width + dx),
    height: Math.min(100 - original.y, original.height + dy) });
  return original;
}
export function comicBubblePosition(bubble, { dx = 0, dy = 0, x, y, snap = false, others = [] } = {}) {
  const coordinate = (value, fallback, min, max, targets) => {
    let next = Number.isFinite(value) ? value : fallback;
    if (snap) {
      const closest = targets.filter(Number.isFinite).sort((a, b) => Math.abs(a - next) - Math.abs(b - next))[0];
      if (Math.abs(next - closest) <= 2) next = closest;
    }
    return Math.round(Math.max(min, Math.min(max, next)) * 10) / 10;
  };
  return { x: coordinate(x ?? bubble.x + dx, bubble.x, 5, 95, [50, ...others.map((row) => row.x)]),
    y: coordinate(y ?? bubble.y + dy, bubble.y, 5, 90, [50, ...others.map((row) => row.y)]) };
}
export function comicBubbleLayer(bubbles, id, target) {
  const index = bubbles.findIndex((row) => row.id === id);
  if (index < 0 || !Number.isInteger(target) || target < 0 || target >= bubbles.length) return bubbles;
  const next = [...bubbles], [bubble] = next.splice(index, 1);
  next.splice(target, 0, bubble);
  return next;
}
export function comicOverlap(a, b) {
  return b ? Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)) : 0;
}
export const comicLayoutSignature = (project) => JSON.stringify([project.id, project.layout,
  project.panels.map((panel) => [panel.id, panel.caption, panel.bubbles, panel.protection, comicRefKey(panel.image)])]);

export function suggestComicLayout(project, context, { dimensions = new Map(), panelId } = {}) {
  const next = structuredClone(project), warnings = [], changes = [];
  const pages = comicPageGeometry(next, 960, dimensions);
  for (const page of pages) for (const rect of page.rects) {
    const panel = next.panels[rect.index];
    if (panelId && panel.id !== panelId) continue;
    const protection = comicProtectedRect(panel, rect), placed = [];
    for (const [index, bubble] of panel.bubbles.entries()) {
      if (!bubble.text.trim()) continue;
      const original = comicBubbleGeometry(context, bubble, rect, next.layout, page.scale), candidates = [];
      for (const y of [8, 18, 30, 50, 70, 82, 90]) for (const x of [18, 32, 50, 68, 82]) {
        const candidate = { ...bubble, x, y };
        const geometry = comicBubbleGeometry(context, candidate, rect, next.layout, page.scale);
        const area = geometry.width * geometry.height;
        const protectedArea = comicOverlap(geometry, protection) / area;
        const collisions = placed.reduce((sum, row) => sum + comicOverlap(geometry, row) / area, 0);
        const orderPenalty = placed.length && geometry.y + geometry.height / 2 < placed.at(-1).y ? 0.05 : 0;
        const distance = Math.hypot(geometry.x - original.x, geometry.y - original.y) / Math.max(rect.width, rect.imageHeight);
        candidates.push({ candidate, geometry, protectedArea, collisions,
          score: protectedArea * 1000 + collisions * 300 + orderPenalty + distance * 0.08 + y / 1000
            + (next.layout.direction === 'rtl' ? 100 - x : x) / 10000 + index * 0.00001 });
      }
      candidates.sort((a, b) => a.score - b.score);
      const best = candidates[0];
      if (best.protectedArea > 0.01 || best.collisions > 0.01) warnings.push(`第 ${rect.index + 1} 格对白 ${index + 1} 仍有遮挡，请缩短对白、缩小字号或调整保护区`);
      if (bubble.x !== best.candidate.x || bubble.y !== best.candidate.y) changes.push({ panelId: panel.id, bubbleId: bubble.id });
      bubble.x = best.candidate.x; bubble.y = best.candidate.y;
      placed.push(best.geometry);
    }
  }
  return { project: next, warnings, changes, base: comicLayoutSignature(project) };
}
