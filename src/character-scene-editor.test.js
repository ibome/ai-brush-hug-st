import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProfileLibrary, resolveCharacterScene, applyCharacterScene } from './character-profiles.js';
import { draftCharacterScene, editCharacterParticipant, selectCharacterParticipant, arrangeCharacterScene } from './character-scene-editor.js';
import { characterLayoutWarnings, characterPositionLabel } from './character-layout.js';
import { previewCreation } from './creation-workflow.js';
globalThis.window ||= { addEventListener() {} };
const { captureSnapshot, restoreSnapshot } = await import('./ui/drawings.js');
const { renderCharacterSelection, renderCharacters } = await import('./ui/characters.js');
const { normalizeNovelAI } = await import('./ui/novelai.js');

const library = () => normalizeProfileLibrary({
  profiles: [{ id: 'a', name: '小蓝', hair: 'blue hair', tags: '1girl' },
    { id: 'b', name: '小红', hair: 'red hair', tags: '1girl' }],
  selection: [{ profileId: 'a' }, { profileId: 'b' }],
});
const snapshot = () => ({ provider: 'novelai', params: normalizeNovelAI({
  model: 'nai-diffusion-4-5-full', positive: 'garden', artist: '', negative: 'blurry',
}) });
const frozen = () => applyCharacterScene(snapshot(), resolveCharacterScene(library()), [
  { profileId: 'a', position: 'B3', action: 'waving', expression: 'smiling',
    interaction: { targetId: 'b', mode: 'mutual', action: 'holding hands' } },
  { profileId: 'b', position: 'D3', action: 'reading' },
]);

test('editing an image scene preserves captured identities and never modifies the library or original snapshot', () => {
  const value = frozen(), original = structuredClone(value), db = library(), saved = structuredClone(db);
  db.profiles[0].hair = 'green hair';
  const before = structuredClone(db);
  let scene = editCharacterParticipant(value.characterScene, 'a', 'position', 'E2');
  scene = editCharacterParticipant(scene, 'a', 'action', 'running');
  const result = applyCharacterScene(snapshot(), scene);
  assert.equal(result.characterScene.characterPrompts[0].position, 'E2');
  assert.match(result.characterScene.characterPrompts[0].positive, /blue hair.*running.*smiling/);
  assert.doesNotMatch(result.characterScene.characterPrompts[0].positive, /green hair|waving/);
  assert.match(result.characterScene.characterPrompts[1].positive, /reading/);
  assert.deepEqual(db, before);
  assert.deepEqual(value, original);
  assert.equal(saved.profiles[0].hair, 'blue hair');
});

test('clearing image actions and restoring automatic positions suppresses previous assistant directions', () => {
  let scene = editCharacterParticipant(frozen().characterScene, 'a', 'action', '');
  scene = editCharacterParticipant(scene, 'a', 'expression', '');
  scene = arrangeCharacterScene(scene, 'auto');
  const result = applyCharacterScene(snapshot(), scene);
  assert.ok(result.characterScene.characterPrompts.every((role) => role.position === 'auto'));
  assert.doesNotMatch(result.characterScene.characterPrompts[0].positive, /waving|smiling/);
  assert.match(result.characterScene.characterPrompts[1].positive, /reading/);
  assert.deepEqual(arrangeCharacterScene(frozen().characterScene, 'reverse').entries.map((row) => row.position), ['D3', 'B3']);
});

test('scene cast changes retain temporary clothes and an explicit empty scene survives parameter restore', () => {
  const value = frozen();
  value.characterScene.entries[0].outfitMode = 'custom';
  value.characterScene.entries[0].outfitPrompt = 'white cloak';
  value.characterScene.entries[0].outfitScope = 'once';
  const one = selectCharacterParticipant(value.characterScene, 'b', false);
  assert.equal(one.entries[0].outfitPrompt, 'white cloak');
  assert.match(applyCharacterScene(snapshot(), one).characterScene.characterPrompts[0].positive, /white cloak/);
  const empty = selectCharacterParticipant(one, 'a', false);
  const state = { characterProfiles: library() };
  restoreSnapshot(state, { ...snapshot(), characterScene: empty });
  assert.deepEqual(captureSnapshot(state).characterScene.entries, []);
  assert.equal(state.characterProfiles.selection.length, 2);
  const added = selectCharacterParticipant(empty, 'b', true, state.characterProfiles.profiles, 6);
  assert.deepEqual(added.entries.map((row) => row.profileId), ['b']);
  assert.throws(() => selectCharacterParticipant(added, 'a', true, state.characterProfiles.profiles, 1), /1/);
  assert.throws(() => selectCharacterParticipant(empty, 'missing', true, []), /不存在/);
});

