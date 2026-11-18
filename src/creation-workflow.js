import { applyCharacterScene, effectiveOutfit } from './character-profiles.js';
import { validateAdvanced, ADVANCED_MODES } from './advanced-generation.js';
import { isNovelAIV5, novelAIImageModel } from './novelai-models.js';
import { prepareMultiCharacterPrompt } from './multi-character-prompt.js';
import { characterLimit, independentCharacters, characterLayoutWarnings } from './character-layout.js';

export const CREATION_MODES = Object.freeze([
  ['generate', '标签生图', 'braces'],
  ['assistant', 'AI 构思', 'sparkles'],
  ['comic', '漫画分镜', 'panels-top-left'],
]);

export const creationRevision = (snapshot) => JSON.stringify(snapshot);

export function previewCreation(snapshot, { preset, origin, pendingOutfits = [], profiles } = {}) {
  const initial = snapshot.params || snapshot.config.params;
  const prepared = prepareMultiCharacterPrompt(snapshot, initial.positive, {
    profiles: profiles || snapshot.characterScene?.entries.map((entry) => entry.profile) || [],
  }) || applyCharacterScene(snapshot, snapshot.characterScene);
  const advanced = validateAdvanced(prepared);
  const params = prepared.params || prepared.config.params;
  const limit = characterLimit(prepared.provider, params.model);
  if (prepared.characterScene?.entries.length > limit) throw new Error(`当前模型最多支持 ${limit} 个角色，请减少出场人数`);
  const positive = [params.artist, params.positive].map((text) => String(text || '').trim()).filter(Boolean).join(', ');
  if (!positive) throw new Error('请先填写正向提示词或画师串');
  const selectedModel = params.model || params.checkpoint || '当前工作流模型';
  const model = prepared.provider === 'novelai' && advanced.mode === 'inpaint'
    ? novelAIImageModel(selectedModel) : selectedModel;
  const base = snapshot.params || snapshot.config.params;
  const source = (key, value) => {
    if (origin?.params && value === origin.params[key]) return origin.label;
    if (preset?.params && value === (preset.params[key] || '')) return `与预设「${preset.name}」相同`;
    return preset ? `当前编辑值 · 与预设「${preset.name}」不同` : '当前生图参数';
  };
  const scene = prepared.characterScene;
  const basePositive = scene?.applied ? scene.basePositive : base.positive || '';
  const baseNegative = scene?.applied ? scene.baseNegative : base.negative || '';
  return {
    model, selectedModel,
    transparent: prepared.provider === 'novelai' && isNovelAIV5(model) && params.transparent === true,
    transparencyUnavailable: prepared.provider === 'novelai' && params.transparent === true && !isNovelAIV5(model),
    mode: ADVANCED_MODES.find(([id]) => id === advanced.mode)?.[1] || '文生图',
    width: params.width, height: params.height, count: params.nSamples || 1,
    positive, negative: params.negative || '',
    pendingOutfits,
    characterTransport: independentCharacters(prepared.provider, params.model, params.characterMode) ? '独立角色参数'
      : prepared.provider === 'comfyui' && prepared.config.mapping.characterPrompts ? '角色 JSON 节点与合并描述' : '合并描述',
    characterWarnings: [
      ...(scene?.warnings || []),
      ...characterLayoutWarnings(scene, independentCharacters(prepared.provider, params.model, params.characterMode)),
    ],
    components: [
      { label: '画师串 / 风格', source: source('artist', base.artist || ''), text: base.artist || '' },
      { label: '场景正向词', source: source('positive', basePositive), text: basePositive },
      { label: '基础负面词', source: source('negative', baseNegative), text: baseNegative },
    ],
    roles: (scene?.entries || []).map((entry) => {
      const direction = scene.directions?.find((row) => row.profileId === entry.profileId), outfit = effectiveOutfit(entry);
      return {
        name: entry.profile.name, source: { once: '仅下一次生图', chat: '当前聊天', project: '漫画项目', global: '全局默认' }[entry.outfitScope]
          || (scene.chatKey ? '当前聊天角色档案' : '全局角色档案'),
        outfit: (!outfit.locked && direction?.outfit || outfit.prompt) || '由剧情 / AI 决定',
        appearance: !entry.profile.lockAppearance && direction?.appearance
          || [entry.profile.tags, entry.profile.hair, entry.profile.eyes, entry.profile.body, entry.profile.features].filter(Boolean).join(', '),
        action: [entry.action || direction?.action, entry.expression || direction?.expression].filter(Boolean).join(', '),
      };
    }),
    characters: prepared.characterScene?.characterPrompts || [],
  };
}
