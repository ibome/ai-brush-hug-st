import test from 'node:test';
import assert from 'node:assert/strict';
import { previewCreation, creationRevision } from './creation-workflow.js';
import { buildNovelAIRequest, submitGeneration, downloadResults } from './generation.js';
import { normalizeProfileLibrary, resolveCharacterScene, applySceneOutfit, setGlobalOutfit, profileContext,
  applyCharacterScene, reconcileTemporaryScene, updateProfileChat } from './character-profiles.js';
import { applyNovelAIAdvanced } from './advanced-generation.js';
import { freezeIllustrationCharacters } from './assistant-workflow.js';
globalThis.window = { addEventListener() {} };
const { NOVELAI_DEFAULTS, normalizeNovelAI } = await import('./ui/novelai.js');

const library = () => normalizeProfileLibrary({ profiles: [{ id: 'one', name: '旅人', avatar: 'one.png', tags: '1girl',
  lockOutfit: true, outfits: [{ id: 'white', name: '白裙', prompt: 'white dress' }, { id: 'red', name: '红裙', prompt: 'red dress' }] }],
selection: [{ profileId: 'one' }] });
const snapshot = (model = 'nai-diffusion-5-full') => ({ provider: 'novelai', params: normalizeNovelAI({ ...NOVELAI_DEFAULTS,
  model, positive: 'sunlit garden', artist: 'watercolor', negative: 'blurry', transparent: true, variety: true }),
characterScene: resolveCharacterScene(library()) });

test('V5 PNG requests preserve transparency and role captions, omitting unsupported schedule and Variety+', () => {
  for (const model of ['nai-diffusion-5-full', 'nai-diffusion-5-curated']) {
    const value = snapshot(model), request = buildNovelAIRequest(value.params);
    assert.equal(request.parameters.params_version, 4);
    assert.equal(request.parameters.tag_hint_transparent_background, true);
    assert.equal(request.parameters.straight_alpha, true);
    assert.equal(request.parameters.image_format, 'png');
    assert.equal('noise_schedule' in request.parameters, false);
    assert.equal('skip_cfg_above_sigma' in request.parameters, false);
    assert.equal(normalizeNovelAI(value.params).transparent, true);
  }
  for (const model of ['nai-diffusion-3', 'nai-diffusion-4-5-full']) {
    const request = buildNovelAIRequest(snapshot(model).params);
    assert.equal('tag_hint_transparent_background' in request.parameters, false);
    assert.equal(request.parameters.noise_schedule, 'karras');
  }
});

test('creation preview shows the actual flattened or native role prompts and never mutates a saved draft', () => {
  const original = snapshot(), revision = creationRevision(original);
  const preview = previewCreation(original);
  assert.equal(preview.positive, 'watercolor, sunlit garden');
  assert.match(preview.characters[0].positive, /white dress/);
  assert.equal(creationRevision(original), revision);
  const flat = { ...original, provider: 'openai', params: { ...original.params, model: 'gpt-image-1' } };
  assert.match(previewCreation(flat).positive, /Character 1.*white dress/);
  assert.throws(() => previewCreation({ ...original, params: { ...original.params, positive: '', artist: '' } }), /请先填写/);
  assert.throws(() => previewCreation({ ...original, params: { ...original.params, advanced: { mode: 'inpaint' } } }), /底图/);
});

test('prompt source labels distinguish preset equality, edits and applied assistant values without changing the request', () => {
  const value = snapshot(), before = structuredClone(value);
  value.characterScene = applySceneOutfit(value.characterScene, 'one', { mode: 'custom', prompt: 'blue cloak' }, 'once');
  const preview = previewCreation(value, { preset: { name: '水彩', params: { artist: 'watercolor', positive: 'other scene', negative: 'blurry' } },
    origin: { label: '与助手草稿相同', params: { positive: 'sunlit garden' } }, pendingOutfits: ['旅人'] });
  assert.match(preview.components[0].source, /与预设「水彩」相同/);
  assert.equal(preview.components[1].source, '与助手草稿相同');
  assert.equal(preview.roles[0].source, '仅下一次生图');
  assert.equal(preview.roles[0].outfit, 'blue cloak');
  assert.deepEqual(preview.pendingOutfits, ['旅人']);
  const edited = previewCreation(before, { preset: { name: '水彩', params: { positive: 'other scene' } } });
  assert.match(edited.components[1].source, /当前编辑值/);
  const flat = previewCreation({ ...value, provider: 'openai', params: { ...value.params, model: 'image' } });
  assert.equal(flat.components[1].text, 'sunlit garden');
  assert.match(flat.positive, /Character 1.*blue cloak/);
});

