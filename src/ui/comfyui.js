import { randomUUID } from '../crypto-compat.js';
import { escapeHtml as esc } from '../config.js';
import { icon } from '../icons.js';
import { samples } from './sample-data.js';
import { applyPresetConnection, connectionDirty, presetConnection, savePresetBinding, resolvePresetConnection } from '../connections.js';
import { normalizeAdvanced } from '../advanced-generation.js';

export const COMFY_FIELDS = Object.freeze({
  positive: { label: '正向提示词', default: samples[0].prompt, type: 'text' },
  negative: { label: '负面提示词', default: 'low quality, blurry, watermark', type: 'text' },
  characterPrompts: { label: '角色提示词 JSON', default: '[]', type: 'text' },
  width: { label: '宽度 (px)', default: 1024, min: 16, max: 16384, step: 8 },
  height: { label: '高度 (px)', default: 1024, min: 16, max: 16384, step: 8 },
  steps: { label: '采样步数', default: 20, min: 1, max: 10000, step: 1 },
  cfg: { label: '提示词引导 (CFG)', default: 8, min: 0, max: 100, step: 0.1 },
  seed: { label: '随机种子', default: -1, min: -1, max: Number.MAX_SAFE_INTEGER, step: 1 },
  sampler: { label: '采样器', default: 'euler', type: 'choice' },
  scheduler: { label: '调度器', default: 'normal', type: 'choice' },
  denoise: { label: '重绘强度', default: 1, min: 0, max: 1, step: 0.01 },
  batch: { label: '每批图片数量', default: 1, min: 1, max: 4096, step: 1 },
  checkpoint: { label: 'Checkpoint 模型', default: '', type: 'choice' },
  vae: { label: '独立 VAE', default: '', type: 'choice' },
  lora: { label: 'LoRA 文件', default: '', type: 'choice' },
  loraModel: { label: 'LoRA 模型权重', default: 1, min: -100, max: 100, step: 0.01 },
  loraClip: { label: 'LoRA CLIP 权重', default: 1, min: -100, max: 100, step: 0.01 },
  image: { label: '输入图片文件', default: '', type: 'choice' },
  prefix: { label: '输出文件名前缀', default: 'Linghuashi', type: 'text' },
});
const MAX_WORKFLOW_BYTES = 512 * 1024;
const MAX_LIBRARY_BYTES = 1536 * 1024;
const FALLBACK_CHOICES = {
  sampler: ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_sde', 'ddim', 'heun'],
  scheduler: ['normal', 'karras', 'exponential', 'simple', 'sgm_uniform', 'ddim_uniform', 'beta'],
};
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isScalar = (value) => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
const clone = (value) => JSON.parse(JSON.stringify(value));
const bytes = (value) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
const token = (node, input) => JSON.stringify([node, input]);

export function parseWorkflow(text) {
  if (bytes(text) > MAX_WORKFLOW_BYTES) throw new Error('工作流文件需小于 512 KB');
  let value;
  try {
    value = JSON.parse(text, (key, item) => {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('工作流含有不支持的字段');
      if (typeof item === 'number' && (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item)))) {
        throw new Error('工作流含有过大的整数，请将种子设为 0 到 9007199254740991 后重新导出');
      }
      return item;
    });
  } catch (error) {
    throw new Error(error instanceof SyntaxError ? 'JSON 格式不正确，请检查文件内容' : error.message);
  }
  if (Array.isArray(value?.nodes)) throw new Error('这是画布格式，请在 ComfyUI 中使用“文件 → 导出 (API)”后重新导入');
  const graph = isRecord(value?.prompt) ? value.prompt : value;
  if (!isRecord(graph) || !Object.keys(graph).length || Object.keys(graph).length > 600) {
    throw new Error('需要包含 1 到 600 个节点的 API 格式工作流');
  }
  for (const [id, node] of Object.entries(graph)) {
    if (id.length > 120 || !isRecord(node) || typeof node.class_type !== 'string' || !node.class_type.trim() || !isRecord(node.inputs)) {
      throw new Error('工作流节点需要 class_type 和 inputs，请导入 API 格式 JSON');
    }
    for (const input of Object.values(node.inputs)) {
      if (Array.isArray(input) && input.length === 2 && typeof input[0] === 'string' && Number.isInteger(input[1])) {
        if (!Object.hasOwn(graph, input[0]) || input[1] < 0) throw new Error(`节点 ${id} 引用了不存在的节点或输出`);
      }
    }
  }
  return clone(graph);
}

