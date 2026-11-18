import { normalizeProfile, normalizeCharacterScene, applyCharacterScene, normalizeAliases } from './character-profiles.js';
import { characterPosition, characterLimit } from './character-layout.js';
import { parsePrompt, serializePrompt, rebuildPromptGroup, promptIdentity } from './prompt-composer.js';
import { createChatPromptStyle, chatPromptText } from './chat-prompt-style.js';
import { multiCharacterFields } from './multi-character-fields.js';

const clean = (value) => value.trim().replace(/[;\s]+$/, '').trim();
const folded = (value) => value.normalize('NFKC').trim().toLocaleLowerCase();

// Only unambiguous pose/expression tags may pass from an unstructured prompt into a locked profile.
export function characterDynamics(value) {
  const dynamic = /^(?:(?:source|target|mutual)#)?(?:smil(?:e|ing)|grin(?:ning)?|laugh(?:ing)?|cry(?:ing)?|blush(?:ing)?|frown(?:ing)?|pout(?:ing)?|surprised|angry|happy|sad|serious|embarrassed|winking|tears|(?:open|closed|half-closed) (?:eyes|mouth)|(?:looking|staring|gazing|holding|hugging|embracing|touching|pointing|waving|standing|sitting|lying|kneeling|crouching|running|walking|jumping|dancing|reading|eating|drinking|sleeping|leaning|reaching|kissing)(?:\b|_)|(?:hand|hands|arm|arms|leg|legs|head) (?:up|down|raised|on|behind|above|at|out|crossed|tilt)|(?:crossed arms|crossed legs|hand on hip|holding hands))(?:\b|_)/i;
  const filter = (items) => items.flatMap((item) => {
    if (item.kind === 'group') {
      const children = filter(item.children);
      return children.length ? [rebuildPromptGroup(item, children)] : [];
    }
    return item.syntax !== 'opaque' && dynamic.test(promptIdentity(item.en)) ? [item] : [];
  });
  return serializePrompt(filter(parsePrompt(value).items));
}

export function parseMultiCharacterPrompt(input, fields) {
  if (typeof input !== 'string' || !input.trim()) return null;
  if (input.length > 32000) throw new Error('多角色提示词不能超过 32000 字符');
  const matches = multiCharacterFields(input, fields);
  if (!matches.some((match) => match.number !== undefined)) return null;
  const characters = new Map(), shared = { scene: '', negative: '' }, warnings = [], seen = new Set();
  const preamble = clean(input.slice(0, matches[0].index));
  for (const [index, match] of matches.entries()) {
    const number = match.number, key = match.key;
    const fieldId = `${number ?? 'shared'}:${key}`;
    if (seen.has(fieldId)) throw new Error(`多角色提示词的 ${fieldId} 字段重复，请保留一组描述`);
    seen.add(fieldId);
    let content = clean(input.slice(match.end, matches[index + 1]?.index ?? input.length));
    if (number === undefined) {
      if (shared[key]) throw new Error(`多角色提示词重复填写了${key === 'scene' ? '公共场景' : '全局负面词'}`);
      shared[key] = content;
      continue;
    }
    if (!Number.isInteger(number) || number < 1 || number > 22) throw new Error('角色编号需为 1 至 22');
    if (!characters.has(number)) characters.set(number, { number, name: '', profileId: '', positive: '', negative: '', position: 'auto' });
    const character = characters.get(number);
    if (key !== 'position' && character[key]) throw new Error(`角色 ${number} 的${key}字段重复，请保留一组描述`);
    if (match.position) character.position = characterPosition(match.position);
    if (key === 'position') {
      character.position = characterPosition(content);
      if (character.position === 'auto' && content.toLowerCase() !== 'auto') warnings.push(`角色 ${number} 的坐标无效，已使用自动位置`);
      continue;
    }
    if (key === 'positive') {
      content = content.replace(/\|\s*(centers|name|id)\s*[：:]\s*([^|;\r\n]+)/gi, (_, marker, value) => {
        const field = marker.toLowerCase();
        if (field === 'centers') {
          const position = value.trim();
          character.position = characterPosition(position);
          if (character.position === 'auto' && position.toLowerCase() !== 'auto') {
            warnings.push(`角色 ${number} 的坐标无效，已使用自动位置`);
          }
        } else character[field === 'id' ? 'profileId' : 'name'] = value.trim().slice(0, 120);
        return '';
      }).trim();
    }
    character[key] = content;
  }
  const roles = [...characters.values()].sort((a, b) => a.number - b.number);
  if (roles.some((role) => !role.positive)) throw new Error('每个分段角色都需要填写正向提示词');
  for (const role of roles) {
    if (role.positive.length > 4000 || role.negative.length > 2000
      || (role.action?.length || 0) > 1000 || (role.expression?.length || 0) > 500 || (role.outfit?.length || 0) > 4000) {
      throw new Error(`角色 ${role.number} 的描述过长，请精简正向、负面或动作表情`);
    }
  }
  return { positive: [preamble, shared.scene].filter(Boolean).join(', '), negative: shared.negative,
    characters: roles, warnings };
}

export function matchCharacterProfile(role, profiles) {
  const enabled = profiles.filter((profile) => profile.enabled);
  if (role.profileId) {
    const profile = enabled.find((profile) => profile.id === role.profileId);
    return profile ? { profile } : { warning: `角色 ${role.number} 指定的档案不存在，已保留为本图临时角色` };
  }
  const names = [role.name, ...parsePrompt(role.positive).items.map((item) => item.en)].filter(Boolean).map(folded);
  const matches = enabled.filter((profile) => [profile.name, ...normalizeAliases(profile.aliases)]
    .some((name) => names.includes(folded(name))));
  if (matches.length === 1) return { profile: matches[0] };
  return matches.length > 1 ? { warning: `角色 ${role.number} 匹配到多个同名档案，已保留为本图临时角色；可用角色 ID 指定` } : {};
}

export function prepareMultiCharacterPrompt(snapshot, input, { profiles = [], chatKey = '', scene: currentScene, basePositive, fields = snapshot.promptFields } = {}) {
  const parsed = parseMultiCharacterPrompt(input, fields);
  if (!parsed) return null;
  const next = structuredClone(snapshot), params = next.params || next.config.params;
  if (parsed.characters.length > characterLimit(next.provider, params.model)) {
    throw new Error(`当前接口与模型最多支持 ${characterLimit(next.provider, params.model)} 个角色，请减少本图人数`);
  }
  const warnings = [...parsed.warnings], directions = [], used = new Set();
  const scene = normalizeCharacterScene(currentScene || next.characterScene);
  const entries = parsed.characters.map((role) => {
    const { profile, warning } = matchCharacterProfile(role, profiles);
    if (warning) warnings.push(warning);
    if (profile && used.has(profile.id)) throw new Error(`多个角色分段匹配到档案「${profile.name}」，请分别指定人物名称或 ID`);
    const existing = profile && scene?.entries.find((entry) => entry.profileId === profile.id);
    let temporaryId = `temporary-role-${role.number}`, suffix = 1;
    while (used.has(temporaryId) || profiles.some((row) => row.id === temporaryId)) temporaryId = `temporary-role-${role.number}-${suffix++}`;
    const selected = profile || normalizeProfile({
      id: temporaryId, name: role.name || `角色 ${role.number}`,
      tags: role.positive, negative: role.negative, lockAppearance: false,
    });
    used.add(selected.id);
    const dynamics = selected.lockAppearance ? characterDynamics(role.positive) : '';
    if (profile?.lockAppearance && !role.action && !role.expression) {
      warnings.push(`「${profile.name}」使用档案锁定外貌，分段中仅补充可识别的动作表情；其他动作可单列 Action / Expression。`);
    }
    directions.push({ profileId: selected.id, appearance: role.positive, negative: role.negative,
      action: role.action || dynamics, expression: role.expression || '', outfit: role.outfit || '', position: role.position });
    return { ...existing, profileId: selected.id, profile: selected,
      position: existing?.position && existing.position !== 'auto' ? existing.position : role.position };
  });
  // A fixed participant is a deliberate user choice even when omitted by the generated segments.
  for (const entry of scene?.entries || []) {
    if (entry.participation === 'always' && !used.has(entry.profileId)) entries.push(entry);
  }
  const prefix = basePositive ?? (scene?.applied ? scene.basePositive : params.positive);
  params.positive = [prefix === input ? '' : prefix?.trim(), parsed.positive].filter(Boolean).join(', ');
  params.negative = [...new Set([scene?.applied ? scene.baseNegative : params.negative, parsed.negative].filter(Boolean))].join(', ');
  const structured = { version: 1, chatKey: chatKey || scene?.chatKey || '', source: 'structured', warnings, entries };
  const prepared = applyCharacterScene(next, structured, directions);
  if (parsed.positive) prepared.chatPromptStyle = createChatPromptStyle(prefix === input ? '' : prefix, parsed.positive);
  const preparedParams = prepared.params || prepared.config.params;
  if (entries.length > characterLimit(next.provider, preparedParams.model)) throw new Error('固定出场人物与本图角色合计超过当前模型人数上限');
  return prepared;
}

export function prepareChatMultiCharacterPrompt(snapshot, input, options = {}) {
  const params = snapshot.params || snapshot.config.params;
  const prepared = prepareMultiCharacterPrompt(snapshot, params.positive, options);
  const structured = prepareMultiCharacterPrompt(prepared || snapshot, input, {
    ...options, basePositive: createChatPromptStyle(prepared?.characterScene.basePositive ?? params.positive, '', options.defaultPrompt).prefix,
  });
  if (structured) return structured;
  if (!prepared) return null;
  const scene = prepared.characterScene;
  prepared.chatPromptStyle = createChatPromptStyle(scene.basePositive, input, options.defaultPrompt);
  scene.basePositive = chatPromptText(prepared.chatPromptStyle);
  return applyCharacterScene(prepared, scene);
}
