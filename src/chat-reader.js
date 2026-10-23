import { bindImageSlots, bindSmartSlot, chatIdentity, digest, eligibleMessage } from './chat.js';
import { chatImageBelongsTo } from './chat-image-actions.js';
import { currentDrawing, versionGroupId } from '../server/linghuashi-storage/image-versions.mjs';

export const READER_LIMITS = Object.freeze({ messages: 3000, characters: 4000000, images: 600, exportBytes: 64 * 1024 * 1024 });
export const READER_DEFAULTS = Object.freeze({ fontSize: 18, lineHeight: 1.9, imageWidth: 85, showUser: true });
export function normalizeReaderSettings(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const number = (key, min, max) => Number.isFinite(Number(value[key]))
    ? Math.max(min, Math.min(max, Number(value[key]))) : READER_DEFAULTS[key];
  return { fontSize: number('fontSize', 14, 28), lineHeight: number('lineHeight', 1.4, 2.6),
    imageWidth: number('imageWidth', 40, 100), showUser: value.showUser !== false };
}
export function readerRange(total, range = {}) {
  const start = range.start ?? 1, end = range.end ?? total;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > total) {
    throw new Error(total ? `楼层范围需在 1 至 ${total} 之间` : '请先打开包含消息的聊天');
  }
  if (end - start + 1 > READER_LIMITS.messages) throw new Error(`每次最多读取 ${READER_LIMITS.messages} 条，请缩小楼层范围`);
  return { start, end };
}
const compact = (value) => String(value || '').replace(/\s+/g, ' ').trim();
function anchorEnd(text, anchor) {
  const quote = compact(anchor);
  if (quote.length < 2) return text.length;
  let normalized = '', offsets = [];
  for (let index = 0; index < text.length; index++) {
    const char = /\s/.test(text[index]) ? ' ' : text[index];
    if (char === ' ' && normalized.endsWith(' ')) continue;
    normalized += char; offsets.push(index);
  }
  const start = normalized.indexOf(quote);
  return start < 0 || normalized.indexOf(quote, start + 1) >= 0 ? text.length : offsets[start + quote.length - 1] + 1;
}
export function readerParts(text, placements) {
  let cursor = 0;
  const parts = [];
  for (const item of [...placements].sort((a, b) => a.start - b.start || a.slot - b.slot)) {
    if (item.start < cursor) continue;
    if (item.start > cursor) parts.push({ type: 'text', text: text.slice(cursor, item.start) });
    parts.push({ type: 'images', images: item.images });
    cursor = item.end;
  }
  if (cursor < text.length) parts.push({ type: 'text', text: text.slice(cursor) });
  return parts;
}
const sameBinding = (a, b) => a && b && ['id', 'chatKey', 'branch', 'swipe', 'slot'].every((key) => a[key] === b[key]);
const imageKey = (row) => `${row.storageLocation}:${row.id}`;
const dimension = (value) => Number.isFinite(Number(value)) ? Math.max(1, Math.min(32768, Math.round(Number(value)))) : 1;
function slotImages(binding, data, index) {
  const result = [], groups = new Set();
  for (const location of ['browser', 'server']) {
    const rows = data.images.filter((row) => row.storageLocation === location);
    const record = data.records.find((row) => row.storageLocation === location && sameBinding(row.binding, binding));
    const ids = [...new Set([...(record?.savedIds || []),
      ...rows.filter((row) => chatImageBelongsTo(row, binding)).map((row) => row.id)])];
    for (const id of ids) {
      const selected = currentDrawing(rows, id);
      const group = `${location}:${selected ? versionGroupId(selected) : id}`;
      if (groups.has(group)) continue;
      groups.add(group);
      if (!selected || !chatImageBelongsTo(selected, binding)) {
        result.push({ key: `${location}:${id}`, id, index, storageLocation: location, missing: true, title: '图片已删除或记录不匹配' });
        continue;
      }
      result.push({ key: imageKey(selected), id: selected.id, storageLocation: location,
        title: String(selected.title || '聊天配图').slice(0, 240), width: dimension(selected.width), height: dimension(selected.height),
        bytes: Math.max(0, Number(selected.blob?.size || selected.bytes) || 0), mime: selected.blob?.type || selected.mime,
        binding, index });
    }
  }
  return result;
}