test('inpainting previews agree with the submitted model and effective transparent background', async () => {
  const asset = (id) => ({ id: id.repeat(64), location: 'server', name: 'fixture', width: 832, height: 1216, mime: 'image/png' });
  for (const [selected, actual, transparent] of [
    ['nai-diffusion-5-full', 'nai-diffusion-5-full-inpainting', true],
    ['nai-diffusion-5-curated', 'nai-diffusion-4-5-curated-inpainting', false],
    ['nai-diffusion-4-curated-preview', 'nai-diffusion-4-curated-inpainting', false],
  ]) {
    const value = snapshot(selected);
    value.params.advanced = { mode: 'inpaint', source: asset('a'), mask: asset('b') };
    const before = structuredClone(value), preview = previewCreation(value);
    const body = await applyNovelAIAdvanced(buildNovelAIRequest(value.params), value, async () => 'fixture-bytes');
    assert.equal(preview.model, actual); assert.equal(preview.selectedModel, selected);
    assert.equal(preview.model, body.model); assert.equal(preview.transparent, transparent);
    assert.equal(preview.transparencyUnavailable, !transparent);
    assert.equal(body.parameters.tag_hint_transparent_background === true, transparent);
    assert.deepEqual(value, before);
  }
});

test('temporary custom and wardrobe choices override AI outfit changes, while AI mode releases the profile lock', () => {
  const db = library(), before = structuredClone(db), scene = resolveCharacterScene(db);
  for (const choice of [{ mode: 'custom', prompt: 'blue travel cloak' }, { mode: 'wardrobe', outfitId: 'red' }]) {
    const changed = applySceneOutfit(scene, 'one', choice, 'once');
    const context = profileContext(changed)[0];
    assert.equal(context.lockOutfit, true);
    const result = applyCharacterScene(snapshot(), changed, [{ profileId: 'one', outfit: 'yellow suit' }]);
    assert.match(result.characterScene.characterPrompts[0].positive, choice.mode === 'custom' ? /blue travel cloak/ : /red dress/);
    assert.doesNotMatch(result.characterScene.characterPrompts[0].positive, /yellow suit|white dress/);
    const plan = { positive: 'garden', characters: [{ profileId: 'one', outfit: 'yellow suit' }] };
    freezeIllustrationCharacters(plan, changed);
    assert.equal(plan.characters[0].outfit, '');
  }
  const ai = applySceneOutfit(scene, 'one', { mode: 'ai' }, 'project');
  assert.equal(profileContext(ai)[0].lockOutfit, false);
  const result = applyCharacterScene(snapshot(), ai, [{ profileId: 'one', outfit: 'yellow suit' }]);
  assert.match(result.characterScene.characterPrompts[0].positive, /yellow suit/);
  const plan = { characters: [{ profileId: 'one', outfit: 'yellow suit' }] };
  freezeIllustrationCharacters(plan, ai);
  assert.equal(plan.characters[0].outfit, 'yellow suit');
  assert.deepEqual(db, before); assert.equal(scene.entries[0].outfitMode, undefined);
});

test('global outfit saves remain explicit and preserve per-chat overrides and past snapshots', () => {
  const db = library(); db.chats = [{ chatKey: 'one-chat', selection: [{ profileId: 'one', outfitId: 'red' }], overrides: [] }];
  const past = resolveCharacterScene(db), frozen = structuredClone(past);
  const changed = setGlobalOutfit(db, 'one', { mode: 'custom', prompt: 'travel cloak' }, 'cloak');
  assert.equal(resolveCharacterScene(changed).entries[0].outfitId, 'cloak');
  assert.equal(resolveCharacterScene(changed, 'one-chat').entries[0].outfitId, 'red');
  assert.equal(db.profiles[0].outfits.length, 2);
  assert.deepEqual(past, frozen);
  assert.throws(() => applySceneOutfit(past, 'one', { mode: 'custom' }), /填写/);
  assert.throws(() => applySceneOutfit(past, 'one', { mode: 'wardrobe', outfitId: 'missing' }), /有效服装/);
});