export function defaultWorkflow() {
  return {
    '3': { class_type: 'KSampler', inputs: { model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0], seed: -1, steps: 20, cfg: 8, sampler_name: 'euler', scheduler: 'normal', denoise: 1 } },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: '' } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: COMFY_FIELDS.positive.default, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: COMFY_FIELDS.negative.default, clip: ['4', 1] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'Linghuashi' } },
  };
}

export function mappingCandidates(graph, key) {
  const field = COMFY_FIELDS[key];
  if (!field) return [];
  return Object.entries(graph).flatMap(([node, data]) => Object.entries(data.inputs)
    .filter(([, value]) => field.type ? typeof value === 'string' : typeof value === 'number' && Number.isFinite(value))
    .map(([input]) => ({ node, input, token: token(node, input), title: `#${node} ${data._meta?.title || data.class_type} · ${input}` })));
}

export function autoMapWorkflow(graph) {
  const mapping = {};
  const entries = Object.entries(graph);
  const samplers = entries.filter(([, node]) => ['KSampler', 'KSamplerAdvanced'].includes(node.class_type));
  // Multiple sampling branches need an explicit choice; do not overwrite an arbitrary branch.
  const sampler = samplers.length === 1 ? samplers[0] : null;
  const bind = (key, id, input) => {
    if (id && mappingCandidates(graph, key).some((item) => item.node === id && item.input === input)) mapping[key] = { node: id, input };
  };
  const uniqueInput = (key, classes, input) => {
    const found = entries.filter(([, node]) => classes.includes(node.class_type) && isScalar(node.inputs[input]));
    if (found.length === 1) bind(key, found[0][0], input);
  };
  if (sampler) {
    for (const [key, input] of Object.entries({ steps: 'steps', cfg: 'cfg', sampler: 'sampler_name', scheduler: 'scheduler', denoise: 'denoise' })) bind(key, sampler[0], input);
    bind('seed', sampler[0], sampler[1].class_type === 'KSamplerAdvanced' ? 'noise_seed' : 'seed');
    for (const key of ['positive', 'negative']) {
      const link = sampler[1].inputs[key];
      const encoder = Array.isArray(link) ? graph[link[0]] : null;
      if (encoder?.class_type === 'CLIPTextEncode') bind(key, link[0], 'text');
    }
    const latent = sampler[1].inputs.latent_image;
    const latentNode = Array.isArray(latent) ? graph[latent[0]] : null;
    if (['EmptyLatentImage', 'EmptySD3LatentImage'].includes(latentNode?.class_type)) {
      for (const [key, input] of Object.entries({ width: 'width', height: 'height', batch: 'batch_size' })) bind(key, latent[0], input);
    }
  }
  uniqueInput('checkpoint', ['CheckpointLoaderSimple', 'CheckpointLoader'], 'ckpt_name');
  uniqueInput('vae', ['VAELoader'], 'vae_name');
  uniqueInput('image', ['LoadImage'], 'image');
  uniqueInput('prefix', ['SaveImage'], 'filename_prefix');
  for (const [key, input] of Object.entries({ lora: 'lora_name', loraModel: 'strength_model', loraClip: 'strength_clip' })) {
    uniqueInput(key, ['LoraLoader', 'LoraLoaderModelOnly'], input);
  }
  return mapping;
}

export function normalizeMapping(graph, value = {}) {
  const mapping = {};
  const occupied = new Set();
  for (const key of Object.keys(COMFY_FIELDS)) {
    const item = value?.[key];
    const match = mappingCandidates(graph, key).find((candidate) => candidate.node === item?.node && candidate.input === item?.input);
    if (match && !occupied.has(match.token)) {
      mapping[key] = { node: match.node, input: match.input };
      occupied.add(match.token);
    }
  }
  return mapping;
}

