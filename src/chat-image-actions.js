import { nativeCharacterPrompts } from './character-profiles.js';
import { canRecoverGeneration } from './generation-recovery.js';

export function chatImageTaskBusy(task) {
  return ['queued', 'preparing', 'confirming', 'running', 'paused'].includes(task?.status)
    || task?.status === 'failed' && canRecoverGeneration(task);
}

export function chatImageBelongsTo(row, binding) {
  return Boolean(row?.chatBinding && binding
    && ['id', 'chatKey', 'branch', 'swipe', 'slot'].every((key) => row.chatBinding[key] === binding[key]));
}

export function chatImagePrompt(row) {
  const snapshot = row?.snapshot, params = snapshot?.params || snapshot?.config?.params || {};
  return {
    positive: snapshot?.characterScene?.applied ? snapshot.characterScene.basePositive || '' : params.positive || '',
    negative: snapshot?.characterScene?.applied ? snapshot.characterScene.baseNegative || '' : params.negative || '',
  };
}

export function chatImagePromptText(row) {
  const snapshot = row?.snapshot, params = snapshot?.params || snapshot?.config?.params || {};
  const sections = [
    params.artist ? `画师串：\n${params.artist}` : '',
    params.positive ? `正向提示词：\n${params.positive}` : '',
    params.negative ? `负面提示词：\n${params.negative}` : '',
  ];
  if (nativeCharacterPrompts(snapshot?.provider, params.model) && snapshot?.characterScene?.applied) {
    for (const [index, role] of (snapshot.characterScene.characterPrompts || []).entries()) {
      sections.push(`角色 ${index + 1}${role.name ? `（${role.name}）` : ''}：\n${role.positive || ''}`
        + (role.negative ? `\n负面提示词：${role.negative}` : ''));
    }
  }
  return sections.filter(Boolean).join('\n\n');
}

export function applyChatImageStyle(draft, current, samplePrompt = '') {
  if (draft.provider !== current?.provider) throw new Error('画风配置与原图的生图模式不一致');
  const next = structuredClone(draft);
  const params = next.params || next.config?.params;
  const style = current.params || current.config?.params;
  if (!params || !style) throw new Error('图片没有可用的生成参数');
  for (const key of ['artist', 'negative']) {
    if (typeof style[key] === 'string') params[key] = style[key];
  }
  const examplePrefix = samplePrompt.trim() && `${samplePrompt.trim()}, `;
  if (examplePrefix && params.positive?.startsWith(examplePrefix)) {
    const scene = params.positive.slice(examplePrefix.length).trim();
    if (scene) params.positive = scene;
  }
  return next;
}

export function applyChatImageEdit(draft, edits, randomize = false, seed = () => crypto.getRandomValues(new Uint32Array(1))[0]) {
  const next = structuredClone(draft), params = next.params || next.config?.params;
  if (!params) throw new Error('图片没有可用的生成参数');
  if (edits !== undefined) {
    if (!edits || ['positive', 'negative'].some((key) => typeof edits[key] !== 'string' || edits[key].length > 32000)
      || !edits.positive.trim()) throw new Error('请填写正向提示词，单栏最多 32000 字符');
    params.positive = edits.positive.trim(); params.negative = edits.negative.trim();
  }
  if (randomize) {
    const fresh = (previous) => {
      const value = seed();
      return value === previous ? (value + 1) % 4294967296 : value;
    };
    if (next.provider === 'openai') {
      const extra = JSON.parse(params.extra || '{}');
      if (Object.hasOwn(extra, 'seed')) extra.seed = fresh(extra.seed);
      params.extra = JSON.stringify(extra);
    } else {
      if (next.provider === 'comfyui' && !next.config.mapping?.seed) throw new Error('工作流没有映射随机种子，请先在接口配置补齐');
      params.seed = fresh(params.seed);
    }
  }
  return next;
}
