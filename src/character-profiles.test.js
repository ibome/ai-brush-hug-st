import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProfile, normalizeProfileLibrary, migrateProfileLibrary, saveProfile, deleteProfile, updateProfileChat,
  effectiveProfiles, resolveCharacterScene, applyCharacterScene, normalizeCharacterScene, restoreSceneProfiles } from './character-profiles.js';
import { buildAssistantMessages, parseAssistantResult, applyAssistantPlan } from './prompt-assistant.js';
import { characterDirectory, collectAssistantContext } from './assistant-host.js';
import { buildNovelAIRequest } from './generation.js';
globalThis.window = { addEventListener() {} };
const { NOVELAI_DEFAULTS } = await import('./ui/novelai.js');
const { newComfyConfig, applyWorkflowParameters } = await import('./ui/comfyui.js');
const { normalizeSnapshot, restoreSnapshot, captureSnapshot } = await import('./ui/drawings.js');

const a = normalizeProfile({ id: 'a', name: 'Same name', avatar: 'one.png', hair: 'long black hair', eyes: 'golden eyes',
  tags: '1girl', lockAppearance: true, lockOutfit: true, negative: 'short hair',
  outfits: [{ id: 'white', name: 'Default', prompt: 'white dress' }, { id: 'red', name: 'Alternative', prompt: 'red dress' }] });
const b = normalizeProfile({ id: 'b', name: 'Same name', avatar: 'two.png', tags: '1boy, short silver hair, blue eyes',
  outfits: [{ id: 'uniform', name: 'Uniform', prompt: 'black uniform' }] });
const library = () => normalizeProfileLibrary({ profiles: [a, b], selection: [{ profileId: 'a', position: 'left' }, { profileId: 'b', position: 'right' }] });
const snapshot = (provider = 'novelai', model = 'nai-diffusion-4-5-full') => ({ provider,
  params: { ...NOVELAI_DEFAULTS, model, positive: 'garden, sunset', negative: 'blurry' } });

