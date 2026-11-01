import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatSync } from './chat-storage.js';

test('background sync failures use bounded backoff and successful retries reset it', async () => {
  let time = 0, calls = 0, failing = true;
  const sync = createChatSync(async () => { calls++; if (failing) throw new Error('offline'); }, () => time);
  assert.equal(await sync('chat-a', 'server'), false);
  for (let i = 0; i < 30; i++) assert.equal(await sync('chat-a', 'server'), false);
  assert.equal(calls, 1);
  time = 15000;
  assert.equal(await sync('chat-a', 'server'), false);
  time = 44999;
  assert.equal(await sync('chat-a', 'server'), false);
  assert.equal(calls, 2);
  time = 45000;
  assert.equal(await sync('chat-a', 'server'), false);
  time = 104999;
  assert.equal(await sync('chat-a', 'server'), false);
  assert.equal(calls, 3);
  time = 105000; failing = false;
  assert.equal(await sync('chat-a', 'server'), true);
  failing = true;
  assert.equal(await sync('chat-a', 'server'), false);
  time += 15000;
  assert.equal(await sync('chat-a', 'server'), false);
  assert.equal(calls, 6);
});

test('concurrent refreshes share one sync and a chat switch waits for the previous request', async () => {
  const calls = [];
  let finish;
  const sync = createChatSync((chatKey) => {
    calls.push(chatKey);
    if (chatKey === 'chat-a') return new Promise((resolve) => { finish = resolve; });
  });
  const first = sync('chat-a', 'server'), second = sync('chat-a', 'server');
  const next = sync('chat-b', 'server');
  await Promise.resolve();
  assert.deepEqual(calls, ['chat-a']);
  finish();
  assert.deepEqual(await Promise.all([first, second, next]), [true, true, true]);
  assert.deepEqual(calls, ['chat-a', 'chat-b']);
});

test('switching chats or storage location bypasses a previous failure cooldown', async () => {
  let calls = 0;
  const sync = createChatSync(() => { calls++; throw new Error('unavailable'); }, () => 0);
  assert.equal(await sync('chat-a', 'server'), false);
  assert.equal(await sync('chat-a', 'server'), false);
  assert.equal(await sync('chat-b', 'server'), false);
  assert.equal(await sync('chat-b', 'browser'), false);
  assert.equal(calls, 3);
});
