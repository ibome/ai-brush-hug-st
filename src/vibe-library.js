import { normalizeAdvanced, vibeModelKey } from './advanced-generation.js';

export const VIBE_LIBRARY_LIMIT = 100;
export function normalizeVibeLibrary(value = []) {
  const ids = new Set();
  return (Array.isArray(value) ? value : []).slice(0, VIBE_LIBRARY_LIMIT).flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const entry = normalizeAdvanced({ vibes: [row] }).vibes[0];
    if (!entry || ids.has(entry.id) || !entry.image && !Object.keys(entry.encodings).length) return [];
    ids.add(entry.id);
    return [{ ...entry, category: String(row.category || '我的参考').trim().slice(0, 40),
      favorite: row.favorite === true, model: String(row.model || '').slice(0, 120) }];
  });
}
export function saveVibe(library, value) {
  const entry = normalizeVibeLibrary([value])[0];
  if (!entry?.name.trim()) throw new Error('请填写参考名称并添加图片或编码');
  const next = library.some((row) => row.id === entry.id) ? library.map((row) => row.id === entry.id ? entry : row) : [...library, entry];
  if (next.length > VIBE_LIBRARY_LIMIT) throw new Error('Vibe 素材库最多保存 100 项');
  if (new TextEncoder().encode(JSON.stringify(next)).length > 300000) throw new Error('Vibe 素材库超过容量限制');
  return next;
}
export function searchVibes(library, search = '', favorites = false, model = '') {
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return library.filter((row) => (!favorites || row.favorite) && (!model || row.model === model
    || Boolean(row.encodings[vibeModelKey(model)]) || vibeModelKey(model) === 'v3' && row.image)
    && words.every((word) => `${row.name} ${row.category} ${row.model}`.toLowerCase().includes(word)));
}
