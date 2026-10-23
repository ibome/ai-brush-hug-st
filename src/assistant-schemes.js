import { randomUUID } from './crypto-compat.js';
import { normalizeAssistant, assistantURLs } from './prompt-assistant.js';
import { ASSISTANT_OPERATIONS, composeTaskMessages } from './assistant-workflow.js';
import { normalizeTaskPrompts, validateTaskPrompt } from './assistant-rules.js';

export const ASSISTANT_SCHEME_LIMIT = 30;
export const ASSISTANT_SCHEME_BYTES = 400000;
export const BUILTIN_ASSISTANT_SCHEMES = Object.freeze([
  { id: 'builtin-daily', name: '日常配图', settings: { template: 'scene', composition: 'balanced', illustrationCount: 1, count: 1, aspect: 'keep' } },
  { id: 'builtin-portrait', name: '人物特写', settings: { template: 'portrait', composition: 'closeup', illustrationCount: 1, count: 1, aspect: 'portrait' } },
  { id: 'builtin-story', name: '多图剧情', settings: { template: 'scene', composition: 'balanced', illustrationCount: 3, count: 1, aspect: 'auto' } },
]);
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
const clone = (value) => JSON.parse(JSON.stringify(value));
const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id) && !id.startsWith('builtin-');

export function validateSchemeSettings(value) {
  if (!object(value)) throw new Error('方案配置无效');
  const result = normalizeAssistant(value);
  if (value.taskPrompts && (!object(value.taskPrompts) || Object.entries(value.taskPrompts).some(([operation, prompt]) =>
    validateTaskPrompt(operation, prompt).length))) throw new Error('方案底层提示词无效或缺少动态标记');
  result.taskPrompts = normalizeTaskPrompts(value.taskPrompts);
  if (value.taskMessages && (!object(value.taskMessages) || Object.entries(value.taskMessages).some(([operation, rows]) =>
    !Array.isArray(rows) || rows.length !== result.taskMessages[operation]?.length || rows.some((row, index) =>
      row.role !== result.taskMessages[operation][index].role || row.content !== result.taskMessages[operation][index].content)))) {
    throw new Error('方案任务消息无效或超出限制');
  }
  for (const [operation] of ASSISTANT_OPERATIONS) composeTaskMessages(
    [{ role: 'system', content: 'rules' }, { role: 'user', content: 'input' }], operation, result);
  if (result.endpoint.trim()) assistantURLs(result.endpoint);
  result.apiLink = null;
  return result;
}

export function normalizeAssistantSchemes(value) {
  const seen = new Set();
  let total = 0;
  return (Array.isArray(value) ? value : []).slice(0, ASSISTANT_SCHEME_LIMIT).flatMap((row) => {
    if (!object(row) || !validId(row.id) || seen.has(row.id) || typeof row.name !== 'string' || !row.name.trim()) return [];
    try {
      const settings = validateSchemeSettings(row.settings);
      total += bytes({ ...row, settings });
      if (total > ASSISTANT_SCHEME_BYTES) return [];
      seen.add(row.id);
      return [{ id: row.id, name: row.name.trim().slice(0, 60), settings }];
    } catch { return []; }
  });
}

export function saveAssistantScheme(library, { id, name, settings }) {
  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (!cleanName || cleanName.length > 60) throw new Error('方案名称需为 1 至 60 字符');
  const rows = normalizeAssistantSchemes(library);
  if (id && !rows.some((row) => row.id === id)) throw new Error('方案已删除，请另存为新方案');
  if (rows.some((row) => row.id !== id && row.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase())) throw new Error('方案名称已存在');
  const row = { id: id || randomUUID(), name: cleanName, settings: validateSchemeSettings(settings) };
  const next = id ? rows.map((item) => item.id === id ? row : item) : [...rows, row];
  if (next.length > ASSISTANT_SCHEME_LIMIT || bytes(next) > ASSISTANT_SCHEME_BYTES) throw new Error('方案库超过 30 项或 400 KB，请先精简');
  return { library: next, id: row.id };
}

export function resolveAssistantScheme(library, id, current) {
  const builtin = BUILTIN_ASSISTANT_SCHEMES.find((row) => row.id === id);
  if (builtin) return normalizeAssistant({ ...current, ...builtin.settings });
  const saved = library.find((row) => row.id === id);
  if (!saved) throw new Error('请选择有效方案');
  return validateSchemeSettings(saved.settings);
}

function portable(value) {
  if (typeof value === 'string') return value.replace(/\b(?:sk-|pst-|STD-)[A-Za-z0-9_-]{12,}/g, '[redacted]');
  if (Array.isArray(value)) return value.map(portable);
  if (!object(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['keyRef', 'apiLink'].includes(key)).map(([key, item]) => [key, portable(item)]));
}

export function exportAssistantSchemes(library) {
  return { type: 'linghuashi-assistant-schemes', formatVersion: 1, schemes: portable(normalizeAssistantSchemes(library)) };
}

export function importAssistantSchemes(library, document) {
  if (!object(document) || document.type !== 'linghuashi-assistant-schemes' || document.formatVersion !== 1
    || !Array.isArray(document.schemes) || !document.schemes.length || bytes(document) > ASSISTANT_SCHEME_BYTES) throw new Error('助手方案文件无效或超过 400 KB');
  const input = portable(document.schemes);
  const rows = normalizeAssistantSchemes(input);
  if (rows.length !== input.length) throw new Error('导入方案含无效、重复或超出限制的条目');
  let next = clone(library);
  for (const row of rows) {
    let name = row.name, count = 1;
    while (next.some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      const tail = ` (${++count})`; name = `${row.name.slice(0, 60 - tail.length)}${tail}`;
    }
    next = saveAssistantScheme(next, { name, settings: row.settings }).library;
  }
  return next;
}
