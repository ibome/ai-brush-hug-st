import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatRenderQueue } from './chat-render-queue.js';

test('continuous chat mutations cannot postpone the first progress render', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const queue = createChatRenderQueue((local) => { calls.push(local); });
  queue.schedule(true);
  for (let index = 0; index < 5; index++) {
    t.mock.timers.tick(10);
    queue.schedule();
  }
  assert.deepEqual(calls, []);
  t.mock.timers.tick(10);
  assert.deepEqual(calls, [true]);
  await Promise.resolve();
  queue.destroy();
});

test('slow renders finish without overlap and coalesce subsequent progress updates', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  let finish;
  const queue = createChatRenderQueue((local) => {
    calls.push(local);
    if (calls.length === 1) return new Promise((resolve) => { finish = resolve; });
  });
  queue.schedule();
  t.mock.timers.tick(60);
  queue.schedule(true);
  for (let index = 0; index < 100; index++) {
    t.mock.timers.tick(20);
    queue.schedule();
  }
  assert.deepEqual(calls, [false]);
  finish();
  await Promise.resolve();
  t.mock.timers.tick(60);
  assert.deepEqual(calls, [false, true]);
  await Promise.resolve();
  queue.destroy();
});

test('streaming pauses pending work and resumes with the latest local state', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  let streaming = false;
  const queue = createChatRenderQueue((local) => { calls.push(local); }, { blocked: () => streaming });
  queue.schedule(true);
  streaming = true;
  queue.pause();
  t.mock.timers.tick(1000);
  queue.schedule();
  assert.deepEqual(calls, []);
  streaming = false;
  queue.schedule();
  t.mock.timers.tick(60);
  assert.deepEqual(calls, [true]);
  await Promise.resolve();
  queue.destroy();
});

test('destroying a queue prevents a queued follow-up after a slow render', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0, finish;
  const queue = createChatRenderQueue(() => {
    calls++;
    return new Promise((resolve) => { finish = resolve; });
  });
  queue.schedule();
  t.mock.timers.tick(60);
  queue.schedule();
  queue.destroy();
  finish();
  await Promise.resolve();
  t.mock.timers.tick(1000);
  queue.schedule();
  t.mock.timers.tick(1000);
  assert.equal(calls, 1);
});
