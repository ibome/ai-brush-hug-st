import { randomUUID } from './crypto-compat.js';
import { allTags } from './tag-library.js';
import { effectiveOutfit, applyCharacterScene } from './character-profiles.js';
import { normalizeFieldSettings, validateFieldSettings } from './multi-character-fields.js';

export const TRIGGER_LIMIT = 500;
export const TRIGGER_BYTES = 200000;
export const TRIGGER_SOURCES = Object.freeze([
  ['custom', '自定义触发词'], ['json', '导入的 JSON 触发词'],
  ['profiles', '本图人物档案'], ['tags', '中文标签库（中文 → 英文）'],
]);
export const TRIGGER_TARGETS = Object.freeze([
  ['all', '全部提示词'], ['positive', '仅正向词'], ['negative', '仅负面词'], ['artist', '仅画师串'],
]);
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const identity = (value) => String(value).normalize('NFKC').trim().toLowerCase();
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function normalizeTriggerRule(value = {}) {
  const aliases = Array.isArray(value.aliases) ? value.aliases : String(value.trigger || '').split('|');
  return {
    id: /^[\w-]{1,80}$/.test(value.id || '') ? value.id : randomUUID(),
    aliases: [...new Set(aliases.filter((row) => typeof row === 'string').map((row) => text(row, 80)).filter(Boolean))].slice(0, 16),
    replacement: text(value.replacement, 4000), enabled: value.enabled !== false,
    target: TRIGGER_TARGETS.some(([key]) => key === value.target) ? value.target : 'all',
    source: value.source === 'json' ? 'json' : 'custom',
  };
}

export function normalizePromptProcessing(value = {}) {
  const rules = [], ids = new Set();
  for (const row of (Array.isArray(value?.rules) ? value.rules : []).slice(0, TRIGGER_LIMIT)) {
    if (!object(row)) continue;
    const rule = normalizeTriggerRule(row);
    if (!rule.aliases.length || !rule.replacement || ids.has(rule.id)) continue;
    if (bytes([...rules, rule]) > TRIGGER_BYTES) break;
    rules.push(rule); ids.add(rule.id);
  }
  return { enabled: value?.enabled === true,
    fields: normalizeFieldSettings(value?.fields),
    sources: Object.fromEntries(TRIGGER_SOURCES.map(([key]) => [key,
      typeof value?.sources?.[key] === 'boolean' ? value.sources[key] : ['custom', 'json'].includes(key)])),
    rules };
}

export function validatePromptProcessing(value = {}) {
  const settings = normalizePromptProcessing(value);
  validateFieldSettings(settings.fields);
  if (value.rules !== undefined && (!Array.isArray(value.rules) || settings.rules.length !== value.rules.length
    || bytes(value.rules) > TRIGGER_BYTES)) throw new Error('触发词规则含无效、重复或超限项目（最多 500 条、200 KB）');
  return settings;
}

export function saveTriggerRule(settings, value) {
  const aliases = Array.isArray(value.aliases) ? value.aliases : String(value.trigger || '').split('|');
  if (aliases.length > 16 || aliases.some((alias) => typeof alias !== 'string' || alias.trim().length > 80)
    || typeof value.replacement !== 'string' || value.replacement.trim().length > 4000) throw new Error('每条规则最多 16 个别名，别名最多 80 字符，替换内容最多 4000 字符');
  const rule = normalizeTriggerRule(value);
  if (!rule.aliases.length || !rule.replacement) throw new Error('请填写触发词和替换内容');
  if (rule.aliases.some((alias) => /[\r\n,，;<>{}]/.test(alias))) throw new Error('触发词不能包含换行、逗号、分号或分组符号');
  const next = normalizePromptProcessing(settings);
  next.rules = next.rules.some((row) => row.id === rule.id)
    ? next.rules.map((row) => row.id === rule.id ? rule : row) : [...next.rules, rule];
  return validatePromptProcessing(next);
}