test('profile data is bounded, strips arbitrary credential fields and keeps a deliberate empty default outfit', () => {
  const profile = normalizeProfile({ ...a, api_key: 'not stored', tags: 'x'.repeat(9000), defaultOutfitId: '' });
  assert.equal(profile.tags.length, 4000); assert.equal(profile.defaultOutfitId, '');
  assert.equal('api_key' in profile, false);
  const db = normalizeProfileLibrary({ profiles: [a, a, b, null], chats: [{ chatKey: '__proto__', overrides: [a] }] });
  assert.equal(db.profiles.length, 2);
  assert.equal(effectiveProfiles(db, '__proto__')[0].id, 'a');
});
test('only actual saved legacy drafts migrate; empty installs do not acquire a fictional character', () => {
  assert.equal(migrateProfileLibrary({}).profiles.length, 0);
  const db = migrateProfileLibrary({ character: 'Old name', appearance: 'black hair', outfit: 'coat' });
  assert.equal(db.profiles[0].tags, 'black hair'); assert.equal(db.profiles[0].avatar, '');
  assert.equal(resolveCharacterScene(db, 'chat', ['one.png']).entries.length, 0);
  assert.deepEqual(migrateProfileLibrary({ characterProfiles: db }), db);
});
test('automatic linking uses avatar identity rather than equal character names and does not leak workshop selection', () => {
  const db = library();
  assert.deepEqual(resolveCharacterScene(db, 'chat-one', ['one.png']).entries.map((entry) => entry.profileId), ['a']);
  assert.deepEqual(resolveCharacterScene(db, 'chat-two', ['two.png']).entries.map((entry) => entry.profileId), ['b']);
  assert.equal(resolveCharacterScene(db).entries.length, 2);
});
test('chat overrides and manual participant selection are isolated and global updates retain explicit overrides', () => {
  let db = saveProfile(library(), { ...a, hair: 'purple hair' }, 'chat-one');
  db = updateProfileChat(db, 'chat-one', { selection: [{ profileId: 'b', outfitId: '', action: 'reading' }] });
  assert.equal(effectiveProfiles(db, 'chat-one')[0].hair, 'purple hair');
  assert.equal(effectiveProfiles(db, 'chat-two')[0].hair, 'long black hair');
  assert.equal(resolveCharacterScene(db, 'chat-one', ['one.png']).entries[0].profileId, 'b');
  assert.equal(resolveCharacterScene(db, 'chat-one').entries[0].outfitId, '');
  db = saveProfile(db, { ...a, hair: 'green hair' });
  assert.equal(effectiveProfiles(db, 'chat-one')[0].hair, 'purple hair');
  assert.equal(effectiveProfiles(db, 'chat-two')[0].hair, 'green hair');
});
test('explicit empty selection disables profiles and automatic mode can be restored', () => {
  let db = updateProfileChat(library(), 'chat', { selection: [] });
  assert.equal(resolveCharacterScene(db, 'chat', ['one.png']).entries.length, 0);
  db = updateProfileChat(db, 'chat', { selection: null });
  assert.equal(resolveCharacterScene(db, 'chat', ['one.png']).entries.length, 1);
  assert.equal(db.chats.length, 0);
});
test('disabled profiles, deleted IDs and excess participants do not enter requests', () => {
  let db = saveProfile(library(), { ...a, enabled: false });
  assert.equal(resolveCharacterScene(db).entries.length, 1);
  db = deleteProfile(db, 'b');
  assert.equal(db.selection.length, 1);
  assert.equal(resolveCharacterScene(db).entries.length, 0);
  const profiles = Array.from({ length: 8 }, (_, i) => ({ ...a, id: `p${i}` }));
  db = normalizeProfileLibrary({ profiles, selection: profiles.map((profile) => ({ profileId: profile.id })) });
  assert.equal(resolveCharacterScene(db).entries.length, 6);
});
test('locked appearance and outfit reject generated changes while allowing character-specific action and expression', () => {
  const scene = resolveCharacterScene(library());
  const result = applyCharacterScene(snapshot(), scene, [{ profileId: 'a', appearance: 'pink hair', outfit: 'blue coat',
    action: 'waving', expression: 'smiling' }, { profileId: 'b', action: 'reading' }, { profileId: 'intruder', action: 'wrong' }]);
  assert.match(result.characterScene.characterPrompts[0].positive, /black hair.*white dress.*waving.*smiling/);
  assert.doesNotMatch(result.characterScene.characterPrompts[0].positive, /pink|blue coat/);
  assert.match(result.characterScene.characterPrompts[1].positive, /silver hair.*reading/);
  assert.equal(result.params.positive, 'garden, sunset');
  assert.equal('applied' in scene, false);
});
test('unlocked appearance and outfit can follow story changes, explicit scene actions override model choices', () => {
  const db = saveProfile(library(), { ...a, lockAppearance: false, lockOutfit: false });
  db.selection[0].action = 'running';
  const result = applyCharacterScene(snapshot(), resolveCharacterScene(db), [{ profileId: 'a',
    appearance: 'wet black hair', outfit: 'travel cloak', action: 'sitting' }]);
  assert.match(result.characterScene.characterPrompts[0].positive, /wet black hair.*travel cloak.*running/);
  assert.doesNotMatch(result.characterScene.characterPrompts[0].positive, /sitting|white dress/);
});
test('NovelAI v4 and v5 requests keep independent positives, negatives and coordinate centers', () => {
  for (const model of ['nai-diffusion-4-full', 'nai-diffusion-4-5-full', 'nai-diffusion-5-full']) {
    const result = applyCharacterScene(snapshot('novelai', model), resolveCharacterScene(library()));
    const request = buildNovelAIRequest(result.params, result.characterScene.characterPrompts);
    assert.equal(request.parameters.v4_prompt.caption.char_captions.length, 2);
    assert.equal(request.parameters.v4_negative_prompt.caption.char_captions[0].char_caption, 'short hair');
    assert.deepEqual(request.parameters.v4_prompt.caption.char_captions.map((entry) => entry.centers[0]),
      [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }]);
    assert.equal(request.parameters.use_coords, true);
    assert.equal(request.parameters.characterPrompts.length, 2);
  }
});
test('automatic position does not enable coordinate enforcement and v3 keeps flat attributed prompts', () => {
  const scene = resolveCharacterScene(library());
  scene.entries.forEach((entry) => { entry.position = 'auto'; });
  const result = applyCharacterScene(snapshot(), scene);
  assert.equal(buildNovelAIRequest(result.params, result.characterScene.characterPrompts).parameters.use_coords, false);
  const v3 = applyCharacterScene(snapshot('novelai', 'nai-diffusion-3'), scene);
  assert.match(v3.params.positive, /Character 1.*white dress/);
  assert.equal('v4_prompt' in buildNovelAIRequest(v3.params).parameters, false);
});
test('generic OpenAI and NAI-compatible requests retain attributed identities without assuming native support', () => {
  const scene = resolveCharacterScene(library());
  const natural = applyCharacterScene(snapshot('openai', 'gpt-image-1'), scene);
  assert.match(natural.params.positive, /Character 1.*position left/);
  assert.match(natural.params.positive, /Avoid for characters: short hair/);
  const compatible = applyCharacterScene(snapshot('openai', 'nai-diffusion-4-5-full'), scene);
  assert.match(compatible.params.positive, /Character 2.*silver hair/);
  assert.doesNotMatch(compatible.params.positive, /Avoid for characters/);
  assert.match(compatible.params.negative, /short hair/);
  assert.deepEqual(applyCharacterScene(natural, natural.characterScene), natural);
});
test('ComfyUI writes role JSON only to an explicitly mapped string input and preserves the workflow graph', () => {
  const config = newComfyConfig();
  config.params.checkpoint = 'fixture.safetensors';
  config.graph['10'] = { class_type: 'RolePrompt', inputs: { characters: '[]' } };
  config.mapping.characterPrompts = { node: '10', input: 'characters' };
  const before = structuredClone(config.graph);
  const result = applyCharacterScene({ provider: 'comfyui', config }, resolveCharacterScene(library()));
  const graph = applyWorkflowParameters(result.config);
  assert.equal(JSON.parse(graph['10'].inputs.characters).length, 2);
  assert.match(graph['6'].inputs.text, /Character 2/);
  assert.deepEqual(config.graph, before);
  const cleared = applyCharacterScene(result, { entries: [] });
  assert.equal(applyWorkflowParameters(cleared.config)['10'].inputs.characters, '[]');
});
test('assistant receives fixed profiles and directions by stable ID, ignores malformed roles and freezes profile data', () => {
  const scene = resolveCharacterScene(library());
  const messages = buildAssistantMessages({ settings: {}, context: { characterScene: scene }, target: { provider: 'novelai' } });
  assert.equal(JSON.parse(messages[1].content).DRAWING_PROFILES[0].id, 'a');
  assert.match(messages[0].content, /Locked appearance/);
  const plan = parseAssistantResult(JSON.stringify({ shouldDraw: true, positive: 'garden', negative: '', characters: [
    { profileId: 'a', action: 'waving', api_key: 'never' }, null, { profileId: 'a', action: 'duplicate' },
  ], characterScene: scene }));
  assert.equal(plan.characters.length, 1);
  assert.equal('api_key' in plan.characters[0], false);
  const applied = applyAssistantPlan(snapshot(), plan, {});
  assert.match(applied.characterScene.characterPrompts[0].positive, /waving/);
  assert.equal(applied.characterScene.entries[0].profile.hair, 'long black hair');
});
test('saved snapshots remain independent of later edits and restore deleted profiles into isolated chat overrides', () => {
  const frozen = normalizeCharacterScene(applyCharacterScene(snapshot(), resolveCharacterScene(library())).characterScene);
  let db = saveProfile(library(), { ...a, hair: 'green hair' });
  db = deleteProfile(db, 'b');
  db = restoreSceneProfiles(db, frozen, 'chat-one');
  assert.equal(effectiveProfiles(db, 'chat-one')[0].hair, 'long black hair');
  assert.equal(effectiveProfiles(db, 'chat-two')[0].hair, 'green hair');
  assert.equal(db.profiles.length, 2);
  assert.equal(resolveCharacterScene(db, 'chat-one').entries.length, 2);
  assert.equal(frozen.characterPrompts[0].positive.includes('green hair'), false);
});
test('image parameter normalization and import retain frozen character captions without changing global profiles', () => {
  for (const provider of ['novelai', 'openai', 'comfyui']) {
    const input = provider === 'comfyui' ? { provider, config: newComfyConfig() } : snapshot(provider,
      provider === 'openai' ? 'gpt-image-1' : 'nai-diffusion-4-5-full');
    const value = normalizeSnapshot(applyCharacterScene(input, resolveCharacterScene(library())));
    assert.equal(value.characterScene.characterPrompts.length, 2);
    const state = { characterProfiles: library() }, before = JSON.stringify(state.characterProfiles);
    restoreSnapshot(state, value);
    assert.equal(JSON.stringify(state.characterProfiles), before);
    assert.equal(state.characterSceneOverride.applied, true);
    assert.deepEqual(captureSnapshot(state).characterScene, value.characterScene);
  }
});
test('large stored profile snapshots restore while raw model responses keep their smaller response limit', () => {
  const profiles = Array.from({ length: 6 }, (_, index) => normalizeProfile({ ...a, id: `p${index}`,
    outfits: Array.from({ length: 8 }, (_, i) => ({ id: `o${i}`, name: `outfit ${i}`, prompt: 'x'.repeat(3000) })) }));
  const scene = resolveCharacterScene(normalizeProfileLibrary({ profiles, selection: profiles.map((profile) => ({ profileId: profile.id })) }));
  const raw = JSON.stringify({ shouldDraw: true, positive: 'garden', negative: '', characterScene: scene });
  assert.ok(raw.length > 100000);
  assert.throws(() => parseAssistantResult(raw), /有效结果/);
  assert.equal(parseAssistantResult(raw, { stored: true }).characterScene.entries.length, 6);
});
test('character directory exposes only own names and stable avatars; extraction still associates profiles with card-reading disabled', async () => {
  const context = { characterId: 0, characters: [{ avatar: 'one.png', name: 'Same name', data: { description: 'secret notes' } }, { avatar: 'two.png', name: 'Same name' }],
    chat: [{ name: 'Same name', mes: 'garden' }], getCurrentChatId: () => 'chat' };
  const directory = characterDirectory(context);
  assert.equal(directory.characters.length, 2);
  assert.equal('description' in directory.characters[0], false);
  const collected = await collectAssistantContext(context, { includeCharacters: false, includeWorld: false });
  assert.deepEqual(collected.characters, []); assert.deepEqual(collected.characterAvatars, ['one.png']);
  context.groupId = 'group'; context.groups = [{ id: 'group', members: ['one.png', 'two.png'], name: 'Pair' }];
  assert.equal(characterDirectory(context).avatars.length, 2);
});
test('capacity failures are atomic and reject new profiles and oversized overrides', () => {
  const full = normalizeProfileLibrary({ profiles: Array.from({ length: 100 }, (_, i) => ({ ...a, id: `p${i}` })) });
  const before = JSON.stringify(full);
  assert.throws(() => saveProfile(full, { ...b, id: 'extra' }), /100/);
  assert.equal(JSON.stringify(full), before);
  assert.throws(() => updateProfileChat(library(), '', {}), /聊天/);
  assert.throws(() => applyCharacterScene({ provider: 'openai', params: { model: 'gpt-image-1', positive: 'x'.repeat(32000), negative: '' } },
    resolveCharacterScene(library())), /32000/);
});
