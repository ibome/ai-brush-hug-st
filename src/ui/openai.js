import { randomUUID } from '../crypto-compat.js';
import { escapeHtml as esc } from '../config.js';
import { icon } from '../icons.js';
import { samples } from './sample-data.js';
import { applyPresetConnection, connectionDirty, presetConnection, savePresetBinding, resolvePresetConnection } from '../connections.js';
import { normalizeAdvanced } from '../advanced-generation.js';

export const OPENAI_MODELS = Object.freeze([
  'gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst',
  'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini',
]);
export const OPENAI_DEFAULTS = Object.freeze({
  model: 'gpt-image-2', artist: '', positive: samples[0].prompt, negative: '',
  size: '1024x1024', width: 1024, height: 1024, n: 1, quality: 'auto',
  parameterMode: 'auto', background: 'auto', outputFormat: 'png',
  compression: 100, moderation: 'auto', responseFormat: 'auto', extra: '{}', advanced: normalizeAdvanced(),
});
const SIZES = [
  ['auto', '自动'], ['1024x1024', '方图 · 1024 × 1024'],
  ['1536x1024', '横图 · 1536 × 1024'], ['1024x1536', '竖图 · 1024 × 1536'],
  ['custom', '自定义尺寸'],
];
const LIMITS = { width: [16, 8192], height: [16, 8192], n: [1, 10], compression: [0, 100] };
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const bounded = (value, fallback, min, max) => {
  const number = value === '' || value == null ? fallback : Number(value);
  return Number.isFinite(number) ? Math.round(Math.max(min, Math.min(max, number))) : fallback;
};
export const isOpenAINovelAI = (model) => /nai-diffusion/i.test(String(model || ''));
export const usesGPTImage = (params) => !isOpenAINovelAI(params.model) && (params.parameterMode === 'gpt'
  || params.parameterMode !== 'basic' && /^(gpt-image-|chatgpt-image-latest$)/.test(params.model));
export const openAIQualityOptions = (params) => usesGPTImage(params)
  ? [['auto', '自动'], ['low', '低'], ['medium', '中'], ['high', '高'],
    ...(/^gpt-image-2\.5-/.test(params.model) ? [['xhigh', '超高'], ['max', '最高']] : [])]
  : [['auto', '服务默认'], ['standard', '标准'], ['hd', '高清']];

export function normalizeOpenAI(value = {}) {
  const source = record(value) ? value : {};
  const result = { ...OPENAI_DEFAULTS };
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    result[key] = bounded(source[key], result[key], min, max);
  }
  for (const key of ['model', 'artist', 'positive', 'negative', 'extra']) {
    if (typeof source[key] === 'string') result[key] = key === 'model' ? source[key] : source[key].slice(0,
      ['positive', 'negative'].includes(key) ? 32000 : key === 'extra' ? 16000 : 4000);
  }
  result.model = result.model.trim() || OPENAI_DEFAULTS.model;
  if (isOpenAINovelAI(result.model) && !Object.hasOwn(source, 'negative')) {
    try {
      const extra = JSON.parse(result.extra);
      if (record(extra) && typeof extra.negative_prompt === 'string') {
        result.negative = extra.negative_prompt.slice(0, 32000);
        delete extra.negative_prompt;
        result.extra = JSON.stringify(extra);
      }
    } catch {}
  }
  const choices = {
    size: SIZES.map(([id]) => id), parameterMode: ['auto', 'gpt', 'basic'],
    background: ['auto', 'opaque', 'transparent'], outputFormat: ['png', 'jpeg', 'webp'],
    moderation: ['auto', 'low'], responseFormat: ['auto', 'url', 'b64_json'],
  };
  for (const [key, values] of Object.entries(choices)) {
    if (values.includes(source[key])) result[key] = source[key];
  }
  if (openAIQualityOptions(result).some(([id]) => id === source.quality)) result.quality = source.quality;
  if (result.background === 'transparent' && result.outputFormat === 'jpeg') result.outputFormat = 'png';
  if (usesGPTImage(result)) result.responseFormat = 'auto';
  result.advanced = normalizeAdvanced(source.advanced);
  return result;
}

