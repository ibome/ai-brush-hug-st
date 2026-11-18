import { assetReference } from './advanced-generation.js';
import { characterPosition, characterPositionText, independentCharacters } from './character-layout.js';
export { POSITION_OPTIONS } from './character-layout.js';

export const PROFILE_LIMIT = 100;
export const SCENE_LIMIT = 6;
export const CHARACTER_STORAGE_LIMIT = 22;
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit = 4000) => typeof value === 'string' ? value.slice(0, limit).trim() : '';
const id = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const unique = (values, key, limit) => {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).filter((value) => {
    if (!object(value) || !id(value[key]) || seen.has(value[key])) return false;
    seen.add(value[key]); return true;
  }).slice(0, limit);
};
const joined = (...values) => [...new Set(values.map((value) => text(value, 32000)).filter(Boolean))].join(', ');
export function normalizeAliases(value) {
  return [...new Set((Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[|,，\n]/) : [])
    .map((item) => text(item, 120)).filter(Boolean))].slice(0, 20);
}
export function characterInteraction(value) {
  return object(value) && (value.targetId === '' || id(value.targetId)) ? {
    targetId: value.targetId, action: text(value.action, 500), mode: value.mode === 'mutual' ? 'mutual' : 'source',
  } : null;
}
export const OUTFIT_MODES = [['inherit', '跟随档案与剧情'], ['wardrobe', '选择服装库'], ['custom', '自定义服装'], ['ai', '由 AI 决定']];
export function outfitChoice(value = {}) {
  return { mode: OUTFIT_MODES.some(([id]) => id === value.mode) ? value.mode : 'inherit',
    outfitId: text(value.outfitId, 80), prompt: text(value.prompt) };
}
export function effectiveOutfit(entry) {
  const mode = entry.outfitMode || 'inherit';
  return { mode, prompt: mode === 'custom' ? entry.outfitPrompt || '' : mode === 'ai' ? ''
    : entry.profile.outfits?.find((item) => item.id === entry.outfitId)?.prompt || '',
  locked: mode === 'custom' || mode === 'wardrobe' || mode === 'inherit' && entry.profile.lockOutfit };
}

export function normalizeProfile(value) {
  if (!object(value) || !id(value.id)) return null;
  const outfits = unique(value.outfits, 'id', 20).map((outfit) => ({
    id: outfit.id, name: text(outfit.name, 80) || '服装', prompt: text(outfit.prompt),
  }));
  return {
    id: value.id, name: text(value.name, 120) || '新角色', avatar: text(value.avatar, 512),
    aliases: normalizeAliases(value.aliases),
    enabled: value.enabled !== false, hair: text(value.hair, 800), eyes: text(value.eyes, 800),
    body: text(value.body, 800), features: text(value.features, 1600),
    tags: text(value.tags), negative: text(value.negative, 2000),
    lockAppearance: value.lockAppearance !== false, lockOutfit: value.lockOutfit === true,
    reference: assetReference(value.reference),
    outfits, defaultOutfitId: value.defaultOutfitId === '' ? '' : outfits.some((item) => item.id === value.defaultOutfitId) ? value.defaultOutfitId : outfits[0]?.id || '',
  };
}

export function normalizeParticipants(value, profiles) {
  const allowed = new Set(profiles.map((profile) => profile.id));
  return unique(value, 'profileId', CHARACTER_STORAGE_LIMIT).filter((entry) => allowed.has(entry.profileId)).map((entry) => ({
    profileId: entry.profileId, outfitId: entry.outfitId === undefined ? profiles.find((profile) => profile.id === entry.profileId)?.defaultOutfitId || '' : text(entry.outfitId, 80),
    ...(OUTFIT_MODES.some(([id]) => id !== 'inherit' && id === entry.outfitMode) ? { outfitMode: entry.outfitMode } : {}),
    ...(entry.outfitMode === 'custom' ? { outfitPrompt: text(entry.outfitPrompt) } : {}),
    ...(['once', 'chat', 'global', 'project'].includes(entry.outfitScope) ? { outfitScope: entry.outfitScope } : {}),
    action: text(entry.action, 1000), expression: text(entry.expression, 500),
    positive: text(entry.positive, 2000), negative: text(entry.negative, 1000),
    position: characterPosition(entry.position),
    participation: entry.participation === 'always' ? 'always' : 'story',
    ...(characterInteraction(entry.interaction) ? { interaction: characterInteraction(entry.interaction) } : {}),
  }));
}

