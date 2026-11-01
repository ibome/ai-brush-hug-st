import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAssistant } from './prompt-assistant.js';
import { defaultTaskPrompt } from './assistant-rules.js';
import { TaskPromptDrafts } from './task-prompt-drafts.js';
globalThis.window ||= { addEventListener() {} };
const { TaskPromptPanel } = await import('./ui/assistant-rules.js');

function panelWithSettings(initial = {}) {
  let settings = normalizeAssistant(initial);
  const panel = new TaskPromptPanel({
    settings: () => settings,
    update: (patch) => { settings = normalizeAssistant({ ...settings, ...patch }); },
  });
  panel.operation = 'illustrate';
  return { panel, settings: () => settings };
}

test('template changes remain unsaved until save, with discard restoring the active template', async () => {
  const { panel, settings } = panelWithSettings({ illustrateTemplate: 'natural' });
  assert.equal(panel.dirty(), false);
  panel.selectTemplate('guomo');
  assert.equal(panel.dirty(), true);
  assert.equal(settings().illustrateTemplate, 'natural');
  assert.equal(panel.patch().illustrateTemplate, 'guomo');
  assert.deepEqual(panel.patch().taskPrompts, {});
  await panel.click('discard');
  assert.equal(panel.template, 'natural');
  assert.equal(panel.dirty(), false);
  panel.selectTemplate('guomo');
  await panel.click('save');
  assert.equal(settings().illustrateTemplate, 'guomo');
  assert.equal(panel.dirty(), false);
});

test('saving a different task does not apply an unsaved insertion template', async () => {
  const { panel, settings } = panelWithSettings();
  panel.selectTemplate('natural');
  panel.operation = 'generate';
  panel.draft().prefix = 'Keep the scene concise.';
  assert.ok(!Object.hasOwn(panel.patch(), 'illustrateTemplate'));
  await panel.click('save');
  assert.equal(settings().illustrateTemplate, 'default');
  assert.equal(settings().taskPrompts.generate.prefix, 'Keep the scene concise.');
  panel.operation = 'illustrate';
  assert.equal(panel.template, 'natural');
  assert.equal(panel.dirty(), true);
});

test('template selection survives draft recovery and preserves a custom prefix and rules', async () => {
  const storage = new Map();
  const options = { key: 'template-draft', read: (key) => storage.get(key),
    write: (key, value) => { storage.set(key, value); return true; } };
  const first = panelWithSettings().panel;
  first.draftStore = new TaskPromptDrafts(options);
  first.selectTemplate('natural');
  first.draft().prefix = 'Keep established clothing.';
  first.draft().rules += '\nKeep the camera at eye level.';
  first.stash(); first.draftStore.flush();
  const { panel, settings } = panelWithSettings();
  panel.draftStore = new TaskPromptDrafts(options);
  assert.equal(panel.template, 'natural');
  assert.equal(panel.draft().prefix, 'Keep established clothing.');
  assert.equal(panel.dirty(), true);
  await panel.click('save');
  assert.equal(settings().illustrateTemplate, 'natural');
  assert.equal(settings().taskPrompts.illustrate.rules,
    `${defaultTaskPrompt('illustrate', 'natural')}\nKeep the camera at eye level.`);
  assert.equal(panel.dirty(), false);
});