export function normalizeComfyParams(value = {}) {
  const result = {};
  for (const [key, field] of Object.entries(COMFY_FIELDS)) {
    if (field.type) result[key] = typeof value[key] === 'string' ? value[key].slice(0,
      key === 'characterPrompts' ? 100000 : ['positive', 'negative'].includes(key) ? 12000 : 500) : field.default;
    else {
      const number = value[key] === '' || value[key] == null ? field.default : Number(value[key]);
      const bounded = Number.isFinite(number) ? Math.max(field.min, Math.min(field.max, number)) : field.default;
      result[key] = key === 'seed' ? Math.round(bounded) : Number((Math.round(bounded / field.step) * field.step).toFixed(2));
    }
  }
  return result;
}

export function paramsFromWorkflow(graph, mapping) {
  const value = {};
  for (const [key, item] of Object.entries(mapping)) value[key] = graph[item.node].inputs[item.input];
  return normalizeComfyParams(value);
}

export function newComfyConfig(graph = defaultWorkflow(), name = '基础文生图') {
  const mapping = autoMapWorkflow(graph);
  const outputs = Object.entries(graph).filter(([, node]) => ['SaveImage', 'PreviewImage'].includes(node.class_type));
  return { name: name.slice(0, 60), graph: clone(graph), mapping, params: paramsFromWorkflow(graph, mapping), advanced: normalizeAdvanced(), outputNode: outputs.length === 1 ? outputs[0][0] : '' };
}

function normalizeConfig(value) {
  const graph = parseWorkflow(JSON.stringify(value.graph));
  const mapping = normalizeMapping(graph, value.mapping);
  return {
    name: typeof value.name === 'string' ? value.name.slice(0, 60) : '工作流',
    graph, mapping, params: normalizeComfyParams(value.params),
    outputNode: Object.hasOwn(graph, value.outputNode) ? value.outputNode : '',
    advanced: normalizeAdvanced(value.advanced),
  };
}

export function normalizeComfyState(state) {
  try { state.comfyui = normalizeConfig(state.comfyui); } catch { state.comfyui = newComfyConfig(); }
  const ids = new Set(['default']);
  const names = new Set(['基础文生图']);
  state.comfyPresets = (Array.isArray(state.comfyPresets) ? state.comfyPresets : []).slice(0, 10).flatMap((preset) => {
    try {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(preset.id) || ids.has(preset.id) || typeof preset.name !== 'string') return [];
      const name = preset.name.trim().slice(0, 40);
      if (!name || names.has(name.toLocaleLowerCase())) return [];
      const config = normalizeConfig(preset.config);
      ids.add(preset.id); names.add(name.toLocaleLowerCase());
      return [{ id: preset.id, name, config, ...presetConnection('comfyui', preset) }];
    } catch { return []; }
  });
  if (!['default', ...state.comfyPresets.map((preset) => preset.id)].includes(state.comfyPresetId)) state.comfyPresetId = 'default';
  state.comfyTimeout = Math.max(5, Math.min(120, Math.round(Number(state.comfyTimeout) || 15)));
}

export function selectedComfyPreset(state) {
  return state.comfyPresets.find((item) => item.id === state.comfyPresetId) || { id: 'default', name: '基础文生图', config: newComfyConfig() };
}

export function comfyPresetDirty(state) {
  const comparable = (config) => [config.name, config.graph, Object.keys(COMFY_FIELDS).map((key) => [key, config.mapping[key]?.node, config.mapping[key]?.input]), normalizeComfyParams(config.params), config.outputNode, normalizeAdvanced(config.advanced)];
  return JSON.stringify(comparable(state.comfyui)) !== JSON.stringify(comparable(selectedComfyPreset(state).config))
    || connectionDirty(state, 'comfyui', selectedComfyPreset(state));
}

