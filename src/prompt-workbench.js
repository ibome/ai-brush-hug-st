import { appendPromptParts } from './prompt-composer.js';
import { resolveMaterialText } from './material-cards.js';
import { tagTargets, setPromptText } from './tag-library.js';
import { applyCharacterScene } from './character-profiles.js';

export const BATCH_LIMIT = 32;
export const REVIEW_LABELS = [['unrated', '未分类'], ['best', '精品'], ['usable', '可用'], ['reject', '淘汰']];
const clean = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const bounded = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Math.floor(Number(value)))) : fallback;
export function normalizeWorkbench(value = {}) {
  return { version: 1, mode: value.mode === 'explore' ? 'explore' : 'batch',
    characters: clean(value.characters, 12000), actions: clean(value.actions, 12000), styles: clean(value.styles, 12000),
    artistIds: [...new Set(Array.isArray(value.artistIds) ? value.artistIds.filter((id) => typeof id === 'string' && id.length <= 64) : [])].slice(0, 12),
    combinationSize: bounded(value.combinationSize, 1, 1, 3), candidates: bounded(value.candidates, 8, 1, 32),
    repeats: bounded(value.repeats, 1, 1, 8), seed: bounded(value.seed, 42, 0, 4294967295),
    seedMode: ['same', 'increment', 'random', 'service'].includes(value.seedMode) ? value.seedMode : 'same' };
}
function axisRows(value, field, cards) {
  const lines = String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 32) throw new Error('每个维度最多填写 32 个选项');
  if (!lines.length) return [{ label: '沿用当前', positive: '', negative: '', artist: '' }];
  return lines.map((line) => {
    const split = line.indexOf('|'), raw = split < 0 ? line : line.slice(split + 1).trim();
    const label = (split < 0 ? line : line.slice(0, split)).trim().slice(0, 80);
    const token = /^<([^<>:\r\n]+):([^<>:\r\n]+)>$/.test(raw) && !/^<(lora|lyco|hypernet|embedding):/i.test(raw);
    return { label, ...Object.fromEntries(['positive', 'negative', 'artist'].map((key) =>
      [key, token ? resolveMaterialText(raw, cards, key) : key === field ? resolveMaterialText(raw, cards, key) : ''])) };
  });
}
function choose(rows, size, start = 0, prefix = [], results = []) {
  if (!size) { results.push(prefix); return results; }
  for (let i = start; i <= rows.length - size; i++) choose(rows, size - 1, i + 1, [...prefix, rows[i]], results);
  return results;
}
export function artistCandidates(library, ids, size = 1, count = 8) {
  const pool = library.filter((row) => ids.includes(row.id));
  if (!pool.length || pool.length !== ids.length) throw new Error('请重新选择画师池，部分条目可能已删除');
  if (pool.length > 12 || size < 1 || size > 3 || size > pool.length) throw new Error('每组画师数需为 1 至 3，且不能超过已选数量');
  return choose(pool, size).slice(0, bounded(count, 8, 1, 32)).map((entries) => ({
    label: entries.map((row) => row.name).join(' + '), artistIds: entries.map((row) => row.id),
    positive: entries.reduce((text, row) => appendPromptParts(text, row.quality), ''),
    negative: entries.reduce((text, row) => appendPromptParts(text, row.negative), ''),
    artist: entries.reduce((text, row) => appendPromptParts(text, row.artist), ''),
    targets: entries.map((row) => row.target),
  }));
}
export function buildBatchPreview(snapshot, input, { cards = [], artists = [], random = () => crypto.getRandomValues(new Uint32Array(1))[0] } = {}) {
  const options = normalizeWorkbench(input);
  if (input.repeats !== undefined && Number(input.repeats) !== options.repeats) throw new Error('每组重复次数需为 1 至 8');
  snapshot = structuredClone(snapshot);
  const params = snapshot.params || snapshot.config?.params;
  if (!params) throw new Error('当前生图配置无效');
  if (snapshot.characterScene?.applied) {
    const applied = applyCharacterScene(snapshot, snapshot.characterScene), rendered = applied.params || applied.config.params;
    for (const key of ['positive', 'negative']) {
      if (params[key] === rendered[key]) params[key] = snapshot.characterScene[key === 'positive' ? 'basePositive' : 'baseNegative'];
    }
  }
  const context = { provider: snapshot.provider, params, mapping: snapshot.config?.mapping };
  const available = tagTargets(context).filter((row) => row.enabled).map((row) => row.id);
  if (!available.includes('positive')) throw new Error('请先映射 ComfyUI 正向提示词节点');
  const characters = options.mode === 'explore' ? [{ label: '当前主体' }] : axisRows(options.characters, 'positive', cards);
  const actions = options.mode === 'explore' ? [{ label: '当前场景' }] : axisRows(options.actions, 'positive', cards);
  const styles = options.mode === 'explore' ? artistCandidates(artists, options.artistIds, options.combinationSize, options.candidates)
    : axisRows(options.styles, 'artist', cards);
  const count = characters.length * actions.length * styles.length * options.repeats;
  if (count > BATCH_LIMIT) throw new Error(`组合共 ${count} 个任务，超过 ${BATCH_LIMIT} 个，请减少选项或重复次数`);
  if (snapshot.provider === 'openai' && options.seedMode !== 'service' && !/nai-diffusion/i.test(params.model)) {
    throw new Error('此 OpenAI 图片模型使用服务默认种子；请将种子方式设为“服务默认”');
  }
  if (snapshot.provider === 'comfyui' && options.seedMode !== 'service' && !snapshot.config?.mapping?.seed) throw new Error('请先映射 ComfyUI 种子节点');
  const results = [];
  const sharedSeed = options.seedMode === 'random' ? 0 : options.seed;
  for (const character of characters) for (const action of actions) for (const style of styles) {
    if (style.targets?.some((target) => target !== 'all' && target !== snapshot.provider)) throw new Error(`画师组合“${style.label}”不适用于当前模式`);
    for (let repeat = 0; repeat < options.repeats; repeat++) {
      const copy = structuredClone(snapshot), next = copy.params || copy.config.params;
      for (const key of ['positive', 'negative', 'artist']) {
        let value = String(params[key] || '');
        for (const part of [character, action, style]) if (part[key]) value = appendPromptParts(value, part[key]);
        if (key === 'artist' && snapshot.provider === 'comfyui') { next.positive = appendPromptParts(next.positive, value); continue; }
        if (value !== (params[key] || '') && !available.includes(key)) throw new Error(`当前模型或工作流不支持素材中的${key === 'negative' ? '负面词' : '风格栏'}`);
        if (available.includes(key)) setPromptText(context, value, key);
        next[key] = value;
      }
      setPromptText(context, next.positive, 'positive');
      if (![next.positive, next.artist].some((value) => value?.trim())) throw new Error('请填写当前提示词或组合选项');
      const index = results.length;
      const seed = options.seedMode === 'service' ? snapshot.provider === 'openai' ? null
        : Number.isSafeInteger(params.seed) && params.seed >= 0 ? params.seed : random() >>> 0 : options.seedMode === 'random' ? random() >>> 0
        : options.seedMode === 'increment' ? (sharedSeed + index) % 4294967296
          : (sharedSeed + repeat) % 4294967296;
      if (snapshot.provider === 'openai') {
        const extra = JSON.parse(next.extra || '{}');
        if (seed !== null) extra.seed = seed;
        else delete extra.seed;
        next.extra = JSON.stringify(extra); next.n = 1;
      } else { if (seed !== null) next.seed = seed; if (snapshot.provider === 'novelai') next.nSamples = 1; if (snapshot.provider === 'sdwebui') next.batch = 1; }
      if (copy.characterScene?.applied) {
        copy.characterScene.basePositive = next.positive; copy.characterScene.baseNegative = next.negative;
      }
      const final = applyCharacterScene(copy, copy.characterScene), finalParams = final.params || final.config.params;
      setPromptText(context, finalParams.positive, 'positive');
      if (available.includes('negative')) setPromptText(context, finalParams.negative, 'negative');
      results.push({ index, label: [character.label, action.label, style.label].join(' / ').slice(0, 240),
        seed, snapshot: final, artistIds: style.artistIds || [], repeat,
        ...(style.artistIds ? { candidate: { artist: style.artist, quality: style.positive, negative: style.negative } } : {}) });
    }
  }
  return { version: 1, mode: options.mode, count, expectedImages: snapshot.provider === 'comfyui' ? null : count, options, rows: results };
}

export function normalizeReviews(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(-10000).filter(([key, rating]) =>
    /^(browser|server):[A-Za-z0-9_-]{1,80}$/.test(key) && ['best', 'usable', 'reject'].includes(rating)));
}
export function reviewValue(reviews, location, id) { return reviews?.[`${location}:${id}`] || 'unrated'; }
export function setReview(reviews, location, id, rating) {
  if (!REVIEW_LABELS.some(([value]) => value === rating) || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error('筛图标记无效');
  const next = { ...reviews }, key = `${location}:${id}`;
  if (rating === 'unrated') delete next[key]; else next[key] = rating;
  if (Object.keys(next).length > 10000) throw new Error('筛图标记已达 10000 张，请先清理已删除图片的标记');
  return normalizeReviews(next);
}
