import { normalizeCharacterScene, normalizeProfile, CHARACTER_STORAGE_LIMIT } from './character-profiles.js';
import { arrangeCharacters } from './character-layout.js';
import { characterDynamics } from './multi-character-prompt.js';

export function draftCharacterScene(value) {
  const scene = normalizeCharacterScene(value);
  if (!scene) throw new Error('本次人物配置已失效，请重新载入参数');
  if (!scene.directions && scene.applied) {
    scene.directions = (scene.characterPrompts || []).map((role) => ({
      profileId: role.id, action: characterDynamics(role.positive),
    }));
  }
  for (const entry of scene.entries) {
    const direction = scene.directions?.find((row) => row.profileId === entry.profileId);
    const caption = scene.characterPrompts?.find((row) => row.id === entry.profileId);
    if (entry.position === 'auto') entry.position = caption?.position || direction?.position || 'auto';
    entry.action ||= direction?.action || '';
    entry.expression ||= direction?.expression || '';
    if (!entry.interaction && direction?.interaction) entry.interaction = structuredClone(direction.interaction);
  }
  delete scene.applied;
  delete scene.characterPrompts;
  return normalizeCharacterScene(scene);
}

export function editCharacterParticipant(value, profileId, field, input) {
  if (!['position', 'participation', 'action', 'expression', 'positive', 'negative',
    'interaction.targetId', 'interaction.mode', 'interaction.action'].includes(field) || typeof input !== 'string') {
    throw new Error('人物配置字段无效');
  }
  const scene = draftCharacterScene(value);
  const entry = scene.entries.find((row) => row.profileId === profileId);
  if (!entry) throw new Error('此角色未加入本次画面，请重新选择');
  if (field.startsWith('interaction.')) {
    entry.interaction = { targetId: '', action: '', mode: 'source', ...entry.interaction,
      [field.slice('interaction.'.length)]: input };
  } else entry[field] = input;
  if (['action', 'expression', 'position'].includes(field) || field.startsWith('interaction.')) {
    scene.directions ||= [];
    let direction = scene.directions.find((row) => row.profileId === profileId);
    if (!direction) { direction = { profileId }; scene.directions.push(direction); }
    const key = field.startsWith('interaction.') ? 'interaction' : field;
    direction[key] = structuredClone(entry[key]);
  }
  return normalizeCharacterScene(scene);
}

export function selectCharacterParticipant(value, profileId, selected, profiles = [], limit = CHARACTER_STORAGE_LIMIT) {
  const scene = draftCharacterScene(value);
  if (selected) {
    if (scene.entries.some((row) => row.profileId === profileId)) return scene;
    if (scene.entries.length >= limit) throw new Error(`当前模型一幅画最多选择 ${limit} 个角色`);
    const profile = normalizeProfile(profiles.find((row) => row.id === profileId && row.enabled !== false));
    if (!profile) throw new Error('此角色档案已停用或不存在，请重新选择');
    scene.entries.push({ profileId, profile, outfitId: profile.defaultOutfitId, position: 'auto' });
  } else scene.entries = scene.entries.filter((row) => row.profileId !== profileId);
  return normalizeCharacterScene(scene);
}

export function arrangeCharacterScene(value, layout) {
  if (!['row', 'reverse', 'auto'].includes(layout)) throw new Error('人物布局无效');
  let scene = draftCharacterScene(value);
  const arranged = arrangeCharacters(scene.entries, layout);
  for (const entry of arranged) scene = editCharacterParticipant(scene, entry.profileId, 'position', entry.position);
  return scene;
}