export function loadComfyPreset(state, id) {
  const preset = id === 'default' ? { id, config: newComfyConfig() } : state.comfyPresets.find((item) => item.id === id);
  if (!preset) throw new Error('找不到该工作流预设');
  resolvePresetConnection(state, 'comfyui', preset);
  state.comfyPresetId = id;
  state.comfyui = clone(preset.config);
  applyPresetConnection(state, 'comfyui', preset);
  return preset;
}

export function saveComfyPreset(state, name) {
  const config = normalizeConfig(state.comfyui);
  const presets = clone(state.comfyPresets);
  let id = state.comfyPresetId;
  if (name === undefined) {
    const preset = presets.find((item) => item.id === id);
    if (!preset) throw new Error('请将基础文生图另存为新预设');
    preset.config = config;
    savePresetBinding(state, 'comfyui', preset);
  } else {
    const title = name.trim();
    if (!title || title.length > 40) throw new Error('预设名称需为 1 至 40 个字符');
    if (title === '基础文生图' || presets.some((item) => item.name.toLocaleLowerCase() === title.toLocaleLowerCase())) throw new Error('已有同名预设');
    if (presets.length >= 10) throw new Error('最多保存 10 个工作流预设');
    id = randomUUID();
    presets.push(savePresetBinding(state, 'comfyui', { id, name: title, config }));
  }
  if (bytes(presets) + bytes(config) > MAX_LIBRARY_BYTES) throw new Error('工作流预设空间已满，请删除不需要的预设或导出备份');
  state.comfyPresets = presets;
  state.comfyPresetId = id;
  return state.comfyPresets.find((preset) => preset.id === id);
}

export function applyWorkflowParameters(config, randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]) {
  const graph = clone(config.graph);
  const mapping = normalizeMapping(graph, config.mapping);
  const params = normalizeComfyParams(config.params);
  for (const [key, item] of Object.entries(mapping)) {
    if (['checkpoint', 'vae', 'lora', 'image'].includes(key) && !params[key].trim()) throw new Error(`请填写${COMFY_FIELDS[key].label}`);
    graph[item.node].inputs[item.input] = key === 'seed' && params.seed === -1 ? randomSeed() : params[key];
  }
  return graph;
}

export function normalizeComfyEndpoint(value) {
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('请输入完整服务地址，例如 https://你的域名/comfyui'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('服务地址需为 HTTP 或 HTTPS，不包含账号、查询参数或片段');
  }
  return url.href.replace(/\/+$/, '');
}

