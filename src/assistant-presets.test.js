import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantPresetDirectory, resolveAssistantPreset, normalizeAssistantPreset,
  expandAssistantPresetMacros, selectedAssistantPresetEntries, composeAssistantPresetMessages,
  validateAssistantMessages } from './assistant-presets.js';
import { normalizeAssistant, buildAssistantMessages, requestAssistantAPI } from './prompt-assistant.js';
import { createAssistantHost } from './assistant-host.js';

const id = (api, name) => JSON.stringify([api, name]);
function fixture() {
  const saved = {
    prompts: [
      { identifier: 'main', name: '主提示词', role: 'system', content: 'Saved {{char}} / {{user}}' },
      { identifier: 'history', marker: true },
      { identifier: 'example', role: 'assistant', content: 'Example response' },
      { identifier: 'off', role: 'user', content: 'Disabled text' },
      { identifier: 'normal-only', role: 'system', content: 'Normal generation only', injection_trigger: ['normal'] },
      { identifier: 'unordered', role: 'system', content: 'Unordered text' },
    ],
    prompt_order: [{ character_id: 100000, order: [
      { identifier: 'example', enabled: true }, { identifier: 'main', enabled: true },
      { identifier: 'history', enabled: true }, { identifier: 'off', enabled: false },
      { identifier: 'normal-only', enabled: true },
    ] }],
    custom_url: 'https://private.test', proxy_password: 'DO-NOT-EXPOSE',
  };
  const live = structuredClone(saved);
  live.prompts[0].content = 'Unsaved {{char}}';
  const context = { mainApi: 'openai', characterId: 0, name1: 'User', name2: 'Alice',
    characters: [{ data: { description: 'Silver hair', personality: 'Kind', scenario: 'Library' } }],
    chatCompletionSettings: live, chat: [{ mes: 'Latest' }] };
  const managers = {
    openai: { getSelectedPresetName: () => 'My preset', getPresetList: () => ({
      presets: [saved], preset_names: { 'My preset': 0 }, settings: live }),
    getCompletionPresetByName: (name) => name === 'My preset' ? saved : undefined },
    sysprompt: { getSelectedPresetName: () => 'System', getPresetList: () => ({
      preset_names: ['System'], settings: { enabled: true, content: 'Live system', post_history: 'Live tail' } }),
    getCompletionPresetByName: () => ({ content: 'Saved system' }) },
  };
  context.getPresetManager = (api) => managers[api];
  return { context, saved, live };
}
const current = { presetMode: 'current' };
const named = { presetMode: 'named', presetId: id('openai', 'My preset') };

test('preset settings default off and persist only bounded identities and selections', () => {
  assert.equal(normalizeAssistant().presetMode, 'none');
  const settings = normalizeAssistant({ ...named,
    presetSelection: { id: named.presetId, entries: ['main', 'main'], content: 'DO-NOT-SAVE' },
    presetContent: 'DO-NOT-SAVE' });
  assert.deepEqual(settings.presetSelection, { id: named.presetId, entries: ['main'] });
  assert.ok(!JSON.stringify(settings).includes('DO-NOT-SAVE'));
  assert.equal(normalizeAssistantPreset({ presetId: 'bad', presetMode: 'bad' }).presetId, '');
  assert.equal(normalizeAssistantPreset({ presetSelection: { id: named.presetId, entries: Array(129).fill('x') } }).presetSelection, null);
});

test('directory lists preset metadata only and chooses current API family', () => {
  const { context } = fixture();
  const directory = assistantPresetDirectory(context);
  assert.equal(directory.presets.length, 2);
  assert.equal(directory.current.id, named.presetId);
  assert.ok(!JSON.stringify(directory).includes('DO-NOT-EXPOSE'));
  context.mainApi = 'textgenerationwebui';
  assert.equal(assistantPresetDirectory(context).current.id, id('sysprompt', 'System'));
  assert.deepEqual(assistantPresetDirectory({}), { presets: [], current: null });
});

test('current reads live unsaved prompts while named reads saved data without mutating host settings', () => {
  const { context, live, saved } = fixture(), before = JSON.stringify({ live, saved });
  assert.equal(resolveAssistantPreset(context, current).entries[1].content, 'Unsaved Alice');
  assert.equal(resolveAssistantPreset(context, named).entries[1].content, 'Saved Alice / User');
  assert.equal(JSON.stringify({ live, saved }), before);
  assert.ok(!JSON.stringify(resolveAssistantPreset(context, named)).includes('DO-NOT-EXPOSE'));
});

test('native order and every enabled text entry are preserved regardless of generation trigger', () => {
  const preset = resolveAssistantPreset(fixture().context, named);
  assert.deepEqual(preset.entries.map((entry) => entry.id), ['example', 'main', 'off', 'normal-only', 'unordered']);
  assert.deepEqual(selectedAssistantPresetEntries(preset, named).map((entry) => entry.id), ['example', 'main', 'normal-only']);
  assert.match(preset.warnings[0], /1 个占位/);
});

