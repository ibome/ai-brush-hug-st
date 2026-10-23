import { randomUUID } from '../crypto-compat.js';
import { escapeHtml as esc } from '../config.js';
import { icon } from '../icons.js';
import { samples } from './sample-data.js';
import { applyPresetConnection, connectionDirty, presetConnection, savePresetBinding, resolvePresetConnection } from '../connections.js';
import { normalizeAdvanced } from '../advanced-generation.js';

export const NOVELAI_MODELS = Object.freeze([
  { id: 'nai-diffusion-4-5-full', title: 'NAI 4.5 Full' },
  { id: 'nai-diffusion-4-5-curated', title: 'NAI 4.5 Curated' },
  { id: 'nai-diffusion-4-full', title: 'NAI 4 Full' },
  { id: 'nai-diffusion-4-curated-preview', title: 'NAI 4 Curated Preview' },
  { id: 'nai-diffusion-3', title: 'NAI 3' },
  { id: 'nai-diffusion-furry-3', title: 'NAI 3 Furry' },
  { id: 'nai-diffusion-5-full', title: 'NAI 5 Full' },
  { id: 'nai-diffusion-5-curated', title: 'NAI 5 Curated' },
]);
export const NOVELAI_SAMPLERS = Object.freeze([
  ['k_euler_ancestral', 'Euler Ancestral'],
  ['k_euler', 'Euler'],
  ['k_dpmpp_2s_ancestral', 'DPM++ 2S Ancestral'],
  ['k_dpmpp_2m_sde', 'DPM++ 2M SDE'],
  ['k_dpmpp_2m', 'DPM++ 2M'],
  ['k_dpmpp_sde', 'DPM++ SDE'],
  ['ddim', 'DDIM'],
]);
export const NOVELAI_SIZES = Object.freeze([
  { id: 'portrait', title: '竖图 · 832 × 1216', width: 832, height: 1216 },
  { id: 'landscape', title: '横图 · 1216 × 832', width: 1216, height: 832 },
  { id: 'square', title: '方图 · 1024 × 1024', width: 1024, height: 1024 },
  { id: 'large-portrait', title: '大竖图 · 1024 × 1536', width: 1024, height: 1536 },
  { id: 'large-landscape', title: '大横图 · 1536 × 1024', width: 1536, height: 1024 },
]);
export const NOVELAI_DEFAULTS = Object.freeze({
  model: 'nai-diffusion-4-5-full',
  artist: '',
  positive: samples[0].prompt,
  negative: 'low quality, blurry, watermark',
  width: 832,
  height: 1216,
  steps: 23,
  scale: 5,
  cfgRescale: 0,
  seed: -1,
  sampler: 'k_euler_ancestral',
  noiseSchedule: 'karras',
  nSamples: 1,
  qualityTags: true,
  ucPreset: '0',
  variety: false,
  sm: false,
  smDyn: false,
  advanced: normalizeAdvanced(),
});
export const NOVELAI_LIMITS = Object.freeze({
  width: { min: 64, max: 2048, step: 64 },
  height: { min: 64, max: 2048, step: 64 },
  steps: { min: 1, max: 50, step: 1 },
  scale: { min: 0, max: 10, step: 0.1 },
  cfgRescale: { min: 0, max: 1, step: 0.01 },
  seed: { min: -1, max: 4294967295, step: 1 },
  nSamples: { min: 1, max: 4, step: 1 },
});

export function isNAI3(model) {
  return model === 'nai-diffusion-3' || model === 'nai-diffusion-furry-3';
}

export function supportsVariety(model) {
  return /^nai-diffusion-4(?:-|$)/.test(model);
}

export function normalizeNovelAI(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const result = { ...NOVELAI_DEFAULTS };
  for (const [key, fallback] of Object.entries(NOVELAI_DEFAULTS)) {
    if (Object.hasOwn(NOVELAI_LIMITS, key)) {
      const { min, max, step } = NOVELAI_LIMITS[key];
      const number = input[key] === '' || input[key] == null ? fallback : Number(input[key]);
      result[key] = Number.isFinite(number)
        ? Number((Math.round(Math.max(min, Math.min(max, number)) / step) * step).toFixed(2))
        : fallback;
    } else if (typeof fallback === 'boolean') {
      result[key] = typeof input[key] === 'boolean' ? input[key] : fallback;
    } else if (['artist', 'positive', 'negative'].includes(key)) {
      result[key] = typeof input[key] === 'string' ? input[key].slice(0, key === 'artist' ? 4000 : 12000) : fallback;
    }
  }
  if (NOVELAI_MODELS.some((model) => model.id === input.model)) result.model = input.model;
  if (NOVELAI_SAMPLERS.some(([id]) => id === input.sampler)) result.sampler = input.sampler;
  if (['karras', 'exponential', 'polyexponential', 'native'].includes(input.noiseSchedule)) result.noiseSchedule = input.noiseSchedule;
  if (['0', '1', '2', '3', '4'].includes(String(input.ucPreset))) result.ucPreset = String(input.ucPreset);
  if (!isNAI3(result.model)) {
    result.sm = false;
    result.smDyn = false;
    if (result.sampler === 'ddim') result.sampler = NOVELAI_DEFAULTS.sampler;
    if (result.noiseSchedule === 'native') result.noiseSchedule = NOVELAI_DEFAULTS.noiseSchedule;
  }
  if (!result.sm) result.smDyn = false;
  if (!supportsVariety(result.model)) result.variety = false;
  result.advanced = normalizeAdvanced(input.advanced);
  return result;
}

