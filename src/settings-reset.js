import { SETTINGS_DEFAULTS } from './ui/settings.js';
import { normalizeNovelAI } from './ui/novelai.js';
import { normalizeOpenAI } from './ui/openai.js';
import { normalizeComfyParams } from './ui/comfyui.js';
import { normalizeSDWebUI } from './sdwebui.js';
import { normalizeAdvanced } from './advanced-generation.js';
import { normalizeAssistant } from './prompt-assistant.js';

export const RESET_SCOPES = Object.freeze([
  { id: 'general', title: '常规设置', detail: '恢复自动生图、聊天展示、触发格式、任务调度与清理开关。', checked: true },
  { id: 'generation', title: '当前生图参数', detail: '恢复当前模式的画师串、提示词、尺寸与采样参数，退出参考生图等高级模式。', checked: true },
  { id: 'assistant', title: '提示词助手设置与底层提示词', detail: '恢复助手规则、前置词、插入模板与自动配图设置；清除未保存的规则草稿。', checked: false },
]);

const retainedSettings = new Set(['provider', 'characterTheme', 'cacheLocation', 'cacheDirectory']);
const assistantConnectionKeys = [
  'source', 'apiTransport', 'endpoint', 'model', 'tavernModel', 'keyRef', 'apiLink', 'timeout',
  'compatibilityProfiles', 'outputParameter', 'omitTemperature', 'contextWindow', 'outputLimit',
  'responseMode', 'responseModeOverride',
];

// Only changed settings enter the patch; credentials, libraries and records never do.
export function settingsResetPatch(state, scopes) {
  if (!Array.isArray(scopes) || !scopes.length
    || scopes.some((id) => !RESET_SCOPES.some((scope) => scope.id === id))) {
    throw new Error('请至少选择一项有效的重置范围');
  }
  const patch = {};
  if (scopes.includes('general')) {
    for (const [key, value] of Object.entries(SETTINGS_DEFAULTS)) {
      if (!retainedSettings.has(key)) patch[key] = value;
    }
  }
  if (scopes.includes('generation')) {
    const provider = state.provider;
    if (provider === 'novelai') patch.novelai = normalizeNovelAI({ model: state.novelai?.model });
    else if (provider === 'openai') {
      const params = state.openai || {};
      patch.openai = normalizeOpenAI({ model: params.model, parameterMode: params.parameterMode,
        extra: params.extra, responseFormat: params.responseFormat,
        advanced: { openAIEditEnabled: params.advanced?.openAIEditEnabled, editPath: params.advanced?.editPath } });
    } else if (provider === 'sdwebui') {
      patch.sdwebui = normalizeSDWebUI({ model: state.sdwebui?.model, vae: state.sdwebui?.vae });
    } else if (provider === 'comfyui' && state.comfyui?.graph) {
      const config = structuredClone(state.comfyui);
      config.params = normalizeComfyParams({ checkpoint: config.params.checkpoint, vae: config.params.vae });
      config.advanced = normalizeAdvanced();
      patch.comfyui = config;
    } else throw new Error('当前生图模式无效，请先选择生图模式');
    patch[{ novelai: 'novelaiPresetId', openai: 'openaiPresetId',
      comfyui: 'comfyPresetId', sdwebui: 'sdwebuiPresetId' }[provider]] = 'default';
    patch.presetBindings = { ...state.presetBindings, [provider]: '' };
    if (!state.characterSceneOverrideProvider || state.characterSceneOverrideProvider === provider) {
      patch.characterSceneOverride = null;
      patch.characterSceneOverrideProvider = '';
    }
  }
  if (scopes.includes('assistant')) {
    const connection = Object.fromEntries(assistantConnectionKeys.filter((key) => Object.hasOwn(state.assistant || {}, key))
      .map((key) => [key, structuredClone(state.assistant[key])]));
    patch.assistant = normalizeAssistant(connection);
    patch.assistantSchemeId = '';
  }
  return patch;
}
