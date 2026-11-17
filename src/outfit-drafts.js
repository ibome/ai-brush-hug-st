import { applySceneOutfit, outfitChoice, setGlobalOutfit, resolveCharacterScene,
  reconcileTemporaryScene, updateProfileChat } from './character-profiles.js';

export class OutfitDraftSessions {
  constructor(limit = 32) { this.limit = limit; this.chats = new Map(); }
  forChat(chatKey = '') {
    const drafts = this.chats.get(chatKey) || {};
    this.chats.delete(chatKey); this.chats.set(chatKey, drafts);
    while (this.chats.size > this.limit) this.chats.delete(this.chats.keys().next().value);
    return drafts;
  }
  clear() { this.chats.clear(); }
}

export function pendingOutfitDrafts(scene, drafts = {}) {
  return (scene?.entries || []).flatMap((entry) => {
    const draft = drafts[entry.profileId];
    if (!draft) return [];
    const choice = outfitChoice(draft), mode = entry.outfitMode || 'inherit';
    const changed = choice.mode !== mode
      || choice.mode === 'custom' && choice.prompt !== (entry.outfitPrompt || '').trim()
      || choice.mode === 'wardrobe' && choice.outfitId !== entry.outfitId
      || draft.scope && draft.scope !== 'once' && draft.scope !== entry.outfitScope;
    return changed ? [{ profileId: entry.profileId, name: entry.profile.name, ...choice, scope: draft.scope || 'once' }] : [];
  });
}

// Prepare all changes before the caller commits settings, so an invalid later row
// cannot leave an earlier global or chat outfit partially saved.
export function prepareOutfitDrafts({ library, scene, chatKey, avatars = [] }, choices, newId) {
  let nextLibrary = structuredClone(library), nextScene = structuredClone(scene);
  for (const choice of choices) {
    if (choice.scope === 'global') {
      nextLibrary = setGlobalOutfit(nextLibrary, choice.profileId, choice, newId());
      const live = resolveCharacterScene(nextLibrary, chatKey, avatars);
      nextScene = reconcileTemporaryScene(nextScene, live, [choice.profileId]) || live;
    } else if (choice.scope === 'chat') {
      if (!chatKey) throw new Error('请先打开一个聊天');
      const live = applySceneOutfit(resolveCharacterScene(nextLibrary, chatKey, avatars), choice.profileId, choice, 'chat');
      nextLibrary = updateProfileChat(nextLibrary, chatKey, {
        selection: live.entries.map(({ profile, ...entry }) => entry),
      });
      nextScene = reconcileTemporaryScene(nextScene, live, [choice.profileId]) || live;
    } else nextScene = applySceneOutfit(nextScene, choice.profileId, choice, 'once');
  }
  return { library: nextLibrary, scene: nextScene };
}
