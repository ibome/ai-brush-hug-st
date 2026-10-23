import { chatIdentity, digest, eligibleMessage } from './chat.js';
import { mergeCharacterStates, normalizeCharacterStates } from './assistant-workflow.js';

export const STATE_FIELDS = [['appearance', '外貌', 4000], ['outfit', '服装', 4000],
  ['action', '动作', 1000], ['expression', '表情', 500]];
const keyOf = (row) => row.profileId || row.name;
const stateOf = (message) => message?.extra?.linghuashiDrawingState;
const sourceOf = (signature, evidence, kind = 'automatic', updatedAt = 0) =>
  ({ ...signature, evidence, kind, updatedAt });
const latestIndex = (context) => {
  const chat = context.chat || [];
  for (let index = chat.length - 1; index >= 0; index--) if (eligibleMessage(chat[index])) return index;
  return -1;
};

async function validBasis(context, basis) {
  if (!Array.isArray(basis) || !basis.length || basis.length > 80) return false;
  for (const row of basis) {
    if (!row || !Number.isSafeInteger(row.index) || row.index < 0
      || !Number.isSafeInteger(row.swipe) || row.swipe < 0 || !/^[a-f0-9]{64}$/.test(row.branch || '')) return false;
    const message = context.chat?.[row.index];
    if (!message || row.swipe !== (message.swipe_id || 0) || row.branch !== await digest(message.mes || '')) return false;
  }
  return true;
}

async function timeline(context, before = context.chat?.length || 0) {
  const chatKey = chatIdentity(context), chat = context.chat || [], end = Math.min(before, chat.length);
  let characters = [], sources = Object.create(null), basis = [];
  const signatures = [];
  for (let index = Math.max(0, end - 40); index < end; index++) {
    const message = chat[index], saved = stateOf(message);
    const signature = { index, branch: await digest(message?.mes || ''), swipe: message?.swipe_id || 0 };
    signatures.push({ ...signature, saved: saved || null });
    if (!saved || saved.version !== 1 || saved.chatKey !== chatKey
      || saved.branch !== signature.branch || saved.swipe !== signature.swipe) continue;
    const rows = normalizeCharacterStates(saved.characters);
    characters = mergeCharacterStates(characters, rows);
    for (const row of rows) {
      const key = keyOf(row);
      sources[key] ||= {};
      for (const [field] of STATE_FIELDS) {
        if (row[field]) sources[key][field] = sourceOf(signature, row.evidence);
      }
    }
    basis.push(signature);
    const manual = saved.manual;
    // A snapshot replaces the effective state, including deliberate blanks and removals.
    if (manual?.version === 1 && Array.isArray(manual.characters) && manual.characters.length <= 6
      && await validBasis(context, manual.basis)) {
      characters = normalizeCharacterStates(manual.characters);
      sources = Object.create(null);
      for (const row of characters) {
        const key = keyOf(row);
        sources[key] = {};
        for (const [field] of STATE_FIELDS) {
          const origin = manual.sources?.[key]?.[field];
          if (row[field] && origin && manual.basis.some((item) =>
            item.index === origin.index && item.branch === origin.branch && item.swipe === origin.swipe)) {
            sources[key][field] = sourceOf({ index: origin.index, branch: origin.branch, swipe: origin.swipe },
              origin.kind === 'manual' ? '' : String(origin.evidence || '').slice(0, 500),
              origin.kind === 'manual' ? 'manual' : 'automatic', Number(origin.updatedAt) || 0);
          }
        }
      }
      basis = manual.basis.map((row) => ({ index: row.index, branch: row.branch, swipe: row.swipe }));
    }
  }
  const keys = new Set(characters.map(keyOf));
  sources = Object.fromEntries(Object.entries(sources).filter(([key]) => keys.has(key)));
  basis = [...new Map(basis.map((row) => [row.index, row])).values()];
  characters = normalizeCharacterStates(characters);
  return { chatKey, characters, sources, basis,
    revision: await digest(JSON.stringify({ chatKey, end, signatures, characters, sources, basis })) };
}

