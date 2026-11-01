import { randomUUID } from './crypto-compat.js';
import { BUILTIN_TAGS } from './data/prompt-tags.js';
import { BUILTIN_TAG_TEMPLATES } from './data/prompt-tag-templates.js';
import { appendPromptParts } from './prompt-composer.js';
import { safeTagSource, safeTagPreview } from './tag-details.js';
import { normalizeCardLayout, resolveMaterialCard } from './material-cards.js';

export const TAG_CUSTOM_LIMIT = 500;
export const TAG_LIBRARY_BYTES = 300000;
export const TAG_TEMPLATE_LIMIT = 100;
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const identity = (value) => String(value || '').trim().replace(/_/g, ' ').replace(/\s+/g, ' ').toLowerCase();
const builtinIds = new Set(BUILTIN_TAGS.map((tag) => tag.id));
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

export function normalizeTag(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    id: /^custom-[a-zA-Z0-9_-]{1,64}$/.test(source.id) ? source.id : `custom-${randomUUID()}`,
    name: text(source.name, 80), en: text(source.en, 200),
    category: text(source.category, 40) || '自定义',
    aliases: [...new Set((Array.isArray(source.aliases) ? source.aliases : [])
      .filter((entry) => typeof entry === 'string').map((entry) => text(entry, 40)).filter(Boolean))].slice(0, 16),
    ...(text(source.description, 1000) ? { description: text(source.description, 1000) } : {}),
    ...(safeTagSource(source.source) ? { source: safeTagSource(source.source) } : {}),
    ...(safeTagPreview(source.preview) ? { preview: safeTagPreview(source.preview) } : {}),
  };
}

export function normalizeTagLibrary(value = {}) {
  const custom = [], ids = new Set(builtinIds), english = new Set();
  for (const row of (Array.isArray(value?.custom) ? value.custom : []).slice(0, TAG_CUSTOM_LIMIT)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const tag = normalizeTag(row);
    if (!tag.name || !tag.en || ids.has(tag.id) || english.has(identity(tag.en))) continue;
    if (bytes([...custom, tag]) > TAG_LIBRARY_BYTES) break;
    custom.push(tag); ids.add(tag.id); english.add(identity(tag.en));
  }
  const references = (rows, limit) => [...new Set(Array.isArray(rows) ? rows.filter((id) => ids.has(id)) : [])].slice(0, limit);
  const templates = [], templateIds = new Set();
  for (const row of (Array.isArray(value?.templates) ? value.templates : []).slice(0, TAG_TEMPLATE_LIMIT)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const entry = normalizeTagTemplate(row);
    if (!entry.name || ![entry.positive, entry.negative, entry.artist].some(Boolean) || templateIds.has(entry.id)) continue;
    if (bytes({ custom, templates: [...templates, entry] }) > TAG_LIBRARY_BYTES) break;
    templates.push(entry); templateIds.add(entry.id);
  }
  return { version: 2, custom, favorites: references(value?.favorites, 1000), recent: references(value?.recent, 40), templates };
}

export const allTags = (library) => {
  const custom = library?.custom || [], english = new Set(custom.map((tag) => identity(tag.en)));
  return [...BUILTIN_TAGS.filter((tag) => !english.has(identity(tag.en))), ...custom];
};
export const allTagTemplates = (library) => [...BUILTIN_TAG_TEMPLATES, ...(library?.templates || [])];

export function normalizeTagTemplate(value = {}) {
  const layout = normalizeCardLayout(value.layout);
  return { id: /^template-[a-zA-Z0-9_-]{1,64}$/.test(value.id) ? value.id : `template-${randomUUID()}`,
    name: text(value.name, 80), category: text(value.category, 40) || '我的组合',
    positive: text(value.positive, 12000), negative: text(value.negative, 12000), artist: text(value.artist, 4000),
    ...(value.favorite === true ? { favorite: true } : {}),
    ...(text(value.model, 120) ? { model: text(value.model, 120) } : {}),
    ...(Object.keys(layout).length ? { layout } : {}) };
}

export function saveTagTemplate(library, value) {
  if (['positive', 'negative', 'artist'].some((key) => String(value[key] || '').length > (key === 'artist' ? 4000 : 12000))) {
    throw new Error('组合提示词超过长度限制');
  }
  const entry = normalizeTagTemplate(value);
  if (!entry.name || ![entry.positive, entry.negative, entry.artist].some(Boolean)) throw new Error('请填写组合名称和提示词');
  if ((library.templates || []).some((row) => row.id !== entry.id && row.name.toLowerCase() === entry.name.toLowerCase())) {
    throw new Error('已有同名组合模板');
  }
  const templates = (library.templates || []).some((row) => row.id === entry.id)
    ? library.templates.map((row) => row.id === entry.id ? entry : row) : [...(library.templates || []), entry];
  if (templates.length > TAG_TEMPLATE_LIMIT) throw new Error('组合模板最多 100 项');
  const next = { ...library, templates };
  if (bytes(next) > TAG_LIBRARY_BYTES) throw new Error('标签库超过容量限制，请导出整理');
  for (const card of allTagTemplates(next)) resolveMaterialCard(card, allTagTemplates(next));
  return next;
}