test('temporary cast changes preserve outfits and edits without saving them to the chat library', () => {
  const db = library();
  db.profiles.push({ ...structuredClone(db.profiles[0]), id: 'two', name: '同行者', avatar: 'two.png' });
  const live = resolveCharacterScene(db, 'chat', ['one.png']);
  const pending = applySceneOutfit(live, 'one', { mode: 'custom', prompt: 'blue cloak' }, 'once');
  pending.entries[0].action = 'reading'; pending.entries[0].position = 'right';
  const applied = applyCharacterScene(snapshot(), pending).characterScene;
  const changed = updateProfileChat(db, 'chat', { selection: [{ profileId: 'one' }, { profileId: 'two' }] });
  const before = structuredClone(changed), next = reconcileTemporaryScene(applied, resolveCharacterScene(changed, 'chat'));
  assert.deepEqual(next.entries.map((entry) => entry.profileId), ['one', 'two']);
  assert.equal(next.entries[0].outfitPrompt, 'blue cloak'); assert.equal(next.entries[0].action, 'reading');
  assert.equal(next.entries[0].position, 'right'); assert.equal(next.entries[1].outfitScope, undefined);
  assert.equal(next.applied, undefined); assert.equal(next.characterPrompts, undefined);
  assert.deepEqual(changed, before);
  assert.equal(changed.chats[0].selection[0].outfitScope, undefined);
  assert.equal(reconcileTemporaryScene(next, live).entries.length, 1);
  const onlySecond = updateProfileChat(changed, 'chat', { selection: [{ profileId: 'two' }] });
  assert.equal(reconcileTemporaryScene(next, resolveCharacterScene(onlySecond, 'chat')), null);
  assert.equal(reconcileTemporaryScene(next, resolveCharacterScene(changed, 'other-chat', ['one.png'])), null);
  assert.equal(reconcileTemporaryScene(live, live), null);
});

test('replacing one role outfit preserves other pending roles and refreshes current profile data', () => {
  const db = library();
  db.profiles.push({ ...structuredClone(db.profiles[0]), id: 'two', name: '同行者' });
  db.selection.push({ profileId: 'two' });
  const pending = applySceneOutfit(applySceneOutfit(resolveCharacterScene(db), 'one',
    { mode: 'custom', prompt: 'blue cloak' }), 'two', { mode: 'custom', prompt: 'green coat' });
  pending.entries[0].action = 'reading';
  db.profiles[0].hair = 'silver hair';
  const live = applySceneOutfit(resolveCharacterScene(db), 'one', { mode: 'wardrobe', outfitId: 'red' }, 'chat');
  const next = reconcileTemporaryScene(pending, live, ['one']);
  assert.equal(next.entries[0].outfitId, 'red'); assert.equal(next.entries[0].outfitMode, 'wardrobe');
  assert.equal(next.entries[0].outfitScope, 'chat'); assert.equal(next.entries[0].outfitPrompt, undefined);
  assert.equal(next.entries[0].profile.hair, 'silver hair'); assert.equal(next.entries[0].action, 'reading');
  assert.equal(next.entries[1].outfitPrompt, 'green coat'); assert.equal(next.entries[1].outfitScope, 'once');
  assert.equal(reconcileTemporaryScene(pending, live, ['one', 'two']), null);
});

test('saving an existing custom outfit reuses it even when the wardrobe is full', () => {
  let db = setGlobalOutfit(library(), 'one', { mode: 'custom', prompt: 'travel cloak' }, 'cloak');
  db = setGlobalOutfit(db, 'one', { mode: 'custom', prompt: ' travel cloak ' }, 'duplicate');
  assert.equal(db.profiles[0].outfits.length, 3); assert.equal(db.profiles[0].defaultOutfitId, 'cloak');
  while (db.profiles[0].outfits.length < 20) {
    const index = db.profiles[0].outfits.length;
    db.profiles[0].outfits.push({ id: `outfit-${index}`, name: 'Other', prompt: `outfit ${index}` });
  }
  assert.equal(setGlobalOutfit(db, 'one', { mode: 'custom', prompt: 'travel cloak' }, 'another').profiles[0].outfits.length, 20);
  assert.throws(() => setGlobalOutfit(db, 'one', { mode: 'custom', prompt: 'new outfit' }, 'new'), /已满/);
});

test('accepted V5 JSON image responses are recoverable without submitting generation twice', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRXYAAAAASUVORK5CYII=';
  const value = snapshot(), current = { controller: new AbortController(), plan: { provider: 'novelai',
    url: 'https://fixture.test/ai/generate-image', headers: {}, body: buildNovelAIRequest(value.params) } };
  let calls = 0;
  await submitGeneration(current, async () => { calls++; return Response.json({ images: [{ image: png }] }); });
  await submitGeneration(current, () => assert.fail('duplicate request'));
  assert.equal((await downloadResults(current)).length, 1); assert.equal(calls, 1);
});