test('legacy image edits conservatively recover visible actions before rebuilding captions', () => {
  const value = frozen();
  delete value.characterScene.directions;
  const scene = editCharacterParticipant(value.characterScene, 'a', 'position', 'A1');
  const result = applyCharacterScene(snapshot(), scene);
  assert.match(result.characterScene.characterPrompts[0].positive, /waving.*smiling/);
  assert.match(result.characterScene.characterPrompts[1].positive, /reading/);
  assert.equal(value.characterScene.applied, true);
  assert.throws(() => editCharacterParticipant(scene, 'a', 'apiKey', 'not stored'), /字段/);
  assert.throws(() => editCharacterParticipant(scene, 'missing', 'action', 'running'), /未加入/);
  assert.throws(() => draftCharacterScene(null), /失效/);
});

test('preview identifies overlapping positions and ignored interactions without blocking valid requests', () => {
  let scene = editCharacterParticipant(frozen().characterScene, 'a', 'position', 'C3');
  scene = editCharacterParticipant(scene, 'b', 'position', 'center');
  scene = editCharacterParticipant(scene, 'a', 'interaction.action', '');
  let preview = previewCreation({ ...snapshot(), characterScene: scene });
  assert.match(preview.characterWarnings.join(' '), /相同画面位置.*尚未填写动作/);
  scene = selectCharacterParticipant(scene, 'b', false);
  preview = previewCreation({ ...snapshot(), characterScene: scene });
  assert.match(preview.characterWarnings.join(' '), /互动对象未出场/);
  scene = editCharacterParticipant(scene, 'a', 'interaction.targetId', '');
  assert.equal(previewCreation({ ...snapshot(), characterScene: scene }).characterWarnings.length, 0);
  assert.deepEqual(characterLayoutWarnings(null), []);
  assert.equal(characterPositionLabel('auto'), '自动');
  assert.equal(characterPositionLabel('B3'), '网格 B3');
});

test('scene controls retain missing image profiles and display an explicit empty image selection', () => {
  const state = { provider: 'novelai', novelai: snapshot().params, characterProfiles: library(),
    characterSceneOverride: frozen().characterScene };
  state.characterProfiles.profiles = state.characterProfiles.profiles.filter((row) => row.id !== 'b');
  const html = renderCharacterSelection(state, {}, { frozen: true });
  assert.match(html, /图片记录/);
  assert.match(html, /data-profile-participant="b"[^>]*checked/);
  assert.match(html, /与档案库独立/);
  state.characterSceneOverride = { version: 1, entries: [] };
  const empty = renderCharacterSelection(state, {}, { frozen: true });
  assert.match(empty, /本次未附加角色档案/);
  assert.doesNotMatch(empty, /data-profile-participant="a"[^>]*checked/);
});
test('empty role libraries expose creation from the workshop and the chat override view', () => {
  const state = { provider: 'novelai', novelai: snapshot().params, characterProfiles: normalizeProfileLibrary() };
  assert.match(renderCharacterSelection(state, {}), /data-action="profiles-open"[^]*创建角色档案/);
  const page = renderCharacters(state, { scope: 'chat', draft: null, characters: [], outfitDrafts: {} }, { key: 'chat' });
  assert.match(page, /当前聊天暂无可覆盖的档案/);
  assert.match(page, /data-action="new-character" >[^]*创建全局档案/);
  assert.doesNotMatch(page, /data-action="new-character" disabled/);
  const draft = { ...library().profiles[0], enabled: true };
  const edit = renderCharacters({ ...state, characterProfiles: library() },
    { scope: 'global', draft, characters: [], outfitDrafts: {} }, {});
  assert.match(edit, /data-action="save-character-use"[^]*保存并加入出场/);
});
test('scene controls display a missing interaction target rather than silently showing no interaction', () => {
  const db = library();
  db.selection.push({ profileId: 'c' });
  db.profiles.push({ ...db.profiles[0], id: 'c', name: '第三人' });
  const scene = frozen().characterScene;
  scene.entries.push({ profileId: 'c', profile: db.profiles[2] });
  const missing = selectCharacterParticipant(scene, 'b', false);
  const html = renderCharacterSelection({ provider: 'novelai', novelai: snapshot().params, characterProfiles: db,
    characterSceneOverride: missing }, {}, { frozen: true });
  assert.match(html, /value="b" selected disabled>原互动对象未出场/);
});