test('display rows preserve every native position and separate entries absent from the native list', () => {
  const { context, live } = fixture();
  live.prompts.push({ identifier: 'empty', name: 'Empty prompt', role: 'system', content: '' });
  live.prompt_order[0].order.splice(1, 0, { identifier: 'empty', enabled: true });
  const preset = resolveAssistantPreset(context, current);
  assert.deepEqual(preset.rows.map((row) => row.id), live.prompt_order[0].order.map((row) => row.identifier));
  assert.equal(preset.rows.find((row) => row.id === 'empty').kind, 'empty');
  assert.equal(preset.rows.find((row) => row.id === 'empty').enabled, true);
  assert.equal(preset.rows.find((row) => row.id === 'history').kind, 'marker');
  assert.deepEqual(preset.unlistedRows.map((row) => row.id), ['unordered']);
  const messages = composeAssistantPresetMessages(buildAssistantMessages({ settings: {} }), preset, current);
  assert.deepEqual(messages.slice(0, -2).map((entry) => entry.content),
    ['Example response', 'Unsaved Alice', 'Normal generation only']);
  live.prompt_order[0].order.reverse();
  const reordered = resolveAssistantPreset(context, current);
  assert.deepEqual(reordered.rows.map((row) => row.id), live.prompt_order[0].order.map((row) => row.identifier));
  assert.deepEqual(selectedAssistantPresetEntries(reordered, current).map((entry) => entry.id),
    ['normal-only', 'main', 'example']);
});

test('chat completion uses its 100001 order when the legacy 100000 order also exists', () => {
  const { context, saved, live } = fixture();
  for (const preset of [saved, live]) {
    const active = structuredClone(preset.prompt_order[0]);
    active.character_id = 100001;
    preset.prompt_order[0].order = [{ identifier: 'off', enabled: true }];
    preset.prompt_order.push(active);
  }
  for (const settings of [current, named]) {
    const preset = resolveAssistantPreset(context, settings);
    assert.deepEqual(selectedAssistantPresetEntries(preset, settings).map((entry) => entry.id),
      ['example', 'main', 'normal-only']);
  }
});

test('explicit selection preserves native order, allows empty selection and binds to preset identity', () => {
  const preset = resolveAssistantPreset(fixture().context, named);
  const settings = { ...named, presetSelection: { id: preset.id, entries: ['off', 'main'] } };
  assert.deepEqual(selectedAssistantPresetEntries(preset, settings).map((entry) => entry.id), ['main', 'off']);
  settings.presetSelection.entries = [];
  assert.deepEqual(selectedAssistantPresetEntries(preset, settings), []);
  settings.presetSelection.id = id('openai', 'Other');
  assert.equal(selectedAssistantPresetEntries(preset, settings).length, 3);
  settings.presetSelection = { id: preset.id, entries: ['deleted'] };
  assert.throws(() => selectedAssistantPresetEntries(preset, settings), /已被删除/);
});

test('following current preset ignores old manual selections and includes newly enabled entries', () => {
  const { context, live } = fixture();
  const settings = { ...current, presetSelection: { id: named.presetId, entries: ['off', 'deleted'] } };
  let preset = resolveAssistantPreset(context, settings);
  assert.deepEqual(selectedAssistantPresetEntries(preset, settings).map((entry) => entry.id), ['example', 'main', 'normal-only']);
  live.prompt_order[0].order.find((row) => row.identifier === 'off').enabled = true;
  live.prompt_order[0].order.find((row) => row.identifier === 'example').enabled = false;
  preset = resolveAssistantPreset(context, settings);
  const base = buildAssistantMessages({ settings: {} });
  const messages = composeAssistantPresetMessages(base, preset, settings);
  assert.deepEqual(messages.slice(0, -2).map((entry) => entry.content),
    ['Unsaved Alice', 'Disabled text', 'Normal generation only']);
  assert.deepEqual(messages.slice(-2), base);
  assert.equal(live.prompt_order[0].order.find((row) => row.identifier === 'off').enabled, true);
});

test('following current preset resolves new identities and all enabled entries without using saved selection', () => {
  const { context } = fixture();
  const live = {
    prompts: [{ identifier: 'new', role: 'system', content: 'New live instructions', injection_trigger: ['normal', 'continue'] }],
    prompt_order: [{ character_id: 100000, order: [{ identifier: 'new', enabled: true }] }],
  };
  context.getPresetManager = (api) => api === 'openai' ? {
    getSelectedPresetName: () => 'Other',
    getPresetList: () => ({ settings: live, preset_names: { Other: 0 } }),
  } : null;
  context.chatCompletionSettings = live;
  const settings = { ...current, presetSelection: { id: named.presetId, entries: ['main'] } };
  const preset = resolveAssistantPreset(context, settings);
  assert.equal(preset.id, id('openai', 'Other'));
  assert.deepEqual(selectedAssistantPresetEntries(preset, settings).map((entry) => entry.content), ['New live instructions']);
});

