import test from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_TEMPLATES, validateFieldSettings } from './multi-character-fields.js';
import { parseMultiCharacterPrompt, prepareMultiCharacterPrompt, prepareChatMultiCharacterPrompt } from './multi-character-prompt.js';
import { normalizePromptProcessing, saveTriggerRule, importTriggerRules, exportTriggerRules, applyPromptTriggers } from './prompt-triggers.js';
import { normalizeProfileLibrary, resolveCharacterScene, applyCharacterScene } from './character-profiles.js';
import { prepareCreation, previewCreation } from './creation-workflow.js';
import { buildNovelAIRequest } from './generation.js';
globalThis.window ||= { addEventListener() {} };
const { normalizeNovelAI, normalizeNovelAIState } = await import('./ui/novelai.js');
const { normalizeOpenAI, buildOpenAIRequest } = await import('./ui/openai.js');
const { normalizeSnapshot, captureSnapshot } = await import('./ui/drawings.js');
const { normalizeBackupConfig, mergeBackupConfig } = await import('./backup-config.js');
const { settingsResetPatch } = await import('./settings-reset.js');

const snapshot = (positive = 'cafe, 小蓝', provider = 'novelai') => ({ provider,
  params: provider === 'novelai' ? normalizeNovelAI({ positive, negative: '低清', artist: '' })
    : normalizeOpenAI({ positive, model: 'nai-diffusion-4-5-full', negative: '低清', artist: '', characterMode: 'novelai-v4' }) });
const rules = (...rows) => {
  let settings = normalizePromptProcessing({ enabled: true });
  for (const row of rows) settings = saveTriggerRule(settings, row);
  return settings;
};
const blue = { trigger: '小蓝 | Blue', replacement: 'blue hair, blue eyes', target: 'positive' };

test('automatic fields accept classic, short and Chinese schemes without treating prose as a header', () => {
  const result = parseMultiCharacterPrompt('Scene: cafe;\r\nChar1: blue hair;\r\nChar1 UC: red hair;\r\nNegative: blurry');
  assert.equal(result.positive, 'cafe'); assert.equal(result.negative, 'blurry');
  assert.equal(result.characters[0].positive, 'blue hair'); assert.equal(result.characters[0].negative, 'red hair');
  assert.equal(parseMultiCharacterPrompt('角色 1 正向提示词：blue hair\n角色1名称：小蓝').characters[0].name, '小蓝');
  assert.equal(parseMultiCharacterPrompt('Char1: blue hair', { scheme: 'classic' }), null);
  assert.equal(parseMultiCharacterPrompt('a sign reading Char1: welcome'), null);
  assert.throws(() => parseMultiCharacterPrompt('Char0: person'), /编号/);
  assert.throws(() => parseMultiCharacterPrompt('Char1: a\nCharacter 1 Prompt: b'), /重复/);
});

test('custom headers are literal, support coordinates, and reject ambiguous or unsafe definitions', () => {
  const fields = { scheme: 'custom', custom: {
    scene: '[Scene]:', positive: 'Person.{n} ({coord}):', negative: 'Person.{n} UC:', globalNegative: '[Negative]:',
  } };
  const result = parseMultiCharacterPrompt('[Scene]: garden;\nPerson.2 (D3): 1girl;\nPerson.2 UC: bad hands;\n[Negative]: text', fields);
  assert.equal(result.characters[0].position, 'D3'); assert.equal(result.characters[0].number, 2);
  assert.equal(result.negative, 'text');
  assert.equal(parseMultiCharacterPrompt('PersonX2 (D3): person', fields), null);
  for (const changes of [{ positive: 'Person:' }, { scene: 'Scene {n}:' }, { scene: 'x\n:' },
    { positive: 'Char{n}:', negative: 'Char{n}:' }, { positive: 'x{n}{n}:' }, { scene: 'Scene' }]) {
    assert.throws(() => validateFieldSettings({ scheme: 'custom', custom: { ...FIELD_TEMPLATES.classic, ...changes } }));
  }
  assert.equal(parseMultiCharacterPrompt('Char1: person\nChar1 Position: B3').characters[0].position, 'B3');
});

