import { sha256Hex } from './crypto-compat.js';

export const CHAT_SLOT_LIMIT = 16;
export const CHAT_PENDING = new Set(['preparing', 'confirming', 'queued', 'running']);
export const CHAT_DEFAULTS = Object.freeze({ auto: true, confirm: false, inline: true });

export function parseImageTags(text, prefix = 'image###', suffix = '###') {
  if (typeof text !== 'string' || !prefix || !suffix || text.length > 1000000) return [];
  const ignored = [...text.matchAll(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`/g)]
    .map((match) => [match.index, match.index + match[0].length]);
  const slots = [];
  let cursor = 0;
  while (slots.length < CHAT_SLOT_LIMIT) {
    const start = text.indexOf(prefix, cursor);
    if (start < 0) break;
    const code = ignored.find(([left, right]) => start >= left && start < right);
    if (code) { cursor = code[1]; continue; }
    const end = text.indexOf(suffix, start + prefix.length);
    if (end < 0) break;
    const nested = text.indexOf(prefix, start + prefix.length);
    if (nested >= 0 && nested < end) { cursor = nested; continue; }
    const prompt = text.slice(start + prefix.length, end).trim();
    cursor = end + suffix.length;
    if (!prompt || prompt.length > 32000) continue;
    slots.push({ index: slots.length, prompt, start, end: cursor });
  }
  return slots;
}

export function chatIdentity(context) {
  const chatId = context?.getCurrentChatId?.() ?? context?.chatId;
  const owner = context?.groupId
    ? ['group', String(context.groupId)]
    : ['character', context?.characters?.[context.characterId]?.avatar || String(context?.characterId ?? '')];
  return chatId ? JSON.stringify([...owner, String(chatId)]) : '';
}

export function eligibleMessage(message) {
  return message && !message.is_user && !message.is_system && typeof message.mes === 'string';
}

export async function digest(value) {
  return sha256Hex(new TextEncoder().encode(value));
}

export async function bindImageSlots(context, message, prefix, suffix) {
  const chatKey = chatIdentity(context);
  if (!chatKey || !eligibleMessage(message)) return [];
  const text = message.mes;
  const swipe = Number.isSafeInteger(message.swipe_id) ? message.swipe_id : 0;
  const prompts = parseImageTags(text, prefix, suffix);
  if (!prompts.length) return [];
  const branch = await digest(text);
  // Date and speaker survive message deletion/reordering; index is only a fallback.
  const identity = message.send_date
    ? [String(message.send_date), String(message.name || '')]
    : ['undated', context.chat.indexOf(message), String(message.name || '')];
  return Promise.all(prompts.map(async (slot) => ({
    ...slot,
    binding: {
      id: await digest(JSON.stringify([chatKey, identity, swipe, branch, slot.index, slot.prompt])),
      chatKey, branch, swipe, slot: slot.index,
      characterName: String(context.name2 || message.name || '').slice(0, 120),
      chatName: String(context.getCurrentChatId?.() ?? context.chatId ?? '').slice(0, 120),
    },
  })));
}

export async function bindSmartSlot(context, message, slot = 0) {
  const chatKey = chatIdentity(context);
  if (!chatKey || !eligibleMessage(message) || !Number.isInteger(slot) || slot < 0 || slot > 3) return null;
  const branch = await digest(message.mes);
  const swipe = Number.isSafeInteger(message.swipe_id) ? message.swipe_id : 0;
  const identity = message.send_date ? [String(message.send_date), String(message.name || '')]
    : ['undated', context.chat.indexOf(message), String(message.name || '')];
  return { index: slot, prompt: '', binding: {
    id: await digest(JSON.stringify([chatKey, identity, swipe, branch, 'smart', ...(slot ? [slot] : [])])),
    chatKey, branch, swipe, slot, kind: 'smart',
    characterName: String(context.name2 || message.name || '').slice(0, 120),
    chatName: String(context.getCurrentChatId?.() ?? context.chatId ?? '').slice(0, 120),
  } };
}

export function bindingIsCurrent(entry, context, settings) {
  if (!settings.enabled || chatIdentity(context) !== entry.binding.chatKey
    || !context.chat.includes(entry.message) || !eligibleMessage(entry.message)
    || entry.message.mes !== entry.text
    || (entry.message.swipe_id || 0) !== entry.binding.swipe) return false;
  if (entry.binding.kind === 'smart') return true;
  const slots = parseImageTags(entry.message.mes, settings.triggerPrefix, settings.triggerSuffix);
  return slots[entry.binding.slot]?.prompt === entry.prompt;
}

export function validBinding(value) {
  return value && /^[a-f0-9]{64}$/.test(value.id) && /^[a-f0-9]{64}$/.test(value.branch)
    && typeof value.chatKey === 'string' && value.chatKey.length <= 2048
    && Number.isSafeInteger(value.swipe) && value.swipe >= 0
    && Number.isSafeInteger(value.slot) && value.slot >= 0 && value.slot < CHAT_SLOT_LIMIT;
}
