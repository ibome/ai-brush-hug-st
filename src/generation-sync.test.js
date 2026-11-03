import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskImageSync, startGenerationPolling } from './generation-sync.js';

const savedTask = (id, location = 'server') => ({
  id, status: 'completed', savedIds: [`${id}-image`], plan: { storageLocation: location },
});

test('remote task completion refreshes missing images once and selects the result', async () => {
  const task = savedTask('remote');
  let tasks = [{ ...task, status: 'running', savedIds: [] }], images = [], reloads = 0, notices = 0;
  const selections = [];
  const refresh = createTaskImageSync({
    tasks: () => tasks, images: () => images, location: () => 'server', ready: async () => {},
    reload: async (force) => { assert.equal(force, true); reloads++; images = [{ id: task.savedIds[0] }]; },
    select: (rows) => selections.push(rows.map((row) => row.id)),
    notify: () => { notices++; },
  });
  await refresh();
  assert.equal(reloads, 0);
  tasks = [task, savedTask('other-device', 'browser')];
  await Promise.all([refresh(), refresh(), refresh()]);
  assert.equal(reloads, 1);
  assert.deepEqual(selections, [['remote']]);
  assert.equal(notices, 1);
  await refresh();
  assert.equal(reloads, 1);
  assert.equal(notices, 1);
});

test('a saved result is still synchronized after a display error, and failed loads retry', async () => {
  const task = { ...savedTask('saved'), status: 'failed' };
  let fail = true, calls = 0, notices = 0;
  const refresh = createTaskImageSync({
    tasks: () => [task], images: () => [], location: () => 'server', ready: async () => {},
    reload: async () => { calls++; if (fail) throw new Error('offline'); },
    select: () => {}, notify: () => { notices++; },
  });
  await assert.rejects(refresh(), /offline/);
  assert.equal(notices, 0);
  fail = false;
  await refresh();
  assert.equal(calls, 2);
  assert.equal(notices, 1);
});

test('completion during an in-flight reload is reconciled without losing the second result', async () => {
  let tasks = [savedTask('first')], images = [], finish, calls = 0;
  const selections = [];
  const refresh = createTaskImageSync({
    tasks: () => tasks, images: () => images, location: () => 'server', ready: async () => {},
    reload: async () => {
      calls++;
      if (calls === 1) await new Promise((resolve) => { finish = resolve; });
      images = tasks.flatMap((task) => task.savedIds.map((id) => ({ id })));
    },
    select: (rows) => selections.push(...rows.map((row) => row.id)), notify: () => {},
  });
  const first = refresh();
  while (!finish) await Promise.resolve();
  tasks = [...tasks, savedTask('second')];
  const second = refresh();
  finish();
  await Promise.all([first, second]);
  assert.deepEqual(selections, ['first', 'second']);
  assert.equal(calls, 1);
});

test('an image index that lags behind completion is retried, while deleted old images have bounded retries', async () => {
  const tasks = [savedTask('new'), savedTask('deleted')];
  let images = [], calls = 0;
  const refresh = createTaskImageSync({
    tasks: () => tasks, images: () => images, location: () => 'server', ready: async () => {},
    reload: async () => { if (++calls >= 2) images = [{ id: tasks[0].savedIds[0] }]; },
    select: () => {}, notify: () => {},
  });
  for (let index = 0; index < 8; index++) await refresh();
  assert.equal(calls, 3);
  assert.equal(images[0].id, 'new-image');
});

test('mobile page restoration restarts polling and coalesces resume events', async () => {
  const window = new EventTarget(), document = new EventTarget(), timers = new Map();
  document.visibilityState = 'visible';
  let index = 0, refreshes = 0, resumes = 0;
  window.setInterval = (callback) => { timers.set(++index, callback); return index; };
  window.clearInterval = (id) => timers.delete(id);
  const stop = startGenerationPolling({
    window, document, refresh: async () => { refreshes++; }, resumed: async () => { resumes++; },
  });
  assert.equal(timers.size, 1);
  window.dispatchEvent(new Event('pagehide'));
  assert.equal(timers.size, 0);
  window.dispatchEvent(new Event('pageshow'));
  window.dispatchEvent(new Event('focus'));
  window.dispatchEvent(new Event('online'));
  await new Promise(setImmediate);
  assert.equal(timers.size, 1);
  assert.equal(refreshes, 1);
  assert.equal(resumes, 1);
  document.visibilityState = 'hidden';
  [...timers.values()][0]();
  await new Promise(setImmediate);
  assert.equal(refreshes, 1);
  document.visibilityState = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  await new Promise(setImmediate);
  assert.equal(refreshes, 2);
  assert.equal(resumes, 2);
  stop();
  window.dispatchEvent(new Event('pageshow'));
  assert.equal(timers.size, 0);
});
