import { randomUUID } from './crypto-compat.js';
import { normalizeSettings, SETTINGS_DEFAULTS } from './ui/settings.js';
import { normalizeNovelAIState } from './ui/novelai.js';
import { normalizeOpenAIState } from './ui/openai.js';
import { normalizeComfyState, parseWorkflow } from './ui/comfyui.js';
import { normalizeConnections, CONNECTION_PROVIDERS } from './connections.js';
import { normalizeAssistant } from './prompt-assistant.js';
import { normalizeAssistantSchemes, ASSISTANT_SCHEME_LIMIT, ASSISTANT_SCHEME_BYTES } from './assistant-schemes.js';
import { normalizeArtistLibrary, ARTIST_LIBRARY_LIMIT } from './artist-library.js';
import { normalizeProfileLibrary } from './character-profiles.js';
import { normalizeTagLibrary, mergeTagLibraries, TAG_LIBRARY_BYTES, validateTagTemplates, validateTagMetadata } from './tag-library.js';
import { normalizeWorkbench, normalizeReviews } from './prompt-workbench.js';
import { normalizeVibeLibrary } from './vibe-library.js';
import { normalizeSDWebUIState } from './ui/sdwebui.js';
import { normalizeReaderSettings } from './chat-reader.js';
import { normalizeComicLibrary, validateComicLibrary, COMIC_LIMITS, comicProjectFile } from './comic.js';
import { normalizeLocalTools } from './local-tools.js';

export const BACKUP_SECTIONS = Object.freeze([
  ['general', '插件设置与主题'], ['connections', '接口配置'], ['parameters', '参数预设与工作流'],
  ['artists', '画师串库'], ['tags', '中文标签库'], ['characters', '角色档案'], ['assistant', '提示词助手设置'],
  ['comics', '漫画项目'],
]);
export const CONFIG_KEYS = Object.freeze({
  general: [...Object.keys(SETTINGS_DEFAULTS), 'drawingReviews', 'readerSettings'],
  connections: ['connections', 'connectionProfiles', 'connectionProfileIds', 'connectionLibraryVersion',
    'presetBindings', 'openaiEndpoint', 'openaiPath', 'openaiTimeout', 'comfyTimeout', 'localTools'],
  parameters: ['novelai', 'novelaiPresets', 'novelaiPresetId', 'openai', 'openaiPresets', 'openaiPresetId',
    'comfyui', 'comfyPresets', 'comfyPresetId', 'sdwebui', 'sdwebuiPresets', 'sdwebuiPresetId', 'workbench', 'vibeLibrary'],
  artists: ['artistLibrary', 'artistLibraryVersion'],
  tags: ['tagLibrary'],
  characters: ['characterProfiles'],
  assistant: ['assistant', 'assistantDefaultsVersion', 'assistantSchemes', 'assistantSchemeId'],
  comics: ['comicLibrary'],
});
export const cloneBackup = (value) => JSON.parse(JSON.stringify(value));
export const backupSize = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const libraries = ['novelaiPresets', 'openaiPresets', 'comfyPresets', 'sdwebuiPresets', 'artistLibrary'];
const secretField = /^(?:api[_-]?(?:key|token).*|authorization|password|access[_-]?token|headers|credentials|secret|client[_-]?secret|secret[_-]?key|bearer[_-]?token|token|__proto__|constructor|prototype)$/i;
const keyPattern = /\b(?:sk-|pst-|STD-)[A-Za-z0-9_-]{12,}/g;

export function scrubBackup(value, { refs = false, sharing = false } = {}, depth = 0) {
  if (depth > 45) throw new Error('备份内容层级过深');
  if (typeof value === 'string') {
    let text = value.replace(keyPattern, '[redacted]');
    if (/^https?:\/\//i.test(text)) {
      try {
        const url = new URL(text);
        url.username = ''; url.password = '';
        for (const key of [...url.searchParams.keys()]) if (/key|token|secret|password|auth/i.test(key)) url.searchParams.delete(key);
        text = url.href;
      } catch {}
    }
    return text;
  }
  if (Array.isArray(value)) return value.map((entry) => scrubBackup(entry, { refs, sharing }, depth + 1));
  if (!object(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !secretField.test(key)
    && !(refs && /^(?:keyRef|openaiRef|assistantRef)$/.test(key))
    && !(sharing && /^(?:chatBinding|chatKey|chatName|characterName|apiLink|drawingReviews)$/.test(key)))
    .map(([key, item]) => {
      if (key === 'extra' && typeof item === 'string' && item.trim()) {
        let parsed;
        try { parsed = JSON.parse(item); } catch { throw new Error('附加参数 JSON 无效，请修正后再备份'); }
        return [key, JSON.stringify(scrubBackup(parsed, { refs, sharing }, depth + 1))];
      }
      return [key, scrubBackup(item, { refs, sharing }, depth + 1)];
    }));
}

