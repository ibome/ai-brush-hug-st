import { digest, chatIdentity } from './chat.js';

export const CONTEXT_CANDIDATES = 80;
export const CONTEXT_SELECTION_LIMIT = 40;
export const messageRevision = (message, index) => digest(JSON.stringify([
  index, message?.swipe_id || 0, message?.name, message?.is_user === true, message?.mes,
]));

export async function validateContextSelection(context, selection) {
  if (!selection || selection.chatKey !== chatIdentity(context) || !Array.isArray(selection.messages)
    || selection.messages.length > CONTEXT_SELECTION_LIMIT || new Set(selection.messages.map((row) => row.index)).size !== selection.messages.length) {
    throw new Error('上下文选择已失效，请重新读取聊天');
  }
  for (const row of selection.messages) {
    const message = context.chat?.[row.index];
    if (!Number.isSafeInteger(row.index) || row.index < 0 || !message || message.is_system
      || typeof message.mes !== 'string' || row.revision !== await messageRevision(message, row.index)) {
      throw new Error('选中的聊天消息已变化，请重新读取上下文');
    }
  }
}

export async function selectAssistantMessages(context, targetIndex, settings, selection) {
  const chatKey = chatIdentity(context);
  const candidates = (context.chat || []).map((message, index) => ({ message, index }))
    .filter(({ message, index }) => index <= targetIndex && !message.is_system && typeof message.mes === 'string')
    .slice(-CONTEXT_CANDIDATES);
  const catalogue = await Promise.all(candidates.map(async ({ message, index }) => ({
    index, revision: await messageRevision(message, index), name: String(message.name || '').slice(0, 120),
    role: message.is_user ? 'user' : 'character', originalCharacters: message.mes.length,
    excerpt: message.mes.slice(0, 220),
  })));
  if (selection) {
    await validateContextSelection(context, selection);
    if (selection.messages.some((row) => !catalogue.some((candidate) => candidate.index === row.index))) {
      throw new Error('选中的消息超出当前可选范围，请重新读取上下文');
    }
  }
  const chosen = selection ? new Set(selection.messages.map((row) => row.index))
    : new Set(catalogue.slice(-settings.contextMessages).map((row) => row.index));
  let remaining = settings.contextCharacters;
  const messages = [], included = [];
  for (const row of catalogue.slice().reverse()) {
    row.selected = chosen.has(row.index);
    row.includedCharacters = 0;
    if (!row.selected || remaining <= 0) continue;
    const content = context.chat[row.index].mes.slice(-remaining);
    row.includedCharacters = content.length;
    remaining -= content.length;
    messages.unshift({ name: row.name, role: row.role, content });
    included.unshift({ index: row.index, revision: row.revision, content });
  }
  const receipt = { chatKey, messages: catalogue.filter((row) => row.selected).map(({ index, revision }) => ({ index, revision })) };
  return { messages, contextPreview: { catalogue, included, manual: Boolean(selection),
    truncatedMessages: catalogue.filter((row) => row.selected && row.includedCharacters < row.originalCharacters).length },
  contextSelection: receipt };
}

// Heuristic only: no tokenizer or provider billing claim.
export function estimateTokens(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  let latin = 0, other = 0;
  for (const char of text) { if (char.codePointAt(0) < 128) latin++; else other++; }
  return Math.ceil(latin / 4 + other * 1.3);
}

export function assistantUsage(messages, context, maxTokens) {
  const total = messages.reduce((sum, row) => sum + estimateTokens(row.content) + 4, 3);
  return { input: total, outputLimit: maxTokens, totalLimit: total + maxTokens,
    chat: estimateTokens(context.messages || []), target: estimateTokens(context.target || ''),
    characters: estimateTokens(context.characters || []), world: estimateTokens(context.world || ''),
    truncated: context.contextPreview?.truncatedMessages || 0 };
}
