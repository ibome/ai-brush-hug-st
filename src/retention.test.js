import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupPlan } from './retention.js';

const day = 86400000;
const now = day * 100;
const rows = [
  { id: 'old', createdAt: now - day * 10, favorite: false },
  { id: 'new', createdAt: now - day, favorite: false },
  { id: 'saved', createdAt: now - day * 20, favorite: true },
];
const settings = {
  cacheLocation: 'browser', cleanupMode: 'count', cleanupMaxImages: 3,
  cleanupOlderThanDays: 7, cleanupInterval: 2, cleanupUnit: 'days',
};
test('count cleanup respects age, threshold, and favorite protection', () => {
  assert.deepEqual(cleanupPlan(rows, settings, now, now).ids, ['old']);
  assert.deepEqual(cleanupPlan(rows, { ...settings, cleanupMaxImages: 4 }, now, now).ids, []);
});
test('timed cleanup runs only when due and preserves favorites', () => {
  const timed = { ...settings, cleanupMode: 'time' };
  assert.deepEqual(cleanupPlan(rows, timed, now - day, now).ids, []);
  assert.deepEqual(cleanupPlan(rows, timed, now - day * 2, now).ids, ['old', 'new']);
});
test('manual mode and server storage do not delete browser records', () => {
  assert.deepEqual(cleanupPlan(rows, { ...settings, cleanupMode: 'manual' }, 0, now).ids, []);
  assert.deepEqual(cleanupPlan(rows, { ...settings, cacheLocation: 'local' }, 0, now).ids, []);
});