function assertLibrary(before, after, title) {
  if (Array.isArray(before) && before.length !== after.length) throw new Error(`${title}含重复、无效或超出数量限制的条目`);
}

export function normalizeBackupConfig(value = {}, sections = BACKUP_SECTIONS.map(([id]) => id)) {
  if (!object(value) || backupSize(value) > 2000000) throw new Error('备份配置无效或超过 2 MB');
  const selected = [...new Set(sections)];
  if (selected.some((id) => !Object.hasOwn(CONFIG_KEYS, id))) throw new Error('备份配置分区无效');
  const input = scrubBackup(value), state = cloneBackup(input);
  Object.assign(state, normalizeSettings(state));
  if (input.comfyui?.graph) parseWorkflow(JSON.stringify(input.comfyui.graph));
  for (const preset of input.comfyPresets || []) parseWorkflow(JSON.stringify(preset.config?.graph));
  normalizeNovelAIState(state); normalizeOpenAIState(state); normalizeComfyState(state); normalizeSDWebUIState(state); normalizeConnections(state);
  state.assistant = normalizeAssistant(state.assistant);
  state.localTools = normalizeLocalTools(state.localTools);
  state.assistantSchemes = normalizeAssistantSchemes(state.assistantSchemes);
  assertLibrary(input.assistantSchemes, state.assistantSchemes, '助手方案库');
  if (backupSize(state.assistantSchemes) > ASSISTANT_SCHEME_BYTES) throw new Error('助手方案库超过容量限制');
  state.assistantSchemeId = state.assistantSchemes.some((row) => row.id === input.assistantSchemeId)
    || ['builtin-daily', 'builtin-portrait', 'builtin-story'].includes(input.assistantSchemeId) ? input.assistantSchemeId : '';
  state.artistLibrary = normalizeArtistLibrary(state.artistLibrary);
  state.artistLibraryVersion = 1;
  validateTagTemplates(input.tagLibrary?.templates);
  validateTagMetadata(input.tagLibrary?.custom);
  state.tagLibrary = normalizeTagLibrary(state.tagLibrary);
  state.workbench = normalizeWorkbench(input.workbench);
  state.drawingReviews = normalizeReviews(input.drawingReviews);
  state.readerSettings = normalizeReaderSettings(input.readerSettings);
  state.comicLibrary = validateComicLibrary(input.comicLibrary || normalizeComicLibrary());
  state.comicLibrary.projects = state.comicLibrary.projects.map((project) => comicProjectFile(project).project);
  state.vibeLibrary = normalizeVibeLibrary(input.vibeLibrary);
  assertLibrary(input.vibeLibrary, state.vibeLibrary, 'Vibe 素材库');
  if (backupSize(state.vibeLibrary) > 300000) throw new Error('Vibe 素材库超过容量限制');
  assertLibrary(input.tagLibrary?.custom, state.tagLibrary.custom, '中文标签库');
  assertLibrary(input.tagLibrary?.templates, state.tagLibrary.templates, '提示词组合模板');
  if (backupSize(state.tagLibrary) > TAG_LIBRARY_BYTES) throw new Error('中文标签库超过容量限制');
  state.characterProfiles = normalizeProfileLibrary(state.characterProfiles);
  state.assistantDefaultsVersion = 1;
  for (const key of libraries) assertLibrary(input[key], state[key], key);
  for (const provider of CONNECTION_PROVIDERS) assertLibrary(input.connectionProfiles?.[provider],
    state.connectionProfiles[provider], `${provider} 接口`);
  assertLibrary(input.characterProfiles?.profiles, state.characterProfiles.profiles, '角色档案');
  if (backupSize(state.artistLibrary) > ARTIST_LIBRARY_LIMIT || backupSize(state.characterProfiles) > 750000) throw new Error('画师串库或角色档案超过容量限制');
  const output = Object.fromEntries(selected.flatMap((section) => CONFIG_KEYS[section])
    .filter((key) => Object.hasOwn(state, key)).map((key) => [key, state[key]]));
  const preserved = new Set(referencedAssets(output).map((asset) => `${asset.location}:${asset.id}`));
  const original = Object.fromEntries(selected.flatMap((section) => CONFIG_KEYS[section])
    .filter((key) => Object.hasOwn(input, key)).map((key) => [key, input[key]]));
  if (referencedAssets(original).some((asset) => !preserved.has(`${asset.location}:${asset.id}`))) throw new Error('配置含无法保留的参考素材，请核对参数');
  return output;
}

