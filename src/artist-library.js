import { randomUUID } from './crypto-compat.js';
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
export const ARTIST_LIBRARY_LIMIT = 450 * 1024;
export const emptyArtist = () => ({ id: randomUUID(), name: '', category: '', artist: '', quality: '', negative: '', preview: '', favorite: false, target: 'all' });

export function normalizeArtist(value = {}) {
  return {
    id: typeof value.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value.id) ? value.id : randomUUID(),
    name: text(value.name, 40).trim(), category: text(value.category, 40).trim(),
    artist: text(value.artist ?? value.tags, 4000), quality: text(value.quality, 4000),
    negative: text(value.negative, 12000), favorite: value.favorite === true,
    target: ['all', 'novelai', 'openai', 'comfyui', 'sdwebui'].includes(value.target) ? value.target : 'all',
    preview: typeof value.preview === 'string' && value.preview.length <= 60000
      && /^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value.preview) ? value.preview : '',
  };
}

export function normalizeArtistLibrary(value) {
  const entries = [], ids = new Set();
  for (const row of (Array.isArray(value) ? value : []).slice(0, 100)) {
    if (!row || typeof row !== 'object') continue;
    const entry = normalizeArtist(row);
    if (!entry.name || ids.has(entry.id)) continue;
    if (new TextEncoder().encode(JSON.stringify([...entries, entry])).length > ARTIST_LIBRARY_LIMIT) break;
    ids.add(entry.id); entries.push(entry);
  }
  return entries;
}

export function saveArtist(entries, value) {
  const entry = normalizeArtist(value);
  if (!entry.name || !entry.artist.trim()) throw new Error('请填写名称和画师串／风格描述');
  if (entries.some((item) => item.id !== entry.id && item.name.toLocaleLowerCase() === entry.name.toLocaleLowerCase())) throw new Error('已有同名画师串');
  const next = entries.some((item) => item.id === entry.id)
    ? entries.map((item) => item.id === entry.id ? entry : item) : [...entries, entry];
  if (next.length > 100) throw new Error('最多保存 100 个画师串');
  if (new TextEncoder().encode(JSON.stringify(next)).length > ARTIST_LIBRARY_LIMIT) throw new Error('画师串库空间已满，请减少预览图或导出整理');
  return next;
}

export function importArtistLibrary(entries, raw) {
  if (raw?.format !== 'linghuashi-artists' || raw.version !== 1 || !Array.isArray(raw.entries)
    || !raw.entries.length || raw.entries.length > 100) throw new Error('请选择灵画师画师串库 JSON，单次需包含 1 至 100 项');
  let next = structuredClone(entries);
  for (const value of raw.entries) {
    const entry = normalizeArtist(value);
    entry.id = randomUUID();
    const base = entry.name.slice(0, 32);
    let suffix = 1;
    while (next.some((item) => item.name.toLocaleLowerCase() === entry.name.toLocaleLowerCase())) entry.name = `${base} (${++suffix})`;
    next = saveArtist(next, entry);
  }
  return next;
}

// Split only at unweighted separators; commas inside weighted groups stay intact.
export function appendPrompt(base, addition) {
  const chunks = (value) => {
    const result = []; let part = '', depth = 0;
    for (const char of String(value || '')) {
      if ('{[('.includes(char)) depth++;
      if ('}])'.includes(char)) depth = Math.max(0, depth - 1);
      if ((char === ',' || char === '\n') && !depth) { if (part.trim()) result.push(part.trim()); part = ''; }
      else part += char;
    }
    if (part.trim()) result.push(part.trim());
    return result;
  };
  const existing = chunks(base), seen = new Set(existing.map((part) => part.toLocaleLowerCase()));
  for (const part of chunks(addition)) if (!seen.has(part.toLocaleLowerCase())) {
    existing.push(part); seen.add(part.toLocaleLowerCase());
  }
  return existing.join(', ');
}

export function applyArtist(state, value, { mode = 'replace', quality = false, negative = false } = {}) {
  const entry = normalizeArtist(value), provider = state.provider;
  if (!entry.artist.trim()) throw new Error('请先填写画师串／风格描述');
  if (entry.target !== 'all' && entry.target !== provider) throw new Error('该画师串不适用于当前生图模式，请先切换模式');
  const params = structuredClone(provider === 'comfyui' ? state.comfyui.params : state[provider]);
  const artistKey = provider === 'comfyui' ? 'positive' : 'artist';
  if (provider === 'comfyui' && !state.comfyui.mapping.positive) throw new Error('请先映射 ComfyUI 正向提示词节点');
  // ComfyUI has one positive field; retain its subject and scene when adding style.
  params[artistKey] = mode === 'append' || provider === 'comfyui' ? appendPrompt(params[artistKey], entry.artist) : entry.artist;
  if (quality && entry.quality.trim()) params.positive = appendPrompt(params.positive, entry.quality);
  if (negative && entry.negative.trim()) {
    if (provider === 'comfyui' && !state.comfyui.mapping.negative) throw new Error('请先映射 ComfyUI 负面提示词节点');
    if (provider === 'openai' && !/nai-diffusion/i.test(params.model)) throw new Error('当前 OpenAI 图片模型没有独立负面词参数，请取消应用负面词');
    params.negative = appendPrompt(params.negative, entry.negative);
  }
  const maxPositive = provider === 'openai' ? 32000 : 12000;
  if ((params.artist || '').length > 4000 || params.positive.length > maxPositive || params.negative.length > maxPositive) throw new Error('合并后的提示词超出长度限制，请先精简');
  if (provider !== 'comfyui') state[provider] = params;
  else state.comfyui.params = params;
  return params;
}