export function importTriggerRules(settings, raw) {
  if (bytes(raw) > TRIGGER_BYTES) throw new Error('触发词文件超过 200 KB');
  let rows;
  if (raw?.format === 'linghuashi-triggers' && raw.version === 1) rows = raw.rules;
  else if (Array.isArray(raw)) rows = raw;
  else if (object(raw) && Array.isArray(raw.triggers)) rows = raw.triggers;
  else if (object(raw) && Object.values(raw).every((row) => typeof row === 'string')) {
    rows = Object.entries(raw).map(([trigger, replacement]) => ({ trigger, replacement }));
  }
  if (!Array.isArray(rows) || !rows.length || rows.length > TRIGGER_LIMIT) throw new Error('请选择有效的触发词 JSON（规则数组、词语映射或灵画师导出文件）');
  let next = normalizePromptProcessing(settings);
  for (const row of rows) {
    if (!object(row)) throw new Error('触发词条目需包含 trigger / aliases 和 replacement');
    const rule = normalizeTriggerRule({ ...row, id: randomUUID(), source: 'json' });
    if (next.rules.some((old) => old.target === rule.target
      && old.replacement === rule.replacement && JSON.stringify(old.aliases) === JSON.stringify(rule.aliases))) continue;
    next = saveTriggerRule(next, { ...row, id: rule.id, source: 'json' });
  }
  return next;
}

export function exportTriggerRules(settings) {
  return { format: 'linghuashi-triggers', version: 1, rules: normalizePromptProcessing(settings).rules };
}

function triggerIndex(settings, tagLibrary, scene, field) {
  const index = new Map();
  const add = (alias, replacement, source, priority) => {
    if (!alias || !replacement) return;
    const key = identity(alias), current = index.get(key);
    if (!key || key === identity(replacement)) return;
    if (!current || priority < current.priority) index.set(key, { alias, replacement, source, priority });
    else if (priority === current.priority && current.replacement !== replacement) {
      index.set(key, { ...current, ambiguous: true });
    }
  };
  for (const rule of settings.rules) if (rule.enabled && settings.sources[rule.source]
    && ['all', field].includes(rule.target)) {
    for (const alias of rule.aliases) add(alias, rule.replacement, rule.source, rule.source === 'custom' ? 0 : 1);
  }
  if (settings.sources.profiles && field === 'positive') for (const entry of scene?.entries || []) {
    const profile = entry.profile;
    const replacement = [profile.tags, profile.hair, profile.eyes, profile.body, profile.features, effectiveOutfit(entry).prompt].filter(Boolean).join(', ');
    for (const alias of [profile.name, ...(profile.aliases || [])]) add(alias, replacement, 'profiles', 2);
  }
  if (settings.sources.tags) for (const tag of allTags(tagLibrary)) {
    // English tags and aliases remain untouched; this source only translates Chinese labels.
    for (const alias of [tag.name, ...(tag.aliases || [])].filter((row) => /\p{Script=Han}/u.test(row))) add(alias, tag.en, 'tags', 3);
  }
  return index;
}

