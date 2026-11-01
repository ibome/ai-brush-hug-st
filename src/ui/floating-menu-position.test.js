import assert from 'node:assert/strict';
import test from 'node:test';
import { floatingMenuPosition } from './floating-menu-position.js';

const menu = { width: 240, height: 172 };
const desktop = { width: 1440, height: 900 };
test('opens on the free side at either desktop edge', () => {
  const left = { x: 4, y: 300, width: 76, height: 76 };
  const right = { x: 1360, y: 300, width: 76, height: 76 };
  assert.ok(floatingMenuPosition(left, menu, desktop).x > left.x + left.width);
  assert.ok(floatingMenuPosition(right, menu, desktop).x + menu.width < right.x);
});
test('keeps the menu visible at viewport corners', () => {
  for (const x of [4, 1360]) for (const y of [4, 820]) {
    const point = floatingMenuPosition({ x, y, width: 76, height: 76 }, menu, desktop);
    assert.ok(point.x >= 8 && point.y >= 8);
    assert.ok(point.x + menu.width <= desktop.width - 8);
    assert.ok(point.y + menu.height <= desktop.height - 8);
  }
});
test('uses vertical space when neither side fits on mobile', () => {
  const anchor = { x: 163, y: 400, width: 64, height: 64 };
  const point = floatingMenuPosition(anchor, menu, { width: 390, height: 844 });
  assert.ok(point.y + menu.height < anchor.y);
  assert.ok(point.x >= 8 && point.x + menu.width <= 382);
});
test('places a centered top-edge mobile menu below the avatar', () => {
  const anchor = { x: 163, y: 4, width: 64, height: 64 };
  const point = floatingMenuPosition(anchor, menu, { width: 390, height: 844 });
  assert.ok(point.y > anchor.y + anchor.height);
  assert.ok(point.x >= 8 && point.x + menu.width <= 382);
});
test('handles the CSS-constrained menu on a narrow screen', () => {
  const size = { width: 264, height: 172 };
  const point = floatingMenuPosition({ x: 212, y: 428, width: 64, height: 64 }, size, { width: 280, height: 500 });
  assert.ok(point.x >= 8 && point.x + size.width <= 272);
  assert.ok(point.y >= 8 && point.y + size.height <= 492);
});
