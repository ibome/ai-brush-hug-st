import { assetReference } from './advanced-generation.js';

export const PROFILE_LIMIT = 100;
export const SCENE_LIMIT = 6;
export const POSITION_OPTIONS = [
  ['auto', '自动'], ['left', '左侧'], ['center', '中央'], ['right', '右侧'],
  ['top-left', '左上'], ['top', '上方'], ['top-right', '右上'],
  ['bottom-left', '左下'], ['bottom', '下方'], ['bottom-right', '右下'],
];
const positions = {
  auto: [0.5, 0.5], left: [0.2, 0.5], center: [0.5, 0.5], right: [0.8, 0.5],
  'top-left': [0.2, 0.2], top: [0.5, 0.2], 'top-right': [0.8, 0.2],
  'bottom-left': [0.2, 0.8], bottom: [0.5, 0.8], 'bottom-right': [0.8, 0.8],
};
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

export function normalizeProfile(value) {
  if (!object(value) || !id(value.id)) return null;
  const outfits = unique(value.outfits, 'id', 20).map((outfit) => ({
    id: outfit.id, name: text(outfit.name, 80) || '服装', prompt: text(outfit.prompt),
  }));
  return {
    id: value.id, name: text(value.name, 120) || '新角色', avatar: text(value.avatar, 512),
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
  return unique(value, 'profileId', SCENE_LIMIT).filter((entry) => allowed.has(entry.profileId)).map((entry) => ({
    profileId: entry.profileId, outfitId: entry.outfitId === undefined ? profiles.find((profile) => profile.id === entry.profileId)?.defaultOutfitId || '' : text(entry.outfitId, 80),
    action: text(entry.action, 1000), expression: text(entry.expression, 500),
    positive: text(entry.positive, 2000), negative: text(entry.negative, 1000),
    position: Object.hasOwn(positions, entry.position) ? entry.position : 'auto',
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
    profile.enabled && profile.avatar && avatars.includes(profile.avatar)).slice(0, SCENE_LIMIT).map((profile) => ({ profileId: profile.id })) : selection;
  return normalizeCharacterScene({ version: 1, chatKey, entries: selected.map((entry) => ({
    ...entry, profile: profiles.find((item) => item.id === entry.profileId),
  })).filter((entry) => entry.profile?.enabled) });
}

export function normalizeCharacterScene(value) {
  if (!object(value) || !Array.isArray(value.entries)) return null;
  const entries = unique(value.entries, 'profileId', SCENE_LIMIT).flatMap((entry) => {
    const profile = normalizeProfile(entry.profile);
    if (!profile || profile.id !== entry.profileId) return [];
    return [{ ...normalizeParticipants([entry], [profile])[0], profile,
      outfitId: entry.outfitId === '' ? '' : profile.outfits.some((outfit) => outfit.id === entry.outfitId) ? entry.outfitId : profile.defaultOutfitId }];
  });
  const scene = { version: 1, chatKey: text(value.chatKey, 2048), entries };
  if (value.applied === true) {
    scene.applied = true;
    scene.basePositive = text(value.basePositive, 32000);
    scene.baseNegative = text(value.baseNegative, 32000);
    scene.characterPrompts = unique(value.characterPrompts, 'id', SCENE_LIMIT)
      .filter((entry) => entries.some((item) => item.profileId === entry.id)).map((entry) => ({
        id: entry.id, name: text(entry.name, 120), positive: text(entry.positive, 12000),
        negative: text(entry.negative, 4000),
        position: Object.hasOwn(positions, entry.position) ? entry.position : 'auto',
      }));
  }
  return scene;
}

export function profileContext(scene) {
  return (scene?.entries || []).map((entry) => ({
    id: entry.profileId, name: entry.profile.name, hair: entry.profile.hair, eyes: entry.profile.eyes,
    body: entry.profile.body, features: entry.profile.features, appearance: entry.profile.tags,
    negative: joined(entry.profile.negative, entry.negative),
    outfit: entry.profile.outfits.find((item) => item.id === entry.outfitId)?.prompt || '',
    lockAppearance: entry.profile.lockAppearance, lockOutfit: entry.profile.lockOutfit,
    action: entry.action, expression: entry.expression, additional: entry.positive, position: entry.position,
  }));
}

export function normalizeCharacterDirections(values) {
  return unique(values, 'profileId', SCENE_LIMIT).map((value) => ({
    profileId: value.profileId, action: text(value.action, 1000), expression: text(value.expression, 500),
    appearance: text(value.appearance), outfit: text(value.outfit), negative: text(value.negative, 1000),
  }));
}

export const nativeCharacterPrompts = (provider, model) => provider === 'novelai' && /^nai-diffusion-(?:4|5)(?:-|$)/.test(model || '');

export function applyCharacterScene(snapshot, value, directions = []) {
  const result = structuredClone(snapshot);
  const scene = normalizeCharacterScene(value);
  if (!scene?.entries.length) {
    if (scene) result.characterScene = scene;
    if (result.provider === 'comfyui' && result.config.mapping.characterPrompts) result.config.params.characterPrompts = '[]';
    return result;
  }
  const params = result.params || result.config.params;
  if (!scene.applied) {
    const changes = normalizeCharacterDirections(directions);
    scene.basePositive = params.positive || '';
    scene.baseNegative = params.negative || '';
    scene.characterPrompts = scene.entries.map((entry) => {
      const profile = entry.profile, change = changes.find((item) => item.profileId === entry.profileId);
      const appearance = joined(profile.tags, profile.hair, profile.eyes, profile.body, profile.features);
      const outfit = profile.outfits.find((item) => item.id === entry.outfitId)?.prompt || '';
      return { id: profile.id, name: profile.name, position: entry.position,
        positive: joined(!profile.lockAppearance && change?.appearance || appearance,
          !profile.lockOutfit && change?.outfit || outfit,
          entry.action || change?.action, entry.expression || change?.expression, entry.positive),
        negative: joined(profile.negative, entry.negative, change?.negative) };
    });
    if (scene.characterPrompts.some((entry) => entry.positive.length > 12000 || entry.negative.length > 4000)) {
      throw new Error('单个角色的合并提示词过长，请精简外貌、服装或动作');
    }
    scene.applied = true;
  }
  const native = nativeCharacterPrompts(result.provider, params.model);
  if (native) {
    params.positive = scene.basePositive;
    params.negative = scene.baseNegative;
  } else {
    const natural = result.provider === 'openai' && !/nai-diffusion/i.test(params.model || '');
    const characterText = scene.characterPrompts.map((entry, index) => {
      const position = entry.position !== 'auto' ? `position ${entry.position}, ` : '';
      return `Character ${index + 1} (${entry.name}): ${position}${entry.positive}`;
    }).join('\n');
    params.positive = [scene.basePositive, characterText].filter(Boolean).join('\n');
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
