import { validImageId } from './image-versions.mjs';
import { storedAssistantPlan } from './assistant-plan.mjs';

export const BACKUP_ACTIONS = ['backup/status', 'backup/chats', 'backup/chats-merge'];
export const STORAGE_VERSION = '0.21.0';
export const STORAGE_PROTOCOL = 2;

export function normalizeBackupChats(values, imageIds) {
  if (!Array.isArray(values) || values.length > 3000 || JSON.stringify(values).length > 8000000) throw new Error('聊天关联备份超过限制');
  const seen = new Set();
  return values.map((row) => {
    const bound = row?.binding;
    if (!bound || !/^[a-f0-9]{64}$/.test(bound.id) || !/^[a-f0-9]{64}$/.test(bound.branch)
      || typeof bound.chatKey !== 'string' || !bound.chatKey || bound.chatKey.length > 2048
      || !Number.isSafeInteger(bound.swipe) || bound.swipe < 0
      || !Number.isSafeInteger(bound.slot) || bound.slot < 0 || bound.slot >= 16 || seen.has(bound.id)) throw new Error('聊天关联备份格式无效');
    seen.add(bound.id);
    const savedIds = (Array.isArray(row.savedIds) ? row.savedIds : []).filter((id) => validImageId(id) && imageIds.has(id));
    return {
      binding: { id: bound.id, branch: bound.branch, chatKey: bound.chatKey, swipe: bound.swipe, slot: bound.slot,
        ...(bound.kind === 'smart' ? { kind: 'smart' } : {}),
        characterName: String(bound.characterName || '').slice(0, 120), chatName: String(bound.chatName || '').slice(0, 120) },
      requestId: validImageId(row.requestId) ? row.requestId : `backup-${bound.id.slice(0, 32)}`,
      status: savedIds.length ? 'completed' : 'failed', savedIds: [...new Set(savedIds)],
      updatedAt: Number.isFinite(row.updatedAt) && row.updatedAt > 0 ? row.updatedAt : Date.now(),
      error: savedIds.length ? '' : '备份记录已恢复，未自动提交生图', recoverable: false,
      ...(row.assistant ? { assistant: storedAssistantPlan(row.assistant) } : {}),
    };
  });
}