export function validateTagTemplates(rows) {
  if (rows === undefined) return;
  if (!Array.isArray(rows) || rows.length > TAG_TEMPLATE_LIMIT || rows.some((row) => !row || typeof row !== 'object'
    || ['positive', 'negative', 'artist'].some((key) => row[key] !== undefined && (typeof row[key] !== 'string'
      || row[key].length > (key === 'artist' ? 4000 : 12000))))) throw new Error('组合模板格式或长度无效');
}

export function searchTags(library, { search = '', category = '', view = 'all' } = {}) {
  const words = identity(search).split(' ').filter(Boolean);
  let entries = allTags(library);
  if (view === 'favorites') entries = entries.filter((tag) => library.favorites.includes(tag.id));
  if (view === 'custom') entries = library.custom;
  if (view === 'recent') {
    const index = new Map(entries.map((tag) => [tag.id, tag]));
    entries = library.recent.map((id) => index.get(id)).filter(Boolean);
  }
  return entries.filter((tag) => (!category || tag.category === category)
    && words.every((word) => identity([tag.name, tag.en, tag.category, ...tag.aliases].join(' ')).includes(word)));
}

export function saveTag(library, raw) {
  validateTagMetadata([raw]);
  const tag = normalizeTag(raw);
  if (!tag.name || !tag.en) throw new Error('请填写中文名称和英文提示词');
  if (/[\r\n]/.test(tag.en)) throw new Error('单个标签不能包含换行');
  if (allTags(library).some((row) => row.id !== tag.id && identity(row.en) === identity(tag.en))) throw new Error('已存在相同英文提示词的标签');
  const custom = library.custom.some((row) => row.id === tag.id)
    ? library.custom.map((row) => row.id === tag.id ? tag : row) : [...library.custom, tag];
  if (custom.length > TAG_CUSTOM_LIMIT) throw new Error(`自定义标签最多 ${TAG_CUSTOM_LIMIT} 项`);
  const next = { ...library, custom };
  if (bytes(next) > TAG_LIBRARY_BYTES) throw new Error('标签库超过容量限制，请导出整理');
  return next;
}

export function validateTagMetadata(rows = []) {
  if (!Array.isArray(rows)) throw new Error('标签格式无效');
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    if (row.description !== undefined && (typeof row.description !== 'string' || row.description.length > 1000)) {
      throw new Error('标签释义最多 1000 字符');
    }
    if (row.source && !safeTagSource(row.source)) throw new Error('标签来源需为不含账号密码的 HTTPS 地址');
    if (row.preview && !safeTagPreview(row.preview)) throw new Error('标签示例需为压缩后的 PNG、JPEG 或 WebP 图片，最多 60 KB');
  }
}

export function mergeTagLibraries(current, incoming) {
  let next = structuredClone(current);
  const mapping = new Map(BUILTIN_TAGS.map((tag) => [tag.id, tag.id]));
  for (const raw of incoming.custom) {
    const same = allTags(next).find((tag) => identity(tag.en) === identity(raw.en));
    if (same && !same.id.startsWith('builtin-')) { mapping.set(raw.id, same.id); continue; }
    const tag = { ...raw };
    if (allTags(next).some((row) => row.id === tag.id)) tag.id = `custom-${randomUUID()}`;
    mapping.set(raw.id, tag.id);
    if (same) {
      next.custom.push(tag);
      if (next.custom.length > TAG_CUSTOM_LIMIT || bytes(next) > TAG_LIBRARY_BYTES) throw new Error('标签库超过容量限制');
    } else next = saveTag(next, tag);
  }
  const remap = (list) => list.map((id) => mapping.get(id)).filter(Boolean);
  next.favorites = [...new Set([...next.favorites, ...remap(incoming.favorites)])].slice(0, 1000);
  next.recent = [...new Set([...next.recent, ...remap(incoming.recent)])].slice(0, 40);
  const imported = [], renamed = new Map();
  for (const raw of incoming.templates || []) {
    const same = (next.templates || []).find((row) => ['category', 'positive', 'negative', 'artist'].every((key) => row[key] === raw[key]));
    if (same) { renamed.set(`<${raw.category}:${raw.name}>`, `<${same.category}:${same.name}>`); continue; }
    const entry = { ...raw };
    if ((next.templates || []).some((row) => row.id === entry.id)) entry.id = `template-${randomUUID()}`;
    const base = entry.name;
    let suffix = 1;
    while ((next.templates || []).some((row) => row.name.toLowerCase() === entry.name.toLowerCase())) {
      const tail = ` (${++suffix})`; entry.name = `${base.slice(0, 80 - tail.length)}${tail}`;
    }
    next.templates = [...(next.templates || []), entry];
    imported.push(entry);
    renamed.set(`<${raw.category}:${raw.name}>`, `<${entry.category}:${entry.name}>`);
    if (next.templates.length > TAG_TEMPLATE_LIMIT || bytes(next) > TAG_LIBRARY_BYTES) throw new Error('素材卡库超过容量限制');
  }
  for (const card of imported) for (const key of ['positive', 'negative', 'artist']) {
    card[key] = card[key].replace(/<([^<>:\r\n]{1,40}):([^<>:\r\n]{1,80})>/g,
      (token, category, name) => renamed.get(`<${category.trim()}:${name.trim()}>`) || token);
  }
  for (let pass = 0; pass < TAG_TEMPLATE_LIMIT; pass++) {
    const aliases = new Map();
    for (const card of imported) {
      if (!next.templates.includes(card)) continue;
      const same = next.templates.find((row) => row !== card && ['category', 'positive', 'negative', 'artist'].every((key) => row[key] === card[key]));
      if (!same) continue;
      aliases.set(`<${card.category}:${card.name}>`, `<${same.category}:${same.name}>`);
      next.templates = next.templates.filter((row) => row !== card);
    }
    if (!aliases.size) break;
    for (const card of imported.filter((row) => next.templates.includes(row))) for (const key of ['positive', 'negative', 'artist']) {
      card[key] = card[key].replace(/<([^<>:\r\n]{1,40}):([^<>:\r\n]{1,80})>/g,
        (token, category, name) => aliases.get(`<${category.trim()}:${name.trim()}>`) || token);
    }
  }
  if (bytes(next) > TAG_LIBRARY_BYTES) throw new Error('素材卡库超过容量限制');
  for (const entry of next.templates || []) resolveMaterialCard(entry, allTagTemplates(next));
  return next;
}