export function normalizeOpenAIState(state) {
  state.openai = normalizeOpenAI(state.openai);
  state.openaiEndpoint = typeof state.openaiEndpoint === 'string'
    ? state.openaiEndpoint.slice(0, 512) : 'https://api.openai.com/v1';
  state.openaiPath = typeof state.openaiPath === 'string'
    ? state.openaiPath.slice(0, 200) : '/images/generations';
  state.openaiTimeout = bounded(state.openaiTimeout, 180, 5, 600);
  const ids = new Set(['default']), names = new Set(['默认配置']);
  state.openaiPresets = (Array.isArray(state.openaiPresets) ? state.openaiPresets : []).filter((preset) => {
    if (!record(preset) || typeof preset.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(preset.id) || ids.has(preset.id)) return false;
    const name = typeof preset.name === 'string' ? preset.name.trim().slice(0, 40) : '';
    if (!name || names.has(name.toLocaleLowerCase())) return false;
    ids.add(preset.id); names.add(name.toLocaleLowerCase());
    return true;
  }).slice(0, 50).map((preset) => ({
    id: preset.id, name: preset.name.trim().slice(0, 40), params: normalizeOpenAI(preset.params),
    ...presetConnection('openai', preset),
  }));
  if (!['default', ...state.openaiPresets.map((preset) => preset.id)].includes(state.openaiPresetId)) state.openaiPresetId = 'default';
}

export const selectedOpenAIPreset = (state) => state.openaiPresets.find((preset) => preset.id === state.openaiPresetId)
  || { id: 'default', name: '默认配置', params: { ...OPENAI_DEFAULTS } };
export const openAIPresetDirty = (state) => JSON.stringify(normalizeOpenAI(state.openai))
  !== JSON.stringify(selectedOpenAIPreset(state).params) || connectionDirty(state, 'openai', selectedOpenAIPreset(state));
export function loadOpenAIPreset(state, id) {
  const preset = id === 'default' ? { id, params: OPENAI_DEFAULTS } : state.openaiPresets.find((item) => item.id === id);
  if (!preset) throw new Error('找不到该预设');
  resolvePresetConnection(state, 'openai', preset);
  state.openaiPresetId = preset.id;
  state.openai = normalizeOpenAI(preset.params);
  applyPresetConnection(state, 'openai', preset);
  return preset;
}
export function saveOpenAIPreset(state, name) {
  const params = normalizeOpenAI(state.openai);
  buildOpenAIRequest(params);
  if (name === undefined) {
    const preset = state.openaiPresets.find((item) => item.id === state.openaiPresetId);
    if (!preset) throw new Error('请将默认配置另存为新预设');
    preset.params = params;
    savePresetBinding(state, 'openai', preset);
    return preset;
  }
  const title = String(name || '').trim();
  if (!title || title.length > 40) throw new Error('预设名称需为 1 至 40 个字符');
  if (title === '默认配置' || state.openaiPresets.some((preset) => preset.name.toLocaleLowerCase() === title.toLocaleLowerCase())) throw new Error('已有同名预设');
  if (state.openaiPresets.length >= 50) throw new Error('最多保存 50 个预设');
  const preset = savePresetBinding(state, 'openai', { id: randomUUID(), name: title, params });
  state.openaiPresets.push(preset); state.openaiPresetId = preset.id;
  return preset;
}