export function normalizeNovelAIState(state) {
  state.novelai = normalizeNovelAI(state.novelai);
  const ids = new Set(['default']);
  const names = new Set(['默认配置']);
  state.novelaiPresets = (Array.isArray(state.novelaiPresets) ? state.novelaiPresets : []).filter((preset) => {
    if (!preset || typeof preset.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(preset.id) || ids.has(preset.id)) return false;
    const name = typeof preset.name === 'string' ? preset.name.trim().slice(0, 40) : '';
    if (!name || names.has(name.toLocaleLowerCase())) return false;
    ids.add(preset.id);
    names.add(name.toLocaleLowerCase());
    return true;
  }).slice(0, 50).map((preset) => ({
    id: preset.id, name: preset.name.trim().slice(0, 40), params: normalizeNovelAI(preset.params),
    ...presetConnection('novelai', preset),
  }));
  if (!['default', ...state.novelaiPresets.map((preset) => preset.id)].includes(state.novelaiPresetId)) state.novelaiPresetId = 'default';
}

export function selectedNovelAIPreset(state) {
  return state.novelaiPresets.find((preset) => preset.id === state.novelaiPresetId)
    || { id: 'default', name: '默认配置', params: { ...NOVELAI_DEFAULTS } };
}

export function novelAIPresetDirty(state) {
  return JSON.stringify(normalizeNovelAI(state.novelai)) !== JSON.stringify(selectedNovelAIPreset(state).params)
    || connectionDirty(state, 'novelai', selectedNovelAIPreset(state));
}

export function loadNovelAIPreset(state, id) {
  const preset = id === 'default' ? { id, params: NOVELAI_DEFAULTS } : state.novelaiPresets.find((item) => item.id === id);
  if (!preset) throw new Error('找不到该预设');
  resolvePresetConnection(state, 'novelai', preset);
  state.novelaiPresetId = preset.id;
  state.novelai = normalizeNovelAI(preset.params);
  applyPresetConnection(state, 'novelai', preset);
  return preset;
}

export function saveNovelAIPreset(state, name) {
  const params = normalizeNovelAI(state.novelai);
  if (name === undefined) {
    const preset = state.novelaiPresets.find((item) => item.id === state.novelaiPresetId);
    if (!preset) throw new Error('请将默认配置另存为新预设');
    preset.params = params;
    savePresetBinding(state, 'novelai', preset);
    return preset;
  }
  const title = name.trim();
  if (!title || title.length > 40) throw new Error('预设名称需为 1 至 40 个字符');
  if (title === '默认配置' || state.novelaiPresets.some((preset) => preset.name.toLocaleLowerCase() === title.toLocaleLowerCase())) {
    throw new Error('已有同名预设，请换一个名称');
  }
  if (state.novelaiPresets.length >= 50) throw new Error('最多保存 50 个预设，请先删除不需要的预设');
  const preset = savePresetBinding(state, 'novelai', { id: randomUUID(), name: title, params });
  state.novelaiPresets.push(preset);
  state.novelaiPresetId = preset.id;
  return preset;
}

const field = (label, body, extra = '') => `<label class="ui-field ${extra}"><span>${label}</span>${body}</label>`;
const options = (items, selected) => items.map(([id, title]) => `<option value="${esc(id)}" ${String(selected) === String(id) ? 'selected' : ''}>${esc(title)}</option>`).join('');
const command = (name, title, action, extra = '') => `<button type="button" class="ui-button secondary" data-action="${action}" ${extra}>${icon(name)}<span>${title}</span></button>`;
const numeric = (key, label) => {
  const { min, max, step } = NOVELAI_LIMITS[key];
  return { key, label, min, max, step };
};

