import { apiError } from '../extension-api.js';
import { normalizeConnection, resolvePresetConnection } from '../connections.js';
import { normalizeAdvanced, advancedOf, modelCapabilities } from '../advanced-generation.js';
import { NOVELAI_DEFAULTS, normalizeNovelAI, loadNovelAIPreset } from './novelai.js';
import { OPENAI_DEFAULTS, normalizeOpenAI, loadOpenAIPreset } from './openai.js';
import { COMFY_FIELDS, normalizeComfyParams, loadComfyPreset, newComfyConfig } from './comfyui.js';
import { captureSnapshot } from './drawings.js';
import { SDWEBUI_DEFAULTS, normalizeSDWebUI } from '../sdwebui.js';
import { loadSDWebUIPreset } from './sdwebui.js';

const providers = ['novelai', 'openai', 'comfyui', 'sdwebui'];
const libraries = { novelai: 'novelaiPresets', openai: 'openaiPresets', comfyui: 'comfyPresets', sdwebui: 'sdwebuiPresets' };
const loaders = { novelai: loadNovelAIPreset, openai: loadOpenAIPreset, comfyui: loadComfyPreset, sdwebui: loadSDWebUIPreset };
const definitions = { novelai: NOVELAI_DEFAULTS, openai: OPENAI_DEFAULTS, comfyui: COMFY_FIELDS, sdwebui: SDWEBUI_DEFAULTS };
export function extensionPresets(state, provider = state.provider) {
  if (!providers.includes(provider)) throw apiError('INVALID_OPTIONS', '未知生图模式');
  const describe = (id, name, params) => ({ id, name, provider, model: params.model || params.checkpoint || '' });
  return [describe('current', '当前参数', state[provider]?.params || state[provider]),
    describe('default', provider === 'comfyui' ? '基础文生图' : '默认配置', provider === 'comfyui' ? newComfyConfig().params : definitions[provider]),
    ...(state[libraries[provider]] || []).map((row) => describe(row.id, row.name, row.params || row.config.params))];
}
export function prepareExtensionSnapshot(state, options) {
  const draft = structuredClone(state), provider = options.provider || draft.provider;
  draft.provider = provider;
  let preset;
  if (options.presetId && options.presetId !== 'current') preset = loaders[provider](draft, options.presetId);
  const connection = resolvePresetConnection(state, provider, preset) || normalizeConnection(provider, state.connections[provider]);
  const snapshot = captureSnapshot(draft);
  delete snapshot.extensionRequest;
  delete snapshot.novelaiProcessing;
  if (!options.useCharacterProfiles) delete snapshot.characterScene;
  const params = snapshot.params || snapshot.config.params;
  if (snapshot.characterScene?.applied) {
    params.positive = snapshot.characterScene.basePositive;
    params.negative = snapshot.characterScene.baseNegative;
    delete snapshot.characterScene.applied;
  }
  const overrides = options.params || {};
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(definitions[provider], key) || ['advanced', 'positive', 'negative', 'artist', 'extra', 'image', 'characterPrompts'].includes(key)) {
      throw apiError('INVALID_OPTIONS', `当前模式不支持临时参数 ${key}`);
    }
    if (provider === 'comfyui' && !snapshot.config.mapping[key]) throw apiError('INVALID_OPTIONS', `工作流未映射参数 ${key}`);
    const expected = provider === 'comfyui' ? COMFY_FIELDS[key].type ? 'string' : 'number' : typeof definitions[provider][key];
    if (typeof value !== expected) throw apiError('INVALID_OPTIONS', `${key} 的值类型无效`);
  }
  Object.assign(params, overrides);
  params.positive = options.prompt;
  if (options.negativePrompt !== undefined) params.negative = options.negativePrompt;
  if (options.artist !== undefined) {
    if (provider === 'comfyui') throw apiError('INVALID_OPTIONS', 'ComfyUI 请将画师词写入正向提示词');
    params.artist = options.artist;
  }
  if (provider === 'openai' && ('width' in overrides || 'height' in overrides) && !('size' in overrides)) params.size = 'custom';
  const normalized = provider === 'novelai' ? normalizeNovelAI(params)
    : provider === 'openai' ? normalizeOpenAI(params) : provider === 'sdwebui' ? normalizeSDWebUI(params) : normalizeComfyParams(params);
  for (const key of ['positive', 'negative', 'artist', ...Object.keys(overrides)]) {
    if (params[key] !== normalized[key]) throw apiError('INVALID_OPTIONS', `${key} 超出当前模式范围或与其他参数不兼容`);
  }
  Object.assign(params, normalized);
  if (provider === 'comfyui' && (!snapshot.config.mapping.positive
    || options.negativePrompt !== undefined && !snapshot.config.mapping.negative)) {
    throw apiError('INVALID_OPTIONS', '工作流尚未映射对应的提示词节点');
  }
  if (provider === 'comfyui' && params.batch > 32) throw apiError('INVALID_OPTIONS', '扩展调用每批最多生成 32 张图片');
  if (!options.useAdvanced) {
    if (provider === 'comfyui' && (advancedOf(snapshot).mode !== 'text' || snapshot.config.mapping.image)) {
      throw apiError('INVALID_OPTIONS', '当前工作流包含图片输入，请显式使用 useAdvanced 或选择文生图预设');
    }
    if (provider === 'comfyui') snapshot.config.advanced = normalizeAdvanced();
    else params.advanced = normalizeAdvanced();
  }
  return { snapshot, connection, useCurrentConnection: !preset || !resolvePresetConnection(state, provider, preset) };
}
export function extensionCapabilities(state, credentials) {
  return { apiVersion: 1, enabled: state.enabled !== false, externalAPI: state.externalAPI !== false,
    currentProvider: state.provider, storageLocation: state.cacheLocation, maxActiveTasks: 32,
    chatTarget: true, idempotentRequests: true, providers: providers.map((provider) => {
      const params = state[provider]?.params || state[provider] || definitions[provider], snapshot = provider === 'comfyui'
        ? { provider, config: state.comfyui } : { provider, params };
      const advanced = advancedOf(snapshot), capabilities = modelCapabilities(provider, params.model, advanced);
      if (provider === 'comfyui') {
        capabilities.image &&= Boolean(state.comfyui.mapping.image);
        capabilities.inpaint &&= capabilities.image && Object.values(state.comfyui.graph).some((node) =>
          node.class_type === 'VAEEncodeForInpaint' || Object.values(node.inputs).some((input) =>
            Array.isArray(input) && input[1] === 1 && state.comfyui.graph[input[0]]?.class_type === 'LoadImage'));
      }
      return { id: provider, model: params.model || params.checkpoint || '', configured: provider === 'comfyui'
        ? Boolean(credentials.comfyui.endpoint && (credentials.comfyui.auth !== 'bearer' || credentials.comfyui.key))
        : provider === 'sdwebui' ? Boolean(credentials.sdwebui?.endpoint && (credentials.sdwebui.auth === 'none' || credentials.sdwebui.key))
        : Boolean(credentials[provider]?.key), text: true, configuredAdvancedMode: advanced.mode, ...capabilities };
    }) };
}
export function publicImageParameters(snapshot) {
  const params = snapshot.params || snapshot.config.params;
  let seed = params.seed;
  if (snapshot.provider === 'openai') {
    try {
      const candidate = JSON.parse(params.extra || '{}').seed;
      if (Number.isSafeInteger(candidate) && candidate >= 0) seed = candidate;
    } catch { /* Optional server-reported seed metadata. */ }
  }
  return { prompt: params.positive, negativePrompt: params.negative || '', artist: params.artist || '',
    model: params.model || params.checkpoint || snapshot.config?.name || '',
    width: params.width, height: params.height, size: params.size,
    steps: params.steps, seed, cfgScale: params.scale ?? params.cfg,
    count: params.nSamples ?? params.n ?? params.batch ?? 1 };
}