test('chat scenes append after configured fields are split and cannot enter the final negative section', () => {
  const value = snapshot('Scene: cafe\nChar1: 小蓝\nChar1 UC: 低清\nNegative: 低清');
  const prepared = prepareChatMultiCharacterPrompt(value, 'garden, reading a book');
  assert.equal(prepared.params.positive, 'cafe, garden, reading a book');
  assert.equal(prepared.params.negative, '低清');
  assert.equal(prepared.characterScene.characterPrompts[0].positive, '小蓝');
  const result = prepareCreation(prepared, { processing: rules({ trigger: 'garden', replacement: 'sunlit garden' }) });
  assert.equal(result.params.positive, 'cafe, sunlit garden, reading a book');
  assert.equal(result.params.negative, '低清');
  assert.equal(prepareChatMultiCharacterPrompt(snapshot('cafe'), 'garden'), null);
  const supplied = prepareChatMultiCharacterPrompt(value, 'Scene: garden\nChar1: 小红\nChar1 UC: text\nNegative: blurry');
  assert.equal(supplied.params.positive, 'cafe, garden');
  assert.equal(supplied.params.negative, '低清, blurry');
  assert.equal(supplied.characterScene.characterPrompts[0].positive, '小红');
});

test('replacements respect source toggles, target fields, longest aliases and nonrecursive expansion', () => {
  let settings = rules(blue, { trigger: '低清', replacement: 'lowres', target: 'negative' },
    { trigger: '蓝', replacement: 'navy' }, { trigger: '晨光', replacement: 'sunlight', target: 'artist' });
  const value = snapshot('小蓝, 蓝, Blue, bluebird, 蓝天, <lora:Blue:0.8>, 1.3::小蓝::');
  value.params.artist = '晨光';
  const result = applyPromptTriggers(value, { settings });
  assert.equal(result.params.positive, 'blue hair, blue eyes, navy, blue hair, blue eyes, bluebird, 蓝天, <lora:Blue:0.8>, 1.3::blue hair, blue eyes::');
  assert.equal(result.params.negative, 'lowres'); assert.equal(result.params.artist, 'sunlight');
  assert.equal(result.promptReplacements.hits.length, 6);
  assert.deepEqual(applyPromptTriggers(result, { settings }), result);
  assert.equal(value.params.positive.includes('小蓝'), true);
  settings = rules({ trigger: '甲', replacement: '乙' }, { trigger: '乙', replacement: '丙' });
  assert.equal(applyPromptTriggers(snapshot('甲'), { settings }).params.positive, '乙');
  assert.equal(applyPromptTriggers(snapshot('甲'), { settings: { ...settings, enabled: false } }).params.positive, '甲');
  assert.equal(applyPromptTriggers(snapshot('甲'), { settings: { ...settings, sources: { custom: false } } }).params.positive, '甲');
});

test('same-priority conflicts preserve the matched term; explicit rules override imported and automatic entries', () => {
  const settings = rules(blue, { trigger: '小蓝', replacement: 'red hair', target: 'positive' });
  const result = applyPromptTriggers(snapshot(), { settings });
  assert.equal(result.params.positive, 'cafe, 小蓝');
  assert.match(result.promptReplacements.warnings[0], /多条不同规则/);
  assert.equal(applyPromptTriggers(snapshot('cafe'), { settings }).promptReplacements, undefined);
  const imported = importTriggerRules(rules(blue), { 小蓝: 'red hair' });
  assert.equal(applyPromptTriggers(snapshot(), { settings: imported }).params.positive, 'cafe, blue hair, blue eyes');
});