export function credentialNodes(config) {
  const nodes = [];
  for (const provider of CONNECTION_PROVIDERS) {
    if (config.connections?.[provider]) nodes.push({ provider, value: config.connections[provider] });
    for (const item of config.connectionProfiles?.[provider] || []) nodes.push({ provider, value: item.connection });
    for (const item of config[{ novelai: 'novelaiPresets', openai: 'openaiPresets', comfyui: 'comfyPresets', sdwebui: 'sdwebuiPresets' }[provider]] || []) {
      if (item.connection) nodes.push({ provider, value: item.connection });
    }
  }
  if (config.assistant) nodes.push({ provider: 'assistant', value: config.assistant });
  if (config.localTools) nodes.push({ provider: 'localtools', value: config.localTools });
  for (const row of config.assistantSchemes || []) nodes.push({ provider: 'assistant', value: row.settings });
  return nodes;
}

const connectionSignature = (provider, value) => JSON.stringify([provider, String(value?.endpoint || '').trim().replace(/\/+$/, ''),
  value?.auth || 'none', value?.path || '', provider === 'sdwebui' ? value?.username || '' : '']);

export async function portableCredentials(config, readKey, includeKeys) {
  const slots = new Map(), secrets = [];
  for (const { provider, value } of credentialNodes(config)) {
    const original = value?.keyRef;
    if (!original) continue;
    const identity = `${provider}:${original}`;
    if (!slots.has(identity)) {
      const slot = `browser:${randomUUID()}`;
      slots.set(identity, slot);
      if (includeKeys) {
        const key = await readKey(provider, original);
        if (!key) throw new Error(`${provider} 的已有秘钥无法读取，未生成不完整备份`);
        secrets.push({ provider, slot, key });
      }
    }
    value.keyRef = slots.get(identity);
  }
  for (const { provider, value } of credentialNodes(config)) if (provider === 'assistant') value.apiLink = null;
  return secrets;
}

export async function restoreBackupCredentials(incoming, current, secrets, writeKey, readKey) {
  const slots = new Map();
  const existing = credentialNodes(current), targets = credentialNodes(incoming);
  for (const entry of secrets || []) {
    if (![...CONNECTION_PROVIDERS, 'assistant', 'localtools'].includes(entry.provider)
      || !/^browser:[a-f0-9-]{36}$/.test(entry.slot) || typeof entry.key !== 'string' || !entry.key || entry.key.length > 4096) throw new Error('加密秘钥清单无效');
    const identity = `${entry.provider}:${entry.slot}`;
    if (slots.has(identity)) throw new Error('加密秘钥清单重复');
    slots.set(identity, '');
  }
  for (const entry of secrets || []) {
    const destinations = targets.filter((node) => node.provider === entry.provider && node.value.keyRef === entry.slot)
      .map((node) => connectionSignature(node.provider, node.value));
    let reused = '';
    if (readKey) for (const candidate of existing.filter((node) => node.provider === entry.provider && node.value.keyRef
      && destinations.includes(connectionSignature(node.provider, node.value)))) {
      try { if (await readKey(candidate.provider, candidate.value.keyRef) === entry.key) { reused = candidate.value.keyRef; break; } } catch {}
    }
    slots.set(`${entry.provider}:${entry.slot}`, reused || await writeKey(entry.provider, entry.key));
  }
  for (const { provider, value } of credentialNodes(incoming)) {
    if (!value.keyRef) continue;
    value.keyRef = slots.get(`${provider}:${value.keyRef}`) || existing.find((entry) =>
      entry.provider === provider && entry.value.keyRef
      && connectionSignature(provider, entry.value) === connectionSignature(provider, value))?.value.keyRef || '';
  }
  for (const { provider, value } of credentialNodes(incoming)) if (provider === 'assistant') value.apiLink = null;
  return incoming;
}