export function normalizeProfileLibrary(value = {}) {
  if (!object(value)) value = {};
  const profiles = unique(value.profiles, 'id', PROFILE_LIMIT).map(normalizeProfile);
  const seen = new Set();
  const chats = (Array.isArray(value.chats) ? value.chats : []).filter((chat) => {
    if (!object(chat) || !text(chat.chatKey, 2048) || chat.chatKey.length > 2048 || seen.has(chat.chatKey)) return false;
    seen.add(chat.chatKey); return true;
  }).map((chat) => ({
    chatKey: chat.chatKey,
    selection: chat.selection === null || chat.selection === undefined ? null : normalizeParticipants(chat.selection, profiles),
    overrides: unique(chat.overrides, 'id', PROFILE_LIMIT).filter((profile) => profiles.some((item) => item.id === profile.id)).map(normalizeProfile),
  })).filter((chat) => chat.selection !== null || chat.overrides.length).slice(0, 200);
  return { version: 1, profiles, chats, selection: normalizeParticipants(value.selection, profiles) };
}

export function migrateProfileLibrary(saved = {}) {
  if (!object(saved)) saved = {};
  if (saved.characterProfiles) return normalizeProfileLibrary(saved.characterProfiles);
  if (!saved.appearance && !saved.outfit) return normalizeProfileLibrary();
  return normalizeProfileLibrary({ profiles: [{
    id: 'legacy-profile', name: saved.character || '角色草稿', tags: saved.appearance || '',
    outfits: saved.outfit ? [{ id: 'legacy-outfit', name: '原服装', prompt: saved.outfit }] : [],
  }] });
}

export function effectiveProfiles(library, chatKey = '') {
  const db = normalizeProfileLibrary(library);
  const overrides = db.chats.find((chat) => chat.chatKey === chatKey)?.overrides || [];
  return db.profiles.map((profile) => overrides.find((item) => item.id === profile.id) || profile);
}

export function updateProfileChat(library, chatKey, patch) {
  if (!chatKey || chatKey.length > 2048) throw new Error('请先打开一个酒馆聊天');
  const db = normalizeProfileLibrary(library);
  let chat = db.chats.find((item) => item.chatKey === chatKey);
  if (!chat) {
    if (db.chats.length >= 200) throw new Error('聊天档案配置已达 200 组，请先删除不用的聊天覆盖');
    chat = { chatKey, selection: null, overrides: [] }; db.chats.push(chat);
  }
  Object.assign(chat, patch);
  return boundedLibrary(db);
}

export function saveProfile(library, profile, chatKey = '') {
  const db = normalizeProfileLibrary(library);
  const clean = normalizeProfile(profile);
  if (!clean) throw new Error('角色档案无效');
  const existing = db.profiles.findIndex((item) => item.id === clean.id);
  if (chatKey) {
    if (existing < 0) throw new Error('请先保存全局档案');
    const overrides = [...(db.chats.find((chat) => chat.chatKey === chatKey)?.overrides || [])]
      .filter((item) => item.id !== clean.id);
    overrides.push(clean);
    return updateProfileChat(db, chatKey, { overrides });
  }
  if (existing < 0) {
    if (db.profiles.length >= PROFILE_LIMIT) throw new Error('最多保存 100 个角色档案');
    db.profiles.push(clean);
  } else db.profiles[existing] = clean;
  return boundedLibrary(db);
}

export function saveProfileAndSelect(library, profile, { chatKey = '', avatars = [], scope = 'global', limit = SCENE_LIMIT } = {}) {
  const clean = normalizeProfile(profile);
  if (!clean?.enabled) throw new Error('请启用此档案后再加入出场');
  if (scope === 'chat' && !chatKey) throw new Error('请先打开一个酒馆聊天');
  let db = saveProfile(library, clean, scope === 'chat' ? chatKey : '');
  if (!effectiveProfiles(db, chatKey).find((entry) => entry.id === clean.id)?.enabled) {
    throw new Error('当前聊天覆盖已停用此档案，请先启用聊天覆盖');
  }
  const scene = resolveCharacterScene(db, chatKey, avatars);
  if (scene.entries.length > limit) throw new Error(`当前模型一幅画最多选择 ${limit} 个角色；可先仅保存档案`);
  if (!scene.entries.some((entry) => entry.profileId === clean.id)) {
    if (scene.entries.length >= limit) throw new Error(`当前模型一幅画最多选择 ${limit} 个角色；可先仅保存档案`);
    scene.entries.push({ profileId: clean.id, profile: clean, outfitId: clean.defaultOutfitId, position: 'auto' });
  }
  const selection = scene.entries.map(({ profile: captured, ...entry }) => entry);
  if (chatKey) db = updateProfileChat(db, chatKey, { selection });
  else db = boundedLibrary({ ...db, selection });
  return db;
}