test('rerolls use current rules and preserve manual edits without recursively expanding old replacement output', () => {
  const original = rules({ trigger: '甲', replacement: '乙', target: 'positive' },
    { trigger: '低清', replacement: 'lowres', target: 'negative' });
  const first = normalizeSnapshot(prepareCreation(snapshot('Scene: 甲\nChar1: 甲\nChar1 UC: 低清'), { processing: original }));
  const changed = rules({ trigger: '甲', replacement: '丙', target: 'positive' },
    { trigger: '乙', replacement: '错误递归', target: 'positive' },
    { trigger: '低清', replacement: 'blurry', target: 'negative' });
  const rerolled = prepareCreation(first, { processing: changed });
  assert.equal(rerolled.params.positive, '丙');
  assert.equal(rerolled.params.negative, 'blurry');
  assert.equal(rerolled.characterScene.characterPrompts[0].positive, '丙');
  assert.equal(rerolled.characterScene.characterPrompts[0].negative, 'blurry');
  const edited = structuredClone(first);
  edited.characterScene.characterPrompts[0].positive = '手动修改';
  const kept = prepareCreation(edited, { processing: changed });
  assert.equal(kept.characterScene.characterPrompts[0].positive, '手动修改');
  assert.equal(kept.params.positive, '丙');
  const disabled = prepareCreation(first, { processing: { ...changed, enabled: false } });
  assert.equal(disabled.params.positive, '甲');
  assert.equal(disabled.characterScene.characterPrompts[0].negative, '低清');
  assert.equal(disabled.promptReplacements, undefined);
  const flat = normalizeSnapshot(applyPromptTriggers(snapshot('甲, 新词'), { settings: original }));
  flat.params.negative = 'custom negative';
  const current = applyPromptTriggers(flat, { settings: rules(...changed.rules, { trigger: '新词', replacement: 'new term' }) });
  assert.equal(current.params.positive, '丙, new term');
  assert.equal(current.params.negative, 'custom negative');
});

test('Chinese tag translation is opt-in and role aliases are scoped to this picture with its active outfit', () => {
  const library = normalizeProfileLibrary({ profiles: [{ id: 'blue', name: '小蓝', aliases: ['Blue'], tags: '1girl', hair: 'blue hair',
    outfits: [{ id: 'dress', prompt: 'white dress' }] }, { id: 'red', name: '小红', tags: 'red hair' }],
  selection: [{ profileId: 'blue' }] });
  const value = snapshot('小蓝, 小红, 测试中文');
  value.characterScene = resolveCharacterScene(library);
  const settings = normalizePromptProcessing({ enabled: true, sources: { tags: true, profiles: true } });
  const tagLibrary = { custom: [{ id: 'custom-local', name: '测试中文', en: 'fixture tag', aliases: [] }] };
  const result = applyPromptTriggers(value, { settings, tagLibrary });
  assert.equal(result.params.positive, '1girl, blue hair, white dress, 小红, fixture tag');
  assert.equal(result.promptReplacements.hits[0].source, 'profiles');
  assert.equal(result.promptReplacements.hits[1].source, 'tags');
  assert.equal(normalizePromptProcessing().enabled, false);
});

test('structured preview, native captions, generic descriptions and workflow character JSON use the same expanded text', () => {
  const settings = rules(blue, { trigger: '低清', replacement: 'lowres' });
  for (const provider of ['novelai', 'openai', 'comfyui']) {
    const value = provider === 'comfyui' ? { provider, config: { mapping: { characterPrompts: {} },
      params: { positive: 'Scene: cafe\nChar1: 小蓝\nChar1 UC: 低清', negative: '' } } }
      : snapshot('Scene: cafe\nChar1: 小蓝\nChar1 UC: 低清', provider);
    const structured = prepareMultiCharacterPrompt(value, (value.params || value.config.params).positive);
    const result = applyPromptTriggers(structured, { settings });
    const parameters = result.params || result.config.params;
    assert.match(result.characterScene.characterPrompts[0].positive, /blue hair/);
    assert.equal(result.characterScene.characterPrompts[0].negative, 'lowres');
    if (provider === 'novelai') {
      const preview = previewCreation(value, { processing: settings });
      const request = buildNovelAIRequest(parameters, result.characterScene.characterPrompts);
      assert.equal(request.parameters.v4_prompt.caption.char_captions[0].char_caption, preview.characters[0].positive);
      assert.equal(request.parameters.v4_negative_prompt.caption.char_captions[0].char_caption, preview.characters[0].negative);
      assert.equal(preview.replacements.hits.length, result.promptReplacements.hits.length);
    } else if (provider === 'openai') {
      assert.match(buildOpenAIRequest(parameters, result.characterScene.characterPrompts).v4_prompt.caption.char_captions[0].char_caption, /blue hair/);
      const flat = applyPromptTriggers(applyCharacterScene({ ...value, params: { ...value.params, characterMode: 'flat' } }, structured.characterScene), { settings });
      assert.match(flat.params.positive, /blue hair/); assert.doesNotMatch(flat.params.positive, /小蓝/);
    } else assert.match(parameters.characterPrompts, /blue hair/);
    if (provider !== 'comfyui') assert.deepEqual(applyPromptTriggers(normalizeSnapshot(result), { settings }).params, parameters);
  }
});