const equivalent = (value) => JSON.stringify(scrubBackup(value));
function combineRows(existing, incoming, limit, idMap = new Map(), nameLimit = 40) {
  const next = cloneBackup(existing || []);
  for (const item of incoming || []) {
    const same = next.find((entry) => equivalent(entry) === equivalent(item));
    if (same) { idMap.set(item.id, same.id); continue; }
    const row = cloneBackup(item);
    if (next.some((entry) => entry.id === row.id)) row.id = randomUUID();
    idMap.set(item.id, row.id);
    let suffix = 1;
    const base = row.name || '导入条目';
    while (next.some((entry) => entry.name?.toLocaleLowerCase() === row.name?.toLocaleLowerCase())) {
      const tail = ` (${++suffix})`; row.name = `${base.slice(0, nameLimit - tail.length)}${tail}`;
    }
    next.push(row);
    if (next.length > limit) throw new Error(`合并后超过 ${limit} 项，请减少导入内容`);
  }
  return next;
}

export function mergeBackupConfig(current, imported, sections, mode = 'merge', preserveChat = false) {
  const next = cloneBackup(current), incoming = cloneBackup(imported);
  if (incoming.comicLibrary) incoming.comicLibrary.projects = incoming.comicLibrary.projects.map((project) => comicProjectFile(project).project);
  if (!preserveChat && incoming.characterProfiles) incoming.characterProfiles.chats = [];
  if (mode === 'replace') {
    for (const section of sections) for (const key of CONFIG_KEYS[section]) {
      if (Object.hasOwn(incoming, key)) next[key] = incoming[key];
    }
  } else if (mode === 'merge') {
    const connectionMaps = {};
    if (sections.includes('connections')) {
      for (const provider of CONNECTION_PROVIDERS) {
        const mapping = new Map(); connectionMaps[provider] = mapping;
        next.connectionProfiles[provider] = combineRows(next.connectionProfiles[provider], incoming.connectionProfiles[provider], 50, mapping);
      }
    }
    if (sections.includes('parameters')) {
      next.vibeLibrary = combineRows(next.vibeLibrary, incoming.vibeLibrary, 100, new Map(), 80);
      for (const [provider, key, limit] of [['novelai', 'novelaiPresets', 50], ['openai', 'openaiPresets', 50], ['comfyui', 'comfyPresets', 10], ['sdwebui', 'sdwebuiPresets', 50]]) {
        for (const item of incoming[key] || []) {
          if (item.connectionProfileId) {
            item.connectionProfileId = connectionMaps[provider]?.get(item.connectionProfileId)
              || (next.connectionProfiles[provider].some((entry) => entry.id === item.connectionProfileId) ? item.connectionProfileId : '');
          }
        }
        next[key] = combineRows(next[key], incoming[key], limit);
      }
    }
    if (sections.includes('general')) next.drawingReviews = normalizeReviews({ ...incoming.drawingReviews, ...next.drawingReviews });
    if (sections.includes('comics')) {
      next.comicLibrary = normalizeComicLibrary(next.comicLibrary);
      const incomingComics = normalizeComicLibrary(incoming.comicLibrary), seriesMap = new Map();
      for (const series of incomingComics.series) {
        const same = next.comicLibrary.series.find((row) => row.title === series.title);
        if (same) { seriesMap.set(series.id, same.id); continue; }
        const id = next.comicLibrary.series.some((row) => row.id === series.id) ? randomUUID() : series.id;
        next.comicLibrary.series.push({ id, title: series.title }); seriesMap.set(series.id, id);
      }
      for (const project of incomingComics.projects) {
        if (next.comicLibrary.projects.some((row) => equivalent(row) === equivalent(project))) continue;
        const copied = comicProjectFile(project).project;
        copied.seriesId = seriesMap.get(copied.seriesId) || copied.seriesId;
        if ([...next.comicLibrary.projects, ...next.comicLibrary.shelved].some((row) => row.id === copied.id)) copied.id = randomUUID();
        next.comicLibrary.projects.push(copied);
      }
      for (const row of incomingComics.shelved) {
        if (next.comicLibrary.shelved.some((old) => old.key === row.key)) continue;
        const copied = { ...row, seriesId: seriesMap.get(row.seriesId) || row.seriesId };
        if ([...next.comicLibrary.projects, ...next.comicLibrary.shelved].some((old) => old.id === copied.id)) copied.id = randomUUID();
        next.comicLibrary.shelved.push(copied);
      }
      if (next.comicLibrary.projects.length > COMIC_LIMITS.projects) throw new Error('合并后已加载项目超过 8 个，请先在章节库卸载部分章节再合并');
      next.comicLibrary = validateComicLibrary(next.comicLibrary);
    }
    if (sections.includes('assistant')) {
      const mapping = new Map();
      next.assistantSchemes = combineRows(next.assistantSchemes, incoming.assistantSchemes, ASSISTANT_SCHEME_LIMIT, mapping, 60);
      if (!next.assistantSchemeId && incoming.assistantSchemeId) {
        next.assistantSchemeId = mapping.get(incoming.assistantSchemeId) || '';
      }
    }
    if (sections.includes('artists')) next.artistLibrary = combineRows(next.artistLibrary, incoming.artistLibrary, 100);
    if (sections.includes('tags')) next.tagLibrary = mergeTagLibraries(
      normalizeTagLibrary(next.tagLibrary), normalizeTagLibrary(incoming.tagLibrary));
    if (sections.includes('characters')) {
      const mapping = new Map();
      next.characterProfiles.profiles = combineRows(next.characterProfiles.profiles, incoming.characterProfiles.profiles, 100, mapping, 120);
      if (preserveChat) {
        for (const chat of incoming.characterProfiles.chats) {
          if (next.characterProfiles.chats.some((entry) => entry.chatKey === chat.chatKey)) continue;
          if (chat.selection) chat.selection.forEach((entry) => { entry.profileId = mapping.get(entry.profileId) || entry.profileId; });
          chat.overrides.forEach((entry) => { entry.id = mapping.get(entry.id) || entry.id; });
          next.characterProfiles.chats.push(chat);
        }
        if (next.characterProfiles.chats.length > 200) throw new Error('合并后聊天档案超过 200 组');
      }
    }
  } else throw new Error('请选择合并导入或覆盖配置');
  for (const key of ['novelaiPresets', 'openaiPresets', 'comfyPresets', 'sdwebuiPresets']) {
    for (const item of next[key] || []) if (item.connectionProfileId) {
      const provider = { novelaiPresets: 'novelai', openaiPresets: 'openai', comfyPresets: 'comfyui', sdwebuiPresets: 'sdwebui' }[key];
      if (!next.connectionProfiles[provider].some((entry) => entry.id === item.connectionProfileId)) item.connectionProfileId = '';
    }
  }
  const normalized = normalizeBackupConfig(next);
  // Existing live associations stay local; imported projects never resume old tasks.
  normalized.comicLibrary = validateComicLibrary(next.comicLibrary || normalizeComicLibrary());
  for (const key of ['novelaiPresets', 'openaiPresets', 'comfyPresets', 'sdwebuiPresets']) assertLibrary(next[key], normalized[key], key);
  if (backupSize({ ...next, ...normalized }) > 2000000) throw new Error('恢复后的配置超过 2 MB');
  return { ...next, ...normalized };
}

export function referencedAssets(value) {
  const found = new Map();
  const visit = (item, depth = 0) => {
    if (depth > 45 || !item || typeof item !== 'object') return;
    if (/^[a-f0-9]{64}$/.test(item.id) && ['browser', 'server'].includes(item.location)
      && ['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'].includes(item.mime)) {
      found.set(`${item.location}:${item.id}`, cloneBackup(item)); return;
    }
    for (const entry of Object.values(item)) visit(entry, depth + 1);
  };
  visit(value);
  return [...found.values()];
}

export function rewriteBackupAssets(value, locations) {
  const next = cloneBackup(value);
  const visit = (item) => {
    if (!item || typeof item !== 'object') return;
    if (/^[a-f0-9]{64}$/.test(item.id) && ['browser', 'server'].includes(item.location)) {
      if (locations.has(item.id)) item.location = locations.get(item.id);
      return;
    }
    Object.values(item).forEach(visit);
  };
  visit(next); return next;
}