export function replaceTriggerText(input, index, field = 'positive') {
  const hits = [], warnings = new Set();
  if (!index.size || !input) return { text: input || '', hits, warnings: [] };
  const aliases = [...index.keys()].sort((a, b) => b.length - a.length).map(escapeRegex);
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_\\\\])(${aliases.join('|')})(?=$|[^\\p{L}\\p{N}_])`, 'giu');
  // A single pass preserves LoRA/material syntax and never expands replacement output recursively.
  const text = String(input).split(/(<[^>\r\n]*>)/g).map((part) => part.startsWith('<') ? part
    : part.replace(pattern, (_, boundary, matched) => {
      const rule = index.get(identity(matched));
      if (!rule) return boundary + matched;
      if (rule.ambiguous) { warnings.add(`触发词「${matched}」有多条不同规则，已保留原文`); return boundary + matched; }
      if (hits.length >= 200) throw new Error('单个字段命中触发词超过 200 次，请精简提示词');
      hits.push({ field, trigger: matched, replacement: rule.replacement, source: rule.source });
      return boundary + rule.replacement;
    })).join('');
  return { text, hits, warnings: [...warnings] };
}

function promptTexts(snapshot) {
  const params = snapshot.params || snapshot.config.params, scene = snapshot.characterScene;
  return {
    positive: (scene?.applied ? scene.basePositive : params.positive) || '',
    negative: (scene?.applied ? scene.baseNegative : params.negative) || '',
    artist: params.artist || '',
    characters: scene?.applied ? (scene.characterPrompts || []).map(({ id, positive, negative }) => ({ id, positive, negative })) : [],
  };
}

function restoreTriggerInputs(snapshot) {
  const previous = snapshot.promptReplacements;
  if (!previous?.input) return snapshot;
  try {
    const before = JSON.parse(previous.input), after = JSON.parse(previous.signature);
    if (!object(before) || !object(after) || !Array.isArray(before.characters) || !Array.isArray(after.characters)) return snapshot;
    const params = snapshot.params || snapshot.config.params, scene = snapshot.characterScene;
    const current = promptTexts(snapshot);
    for (const key of ['positive', 'negative', 'artist']) {
      if (typeof before[key] !== 'string' || current[key] !== after[key]) continue;
      if (scene?.applied && key !== 'artist') scene[key === 'positive' ? 'basePositive' : 'baseNegative'] = before[key];
      else params[key] = before[key];
    }
    for (const role of scene?.characterPrompts || []) {
      const input = before.characters?.find((row) => row.id === role.id), output = after.characters?.find((row) => row.id === role.id);
      for (const key of ['positive', 'negative']) {
        if (typeof input?.[key] === 'string' && role[key] === output?.[key]) role[key] = input[key];
      }
    }
    return scene?.applied ? applyCharacterScene(snapshot, scene) : snapshot;
  } catch { return snapshot; }
}

export function applyPromptTriggers(snapshot, { settings, tagLibrary } = {}) {
  let next = structuredClone(snapshot);
  if (next.novelaiProcessing) return next;
  const options = normalizePromptProcessing(settings);
  // Re-expand original terms on rerolls while preserving fields edited after generation.
  next = restoreTriggerInputs(next);
  const params = next.params || next.config.params;
  const input = JSON.stringify(promptTexts(next));
  delete next.promptReplacements;
  if (!options.enabled) return next;
  const hits = [], warnings = new Set(), lookups = new Map();
  const transform = (value, field, label = field, limit = field === 'artist' ? 4000 : next.provider === 'openai' ? 32000 : 12000) => {
    if (!lookups.has(field)) lookups.set(field, triggerIndex(options, tagLibrary, next.characterScene, field));
    const result = replaceTriggerText(value, lookups.get(field), label);
    for (const warning of result.warnings) warnings.add(warning);
    if (result.text.length > limit) throw new Error(`触发词展开后超过 ${limit} 字符，请精简规则或提示词`);
    hits.push(...result.hits);
    return result.text;
  };
  const scene = next.characterScene;
  if (scene?.applied) {
    scene.basePositive = transform(scene.basePositive, 'positive');
    scene.baseNegative = transform(scene.baseNegative, 'negative');
    for (const role of scene.characterPrompts || []) {
      role.positive = transform(role.positive, 'positive', `${role.name} · 正向`, 12000);
      role.negative = transform(role.negative, 'negative', `${role.name} · 负面`, 4000);
    }
    Object.assign(next, applyCharacterScene(next, scene));
  } else {
    params.positive = transform(params.positive, 'positive');
    params.negative = transform(params.negative, 'negative');
  }
  const current = next.params || next.config.params;
  if (typeof current.artist === 'string') current.artist = transform(current.artist, 'artist');
  if (hits.length || warnings.size) {
    next.promptReplacements = { hits: hits.slice(0, 200), warnings: [...warnings], input, signature: JSON.stringify(promptTexts(next)) };
  }
  return next;
}