export async function probeComfyUI(endpoint, key, options = {}) {
  const base = normalizeComfyEndpoint(endpoint);
  const headers = { Accept: 'application/json' };
  if (options.auth === 'bearer' && key.trim()) headers.Authorization = `Bearer ${key.trim()}`;
  if (options.auth === 'bearer' && !key.trim()) throw new Error('请填写访问令牌或选择无需认证');
  const get = async (route) => {
    const response = await fetch(`${base}/${route}`, { method: 'GET', headers, signal: options.signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store' });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? '访问被拒绝，请检查认证方式和令牌' : `服务返回 HTTP ${response.status}`);
    return response.json();
  };
  const stats = await get('system_stats');
  if (!isRecord(stats.system) || !Array.isArray(stats.devices)) throw new Error('地址未返回 ComfyUI 系统信息，请确认服务根地址');
  const result = { stats, base, objectInfo: null, queue: null, warnings: [] };
  for (const route of ['object_info', 'queue']) {
    try {
      const value = await get(route);
      if (!isRecord(value)) throw new Error('响应格式不正确');
      if (route === 'object_info') result.objectInfo = value;
      else if (Array.isArray(value.queue_running) && Array.isArray(value.queue_pending)) result.queue = value;
      else throw new Error('响应格式不正确');
    } catch (error) {
      if (options.signal?.aborted) throw error;
      result.warnings.push(route === 'object_info' ? '节点与模型列表未读取成功' : '队列状态未读取成功');
    }
  }
  return result;
}

export function nodeChoices(config, key, objectInfo) {
  const mapping = config.mapping[key];
  const node = mapping ? config.graph[mapping.node] : null;
  const schema = node ? objectInfo?.[node.class_type]?.input : null;
  const spec = schema?.required?.[mapping?.input] || schema?.optional?.[mapping?.input];
  const remote = Array.isArray(spec?.[0]) ? spec[0].filter((item) => typeof item === 'string') : [];
  const current = config.params[key];
  return [...new Set([...(current ? [current] : []), ...(remote.length ? remote : FALLBACK_CHOICES[key] || [])])];
}

function hasRemoteChoices(config, key, objectInfo) {
  const mapping = config.mapping[key];
  const node = mapping ? config.graph[mapping.node] : null;
  const schema = node ? objectInfo?.[node.class_type]?.input : null;
  const spec = schema?.required?.[mapping?.input] || schema?.optional?.[mapping?.input];
  return Array.isArray(spec?.[0]) && spec[0].some((item) => typeof item === 'string');
}

export function workflowWarnings(config, objectInfo) {
  if (!objectInfo) return [];
  const missing = [...new Set(Object.values(config.graph).filter((node) => !Object.hasOwn(objectInfo, node.class_type)).map((node) => node.class_type))];
  const warnings = missing.length ? [`服务缺少节点：${missing.join('、')}`] : [];
  for (const [key, mapping] of Object.entries(config.mapping)) {
    const node = config.graph[mapping.node];
    const schema = objectInfo[node.class_type]?.input;
    const spec = schema?.required?.[mapping.input] || schema?.optional?.[mapping.input];
    if (Array.isArray(spec?.[0]) && !spec[0].includes(config.params[key])) warnings.push(`${COMFY_FIELDS[key].label}不在服务可用列表中`);
  }
  return warnings;
}

const field = (title, body) => `<label class="ui-field"><span>${esc(title)}</span>${body}</label>`;
const command = (name, title, action, attrs = '') => `<button type="button" class="ui-button secondary" data-action="${action}" ${attrs}>${icon(name)}<span>${title}</span></button>`;
const options = (items, selected) => items.map(([id, title]) => `<option value="${esc(id)}" ${selected === id ? 'selected' : ''}>${esc(title)}</option>`).join('');

export function renderComfyWorkflow(state, probe, expanded = {}) {
  const value = state.comfyui;
  const warnings = workflowWarnings(value, probe?.objectInfo);
  return `<section class="comfy-workflow" aria-label="ComfyUI 工作流">
    <div class="field-heading"><h2>工作流</h2><span class="nai-preset-state" data-comfy-dirty>${comfyPresetDirty(state) ? '有未保存修改' : '已保存'}</span></div>
    <div class="comfy-workflow-summary">${icon('folder-open')}<div><strong>${esc(value.name)}</strong><span>${Object.keys(value.graph).length} 个节点 · 已映射 ${Object.keys(value.mapping).length} 项参数</span></div><span class="comfy-format">API JSON</span></div>
    <div class="comfy-toolbar">${command('upload', '导入工作流', 'workflow-import')}${command('arrow-down-to-line', '导出工作流', 'workflow-export')}</div>
    <p class="comfy-note">导入 ComfyUI 的“导出 (API)”JSON。基础文生图需选择服务上已有的 Checkpoint 模型。</p>
    <div class="comfy-warning" role="status" ${warnings.length ? '' : 'hidden'}>${warnings.map((item) => `<p>${esc(item)}</p>`).join('')}</div>
    ${renderComfyParameters(state, probe?.objectInfo, expanded.advanced)}
    ${renderComfyMapping(value, probe?.objectInfo, expanded.mapping || state.experience?.level === 'full' || !value.mapping.positive)}
  </section>`;
}

export function renderComfyPresets(state, actions = '') {
  return `<div class="nai-presets">
    ${field('工作流预设', `<select data-comfy-preset>${options([['default', '基础文生图'], ...state.comfyPresets.map((preset) => [preset.id, preset.name])], state.comfyPresetId)}</select>`)}
    <div class="nai-preset-actions">${command('folder-open', '载入预设', 'comfy-load-preset')}${command('save', '保存预设', 'comfy-save-preset')}${command('copy-plus', '另存为', 'comfy-save-as')}${actions}<button type="button" class="ui-icon-button" data-action="comfy-delete-preset" title="删除工作流预设" aria-label="删除工作流预设" ${state.comfyPresetId === 'default' ? 'disabled' : ''}>${icon('trash-2')}</button></div>
  </div>`;
}

export function renderComfyParameters(state, objectInfo, advancedOpen = false) {
  const config = state.comfyui;
  const input = (key) => {
    const meta = COMFY_FIELDS[key];
    const disabled = !config.mapping[key];
    let body;
    if (key === 'positive' || key === 'negative') body = `<textarea rows="${key === 'positive' ? 3 : 2}" data-comfy="${key}" maxlength="12000" spellcheck="false" ${disabled ? 'disabled' : ''}>${esc(config.params[key])}</textarea>`;
    else if (!meta.type) body = `<input type="number" data-comfy="${key}" min="${meta.min}" max="${meta.max}" step="${meta.step}" value="${config.params[key]}" ${disabled ? 'disabled' : ''} />`;
    else if (meta.type === 'choice') {
      const choices = nodeChoices(config, key, objectInfo);
      const manual = !hasRemoteChoices(config, key, objectInfo);
      body = manual ? `<input data-comfy="${key}" value="${esc(config.params[key])}" maxlength="500" ${disabled ? 'disabled' : ''} ${FALLBACK_CHOICES[key] ? `list="comfy-${key}-list"` : ''} />${FALLBACK_CHOICES[key] ? `<datalist id="comfy-${key}-list">${choices.map((item) => `<option value="${esc(item)}"></option>`).join('')}</datalist>` : ''}`
        : `<select data-comfy="${key}" ${disabled ? 'disabled' : ''}>${options([...(config.params[key] ? [] : [['', '请选择']]), ...choices.map((item) => [item, item])], config.params[key])}</select>`;
    } else body = `<input data-comfy="${key}" value="${esc(config.params[key])}" maxlength="500" ${disabled ? 'disabled' : ''} />`;
    if (key === 'seed') body = `<div class="input-with-button">${body}<button type="button" class="ui-icon-button" data-action="comfy-random-seed" title="生成随机种子" aria-label="生成随机种子" ${disabled ? 'disabled' : ''}>${icon('refresh-cw')}</button></div>`;
    return field(`${meta.label}${disabled ? ' · 未映射' : ''}`, body);
  };
  return `<div class="comfy-parameters"><div class="field-heading"><h2>基础参数</h2></div>
    ${input('positive')}${input('negative')}
    <div class="two-field-row">${input('width')}${input('height')}</div>
    <div class="two-field-row">${input('steps')}${input('cfg')}</div>
    <div class="two-field-row">${input('sampler')}${input('scheduler')}</div>
    ${input('seed')}<p class="comfy-note">种子 -1 表示每次随机；参数只应用到已映射的节点。</p>
    <details class="advanced-options comfy-advanced" data-experience-fold="comfy-parameters" ${advancedOpen || state.experience?.level === 'full' ? 'open' : ''}><summary>${icon('sliders-horizontal')}其他参数设置${icon('chevron-down')}</summary>
      <div class="two-field-row">${input('denoise')}${input('batch')}</div>
      <p class="comfy-note">重绘强度通常文生图为 1，图生图使用较低数值。批量数量会增加显存占用。</p>
      ${input('checkpoint')}${input('vae')}${input('lora')}
      <div class="two-field-row">${input('loraModel')}${input('loraClip')}</div>
      ${input('image')}${input('prefix')}
      <p class="comfy-note">VAE、LoRA 和输入图片需在工作流中已有相应节点。输入图片填写 ComfyUI input 目录中的文件名。</p>
    </details></div>`;
}

export function renderComfyMapping(config, objectInfo, mappingOpen = false) {
  const outputCandidates = Object.entries(config.graph).filter(([, node]) => ['SaveImage', 'PreviewImage'].includes(node.class_type) || objectInfo?.[node.class_type]?.output_node);
  const outputs = outputCandidates.length ? outputCandidates : Object.entries(config.graph);
  return `<details class="advanced-options comfy-mapping" data-experience-fold="comfy-mapping" ${!config.mapping.positive ? 'data-experience-active' : ''} ${mappingOpen ? 'open' : ''}><summary>${icon('settings-2')}节点映射${icon('chevron-down')}</summary>
    <div class="comfy-mapping-heading"><p class="comfy-note">同一输入只能对应一项参数；多采样分支请手动指定。</p>${command('refresh-cw', '自动识别', 'comfy-auto-map')}</div>
    <div class="comfy-mapping-grid">${Object.entries(COMFY_FIELDS).map(([key, meta]) => field(meta.label, `<div class="input-with-button"><select data-comfy-map="${key}">${options([['', '保留工作流原值'], ...mappingCandidates(config.graph, key).map((item) => [item.token, item.title])], config.mapping[key] ? token(config.mapping[key].node, config.mapping[key].input) : '')}</select><button type="button" class="ui-icon-button" data-action="comfy-locate-node" data-mapping-key="${key}" title="定位工作流节点" aria-label="定位 ${meta.label} 节点" ${config.mapping[key] ? '' : 'disabled'}>${icon('locate-fixed')}</button></div>`)).join('')}</div>
    ${field('结果输出节点', `<select data-comfy-output>${options([['', '所有图片输出'], ...outputs.map(([id, node]) => [id, `#${id} ${node._meta?.title || node.class_type}`])], config.outputNode)}</select>`)}
  </details>`;
}

export function renderComfyConnectionOptions(state, credentials, open = false, keyVisible = false) {
  return `<details class="advanced-options comfy-auth" data-experience-fold="comfy-auth" ${open || state.experience?.level === 'full' || credentials.auth === 'bearer' ? 'open' : ''}><summary>${icon('link')}访问认证与连接选项${icon('chevron-down')}</summary>
    <div class="two-field-row">${field('认证方式', `<select data-comfy-auth>${options([['none', '无需认证'], ['bearer', 'Bearer 令牌']], credentials.auth || 'none')}</select>`)}
    ${field('连接超时 (秒)', `<input type="number" data-comfy-timeout min="5" max="120" step="1" value="${state.comfyTimeout}" />`)}</div>
    ${credentials.auth === 'bearer' ? field('访问令牌', `<div class="input-with-button credential-input"><input type="${keyVisible ? 'text' : 'password'}" data-transient="key" autocomplete="off" spellcheck="false" maxlength="4096" value="${esc(credentials.key)}" placeholder="反向代理要求的 Bearer 令牌" /><button type="button" class="ui-icon-button" data-action="toggle-key" title="${keyVisible ? '隐藏秘钥' : '显示秘钥'}" aria-label="${keyVisible ? '隐藏秘钥' : '显示秘钥'}" aria-pressed="${keyVisible}">${icon(keyVisible ? 'eye-off' : 'eye')}</button></div>`) : ''}
    <p class="comfy-note">自行部署的 ComfyUI 通常无需 Key；访问令牌用于带认证的反向代理。此处配置自建服务，不是 Comfy Cloud。</p>
  </details>`;
}

export function renderComfyService(probe) {
  if (!probe) return '';
  const device = probe.stats.devices[0];
  const memory = device?.vram_total ? ` · ${(device.vram_total / 1073741824).toFixed(1)} GB 显存` : '';
  return `<div class="comfy-service" role="status"><span>${esc(device?.name || 'ComfyUI 服务')}${memory}</span><span>${probe.queue ? `运行 ${probe.queue.queue_running.length} · 排队 ${probe.queue.queue_pending.length}` : '队列状态未读取'}</span>${probe.warnings.map((item) => `<small>${esc(item)}</small>`).join('')}</div>`;
}
