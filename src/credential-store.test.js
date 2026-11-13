import test from 'node:test';
import assert from 'node:assert/strict';
import { createCredentialStore } from './credential-store.js';

test('unavailable or blocked credential databases fail explicitly rather than keeping an in-memory secret', async () => {
  await assert.rejects(createCredentialStore('fixture', null).write('openai', 'id', 'fixture-key'),
    { code: 'CREDENTIAL_UNAVAILABLE' });
  const blocked = createCredentialStore('fixture', { open() {
    const request = {};
    queueMicrotask(() => request.onblocked());
    return request;
  } });
  await assert.rejects(blocked.write('openai', 'id', 'fixture-key'), { code: 'CREDENTIAL_BLOCKED' });
});

test('credential database timeouts close late connections and never report success', async () => {
  const request = {};
  let closed = false;
  const store = createCredentialStore('fixture', { open: () => request }, 5);
  await assert.rejects(store.write('openai', 'id', 'fixture-key'), { code: 'CREDENTIAL_TIMEOUT' });
  request.result = { close() { closed = true; }, transaction() { throw new Error('Late request must not write'); } };
  request.onsuccess();
  assert.equal(closed, true);
});

test('credential database open errors propagate for safe classification', async () => {
  const failure = new DOMException('Fixture detail', 'SecurityError');
  const store = createCredentialStore('fixture', { open() {
    const request = { error: failure };
    queueMicrotask(() => request.onerror());
    return request;
  } });
  await assert.rejects(store.read('openai', 'id'), { name: 'SecurityError' });
});
