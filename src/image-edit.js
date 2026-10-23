import { normalizeSnapshot } from './ui/drawings.js';
import { buildAssistantMessages } from './prompt-assistant.js';
import { applyCharacterScene } from './character-profiles.js';

export function imageEditDraft(snapshot) {
  const draft = normalizeSnapshot(snapshot && { ...snapshot, partial: false });
  if (!draft) throw new Error('图片没有可编辑的生成参数，请先导入参数记录');
  delete draft.novelaiProcessing;
  const params = draft.params || draft.config.params;
  if (snapshot.partial && !Object.hasOwn(snapshot.params || {}, 'positive')) params.positive = '';
  if (draft.characterScene?.applied) {
    params.positive = draft.characterScene.basePositive;
    params.negative = draft.characterScene.baseNegative;
  }
  if (draft.provider === 'novelai') params.nSamples = 1;
  else if (draft.provider === 'openai') params.n = 1;
  else params.batch = 1;
  return draft;
}

export function prepareImageEdit(draft) {
  const result = normalizeSnapshot(draft);
  delete result.novelaiProcessing;
  const params = result.params || result.config.params;
  if (!params.positive.trim() && !(result.provider === 'sdwebui' && params.advanced?.mode === 'upscale')) throw new Error('请填写正向提示词');
  if (result.provider === 'comfyui' && !result.config.mapping.positive) throw new Error('原工作流没有映射正向提示词，请先在接口配置完善工作流');
  if (result.characterScene?.applied) {
    result.characterScene.basePositive = params.positive;
    result.characterScene.baseNegative = params.negative;
  }
  if (result.provider === 'novelai') params.nSamples = 1;
  else if (result.provider === 'openai') {
    params.n = 1;
    if (params.extra.trim()) {
      const extra = JSON.parse(params.extra);
      delete extra.n;
      params.extra = JSON.stringify(extra);
    }
  } else params.batch = 1;
  return applyCharacterScene(result, result.characterScene);
}

export function imageEditMessages(draft, instruction, settings) {
  if (!instruction.trim()) throw new Error('请填写希望修改的内容');
  const params = draft.params || draft.config.params;
  const messages = buildAssistantMessages({ settings, operation: 'polish', ruleTask: 'edit',
    input: JSON.stringify({ CHANGE_REQUEST: instruction, ORIGINAL_POSITIVE: params.positive,
      ORIGINAL_NEGATIVE: params.negative, ORIGINAL_CHARACTERS: draft.characterScene?.characterPrompts || [] }),
    context: { characterScene: draft.characterScene }, target: { provider: draft.provider, model: params.model } });
  return messages;
}

export function applyImageRewrite(draft, plan) {
  if (!plan.shouldDraw || !plan.positive.trim()) throw new Error('文字模型没有给出可用的修改提示词');
  const next = structuredClone(draft), params = next.params || next.config.params;
  params.positive = plan.positive; params.negative = plan.negative;
  if (next.characterScene?.applied) {
    next.characterScene.characterPrompts = next.characterScene.characterPrompts.map((role) => {
      const direction = plan.characters?.find((item) => item.profileId === role.id);
      const positive = direction && [direction.appearance, direction.outfit, direction.action, direction.expression].filter(Boolean).join(', ');
      return positive ? { ...role, positive, negative: direction.negative || '' } : role;
    });
  }
  return next;
}

export function drawingSeed(item) {
  const params = item.snapshot?.params || item.snapshot?.config?.params;
  if (Number.isSafeInteger(params?.seed) && params.seed >= 0) return params.seed;
  try {
    const seed = JSON.parse(params?.extra || '{}').seed;
    return Number.isSafeInteger(seed) && seed >= 0 ? seed : null;
  } catch { return null; }
}