test('invalid or oversized rules and expanded prompts fail before a request can be built', () => {
  for (const rule of [{ trigger: '', replacement: 'x' }, { trigger: 'x', replacement: '' },
    { trigger: 'x,y', replacement: 'z' }, { aliases: Array(17).fill('x'), replacement: 'z' },
    { trigger: 'x', replacement: 'z'.repeat(4001) }]) assert.throws(() => saveTriggerRule({}, rule));
  const settings = rules({ trigger: '甲', replacement: 'x'.repeat(4000) });
  assert.throws(() => applyPromptTriggers(snapshot('甲,甲,甲,甲'), { settings }), /12000/);
  assert.throws(() => importTriggerRules({}, [{ trigger: 'x', replacement: 'y'.repeat(4001) }]), /4000/);
  assert.throws(() => importTriggerRules({}, [{ trigger: 'x' }]));
  assert.throws(() => importTriggerRules({}, { invalid: [] }));
});

test('JSON roundtrips merge atomically, preserve disabled rules and retain existing rules on validation failure', () => {
  const settings = rules({ ...blue, enabled: false });
  const imported = importTriggerRules(settings, [{ trigger: '晨光|朝阳', replacement: 'sunlight', target: 'positive' }]);
  assert.equal(imported.rules.length, 2); assert.equal(imported.rules[1].source, 'json');
  const copied = importTriggerRules({}, exportTriggerRules(imported));
  assert.equal(copied.rules[0].enabled, false);
  assert.equal(importTriggerRules(imported, exportTriggerRules(imported)).rules.length, 2);
  const before = JSON.stringify(settings);
  assert.throws(() => importTriggerRules(settings, [{ trigger: 'ok', replacement: 'yes' }, { trigger: 'bad' }]));
  assert.equal(JSON.stringify(settings), before);
});

test('field settings, rules and replacement records survive snapshots, backups and reset without losing credentials', () => {
  const processing = rules(blue);
  processing.fields = { scheme: 'short', custom: FIELD_TEMPLATES.classic };
  const state = { provider: 'novelai', novelai: snapshot().params, promptProcessing: processing };
  normalizeNovelAIState(state);
  const captured = captureSnapshot(state);
  assert.equal(captured.promptFields.scheme, 'short');
  const result = applyPromptTriggers(captured, { settings: processing });
  assert.equal(normalizeSnapshot(result).promptReplacements.hits[0].trigger, '小蓝');
  const backup = normalizeBackupConfig(state, ['tags', 'parameters']);
  assert.equal(backup.promptProcessing.fields.scheme, 'short');
  assert.equal(backup.promptProcessing.rules.length, 1);
  const merged = mergeBackupConfig(normalizeBackupConfig(state), backup, ['tags']);
  assert.equal(merged.promptProcessing.rules.length, 1);
  assert.equal(settingsResetPatch(state, ['general']).promptProcessing.enabled, false);
  assert.equal(settingsResetPatch(state, ['general']).promptProcessing.rules.length, 1);
});

test('Decrisper persists in presets and requests, is off by default, and does not leak into generic models', () => {
  assert.equal(buildNovelAIRequest(snapshot().params).parameters.dynamic_thresholding, false);
  const value = normalizeNovelAI({ decrisper: true });
  assert.equal(buildNovelAIRequest(value).parameters.dynamic_thresholding, true);
  assert.equal(normalizeSnapshot({ provider: 'novelai', params: value }).params.decrisper, true);
  const compatible = normalizeOpenAI({ model: 'nai-diffusion-4-5-full', positive: 'cafe', decrisper: true });
  assert.equal(buildOpenAIRequest(compatible).dynamic_thresholding, true);
  assert.equal(buildOpenAIRequest({ ...compatible, decrisper: false }).dynamic_thresholding, undefined);
  assert.equal(buildOpenAIRequest({ ...compatible, model: 'custom-image' }).dynamic_thresholding, undefined);
  assert.throws(() => buildOpenAIRequest({ ...compatible, extra: '{"dynamic_thresholding":false}' }), /Decrisper/);
});