test('read-only macros expand and remaining macros cannot be executed by generateRaw', () => {
  const { context } = fixture();
  context.characters[0].data.description += ' {{setvar::nested::1}}';
  context.substituteParams = () => { throw new Error('Must not execute native macros'); };
  const expanded = expandAssistantPresetMacros('{{char}} {{user}} {{description}} {{setvar::x::1}}', context);
  assert.match(expanded.content, /Alice User Silver hair/);
  assert.ok(!expanded.content.includes('{{'));
  assert.deepEqual(expanded.unresolved, ['setvar::x::1']);
});

test('system prompt presets work for text completion and named saved system prompts', () => {
  const { context } = fixture();
  context.mainApi = 'textgenerationwebui';
  const preset = resolveAssistantPreset(context, current);
  assert.deepEqual(preset.entries.map((entry) => entry.content), ['Live system', 'Live tail']);
  assert.equal(resolveAssistantPreset(context, { presetMode: 'named', presetId: id('sysprompt', 'System') }).entries[0].content, 'Saved system');
});

test('missing, ambiguous, duplicate and oversized presets fail explicitly', () => {
  const { context, saved } = fixture();
  assert.throws(() => resolveAssistantPreset(context, { ...named, presetId: id('openai', 'Deleted') }), /已删除/);
  saved.prompt_order = [{ character_id: 1, order: [] }, { character_id: 2, order: [] }];
  assert.throws(() => resolveAssistantPreset(context, named), /顺序/);
  saved.prompt_order = [{ character_id: 0, order: [{ identifier: 'main', enabled: true }] }];
  assert.equal(resolveAssistantPreset(context, named).entries[0].id, 'main');
  saved.prompts.push(saved.prompts[0]);
  assert.throws(() => resolveAssistantPreset(context, named), /重复/);
  saved.prompts.pop();
  saved.prompts[0].content = 'x'.repeat(64001);
  assert.throws(() => resolveAssistantPreset(context, named), /过长/);
});

test('composed requests retain roles plus final built-in JSON rules and source material', () => {
  const base = buildAssistantMessages({ settings: {}, input: 'Drawing' });
  const preset = resolveAssistantPreset(fixture().context, named);
  const messages = composeAssistantPresetMessages(base, preset, named);
  assert.equal(messages[0].role, 'assistant');
  assert.match(messages.at(-2).content, /Return one JSON object only/);
  assert.equal(JSON.parse(messages.at(-1).content).INPUT, 'Drawing');
  assert.deepEqual(composeAssistantPresetMessages(base, null, {}), base);
  assert.equal(validateAssistantMessages(messages), true);
  assert.equal(validateAssistantMessages([{ role: 'tool', content: 'bad' }, ...base]), false);
  assert.equal(validateAssistantMessages(Array(145).fill(base[0])), false);
  assert.equal(validateAssistantMessages([null, base[1]]), false);
});

test('host exposes read-only preset actions and forwards composed text without applying presets twice', async () => {
  const { context } = fixture(), replies = [], calls = [];
  const host = createAssistantHost({ getContext: () => context, settings: () => current,
    post: (_type, data) => replies.push(data),
    textAccess: { generate: async (messages) => { calls.push(messages); return 'done'; } } });
  await host.receive({ requestId: 'list', action: 'presets' });
  await host.receive({ requestId: 'resolve', action: 'preset', settings: named });
  assert.equal(replies[0].value.presets.length, 2);
  const messages = composeAssistantPresetMessages(buildAssistantMessages({ settings: {} }), replies[1].value, named);
  await host.receive({ requestId: 'text', action: 'text', messages });
  assert.deepEqual(calls, [messages]);
  assert.equal(replies[2].value, 'done');
  host.destroy();
});

test('independent API receives the same composed messages and retains max output token configuration', async () => {
  const messages = composeAssistantPresetMessages(buildAssistantMessages({ settings: {} }),
    resolveAssistantPreset(fixture().context, named), named);
  await requestAssistantAPI({ endpoint: 'https://test.example', model: 'test' }, 'fixture', messages, {
    fetcher: async (_url, request) => {
      const body = JSON.parse(request.body);
      assert.deepEqual(body.messages, messages);
      assert.equal(body.max_tokens, 4000);
      return Response.json({ choices: [{ message: { content: JSON.stringify({ shouldDraw: true, positive: 'test' }) } }] });
    },
  });
});