export function renderNovelAIParameters(state, advancedOpen = false) {
  const value = state.novelai;
  const nai3 = isNAI3(value.model);
  const sizes = NOVELAI_SIZES.find((size) => size.width === value.width && size.height === value.height)?.id || 'custom';
  const numberField = (key, label) => {
    const limits = numeric(key, label);
    return field(label, `<input type="number" data-nai="${key}" min="${limits.min}" max="${limits.max}" step="${limits.step}" value="${value[key]}" />`);
  };
  const toggle = (key, title, disabled = false, note = '') => `<label class="nai-toggle ${disabled ? 'is-disabled' : ''}"><span>${title}${note ? `<small>${note}</small>` : ''}</span><input type="checkbox" role="switch" data-nai="${key}" ${value[key] ? 'checked' : ''} ${disabled ? 'disabled' : ''} /><span class="nai-toggle-track" aria-hidden="true"></span></label>`;
  return `<section class="novelai-parameters" aria-label="NovelAI 参数配置">
    <div class="field-heading"><h2>NovelAI 参数</h2><span class="nai-preset-state" data-nai-dirty>${novelAIPresetDirty(state) ? '有未保存修改' : '已保存'}</span></div>
    ${field('NovelAI 模型', `<select data-nai="model">${options(NOVELAI_MODELS.map((model) => [model.id, model.id]), value.model)}</select>`)}
    ${field('画师串', `<textarea rows="2" data-nai="artist" maxlength="4000" spellcheck="false" placeholder="artist:画师名, artist:画师名">${esc(value.artist)}</textarea>`)}
    ${field('正向提示词', `<textarea class="nai-positive" rows="3" data-nai="positive" maxlength="12000" spellcheck="false" placeholder="想要的主体、场景、风格与细节">${esc(value.positive)}</textarea>`)}
    ${field('负面提示词', `<textarea rows="2" data-nai="negative" maxlength="12000" spellcheck="false" placeholder="不希望出现的内容">${esc(value.negative)}</textarea>`)}
    ${field('尺寸', `<select data-nai-size>${options([...NOVELAI_SIZES.map((size) => [size.id, size.title]), ['custom', '自定义尺寸']], sizes)}</select>`)}
    <div class="nai-dimensions">${numberField('width', '宽度 (px)')}<button type="button" class="ui-icon-button" data-action="nai-swap-size" title="交换宽高" aria-label="交换宽高">${icon('arrow-left-right')}</button>${numberField('height', '高度 (px)')}</div>
    ${numberField('steps', '步数')}
    <details class="advanced-options nai-advanced" data-experience-fold="nai-parameters" ${advancedOpen || state.experience?.level === 'full' ? 'open' : ''}><summary>${icon('settings-2')}其他参数设置${icon('chevron-down')}</summary>
      <div class="two-field-row">
        ${numberField('scale', '提示词引导 (CFG)')}
        ${numberField('cfgRescale', 'CFG Rescale')}
        ${field('采样器', `<select data-nai="sampler">${options(NOVELAI_SAMPLERS.filter(([id]) => nai3 || id !== 'ddim'), value.sampler)}</select>`)}
        ${field('噪声调度', `<select data-nai="noiseSchedule">${options([['karras', 'Karras'], ['exponential', 'Exponential'], ['polyexponential', 'Polyexponential'], ...(nai3 ? [['native', 'Native']] : [])], value.noiseSchedule)}</select>`)}
        ${field('随机种子', `<div class="input-with-button"><input type="number" data-nai="seed" min="-1" max="4294967295" step="1" value="${value.seed}" /><button type="button" class="ui-icon-button" data-action="nai-random-seed" title="生成随机种子" aria-label="生成随机种子">${icon('refresh-cw')}</button></div>`)}
        ${numberField('nSamples', '每次生成张数')}
        ${field('负面预设', `<select data-nai="ucPreset">${options([['0', 'Heavy'], ['1', 'Light'], ['2', 'Furry'], ['3', 'Human Focus'], ['4', 'None']], value.ucPreset)}</select>`)}
        <p class="nai-seed-note">种子 -1 表示每次随机</p>
      </div>
      <div class="nai-toggle-grid">${toggle('qualityTags', '质量标签')}${toggle('variety', 'Variety+', !supportsVariety(value.model), '仅 NAI 4 / 4.5')}${toggle('sm', 'SMEA', !nai3, '仅 NAI 3')}${toggle('smDyn', 'SMEA DYN', !nai3 || !value.sm, '需启用 SMEA')}</div>
    </details>
  </section>`;
}

export function renderNovelAIPresets(state, actions = '') {
  return `<div class="nai-presets">
      ${field('参数预设', `<select data-nai-preset>${options([['default', '默认配置'], ...state.novelaiPresets.map((preset) => [preset.id, preset.name])], state.novelaiPresetId)}</select>`)}
      <div class="nai-preset-actions">${command('folder-open', '载入预设', 'nai-load-preset')}${command('save', '保存预设', 'nai-save-preset')}${command('copy-plus', '另存为', 'nai-save-as')}${actions}<button type="button" class="ui-icon-button" data-action="nai-delete-preset" title="删除当前预设" aria-label="删除当前预设" ${state.novelaiPresetId === 'default' ? 'disabled' : ''}>${icon('trash-2')}</button></div>
    </div>`;
}