export function importTags(current, raw) {
  validateTagMetadata(raw?.library?.custom);
  validateTagTemplates(raw?.library?.templates);
  if (raw?.format !== 'linghuashi-tags' || ![1, 2].includes(raw.version) || !raw.library
    || !Array.isArray(raw.library.custom) || raw.library.custom.length > TAG_CUSTOM_LIMIT
    || (raw.library.templates !== undefined && (!Array.isArray(raw.library.templates) || raw.library.templates.length > TAG_TEMPLATE_LIMIT))
    || bytes(raw) > TAG_LIBRARY_BYTES) throw new Error('请选择灵画师标签库 JSON（最多 500 项、300 KB）');
  const normalized = normalizeTagLibrary(raw.library);
  if (normalized.custom.length !== raw.library.custom.length) throw new Error('标签库含重复、无效或超出限制的标签');
  if (normalized.templates.length !== (raw.library.templates || []).length) throw new Error('组合模板含重复、无效或超出限制的内容');
  return mergeTagLibraries(current, normalized);
}

export function tagTargets({ provider, params, mapping, allowedTargets }) {
  return [
    { id: 'positive', title: '正向提示词', enabled: provider !== 'comfyui' || Boolean(mapping?.positive) },
    { id: 'negative', title: '负面提示词', enabled: provider === 'openai' ? /nai-diffusion/i.test(params?.model)
      : provider !== 'comfyui' || Boolean(mapping?.negative) },
    ...(provider === 'comfyui' ? [] : [{ id: 'artist', title: '风格／画师描述', enabled: true }]),
  ].map((row) => ({ ...row, enabled: row.enabled && (!Array.isArray(allowedTargets) || allowedTargets.includes(row.id)) }));
}

export function appendTags(context, tags, target = 'positive') {
  const additions = tags.map((tag) => text(tag?.en, 200)).filter(Boolean);
  if (!additions.length) throw new Error('请先选择标签');
  return setPromptText(context, appendPromptParts(context.params?.[target] || '', additions.join(', ')), target);
}

export function setPromptText(context, value, target = 'positive') {
  if (!tagTargets(context).some((row) => row.id === target && row.enabled)) {
    throw new Error(context.provider === 'comfyui' ? '请先映射对应的 ComfyUI 提示词节点' : '当前图片模型不支持独立负面提示词');
  }
  const combined = String(value || '');
  const defaultLimit = target === 'artist' ? 4000 : context.provider === 'openai' ? 32000 : 12000;
  const limit = Math.min(defaultLimit, context.limits?.[target] || defaultLimit);
  if (combined.length > limit) throw new Error(`合并后超过 ${limit} 字符，请先精简提示词`);
  return { ...context.params, [target]: combined };
}

export function applyPromptDrafts(context, drafts, targets) {
  const entries = [...new Set(targets)];
  for (const target of entries) {
    if (!drafts[target]) throw new Error('组合草稿不存在');
    if ((context.params?.[target] || '') !== drafts[target].baseline) throw new Error('当前提示词已在其他位置修改，请重新读取后合并');
    setPromptText(context, drafts[target].text, target);
  }
  return entries.reduce((params, target) => ({ ...params, [target]: drafts[target].text }), { ...context.params });
}
