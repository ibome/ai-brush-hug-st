import { randomUUID } from './crypto-compat.js';
import { parseAssistantResult } from './prompt-assistant.js';
import { freezeIllustrationCharacters, illustrationPlans } from './assistant-workflow.js';

export const ASSISTANT_HISTORY_LIMIT = 12;
export const ASSISTANT_HISTORY_BYTES = 600000;
export const DRAFT_OPERATIONS = Object.freeze({
  generate: '生成提示词', translate: '翻译', polish: '润色', illustrate: '聊天配图',
  manual: '手动保存', checkpoint: '替换前草稿', recovered: '修复回复', reanalyze: '单画面重分析',
});
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);

export function cleanAssistantDraft(plan) {
  const clean = parseAssistantResult(JSON.stringify(plan), { stored: true, editable: true });
  // History is a standalone prompt snapshot, never a reference to a live chat.
  delete clean.characterStates;
  if (clean.characterScene) clean.characterScene.chatKey = '';
  return clean;
}

function cleanEntry(value) {
  if (!object(value) || !/^[A-Za-z0-9_-]{1,80}$/.test(value.id || '')
    || !Number.isSafeInteger(value.createdAt) || value.createdAt <= 0) return null;
  try {
    const plan = cleanAssistantDraft(value.plan);
    return {
      id: value.id, createdAt: value.createdAt, label: text(value.label, 60).trim(),
      operation: Object.hasOwn(DRAFT_OPERATIONS, value.operation) ? value.operation : 'manual',
      input: text(value.input, 32000), plan,
      index: Math.max(0, Math.min(Number.isInteger(value.index) ? value.index : 0, illustrationPlans(plan).length - 1)),
    };
  } catch { return null; }
}

export function normalizeAssistantHistory(value, budget = ASSISTANT_HISTORY_BYTES) {
  const result = [], seen = new Set();
  for (const valueRow of (Array.isArray(value) ? value : []).slice(0, 100)) {
    const row = cleanEntry(valueRow);
    if (!row || seen.has(row.id)) continue;
    if (result.length >= ASSISTANT_HISTORY_LIMIT) break;
    if (bytes([...result, row]) > Math.min(ASSISTANT_HISTORY_BYTES, budget)) continue;
    seen.add(row.id); result.push(row);
  }
  return result;
}

export function rememberAssistantDraft(history, draft, { budget = ASSISTANT_HISTORY_BYTES, now = Date.now() } = {}) {
  const rows = normalizeAssistantHistory(history, budget);
  const row = cleanEntry({ ...draft, id: randomUUID(), createdAt: now });
  if (!row) throw new Error('当前草稿无效，无法保存历史版本');
  if (bytes([row]) > budget || bytes([row]) > ASSISTANT_HISTORY_BYTES) {
    throw new Error('草稿超过历史容量，当前工作草稿仍会保留');
  }
  const first = rows[0];
  if (first && JSON.stringify(first.plan) === JSON.stringify(row.plan) && first.input === row.input
    && (!row.label || row.label === first.label)) return rows;
  return normalizeAssistantHistory([row, ...rows], budget);
}

export function assistantWorkspaceRevision({ plan, input = '', index = 0, binding = null } = {}) {
  return JSON.stringify([plan, input, index, binding]);
}

export function compareAssistantDrafts(previous, current) {
  const before = previous ? cleanAssistantDraft(previous) : null;
  const after = current ? cleanAssistantDraft(current) : null;
  const a = illustrationPlans(before), b = illustrationPlans(after), changes = [];
  const fields = [['shouldDraw', '配图判断'], ['scene', '画面'], ['positive', '正向提示词'], ['negative', '负面提示词'],
    ['anchor', '原文定位句'], ['aspect', '画幅'], ['reason', '配图理由'], ['characters', '角色动作与外貌']];
  const show = (value) => value === undefined ? '' : typeof value === 'boolean' ? value ? '可生成' : '无需配图'
    : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if (!a[index] || !b[index]) changes.push({ index, field: '画面状态',
      before: a[index] ? '已有画面' : '无此画面', after: b[index] ? '已有画面' : '无此画面' });
    for (const [key, field] of fields) {
      const left = show(a[index]?.[key]), right = show(b[index]?.[key]);
      if (left !== right) changes.push({ index, field, before: left, after: right });
    }
  }
  if (JSON.stringify(before?.characterScene || null) !== JSON.stringify(after?.characterScene || null)) {
    changes.push({ index: -1, field: '固定角色快照', before: show(before?.characterScene), after: show(after?.characterScene) });
  }
  return changes;
}

export function recoverAssistantDraft(raw, context = {}) {
  const plan = parseAssistantResult(raw);
  if (illustrationPlans(plan).length > (context.maxShots || 4)) throw new Error('修复后的画面数量超过本次分析设置');
  // Ignore model-supplied profile snapshots, including forged locks and references.
  delete plan.characterScene;
  delete plan.characterStates;
  freezeIllustrationCharacters(plan, context.scene, context.states || []);
  return cleanAssistantDraft(plan);
}