export async function readDrawingState(context, before) {
  return (await timeline(context, before)).characters;
}

export async function inspectDrawingState(context) {
  const { basis, ...state } = await timeline(context);
  const index = latestIndex(context);
  return { ...state, writable: Boolean(state.chatKey) && index >= 0 && typeof context.saveChat === 'function' };
}

async function checkedState(context, request) {
  const state = await timeline(context);
  if (!state.chatKey || request.chatKey !== state.chatKey || request.revision !== state.revision) {
    throw new Error('聊天或角色状态已变化，请重新读取状态');
  }
  if (typeof context.saveChat !== 'function') throw new Error('当前酒馆不支持保存角色状态');
  return state;
}

async function persistStateRecord(context, message, record, previous) {
  message.extra ||= {};
  if (record === undefined) delete message.extra.linghuashiDrawingState;
  else message.extra.linghuashiDrawingState = record;
  try { await context.saveChat(); }
  catch {
    if (previous === undefined) delete message.extra.linghuashiDrawingState;
    else message.extra.linghuashiDrawingState = previous;
    throw new Error('角色状态保存失败，请重试');
  }
}

export async function reviseDrawingState(context, request, remove = false) {
  const state = await checkedState(context, request);
  const index = latestIndex(context), message = context.chat?.[index];
  const row = state.characters.find((item) => keyOf(item) === request.key);
  if (!row || !message) throw new Error('角色状态已失效，请重新读取状态');
  const characters = structuredClone(state.characters), sources = Object.assign(Object.create(null), structuredClone(state.sources));
  if (remove) {
    characters.splice(characters.findIndex((item) => keyOf(item) === request.key), 1);
    delete sources[request.key];
  } else {
    if (!request.values || Object.keys(request.values).length !== STATE_FIELDS.length
      || STATE_FIELDS.some(([field, , limit]) => typeof request.values[field] !== 'string'
        || request.values[field].length > limit)) throw new Error('角色状态字段无效或超过长度限制');
    const edited = characters.find((item) => keyOf(item) === request.key);
    const signature = { index, branch: await digest(message.mes || ''), swipe: message.swipe_id || 0 };
    let changed = false;
    for (const [field] of STATE_FIELDS) {
      const next = request.values[field].trim();
      if (edited[field] === next) continue;
      changed = true; edited[field] = next;
      sources[request.key] ||= {};
      if (next) sources[request.key][field] = sourceOf(signature, '', 'manual', Date.now());
      else delete sources[request.key][field];
    }
    if (!changed) throw new Error('角色状态没有变化');
    edited.evidence = '';
  }
  const signature = { index, branch: await digest(message.mes || ''), swipe: message.swipe_id || 0 };
  const basis = [...new Map([...state.basis, signature].map((item) => [item.index, item])).values()];
  if (basis.length > 80) throw new Error('状态来源过多，请清除旧状态后重新分析');
  await checkedState(context, request);
  const previous = stateOf(message);
  const record = { version: 1, chatKey: state.chatKey, branch: signature.branch, swipe: signature.swipe,
    characters: previous?.version === 1 && previous.chatKey === state.chatKey
      && previous.branch === signature.branch && previous.swipe === signature.swipe ? previous.characters : [],
    manual: { version: 1, characters, sources: Object.fromEntries(Object.entries(sources)), basis, updatedAt: Date.now() } };
  await persistStateRecord(context, message, record, previous);
  const inspection = await inspectDrawingState(context);
  return { inspection, undo: { chatKey: state.chatKey, revision: inspection.revision, index, previous, record } };
}

export async function undoDrawingState(context, request, receipt) {
  if (!receipt || receipt.chatKey !== request.chatKey || receipt.revision !== request.revision) {
    throw new Error('没有可撤销的状态修改，请重新读取状态');
  }
  await checkedState(context, request);
  const message = context.chat?.[receipt.index], current = stateOf(message);
  if (current !== receipt.record) throw new Error('角色状态已变化，无法撤销旧修改');
  await persistStateRecord(context, message, receipt.previous, current);
  return inspectDrawingState(context);
}
