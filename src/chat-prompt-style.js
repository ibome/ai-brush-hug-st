export const chatPromptText = ({ prefix, scene }) => [prefix, scene].filter(Boolean).join(', ');

export function createChatPromptStyle(prefix, scene, samplePrompt = '') {
  prefix = String(prefix || '').trim();
  scene = String(scene || '').trim();
  if (prefix === samplePrompt.trim()) prefix = '';
  const value = { version: 1, prefix, scene };
  if (chatPromptText(value).length > 32000) throw new Error('合并后的提示词超过 32000 字符');
  return value;
}

export function normalizeChatPromptStyle(value, positive) {
  if (value?.version !== 1 || typeof value.prefix !== 'string' || typeof value.scene !== 'string'
    || !value.scene.trim() || chatPromptText(value).length > 32000) return null;
  const style = createChatPromptStyle(value.prefix, value.scene);
  return typeof positive === 'string' && chatPromptText(style) === positive.trim() ? style : null;
}

export function inferChatPromptStyle(positive, sourcePrompt, samplePrompt = '') {
  const full = String(positive || '').trim(), scene = String(sourcePrompt || '').trim();
  if (!scene) return null;
  if (full === scene) return createChatPromptStyle('', scene);
  // Legacy chat images stored the preset prefix followed by the exact tagged scene.
  const suffix = `, ${scene}`;
  return full.endsWith(suffix) ? createChatPromptStyle(full.slice(0, -suffix.length), scene, samplePrompt) : null;
}