function boundedLibrary(value) {
  const db = normalizeProfileLibrary(value);
  if (JSON.stringify(db).length > 750000) throw new Error('角色档案库超过容量，请减少服装描述或删除不用的聊天覆盖');
  return db;
}

export function deleteProfile(library, profileId) {
  const db = normalizeProfileLibrary(library);
  db.profiles = db.profiles.filter((profile) => profile.id !== profileId);
  return normalizeProfileLibrary(db);
}

export function resolveCharacterScene(library, chatKey = '', avatars = []) {
  const db = normalizeProfileLibrary(library);
  const profiles = effectiveProfiles(db, chatKey);
  const chat = db.chats.find((item) => item.chatKey === chatKey);
  const selection = chatKey ? chat?.selection ?? null : db.selection;
  const selected = selection === null ? profiles.filter((profile) =>
    profile.enabled && profile.avatar && avatars.includes(profile.avatar)).slice(0, CHARACTER_STORAGE_LIMIT).map((profile) => ({ profileId: profile.id })) : selection;
  return normalizeCharacterScene({ version: 1, chatKey, entries: selected.map((entry) => ({
    ...entry, profile: profiles.find((item) => item.id === entry.profileId),
  })).filter((entry) => entry.profile?.enabled) });
}

export function normalizeCharacterScene(value) {
  if (!object(value) || !Array.isArray(value.entries)) return null;
  const entries = unique(value.entries, 'profileId', CHARACTER_STORAGE_LIMIT).flatMap((entry) => {
    const profile = normalizeProfile(entry.profile);
    if (!profile || profile.id !== entry.profileId) return [];
    return [{ ...normalizeParticipants([entry], [profile])[0], profile,
      outfitId: entry.outfitId === '' ? '' : profile.outfits.some((outfit) => outfit.id === entry.outfitId) ? entry.outfitId : profile.defaultOutfitId }];
  });
  const scene = { version: 1, chatKey: text(value.chatKey, 2048), entries,
    ...(value.source === 'structured' ? { source: 'structured' } : {}),
    ...(Array.isArray(value.directions) ? { directions: normalizeCharacterDirections(value.directions)
      .filter((row) => entries.some((entry) => entry.profileId === row.profileId)) } : {}),
    ...(Array.isArray(value.warnings) ? { warnings: value.warnings.map((row) => text(row, 300)).filter(Boolean).slice(0, 22) } : {}) };
  if (value.applied === true) {
    scene.applied = true;
    scene.basePositive = text(value.basePositive, 32000);
    scene.baseNegative = text(value.baseNegative, 32000);
    scene.characterPrompts = unique(value.characterPrompts, 'id', CHARACTER_STORAGE_LIMIT)
      .filter((entry) => entries.some((item) => item.profileId === entry.id)).map((entry) => ({
        id: entry.id, name: text(entry.name, 120), positive: text(entry.positive, 12000),
        negative: text(entry.negative, 4000),
        position: characterPosition(entry.position),
      }));
  }
  return scene;
}

export function profileContext(scene) {
  return (scene?.entries || []).map((entry) => ({
    id: entry.profileId, name: entry.profile.name, aliases: entry.profile.aliases, hair: entry.profile.hair, eyes: entry.profile.eyes,
    body: entry.profile.body, features: entry.profile.features, appearance: entry.profile.tags,
    negative: joined(entry.profile.negative, entry.negative),
    outfit: effectiveOutfit(entry).prompt,
    lockAppearance: entry.profile.lockAppearance, lockOutfit: effectiveOutfit(entry).locked,
    action: entry.action, expression: entry.expression, additional: entry.positive, position: entry.position,
    participation: entry.participation, ...(entry.interaction ? { interaction: entry.interaction } : {}),
  }));
}

export function normalizeCharacterDirections(values) {
  return unique(values, 'profileId', CHARACTER_STORAGE_LIMIT).map((value) => ({
    profileId: value.profileId, action: text(value.action, 1000), expression: text(value.expression, 500),
    appearance: text(value.appearance), outfit: text(value.outfit), negative: text(value.negative, 1000),
    ...(typeof value.position === 'string' ? { position: characterPosition(value.position) } : {}),
    ...(characterInteraction(value.interaction) ? { interaction: characterInteraction(value.interaction) } : {}),
  }));
}

export const nativeCharacterPrompts = independentCharacters;

