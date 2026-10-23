import test from 'node:test';
import assert from 'node:assert/strict';
import { getBrowserStorage, readBrowserCache, writeBrowserCache } from './browser-cache.js';

const messages = [];
globalThis.window = {
  addEventListener() {},
  __LINGHUASHI_ENV__: { mode: 'extension', account: 'fixture-a', ui: {} },
  parent: { postMessage(value) { messages.push(structuredClone(value)); } },
};
globalThis.location = { origin: 'https://fixture.example' };
const { persistUIState, readUIState, readAssistantArchive, persistAssistantArchive } = await import('./runtime.js');
const name = 'tavern-draw-preview-ui-v1';
const storageName = `${name}:st:fixture-a`;
const denied = () => { throw new DOMException('Fixture quota exceeded', 'QuotaExceededError'); };

function fixture() {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  window.__LINGHUASHI_ENV__ = { mode: 'extension', account: 'fixture-a', ui: {} };
  messages.length = 0;
  return values;
}

test('a full settings cache still sends current configuration to the account and preserves existing data', () => {
  const values = fixture();
  const previous = JSON.stringify({ updatedAt: 1, novelai: { positive: 'old' } });
  values.set(storageName, previous);
  values.set('another-extension', 'untouched');
  localStorage.setItem = denied;
  const next = { updatedAt: 2, novelai: { positive: 'new' }, connections: { novelai: { keyRef: 'fixture-ref' } } };
  assert.equal(persistUIState(name, next), false);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'linghuashi:state');
  assert.equal(typeof messages[0].requestId, 'string');
  assert.deepEqual(messages[0].ui, next);
  assert.equal(values.get(storageName), previous);
  assert.equal(values.get('another-extension'), 'untouched');
  window.__LINGHUASHI_ENV__.ui = messages[0].ui;
  assert.deepEqual(readUIState(name), next);
});

test('optional cache writes recover without interrupting account synchronization', () => {
  const values = fixture(), attempts = [];
  localStorage.setItem = denied;
  assert.equal(persistUIState(name, { updatedAt: 2 }), false);
  localStorage.setItem = (key, value) => { attempts.push(messages.length); values.set(key, value); };
  assert.equal(persistUIState(name, { updatedAt: 3 }), true);
  assert.deepEqual(attempts, [2]);
  assert.equal(JSON.parse(values.get(storageName)).updatedAt, 3);
  assert.equal(writeBrowserCache('cleanup-marker', '42'), true);
  assert.equal(readBrowserCache('cleanup-marker'), '42');
});

test('denied browser storage access and reads fall back to account settings without throwing', () => {
  fixture();
  const saved = { updatedAt: 5, provider: 'comfyui' };
  window.__LINGHUASHI_ENV__.ui = saved;
  localStorage.getItem = () => { throw new DOMException('Denied', 'SecurityError'); };
  assert.equal(readUIState(name), saved);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: denied });
  try {
    assert.equal(getBrowserStorage(), null);
    assert.equal(readBrowserCache('cleanup-marker'), null);
    assert.equal(writeBrowserCache('cleanup-marker', '42'), false);
    assert.equal(persistUIState(name, saved), false);
    assert.equal(readUIState(name), saved);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: null });
  }
});

test('invalid settings caches do not replace account settings, and newer valid caches remain recoverable', () => {
  const values = fixture();
  const saved = { updatedAt: 5, provider: 'novelai' };
  window.__LINGHUASHI_ENV__.ui = saved;
  for (const invalid of ['null', '[]', '"wrong"', '{broken']) {
    values.set(storageName, invalid);
    assert.equal(readUIState(name), saved);
  }
  values.set(storageName, JSON.stringify({ updatedAt: 6, provider: 'openai' }));
  assert.equal(readUIState(name).provider, 'openai');
  window.__LINGHUASHI_ENV__.account = 'fixture-b';
  window.__LINGHUASHI_ENV__.ui = { updatedAt: 4, provider: 'sdwebui' };
  assert.equal(readUIState(name).provider, 'sdwebui');
});

test('preview cache failures report an unsaved result without claiming account persistence', () => {
  fixture();
  window.__LINGHUASHI_ENV__ = {};
  localStorage.setItem = denied;
  assert.equal(persistUIState(name, { updatedAt: 9 }), false);
  assert.deepEqual(messages, []);
});

test('history migrates independently, follows the account and tolerates cache quota failures', () => {
  const values = fixture();
  const rows = [{ id: 'one', createdAt: 100, input: '', plan: { shouldDraw: true, positive: 'old', negative: '', scene: '', aspect: 'square' } }];
  assert.equal(readAssistantArchive(name, rows, 100)[0].plan.positive, 'old');
  localStorage.setItem = denied;
  assert.equal(persistAssistantArchive(name, rows), false);
  assert.equal(messages[0].type, 'linghuashi:assistant-archive');
  window.__LINGHUASHI_ENV__.assistantArchive = messages[0].value;
  assert.equal(readAssistantArchive(name)[0].id, 'one');
  assert.equal(values.size, 0);
  window.__LINGHUASHI_ENV__ = { mode: 'extension', account: 'fixture-b', ui: {} };
  assert.deepEqual(readAssistantArchive(name), []);
});

test('newer hot settings without legacy history cannot hide a valid separate history cache', () => {
  const values = fixture();
  const rows = [{ id: 'cached', createdAt: 10, plan: { shouldDraw: true, positive: 'cached prompt', negative: '', scene: '', aspect: 'square' } }];
  values.set(`${name}:assistant-history:st:fixture-a`, JSON.stringify({ version: 1, updatedAt: 100, rows }));
  assert.equal(readAssistantArchive(name, [], 200)[0]?.id, 'cached');
  window.__LINGHUASHI_ENV__.assistantArchive = { version: 1, updatedAt: 300, rows: [] };
  assert.deepEqual(readAssistantArchive(name, [], 400), []);
});
