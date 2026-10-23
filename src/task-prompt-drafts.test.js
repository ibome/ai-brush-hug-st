import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTaskPrompt } from './assistant-rules.js';
import { TaskPromptDrafts, normalizeTaskDrafts } from './task-prompt-drafts.js';

test('task drafts recover invalid edits without applying them and remain scoped by account', () => {
  const storage = new Map(), options = { read: (key) => storage.get(key), write: (key, value) => { storage.set(key, value); return true; } };
  const original = { prefix: '', rules: defaultTaskPrompt('comic') };
  const edited = { prefix: '请保留镜头变化', rules: 'incomplete {{panelCount}' };
  const a = new TaskPromptDrafts({ ...options, key: 'account-a' });
  a.set('comic', edited, original); a.flush();
  assert.equal(a.status, 'saved');
  const restored = new TaskPromptDrafts({ ...options, key: 'account-a' });
  assert.deepEqual(restored.get('comic').draft, edited);
  assert.deepEqual(restored.get('comic').baseline, original);
  assert.equal(new TaskPromptDrafts({ ...options, key: 'account-b' }).get('comic'), null);
  assert.equal(original.rules, defaultTaskPrompt('comic'));
  restored.remove('comic');
  assert.equal(new TaskPromptDrafts({ ...options, key: 'account-a' }).get('comic'), null);
});

test('draft persistence reports quota failure and strips arbitrary fields from restored data', () => {
  const a = new TaskPromptDrafts({ key: 'test', read: () => null, write: () => { throw new Error('quota'); } });
  a.set('generate', { rules: 'changed', prefix: '' }, { rules: defaultTaskPrompt('generate'), prefix: '' });
  a.flush();
  assert.equal(a.status, 'error');
  assert.equal(a.get('generate').draft.rules, 'changed');
  const clean = normalizeTaskDrafts({ version: 1, apiKey: 'not-a-draft', entries: {
    generate: { draft: { rules: 'changed', apiKey: 'not-a-draft', prefix: 'x'.repeat(5000) }, baseline: {}, keyRef: 'private' },
    unexpected: { draft: { rules: 'unknown' } },
  } });
  assert.equal(clean.entries.generate.draft.prefix.length, 4000);
  assert.ok(!JSON.stringify(clean).includes('not-a-draft'));
  assert.equal(clean.entries.unexpected, undefined);
  assert.deepEqual(normalizeTaskDrafts({ version: 999 }), { version: 1, entries: {} });
});