export function applyCharacterScene(snapshot, value, directions = [], characterIds) {
  const result = structuredClone(snapshot);
  const scene = normalizeCharacterScene(value);
  if (scene && !scene.applied && Array.isArray(characterIds)) {
    if (characterIds.some((id) => !scene.entries.some((entry) => entry.profileId === id))) throw new Error('本图包含未知角色档案，请重新选择人物或重新分析');
    const included = new Set(characterIds);
    scene.entries = scene.entries.filter((entry) => included.has(entry.profileId) || entry.participation === 'always');
  }
  if (!scene?.entries.length) {
    if (scene?.applied || result.characterScene?.applied) {
      const previous = scene?.applied ? scene : result.characterScene;
      const params = result.params || result.config.params;
      params.positive = previous.basePositive || '';
      params.negative = previous.baseNegative || '';
    }
    if (scene) result.characterScene = scene;
    if (result.provider === 'comfyui' && result.config.mapping.characterPrompts) result.config.params.characterPrompts = '[]';
    return result;
  }
  const params = result.params || result.config.params;
  if (!scene.applied) {
    const changes = normalizeCharacterDirections(directions.length ? directions : scene.directions);
    scene.directions = changes.filter((row) => scene.entries.some((entry) => entry.profileId === row.profileId));
    scene.basePositive = params.positive || '';
    scene.baseNegative = params.negative || '';
    for (const entry of scene.entries) {
      const change = changes.find((item) => item.profileId === entry.profileId);
      if (!entry.interaction && change?.interaction) entry.interaction = change.interaction;
    }
    const interactions = new Map(scene.entries.map((entry) => [entry.profileId, []]));
    for (const entry of scene.entries) {
      const change = changes.find((item) => item.profileId === entry.profileId);
      const interaction = entry.interaction || change?.interaction;
      if (!interaction?.action || interaction.targetId === entry.profileId || !interactions.has(interaction.targetId)) continue;
      interactions.get(entry.profileId).push(`${interaction.mode === 'mutual' ? 'mutual' : 'source'}#${interaction.action}`);
      interactions.get(interaction.targetId).push(`${interaction.mode === 'mutual' ? 'mutual' : 'target'}#${interaction.action}`);
    }
    scene.characterPrompts = scene.entries.map((entry) => {
      const profile = entry.profile, change = changes.find((item) => item.profileId === entry.profileId);
      const appearance = joined(profile.tags, profile.hair, profile.eyes, profile.body, profile.features);
      const outfit = effectiveOutfit(entry);
      return { id: profile.id, name: profile.name, position: entry.position === 'auto' ? change?.position || 'auto' : entry.position,
        positive: joined(!profile.lockAppearance && change?.appearance || appearance,
          !outfit.locked && change?.outfit || outfit.prompt,
          entry.action || change?.action, entry.expression || change?.expression, entry.positive,
          ...interactions.get(entry.profileId)),
        negative: joined(profile.negative, entry.negative, change?.negative) };
    });
    if (scene.characterPrompts.some((entry) => entry.positive.length > 12000 || entry.negative.length > 4000)) {
      throw new Error('单个角色的合并提示词过长，请精简外貌、服装或动作');
    }
    scene.applied = true;
  }
  const native = nativeCharacterPrompts(result.provider, params.model, params.characterMode);
  if (native) {
    params.positive = scene.basePositive;
    params.negative = scene.baseNegative;
  } else {
    const natural = result.provider === 'openai' && !/nai-diffusion/i.test(params.model || '');
    const characterText = scene.characterPrompts.map((entry, index) => {
      const position = characterPositionText(entry.position);
      const prompt = entry.positive.replace(/\b(?:source|target|mutual)#/g, '');
      return `Character ${index + 1} (${entry.name}): ${position ? `${position}, ` : ''}${prompt}`;
    }).join('\n');
    const relations = scene.entries.flatMap((entry) => {
      const relation = entry.interaction || normalizeCharacterDirections(directions).find((row) => row.profileId === entry.profileId)?.interaction;
      const target = scene.entries.find((row) => row.profileId === relation?.targetId);
      return target && target !== entry && relation.action
        ? [`Interaction: ${entry.profile.name} ${relation.mode === 'mutual' ? 'and' : 'toward'} ${target.profile.name}: ${relation.action}`] : [];
    });
    params.positive = [scene.basePositive, characterText, ...relations].filter(Boolean).join('\n');
    const negative = scene.characterPrompts.map((entry) => entry.negative).filter(Boolean).join(', ');
    params.negative = joined(scene.baseNegative, negative);
    if (natural && negative) params.positive += `\nAvoid for characters: ${negative}`;
    if (result.provider === 'comfyui' && result.config.mapping.characterPrompts) {
      params.characterPrompts = JSON.stringify(scene.characterPrompts);
    }
  }
  if (params.positive.length > 32000 || params.negative.length > 32000) throw new Error('合并角色后的提示词超过 32000 字符');
  result.characterScene = scene;
  return result;
}

export function applySceneOutfit(value, profileId, input, scope = 'once') {
  const scene = normalizeCharacterScene(value);
  const entry = scene?.entries.find((row) => row.profileId === profileId);
  if (!entry) throw new Error('此角色尚未加入当前画面');
  const choice = outfitChoice(input);
  if (choice.mode === 'custom' && !choice.prompt) throw new Error('请先填写自定义服装提示词');
  if (choice.mode === 'wardrobe' && !entry.profile.outfits.some((row) => row.id === choice.outfitId)) throw new Error('请选择有效服装');
  entry.outfitId = choice.mode === 'wardrobe' ? choice.outfitId : entry.profile.defaultOutfitId;
  delete entry.outfitMode; delete entry.outfitPrompt; delete entry.outfitScope;
  if (choice.mode !== 'inherit') entry.outfitMode = choice.mode;
  if (choice.mode === 'custom') entry.outfitPrompt = choice.prompt;
  if (['once', 'chat', 'global', 'project'].includes(scope)) entry.outfitScope = scope;
  delete scene.applied; delete scene.characterPrompts;
  return scene;
}

export function reconcileTemporaryScene(previous, current, replaceOutfits = []) {
  const pending = normalizeCharacterScene(previous), scene = normalizeCharacterScene(current);
  if (!pending || !scene || pending.chatKey !== scene.chatKey
    || !pending.entries.some((entry) => entry.outfitScope === 'once')) return null;
  scene.entries = scene.entries.map((entry) => {
    const saved = pending.entries.find((row) => row.profileId === entry.profileId);
    if (!saved) return entry;
    const merged = { ...saved, profile: entry.profile };
    if (replaceOutfits.includes(entry.profileId)) {
      for (const key of ['outfitId', 'outfitMode', 'outfitPrompt', 'outfitScope']) {
        delete merged[key];
        if (Object.hasOwn(entry, key)) merged[key] = entry[key];
      }
    }
    return merged;
  });
  delete scene.applied; delete scene.characterPrompts;
  return scene.entries.some((entry) => entry.outfitScope === 'once') ? normalizeCharacterScene(scene) : null;
}

export function setGlobalOutfit(library, profileId, input, newId) {
  const db = normalizeProfileLibrary(library), profile = db.profiles.find((row) => row.id === profileId);
  if (!profile) throw new Error('全局档案已不存在');
  const choice = outfitChoice(input);
  if (choice.mode === 'custom') {
    if (!choice.prompt) throw new Error('请先填写自定义服装提示词');
    const existing = profile.outfits.find((outfit) => outfit.prompt === choice.prompt);
    if (!existing) {
      if (!id(newId) || profile.outfits.length >= 20) throw new Error('服装库已满，请先整理角色档案');
      profile.outfits.push({ id: newId, name: '自定义服装', prompt: choice.prompt });
    }
    profile.defaultOutfitId = existing?.id || newId; profile.lockOutfit = true;
  } else if (choice.mode === 'wardrobe') {
    if (!profile.outfits.some((row) => row.id === choice.outfitId)) throw new Error('全局档案中没有此服装，请先保存到全局服装库');
    profile.defaultOutfitId = choice.outfitId; profile.lockOutfit = true;
  } else if (choice.mode === 'ai') { profile.defaultOutfitId = ''; profile.lockOutfit = false; }
  for (const entry of db.selection.filter((row) => row.profileId === profileId)) {
    entry.outfitId = profile.defaultOutfitId;
    delete entry.outfitMode; delete entry.outfitPrompt; delete entry.outfitScope;
  }
  return boundedLibrary(db);
}

export function restoreSceneProfiles(library, value, chatKey = '') {
  const scene = normalizeCharacterScene(value);
  if (!scene?.entries.length) throw new Error('图片未记录角色档案');
  let db = normalizeProfileLibrary(library);
  for (const entry of scene.entries) {
    if (!db.profiles.some((item) => item.id === entry.profileId)) db = saveProfile(db, entry.profile);
    db = saveProfile(db, entry.profile, chatKey);
  }
  const selection = normalizeParticipants(scene.entries, db.profiles);
  if (chatKey) db = updateProfileChat(db, chatKey, { selection });
  else db.selection = selection;
  return db;
}
