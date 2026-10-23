import test from 'node:test';
import assert from 'node:assert/strict';
import { newComicProject, newComicPanel, newComicBubble, normalizeComicProject } from './comic.js';
globalThis.window ||= { addEventListener() {} };
const { comicBubbleGeometry, comicTailGeometry } = await import('./comic-export.js');
const { comicLayoutTemplate, suggestComicLayout, comicProtectedRect, comicOverlap, comicProtectionGesture, comicLayoutSignature,
  comicBubblePosition, comicBubbleLayer } = await import('./comic-layout.js');
const ctx = { font: '', measureText(value) { return { width: Array.from(value).length * (parseFloat(this.font) || 26) }; } };
const rect = { x: 12, y: 80, width: 936, imageHeight: 936 };
test('individual dialogue font and alignment survive normalization and use the shared export geometry', () => {
  const project = newComicProject(), bubble = { ...newComicBubble(), text: '你好', fontSize: 40, align: 'center' };
  project.panels = [{ ...newComicPanel(), bubbles: [bubble] }];
  const normalized = normalizeComicProject(project).panels[0].bubbles[0];
  assert.equal(normalized.align, 'center'); assert.equal(normalized.fontSize, 40);
  assert.equal(comicBubbleGeometry(ctx, normalized, rect, project.layout, 1).font, 40);
  assert.equal(comicBubbleGeometry(ctx, { ...normalized, fontSize: 0 }, rect, project.layout, 1).font, 26);
  project.panels[0].bubbles[0] = { ...bubble, fontSize: 1000, align: 'invalid' };
  assert.equal(normalizeComicProject(project).panels[0].bubbles[0].fontSize, 64);
  assert.equal(normalizeComicProject(project).panels[0].bubbles[0].align, 'left');
});
test('bubble nudges are bounded, snapping is optional and layer changes retain dialogue and ids', () => {
  const bubble = { ...newComicBubble(), x: 49, y: 60 }, original = structuredClone(bubble);
  assert.deepEqual(comicBubblePosition(bubble, { dx: 1, dy: -5 }), { x: 50, y: 55 });
  assert.deepEqual(comicBubblePosition(bubble, { x: 48.5, y: 62, snap: true, others: [{ x: 70, y: 63 }] }), { x: 50, y: 63 });
  assert.deepEqual(comicBubblePosition(bubble, { x: 48.5, y: 62, snap: false }), { x: 48.5, y: 62 });
  assert.deepEqual(comicBubblePosition(bubble, { dx: -500, dy: 500 }), { x: 5, y: 90 });
  const bubbles = [bubble, { ...newComicBubble(), text: 'second' }, { ...newComicBubble(), text: 'third' }];
  const reordered = comicBubbleLayer(bubbles, bubble.id, 2);
  assert.deepEqual(reordered, [bubbles[1], bubbles[2], bubble]);
  assert.deepEqual(bubble, original);
  assert.deepEqual(comicBubbleLayer(bubbles, 'missing', 0), bubbles);
});
test('tails remain inside panel bounds on every side and disappear when disabled', () => {
  const project = newComicProject();
  for (const side of ['top', 'bottom', 'left', 'right', 'none']) for (const x of [5, 95]) for (const y of [5, 90]) {
    const bubble = { ...newComicBubble(), text: '你好', tail: side, tailLength: 40, x, y };
    const geometry = comicBubbleGeometry(ctx, bubble, rect, project.layout, 1), tail = comicTailGeometry(bubble, geometry);
    assert.ok(geometry.x >= rect.x && geometry.y >= rect.y);
    if (!tail) { assert.equal(side, 'none'); continue; }
    for (const [px, py] of [tail.a, tail.b, tail.tip]) {
      assert.ok(px >= rect.x && px <= rect.x + rect.width);
      assert.ok(py >= rect.y && py <= rect.y + rect.imageHeight);
    }
  }
});
test('position suggestions avoid protected subjects and other bubbles without changing original text', () => {
  const project = newComicProject(); project.panels = [{ ...newComicPanel(),
    protection: { enabled: true, x: 25, y: 20, width: 50, height: 60 },
    bubbles: [0, 1, 2].map((index) => ({ ...newComicBubble(index), text: '今天真好', x: 50, y: 50, width: 30, autoFit: false })) }];
  const original = structuredClone(project), result = suggestComicLayout(project, ctx);
  assert.deepEqual(project, original); assert.equal(result.changes.length, 3);
  const panel = result.project.panels[0], region = comicProtectedRect(panel, rect);
  const boxes = panel.bubbles.map((bubble) => comicBubbleGeometry(ctx, bubble, rect, project.layout, 1));
  assert.ok(boxes.every((box) => comicOverlap(box, region) === 0));
  for (let index = 0; index < boxes.length; index++) for (let other = 0; other < index; other++) assert.equal(comicOverlap(boxes[index], boxes[other]), 0);
  assert.deepEqual(panel.bubbles.map((row) => row.text), original.panels[0].bubbles.map((row) => row.text));
});
test('templates retain reading direction and normalization preserves editable tails and subject regions', () => {
  assert.equal(comicLayoutTemplate({ direction: 'rtl' }, 'four').direction, 'rtl');
  assert.equal(comicLayoutTemplate({}, 'wide').aspect, 'landscape');
  assert.throws(() => comicLayoutTemplate({}, 'invalid'), /有效/);
  const project = newComicProject(); project.panels = [{ ...newComicPanel(), protection: { enabled: true, x: 90, y: 95, width: 44, height: 62 },
    bubbles: [{ ...newComicBubble(), tail: 'left', tailLength: 99, tailPosition: -1 }] }];
  const normalized = normalizeComicProject(project).panels[0];
  assert.equal(normalized.bubbles[0].tailLength, 40); assert.equal(normalized.bubbles[0].tailPosition, 10);
  assert.equal(normalized.protection.x, 56); assert.equal(normalized.protection.y, 38);
});
test('impossible packing reports remaining collisions rather than removing dialogue', () => {
  const project = newComicProject(); project.panels = [{ ...newComicPanel(),
    protection: { enabled: true, x: 0, y: 0, width: 90, height: 90 },
    bubbles: [0, 1, 2, 3].map((index) => ({ ...newComicBubble(index), text: '很长的一句对白'.repeat(20), width: 90 })) }];
  const result = suggestComicLayout(project, ctx);
  assert.ok(result.warnings.length > 0); assert.equal(result.project.panels[0].bubbles.length, 4);
});
test('subject gestures support reverse drawing, bounded moves and resizing without mutating the original', () => {
  const region = { enabled: true, x: 20, y: 30, width: 40, height: 50 }, original = structuredClone(region);
  assert.deepEqual(comicProtectionGesture(region, 'draw', { x: 80, y: 70 }, { x: 30, y: 20 }),
    { enabled: true, x: 30, y: 20, width: 50, height: 50 });
  assert.deepEqual(comicProtectionGesture(region, 'move', { x: 0, y: 0 }, { x: 100, y: -100 }),
    { ...region, x: 60, y: 0 });
  assert.deepEqual(comicProtectionGesture(region, 'resize', { x: 0, y: 0 }, { x: 100, y: 100 }),
    { ...region, width: 80, height: 70 });
  const tiny = comicProtectionGesture(region, 'draw', { x: 99, y: 99 }, { x: 100, y: 100 });
  assert.deepEqual(tiny, { enabled: true, x: 90, y: 90, width: 10, height: 10 });
  assert.deepEqual(comicProtectionGesture(region, 'move', { x: NaN, y: 0 }, { x: 2, y: 3 }), region);
  assert.deepEqual(region, original);
  const project = newComicProject(); project.panels = [{ ...newComicPanel(), protection: region }];
  const before = comicLayoutSignature(project);
  project.panels[0].protection = tiny;
  assert.notEqual(comicLayoutSignature(project), before);
});
