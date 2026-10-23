import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForChatWindow } from './chat-preparation.js';

test('unblocked preparation starts immediately without a waiting notice', async () => {
  await waitForChatWindow({ querySelector: () => null }, {
    onWait: () => assert.fail('No window needs attention'),
  });
});

test('an abandoned editor times out without continuing preparation', async () => {
  let notices = 0;
  await assert.rejects(waitForChatWindow({ querySelector: () => ({}) }, {
    timeout: 20, onWait: () => notices++,
  }), (error) => error.name === 'TimeoutError' && /尚未提交生图/.test(error.message));
  assert.equal(notices, 1);
});

test('cancellation releases a preparation wait immediately', async () => {
  const controller = new AbortController();
  const promise = waitForChatWindow({ querySelector: () => ({}) }, {
    signal: controller.signal, onWait: () => queueMicrotask(() => controller.abort()),
  });
  await assert.rejects(promise, { name: 'AbortError' });
});

test('closing an editor resumes the same preparation once', async () => {
  let open = true, notices = 0;
  await waitForChatWindow({ querySelector: () => open ? {} : null }, {
    timeout: 1000, onWait: () => { notices++; open = false; },
  });
  assert.equal(notices, 1);
});
