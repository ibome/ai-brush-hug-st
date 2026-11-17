import test from 'node:test';
import assert from 'node:assert/strict';
import { OutfitDraftSessions, pendingOutfitDrafts, prepareOutfitDrafts } from './outfit-drafts.js';
import { normalizeProfileLibrary, resolveCharacterScene, applySceneOutfit, updateProfileChat } from './character-profiles.js';

const setup = () => {
  const library = normalizeProfileLibrary({ profiles: ['one', 'two'].map((id) => ({
    id, name: id, outfits: [{ id: 'white', prompt: 'white dress' }, { id: 'red', prompt: 'red dress' }], lockOutfit: true,
  })), selection: [{ profileId: 'one' }, { profileId: 'two' }] });
  return { library, scene: resolveCharacterScene(library), chatKey: '' };
};
test('outfit drafts survive chat switches without sharing or applying another chat draft', () => {
  const sessions = new OutfitDraftSessions(), before = setup();
  const original = structuredClone(before);
  sessions.forChat('one').one = { mode: 'custom', prompt: 'blue cloak', scope: 'chat' };
  assert.equal(sessions.forChat('two').one, undefined);
  sessions.forChat('two').one = { mode: 'custom', prompt: 'green cloak', scope: 'once' };
  assert.equal(sessions.forChat('one').one.prompt, 'blue cloak');
  delete sessions.forChat('one').one;
  assert.equal(sessions.forChat('two').one.prompt, 'green cloak');
  assert.deepEqual(before, original);
  sessions.clear();
  assert.deepEqual(sessions.forChat('two'), {});
});
test('outfit draft retention is bounded and keeps the most recently visited chat', () => {
  const sessions = new OutfitDraftSessions(2);
  sessions.forChat('').one = { prompt: 'workshop coat' };
  sessions.forChat('first').one = { prompt: 'first coat' };
  sessions.forChat('');
  sessions.forChat('second').one = { prompt: 'second coat' };
  assert.equal(sessions.forChat('').one.prompt, 'workshop coat');
  assert.deepEqual(sessions.forChat('first'), {});
});
test('pending outfit detection ignores inactive roles and irrelevant hidden values, but includes scope changes', () => {
  const { scene } = setup();
  assert.equal(pendingOutfitDrafts(scene, { one: { mode: 'inherit', outfitId: 'red', prompt: 'old hidden text', scope: 'once' } }).length, 0);
  assert.equal(pendingOutfitDrafts(scene, { removed: { mode: 'custom', prompt: 'coat' } }).length, 0);
  assert.equal(pendingOutfitDrafts(scene, { one: { mode: 'inherit', scope: 'global' } }).length, 1);
  const applied = applySceneOutfit(scene, 'one', { mode: 'custom', prompt: 'coat' });
  assert.equal(pendingOutfitDrafts(applied, { one: { mode: 'custom', prompt: ' coat ', scope: 'once' } }).length, 0);
  assert.equal(pendingOutfitDrafts(scene, { one: { mode: 'custom', prompt: '' } }).length, 1);
});
test('invalid later outfit drafts never partially apply global, chat or temporary changes', () => {
  const original = setup(), before = structuredClone(original);
  assert.throws(() => prepareOutfitDrafts(original, [
    { profileId: 'one', mode: 'custom', prompt: 'blue cloak', scope: 'global' },
    { profileId: 'two', mode: 'custom', prompt: '', scope: 'once' },
  ], () => 'new-outfit'), /填写/);
  assert.deepEqual(original, before);
  assert.throws(() => prepareOutfitDrafts(original, [{ profileId: 'one', mode: 'wardrobe', outfitId: 'red', scope: 'chat' }]), /打开一个聊天/);
});
test('mixed scope outfit application preserves other temporary outfits and confines global and chat edits', () => {
  const original = setup(); original.chatKey = 'chat';
  original.library = updateProfileChat(original.library, 'chat', { selection: original.library.selection });
  original.scene = resolveCharacterScene(original.library, 'chat');
  const before = structuredClone(original);
  const next = prepareOutfitDrafts(original, [
    { profileId: 'one', mode: 'custom', prompt: 'blue cloak', scope: 'once' },
    { profileId: 'two', mode: 'wardrobe', outfitId: 'red', scope: 'chat' },
  ], () => 'new-outfit');
  assert.equal(next.scene.entries[0].outfitPrompt, 'blue cloak');
  assert.equal(next.scene.entries[1].outfitId, 'red');
  assert.equal(next.library.profiles[1].defaultOutfitId, 'white');
  assert.equal(next.library.chats[0].selection[1].outfitId, 'red');
  assert.deepEqual(original, before);
});
