import { bindAncestorSlot, chatIdentity } from './chat.js';
import { chatImageBelongsTo } from './chat-image-actions.js';
import { versionGroupId } from '../server/linghuashi-storage/image-versions.mjs';

const ancestorLimit = 8;
const validName = (value) => typeof value === 'string' && value.length > 0 && value.length <= 255
  && value.trim() === value && !/[/\\\u0000-\u001f]/u.test(value) && !['.', '..'].includes(value);

export function branchParent(context) {
  const name = context.chatMetadata?.main_chat;
  const active = context.getCurrentChatId?.() ?? context.chatId;
  return validName(name) && name !== active ? name : '';
}

export function createChatAncestry(request = fetch) {
  const parents = new Map();
  return async (context) => {
    const key = chatIdentity(context), first = branchParent(context);
    if (!key || !first) return [];
    const [type, owner, active] = JSON.parse(key);
    const headers = context.getRequestHeaders?.();
    const group = type === 'group';
    const groupChats = group ? context.groups?.find((item) => String(item.id) === owner)?.chats : null;
    parents.set(key, first);
    const ancestors = [], seen = new Set([active]);
    const signal = AbortSignal.timeout(4000);
    let name = first;
    while (validName(name) && !seen.has(name) && ancestors.length < ancestorLimit) {
      seen.add(name);
      const sourceKey = JSON.stringify([type, owner, name]);
      ancestors.push(sourceKey);
      if (ancestors.length >= ancestorLimit) break;
      if (parents.has(sourceKey)) { name = parents.get(sourceKey); continue; }
      if (!headers || signal.aborted || (!group && !context.characters?.[context.characterId]?.avatar)
        || (Array.isArray(groupChats) && !groupChats.includes(name))) break;
      try {
        const response = await request(group ? '/api/chats/group/get' : '/api/chats/get', {
          method: 'POST', credentials: 'same-origin', cache: 'no-store', headers,
          body: JSON.stringify(group ? { id: name } : { avatar_url: owner, file_name: name }),
          signal,
        });
        if (!response.ok) break;
        const chat = await response.json();
        name = Array.isArray(chat) ? chat[0]?.chat_metadata?.main_chat : '';
        if (parents.size >= 128) parents.delete(parents.keys().next().value);
        parents.set(sourceKey, validName(name) ? name : '');
      } catch { break; }
    }
    return ancestors;
  };
}

export function indexBranchImages(data, ancestors) {
  const pictures = new Map(), records = new Map(), keys = new Set(ancestors);
  const keyOf = (binding, location) => `${location}:${binding.id}`;
  for (const row of data.records) {
    if (keys.has(row.binding?.chatKey)) records.set(keyOf(row.binding, row.storageLocation), row);
  }
  for (const row of data.images) {
    if (!keys.has(row.chatBinding?.chatKey) || !row.blob) continue;
    const key = keyOf(row.chatBinding, row.storageLocation);
    if (!pictures.has(key)) pictures.set(key, []);
    pictures.get(key).push(row);
  }
  return async (context, message, slot, locations) => {
    if (!pictures.size) return null;
    for (const chatKey of ancestors) {
      const binding = await bindAncestorSlot(context, message, slot, chatKey);
      for (const storageLocation of locations) {
        const key = keyOf(binding, storageLocation);
        const rows = pictures.get(key)?.filter((row) => chatImageBelongsTo(row, binding));
        if (!rows?.length) continue;
        const record = records.get(key);
        const groups = new Set(rows.map(versionGroupId));
        const savedIds = (record?.savedIds || []).filter((id) => groups.has(id) || rows.some((row) => row.id === id));
        // Only saved pictures cross the branch boundary, never live tasks or drafts.
        return { binding, storageLocation, status: 'completed',
          savedIds: (savedIds.length ? savedIds : [...groups]).slice(0, 32), assistant: record?.assistant };
      }
    }
    return null;
  };
}