export async function buildReadingSnapshot(context, settings, data, range, signal) {
  const chatKey = chatIdentity(context), chat = context.chat || [];
  if (!chatKey) throw new Error('请先打开聊天');
  const { start, end } = readerRange(chat.length, range), messages = [], source = [];
  const smartSlots = new Map();
  for (const binding of [...data.records.map((row) => row.binding), ...data.images.map((row) => row.chatBinding)]) {
    if (binding?.kind !== 'smart' || binding.chatKey !== chatKey) continue;
    if (!smartSlots.has(binding.branch)) smartSlots.set(binding.branch, new Set());
    smartSlots.get(binding.branch).add(binding.slot);
  }
  let characters = 0, images = 0;
  for (let index = start - 1; index < end; index++) {
    signal?.throwIfAborted();
    const message = chat[index], body = typeof message?.mes === 'string' ? message.mes : '';
    source.push([index, body, message?.swipe_id || 0, message?.name, Boolean(message?.is_user), Boolean(message?.is_system), message?.send_date]);
    if (message?.is_system) continue;
    characters += body.length;
    if (characters > READER_LIMITS.characters) throw new Error('所选正文超过 400 万字符，请缩小楼层范围');
    const placements = [];
    if (eligibleMessage(message)) {
      const tagged = await bindImageSlots(context, message, settings.triggerPrefix || 'image###', settings.triggerSuffix || '###');
      const candidates = !tagged.length && smartSlots.size ? smartSlots.get(await digest(body)) : null;
      const slots = tagged.length ? tagged : (await Promise.all([...(candidates || [])].map((slot) => bindSmartSlot(context, message, slot)))).filter(Boolean);
      for (const slot of slots) {
        const pictures = slotImages(slot.binding, data, index);
        if (!tagged.length && !pictures.length) continue;
        if (!pictures.length) pictures.push({ key: `pending:${slot.binding.id}`, index, missing: true, title: '此处暂无已保存配图' });
        images += pictures.length;
        if (images > READER_LIMITS.images) throw new Error('所选配图超过 600 张，请缩小楼层范围');
        const record = data.records.find((row) => sameBinding(row.binding, slot.binding));
        const position = tagged.length ? slot.start : anchorEnd(body, record?.assistant?.anchor);
        placements.push({ start: position, end: tagged.length ? slot.end : position, slot: slot.binding.slot, images: pictures });
      }
    }
    messages.push({ index, name: String(message?.name || (message?.is_user ? '用户' : '角色')).slice(0, 120),
      role: message?.is_user ? 'user' : 'assistant', parts: readerParts(body, placements) });
  }
  const group = context.groupId ? context.groups?.find((row) => String(row.id) === String(context.groupId)) : null;
  const title = String(group?.name || context.name2 || '当前聊天').slice(0, 120);
  const snapshot = { chatKey, title, total: chat.length, start, end, messages, warnings: data.warnings || [] };
  return { ...snapshot, revision: await digest(JSON.stringify({ source, snapshot })) };
}

export function createChatReader({ getContext, settings, load, image, preview, isBusy = () => false }) {
  let latest = null, urls = [], destroyed = false, epoch = 0;
  const revoke = () => { for (const url of urls) URL.revokeObjectURL(url); urls = []; };
  function sourceOf(context, range) {
    let characters = 0;
    const rows = (context.chat || []).slice(range.start - 1, range.end).map((row) => {
      characters += typeof row?.mes === 'string' ? row.mes.length : 0;
      if (characters > READER_LIMITS.characters) throw new Error('所选正文超过 400 万字符，请缩小楼层范围');
      return [row?.mes, row?.swipe_id || 0, row?.name, row?.is_user, row?.is_system, row?.send_date];
    });
    return JSON.stringify([context.chat?.length, context.name2, rows]);
  }
  async function collect(range, signal) {
    if (destroyed) throw new Error('图文阅读已关闭');
    if (isBusy()) throw new Error('酒馆正在输出回复，请结束后再读取或导出');
    const context = getContext(), key = chatIdentity(context), turn = epoch;
    range = readerRange(context.chat?.length || 0, range);
    const source = sourceOf(context, range);
    const check = () => {
      signal?.throwIfAborted();
      const current = getContext();
      if (destroyed || epoch !== turn || isBusy() || key !== chatIdentity(current) || source !== sourceOf(current, range)) {
        throw new Error('聊天已变化，请重新读取图文');
      }
      return current;
    };
    const data = await load(key);
    const snapshot = await buildReadingSnapshot(check(), settings(), data, range, signal);
    check();
    return { snapshot, data };
  }
  return {
    async receive(action, request, signal) {
      if (action === 'reader-read') {
        const { snapshot, data } = await collect(request.range, signal);
        const nextURLs = [];
        try {
          const value = structuredClone(snapshot);
          for (const message of value.messages) for (const part of message.parts) for (const picture of part.images || []) {
            if (picture.missing) continue;
            const row = data.images.find((row) => imageKey(row) === picture.key);
            const url = preview(row);
            if (url?.startsWith('blob:')) nextURLs.push(url);
            picture.preview = url || '';
          }
          signal?.throwIfAborted();
          revoke(); urls = nextURLs; latest = snapshot;
          return value;
        } catch (error) { for (const url of nextURLs) URL.revokeObjectURL(url); throw error; }
      }
      if (!latest || request.chatKey !== latest.chatKey || request.revision !== latest.revision
        || chatIdentity(getContext()) !== latest.chatKey) throw new Error('聊天或阅读版本已变化，请重新读取图文');
      if (action === 'reader-validate') {
        const { snapshot } = await collect({ start: latest.start, end: latest.end }, signal);
        if (snapshot.revision !== latest.revision) throw new Error('正文、回复分支或图片版本已变化，请重新读取图文');
        return { valid: true };
      }
      if (action === 'reader-image') {
        const expected = latest, turn = epoch;
        const picture = latest.messages.flatMap((row) => row.parts.flatMap((part) => part.images || []))
          .find((row) => !row.missing && row.key === request.key);
        const context = getContext(), message = context.chat?.[picture?.index], body = message?.mes;
        if (!picture || !message || (message.swipe_id || 0) !== picture.binding.swipe
          || await digest(message.mes || '') !== picture.binding.branch) throw new Error('配图来源已变化，请重新读取图文');
        const row = await image(picture.id, picture.storageLocation);
        signal?.throwIfAborted();
        const current = getContext();
        if (turn !== epoch || latest !== expected || chatIdentity(current) !== expected.chatKey
          || current.chat?.[picture.index]?.mes !== body
          || (current.chat?.[picture.index]?.swipe_id || 0) !== picture.binding.swipe) throw new Error('聊天已变化，请重新读取图文');
        if (row?.id !== picture.id || !chatImageBelongsTo(row, picture.binding)) throw new Error('图片版本已变化或图片已删除，请重新读取图文');
        return row.blob instanceof Blob ? { blob: row.blob } : { url: row.srcURL };
      }
      throw new Error('未知图文阅读操作');
    },
    reset() { epoch++; latest = null; revoke(); },
    destroy() { epoch++; destroyed = true; latest = null; revoke(); },
  };
}