export function openAIURLs(endpoint, path = '/images/generations') {
  let url;
  try { url = new URL(endpoint.trim()); } catch { throw new Error('请填写完整接口地址'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('请填写 HTTPS 地址；本机服务可使用 HTTP');
  if (url.username || url.password || url.search || url.hash) throw new Error('接口地址不能包含账号、密码、查询参数或锚点');
  let root = url.pathname.replace(/\/+$/, '').replace(/\/(?:images\/(?:generations|edits)|models)$/, '');
  if (!/\/v\d+(?:\.\d+)?$/i.test(root)) root += '/v1';
  const route = path.trim();
  if (!/^\/[A-Za-z0-9_./-]+$/.test(route) || route.startsWith('//') || route.split('/').includes('..')) throw new Error('生图路径需为以 / 开头的相对路径');
  return { base: `${url.origin}${root}`, models: `${url.origin}${root}/models`, generation: `${url.origin}${root}${route}` };
}

export function openAISize(params) {
  return params.size === 'custom' ? `${params.width}x${params.height}` : params.size;
}

export function buildOpenAIRequest(value) {
  const params = normalizeOpenAI(value);
  const prompt = [params.artist.trim(), params.positive.trim()].filter(Boolean).join('\n');
  if (!prompt) throw new Error('请填写生图提示词');
  if (prompt.length > 32000) throw new Error('风格描述与提示词合计不能超过 32000 个字符');
  const gpt = usesGPTImage(params), size = openAISize(params);
  if (gpt && size !== 'auto') {
    const [width, height] = size.split('x').map(Number);
    if (/^gpt-image-2(?:[.-]|$)/.test(params.model)) {
      const pixels = width * height;
      if (width % 16 || height % 16 || Math.max(width, height) > 3840
        || Math.max(width, height) / Math.min(width, height) > 3 || pixels < 655360 || pixels > 8294400) {
        throw new Error('尺寸边长需为 16 的倍数且不超过 3840，长宽比不超过 3:1，总像素需在 655360 至 8294400 之间');
      }
    } else if (!['1024x1024', '1536x1024', '1024x1536'].includes(size)) {
      throw new Error('该 GPT Image 参数模式使用自动、1024x1024、1536x1024 或 1024x1536 尺寸');
    }
  }
  let extra;
  try { extra = JSON.parse(params.extra || '{}'); } catch { throw new Error('附加参数必须是有效 JSON 对象'); }
  if (!record(extra)) throw new Error('附加参数必须是 JSON 对象');
  if (isOpenAINovelAI(params.model) && Object.keys(extra).some((key) => key.toLowerCase() === 'negative_prompt')) {
    throw new Error('请在独立的负面提示词输入框填写，移除附加 JSON 中的 negative_prompt');
  }
  const reserved = new Set(['model', 'prompt', 'n', 'size', 'quality', 'background', 'output_format',
    'output_compression', 'moderation', 'response_format', 'api_key', 'apikey', 'api-key',
    'authorization', 'headers', 'token', 'access_token', 'password', 'secret', '__proto__', 'constructor', 'prototype']);
  if (Object.keys(extra).some((key) => reserved.has(key.toLowerCase()))) throw new Error('附加参数不能覆盖界面参数或包含鉴权信息');
  const body = { model: params.model, prompt, n: params.n, ...extra };
  if (isOpenAINovelAI(params.model) && params.negative.trim()) body.negative_prompt = params.negative.trim();
  if (size !== 'auto' || gpt) body.size = size;
  if (gpt) {
    body.quality = params.quality;
    body.output_format = params.outputFormat;
    if (params.background !== 'auto') body.background = params.background;
    body.moderation = params.moderation;
    if (params.outputFormat !== 'png') body.output_compression = params.compression;
  } else {
    if (params.quality !== 'auto') body.quality = params.quality;
    if (params.responseFormat !== 'auto') body.response_format = params.responseFormat;
  }
  return body;
}

export async function probeOpenAIModels(endpoint, key, { signal, fetcher = fetch } = {}) {
  const urls = openAIURLs(endpoint);
  const response = await fetcher(urls.models, {
    method: 'GET', headers: key.trim() ? { Authorization: `Bearer ${key.trim()}` } : {},
    signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
  });
  if (!response.ok) {
    const messages = { 401: '秘钥未通过鉴权', 403: '当前秘钥没有访问权限', 404: '接口未提供模型列表，可手动填写模型',
      429: '请求频率或额度受限，请稍后重试' };
    throw new Error(messages[response.status] || `接口返回 HTTP ${response.status}`);
  }
  const body = await response.json().catch(() => null);
  if (!Array.isArray(body?.data)) throw new Error('接口没有返回有效的模型列表');
  const models = [...new Set(body.data.filter((item) => typeof item?.id === 'string' && item.id.trim())
    .map((item) => item.id.trim()))];
  return { urls, models };
}

export function filterOpenAIModels(models, query = '') {
  const search = query.trim().toLocaleLowerCase();
  return models.filter((model) => model.toLocaleLowerCase().includes(search));
}

const field = (label, body) => `<label class="ui-field"><span>${label}</span>${body}</label>`;
const options = (items, value) => items.map(([id, title]) => `<option value="${esc(id)}" ${String(value) === String(id) ? 'selected' : ''}>${esc(title)}</option>`).join('');
const command = (name, title, action, extra = '') => `<button type="button" class="ui-button secondary" data-action="${action}" ${extra}>${icon(name)}<span>${title}</span></button>`;

export function renderOpenAIModelItems(models, current, query = '', fetched = false) {
  const filtered = filterOpenAIModels(models, query);
  return filtered.length ? filtered.map((model) => `<div class="openai-model-item ${model === current ? 'selected' : ''}">
    <button type="button" class="openai-model-name" data-action="openai-select-model" data-openai-model-id="${esc(model)}" aria-pressed="${model === current}" title="${esc(model)}"><span>${esc(model)}</span>${icon('check')}</button>
    <button type="button" class="ui-icon-button" data-action="openai-copy-model" data-openai-model-id="${esc(model)}" title="复制模型名：${esc(model)}" aria-label="复制模型名：${esc(model)}">${icon('copy')}</button>
  </div>`).join('') : `<p class="openai-model-empty">${query.trim() ? '没有匹配模型' : fetched ? '接口未返回可用模型' : '暂无模型'}</p>`;
}

function renderOpenAIModelPicker(current, models, ui) {
  const available = ui.fetched ? models : OPENAI_MODELS;
  const query = ui.query || '', filtered = filterOpenAIModels(available, query);
  return `<div class="ui-field openai-model-control"><label for="openai-model">模型</label>
    <div class="openai-model-row"><div class="input-with-button openai-model-input"><input id="openai-model" data-openai="model" spellcheck="false" value="${esc(current)}" autocomplete="off" /><button type="button" class="ui-icon-button" data-action="openai-toggle-models" title="${ui.open ? '收起模型列表' : '展开模型列表'}" aria-label="${ui.open ? '收起模型列表' : '展开模型列表'}" aria-expanded="${Boolean(ui.open)}" aria-controls="openai-model-panel">${icon('chevron-down')}</button></div>
      ${command('refresh-cw', '获取列表', 'openai-fetch-models', ui.loading ? 'disabled' : '')}<span class="openai-model-summary" data-openai-model-summary role="status">${ui.loading ? '获取中…' : ui.fetched ? `已获取 ${models.length} 个` : '尚未获取'}</span>
    </div>
    <section id="openai-model-panel" class="openai-model-panel" aria-label="模型列表" aria-busy="${Boolean(ui.loading)}" ${ui.open ? '' : 'hidden'}>
      <div class="openai-model-heading"><div><strong data-openai-model-title>${ui.fetched ? '可用模型' : '常用模型'}</strong><span class="openai-model-count" data-openai-model-count>${query.trim() ? `${filtered.length} / ${available.length}` : available.length} 个</span></div><label class="search-input openai-model-search">${icon('search')}<input type="search" data-openai-model-search aria-label="搜索模型" placeholder="输入模型名筛选" value="${esc(query)}" autocomplete="off" /></label></div>
      <div class="openai-model-grid" data-openai-model-grid>${renderOpenAIModelItems(available, current, query, ui.fetched)}</div>
    </section>
    <p class="openai-model-feedback" data-openai-model-feedback role="status" hidden></p>
  </div>`;
}

export function renderOpenAIParameters(state, models = [], advancedOpen = false, modelUI = {}) {
  const value = state.openai, gpt = usesGPTImage(value);
  const select = (key, label, choices, disabled = false) => field(label, `<select data-openai="${key}" ${disabled ? 'disabled' : ''}>${options(choices, value[key])}</select>`);
  const number = (key, label) => field(label, `<input type="number" data-openai="${key}" min="${LIMITS[key][0]}" max="${LIMITS[key][1]}" step="1" value="${value[key]}" />`);
  return `<section class="openai-parameters" aria-label="OpenAI兼容参数配置">
    <div class="field-heading"><h2>OpenAI兼容参数</h2><span class="nai-preset-state" data-openai-dirty></span></div>
    ${renderOpenAIModelPicker(value.model, models, modelUI)}
    ${field('风格／画师描述', `<textarea rows="2" data-openai="artist" maxlength="4000" spellcheck="false">${esc(value.artist)}</textarea>`)}
    ${field('生图提示词', `<textarea rows="4" class="openai-positive" data-openai="positive" maxlength="32000" spellcheck="false">${esc(value.positive)}</textarea>`)}
    <label class="ui-field" data-openai-negative-field ${isOpenAINovelAI(value.model) ? '' : 'hidden'}><span>负面提示词</span><textarea rows="3" data-openai="negative" maxlength="32000" spellcheck="false" ${isOpenAINovelAI(value.model) ? '' : 'disabled'}>${esc(value.negative)}</textarea></label>
    ${select('size', '尺寸', SIZES)}
    ${value.size === 'custom' ? `<div class="nai-dimensions">${number('width', '宽度 (px)')}<button type="button" class="ui-icon-button" data-action="openai-swap-size" title="交换宽高" aria-label="交换宽高">${icon('arrow-left-right')}</button>${number('height', '高度 (px)')}</div>` : ''}
    <div class="two-field-row">${number('n', '每次生成张数')}${select('quality', '图像质量', openAIQualityOptions(value))}</div>
    <details class="advanced-options openai-advanced" data-experience-fold="openai-parameters" ${advancedOpen || state.experience?.level === 'full' ? 'open' : ''}><summary>${icon('settings-2')}其他参数设置${icon('chevron-down')}</summary>
      <div class="two-field-row">
        ${select('parameterMode', '参数模式', [['auto', '按模型自动识别'], ['gpt', 'GPT Image'], ['basic', '通用图片接口']])}
        ${select('outputFormat', '图片格式', [['png', 'PNG'], ['jpeg', 'JPEG'], ['webp', 'WebP']], !gpt)}
        ${select('background', '背景', [['auto', '自动'], ['opaque', '不透明'], ['transparent', '透明']], !gpt)}
        ${field('压缩比例 (%)', `<input type="number" data-openai="compression" min="0" max="100" step="1" value="${value.compression}" ${!gpt || value.outputFormat === 'png' ? 'disabled' : ''} />`)}
        ${select('moderation', '内容审核', [['auto', '标准'], ['low', '较宽松']], !gpt)}
        ${select('responseFormat', '返回格式', [['auto', gpt ? 'Base64（模型默认）' : '服务默认'], ['url', '图片 URL'], ['b64_json', 'Base64']], gpt)}
      </div>
      ${field('第三方附加参数 (JSON)', `<textarea class="openai-json" rows="3" data-openai="extra" spellcheck="false" maxlength="16000" placeholder='{"seed": 12345}'>${esc(value.extra)}</textarea>`)}
    </details>
    <p class="openai-validation" role="status" data-openai-validation></p>
  </section>`;
}

export function renderOpenAIPresets(state, actions = '') {
  return `<div class="nai-presets">
      ${field('参数预设', `<select data-openai-preset>${options([['default', '默认配置'], ...state.openaiPresets.map((preset) => [preset.id, preset.name])], state.openaiPresetId)}</select>`)}
      <div class="nai-preset-actions">${command('folder-open', '载入预设', 'openai-load-preset')}${command('save', '保存预设', 'openai-save-preset')}${command('copy-plus', '另存为', 'openai-save-as')}${actions}<button type="button" class="ui-icon-button" data-action="openai-delete-preset" title="删除当前预设" aria-label="删除当前预设" ${state.openaiPresetId === 'default' ? 'disabled' : ''}>${icon('trash-2')}</button></div>
    </div>`;
}
