const BASE = '/api/plugins/linghuashi-storage';
import { TASK_ACTIONS } from '../server/linghuashi-storage/task-ledger.mjs';
import { REFERENCE_ACTIONS } from '../server/linghuashi-storage/reference-actions.mjs';
import { BACKUP_ACTIONS } from '../server/linghuashi-storage/backup-records.mjs';
import { createNativeStorage } from './native-storage.js';
import { createBrowserTaskRequest } from './task-persistence.js';
export const STORAGE_ACTIONS = new Set(['list', 'image/get', 'version/select', 'policy', 'cleanup', 'add', 'favorite', 'remove', 'audit',
  'chat/list', 'chat/get', 'chat/reserve', 'chat/update', 'components/status', 'diagnostics/status',
  'comic/chapter-get', 'comic/chapter-put', ...TASK_ACTIONS, ...REFERENCE_ACTIONS, ...BACKUP_ACTIONS]);

export function createStorageRequest(getHeaders, { account = 'default-user', request = fetch, browserTasks, locks, now, enhancedSupported = true, signal,
  isActive = () => true } = {}) {
  function assertActive() {
    signal?.throwIfAborted();
    if (!isActive()) throw new DOMException('页面正在离开，已停止发起存储请求', 'AbortError');
  }
  function requestSignal() {
    assertActive();
    const deadline = AbortSignal.timeout(120000);
    if (!signal) return deadline;
    if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, deadline]);
    const controller = new AbortController();
    const stop = () => {
      controller.abort();
      signal.removeEventListener('abort', stop); deadline.removeEventListener('abort', stop);
    };
    signal.addEventListener('abort', stop, { once: true });
    deadline.addEventListener('abort', stop, { once: true });
    return controller.signal;
  }
  async function api(url, body, { missing = false } = {}) {
    assertActive();
    const headers = getHeaders();
    if (!headers) throw new Error('酒馆请求验证尚未就绪');
    let response;
    try {
      response = await request(url, {
        method: 'POST', headers, body: JSON.stringify(body), credentials: 'same-origin',
        cache: 'no-store', signal: requestSignal(),
      });
    } catch (error) { error.scope = 'tavern-storage'; throw error; }
    signal?.throwIfAborted();
    if (!response.ok) {
      if (missing && response.status === 404) return null;
      const result = await response.json().catch(() => ({}));
      throw Object.assign(new Error(result.error || (response.status === 403
        ? '当前账号没有此存储组件的访问权限' : '酒馆服务器存储请求失败，请重试')), { status: response.status, scope: 'tavern-storage' });
    }
    const text = await response.text();
    try { return text ? JSON.parse(text) : {}; } catch { return {}; }
  }
  const enhanced = (action, body = {}, options) => api(`${BASE}/${action}`, body, options);
  const native = createNativeStorage({ api, account, locks, now,
    read: (path) => request(`/${path}?account=${encodeURIComponent(account)}`, { credentials: 'same-origin', cache: 'no-cache', signal: requestSignal() })
      .catch((error) => { error.scope = 'tavern-storage'; throw error; }) });
  let discovery, tasks;
  const localTasks = (action, body) => {
    tasks ||= browserTasks || createBrowserTaskRequest(`linghuashi-tasks-v1:st:${encodeURIComponent(account)}`);
    return tasks(action, body);
  };
  async function component(force = false) {
    if (!enhancedSupported) return null;
    if (force) discovery = null;
    if (!discovery) {
      discovery = enhanced('backup/status', {}, { missing: true }).then((status) => {
        if (status && (!Number.isInteger(status.protocol) || typeof status.version !== 'string')) throw new Error('服务器增强组件状态格式无效');
        return status;
      }).catch((error) => {
        if (error.status === 403) return { restricted: true, error: error.message };
        discovery = null; throw error;
      });
    }
    return discovery;
  }
  const nativeImages = new Set(), nativeChats = new Set(), taskLocations = new Map();
  const merge = (a, b, key) => [...new Map([...a, ...b].map((row) => [key(row), row])).values()];
  async function taskList(available) {
    const local = await localTasks('task/list'), remote = available ? await enhanced('task/list') : { rows: [] };
    for (const row of remote.rows) taskLocations.set(row.id, 'enhanced');
    for (const row of local.rows) taskLocations.set(row.id, 'native');
    return { ...remote, serverTime: remote.serverTime || local.serverTime,
      rows: merge(remote.rows, local.rows, (row) => row.id), localTaskCount: local.rows.length };
  }
  async function images(available, body) {
    const local = await native('list', body), remote = available ? await enhanced('list') : { rows: [] };
    nativeImages.clear();
    local.rows.forEach((row) => nativeImages.add(row.id));
    const rows = merge(remote.rows, local.rows, (row) => row.id);
    return { ...local, rows, enhanced: Boolean(available),
      bytes: rows.reduce((sum, row) => sum + row.bytes + row.thumbBytes, 0),
      pendingFiles: (local.pendingFiles || 0) + (remote.pendingFiles || 0) };
  }
  return async (action, body = {}) => {
    assertActive();
    if (!STORAGE_ACTIONS.has(action)) throw new Error('未知服务器存储操作');
    if (action === 'comic/chapter-get' || action === 'comic/chapter-put') return native(action, body);
    if (action === 'components/status') {
      try {
        const status = await component(body.refresh === true);
        return { native: true, enhanced: !enhancedSupported ? 'unsupported' : status?.restricted ? 'denied' : status ? 'installed' : 'missing', version: status?.version || '',
          ...(status?.restricted ? { error: status.error } : {}),
          protocol: status?.protocol || 0, taskStorage: status && !status.restricted ? 'server' : 'browser' };
      } catch (error) {
        return { native: true, enhanced: error.status === 403 ? 'denied' : 'error', error: error.message };
      }
    }
    if (action === 'diagnostics/status') {
      const summary = await native(action);
      const status = await component(true).catch((error) => ({ unavailable: true, status: error.status || 0 }));
      return { ...summary, enhanced: !enhancedSupported ? 'unsupported' : status?.restricted ? 'denied' : status?.unavailable ? 'error' : status ? 'installed' : 'missing',
        componentVersion: typeof status?.version === 'string' ? status.version : '', componentProtocol: status?.protocol || 0,
        componentHttpStatus: status?.status || 0, taskStorage: status && !status.restricted && !status.unavailable ? 'server' : 'browser' };
    }
    const detected = await component(), available = detected?.restricted ? null : detected;
    if (TASK_ACTIONS.includes(action)) {
      if (action === 'task/list') return taskList(available);
      if (action === 'task/configure') {
        const local = await localTasks(action, body);
        return available ? enhanced(action, body) : local;
      }
      if (action === 'task/clear') {
        await taskList(available);
        const local = await localTasks(action, { ...body, ids: [...taskLocations].filter(([id, mode]) => mode === 'native' && (!body.ids || body.ids.includes(id))).map(([id]) => id) });
        const remote = available ? await enhanced(action, { ...body, ids: [...taskLocations].filter(([id, mode]) => mode === 'enhanced' && (!body.ids || body.ids.includes(id))).map(([id]) => id) }) : { cleared: 0 };
        return { cleared: local.cleared + remote.cleared };
      }
      if (!taskLocations.has(body.id)) await taskList(available);
      if (action === 'task/create' && !taskLocations.has(body.id)) {
        const records = await taskList(available);
        if (body.plan?.chatRequestId && records.rows.some((row) => row.plan.chatRequestId === body.plan.chatRequestId)) throw new Error('该聊天请求已有任务，请查看原任务记录');
        taskLocations.set(body.id, available ? 'enhanced' : 'native');
      }
      if (taskLocations.get(body.id) === 'native' || !available) return localTasks(action, body);
      return enhanced(action, body);
    }
    if (action === 'list') return images(available, body);
    if (action === 'backup/status') return { ...(available || await native(action)), native: true,
      enhanced: !enhancedSupported ? 'unsupported' : available ? 'installed' : 'missing' };
    if (action === 'add') {
      if (available) {
        await images(available);
        if (!nativeImages.has(body.row?.id)
          && !nativeImages.has(body.row?.version?.parentId) && !nativeImages.has(body.row?.version?.groupId)) return enhanced(action, body);
      }
      const result = await native(action, body); nativeImages.add(body.row.id); return result;
    }
    if (['image/get', 'favorite', 'version/select', 'remove'].includes(action)) {
      await images(available);
      if (action === 'remove') {
        if (!Array.isArray(body.ids)) throw new Error('删除列表无效');
        const localIds = body.ids.filter((id) => nativeImages.has(id)), remoteIds = body.ids.filter((id) => !nativeImages.has(id));
        // Validate both locations before deleting either set.
        const rows = (await images(available)).rows.filter((row) => body.ids.includes(row.id));
        if (!body.allowReferenced && rows.some((row) => row.chatBinding)) throw new Error('所选图片包含聊天配图，请确认后删除');
        const local = localIds.length ? await native(action, { ...body, ids: localIds }) : { ids: [], pendingFiles: 0 };
        const remote = available && remoteIds.length ? await enhanced(action, { ...body, ids: remoteIds }) : { ids: [], pendingFiles: 0 };
        return { ids: [...local.ids, ...remote.ids], pendingFiles: local.pendingFiles + remote.pendingFiles };
      }
      return nativeImages.has(body.id) || !available ? native(action, body) : enhanced(action, body);
    }
    if (['policy', 'cleanup', 'audit'].includes(action)) {
      const local = await native(action, body), remote = available ? await enhanced(action, body) : null;
      if (action === 'policy') return { ...local, background: Boolean(available) };
      if (action === 'cleanup') return { ...local, due: local.due || remote?.due, ids: [...local.ids, ...(remote?.ids || [])] };
      return { missing: [...local.missing, ...(remote?.missing || [])],
        orphans: local.orphans + (remote?.orphans || 0), pendingFiles: local.pendingFiles + (remote?.pendingFiles || 0) };
    }
    if (action === 'chat/list' || action === 'backup/chats') {
      const localResult = await native(action, body), remoteResult = available ? await enhanced(action, body) : null;
      const local = action === 'backup/chats' ? localResult.rows : localResult;
      const remote = action === 'backup/chats' ? remoteResult?.rows || [] : remoteResult || [];
      local.forEach((row) => nativeChats.add(row.binding.id));
      const rows = merge(remote, local, (row) => row.binding.id);
      return action === 'backup/chats' ? { rows } : rows;
    }
    if (action === 'chat/get' || action === 'chat/reserve' || action === 'chat/update') {
      const id = body.binding?.id || body.id;
      const local = await native('chat/get', { id });
      if (local) nativeChats.add(id);
      if (nativeChats.has(id) || !available) return native(action, body);
      return enhanced(action, body);
    }
    if (action === 'backup/chats-merge') {
      const rows = (await images(available)).rows, localIds = new Set(rows.filter((row) => row.nativeStorage).map((row) => row.id));
      const localRows = body.rows.filter((row) => row.savedIds.some((id) => localIds.has(id)));
      const remoteRows = body.rows.filter((row) => !localRows.includes(row));
      const local = await native(action, { rows: localRows });
      const remote = available && remoteRows.length ? await enhanced(action, { rows: remoteRows }) : { imported: 0 };
      return { imported: local.imported + remote.imported };
    }
    if (REFERENCE_ACTIONS.includes(action)) {
      if (!available) return native(action, body);
      try { return await enhanced(action, body); }
      catch (error) { if (error.status !== 404 || action !== 'reference/get') throw error; return native(action, body); }
    }
    throw new Error('未知服务器存储操作');
  };
}

export function serverImageURL(id, account, thumbnail = false) {
  return `${BASE}/image/${encodeURIComponent(id)}?account=${encodeURIComponent(account)}${thumbnail ? '&thumbnail=1' : ''}`;
}

export function serverDrawing(row, account) {
  const native = row.nativeStorage === 1 && /^[A-Za-z0-9_-]{1,80}$/.test(row.id)
    && ['png', 'jpg', 'webp'].includes(row.extension) && ['png', 'jpg', 'webp'].includes(row.thumbExtension);
  return { ...row, storageLocation: 'server', blob: { size: row.bytes, type: row.mime },
    thumbnail: { size: row.thumbBytes, type: row.thumbMime },
    srcURL: native ? `/user/images/linghuashi/lh-${encodeURIComponent(row.id)}.${row.extension}?account=${encodeURIComponent(account)}` : serverImageURL(row.id, account),
    thumbnailURL: native ? `/user/images/linghuashi-thumbnails/lh-${encodeURIComponent(row.id)}.${row.thumbExtension}?account=${encodeURIComponent(account)}` : serverImageURL(row.id, account, true) };
}

async function base64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('图片数据读取失败'));
    reader.readAsDataURL(blob);
  });
}

export class ServerDrawingLibrary {
  constructor(request, account) { this.request = request; this.account = account; }
  async list(refresh = false) {
    const result = await this.request('list', { refresh });
    this.stats = result;
    return result.rows.map((row) => serverDrawing(row, this.account));
  }
  async add(rows, options = {}) {
    for (const row of rows) {
      const { blob, thumbnail, src, thumbSrc, srcURL, thumbnailURL, ...metadata } = row;
      await this.request('add', { row: metadata, image: await base64(blob), thumbnail: await base64(thumbnail),
        requestId: options.requestId, batchSize: rows.length });
    }
  }
  remove(ids, allowReferenced) { return this.request('remove', { ids, allowReferenced }); }
  setFavorite(id, favorite) { return this.request('favorite', { id, favorite }); }
  selectVersion(id) { return this.request('version/select', { id }); }
  cleanup() { return this.request('cleanup'); }
  policy(settings) {
    return this.request('policy', { active: settings.enabled !== false && settings.cacheLocation === 'server',
      cleanupMode: settings.cleanupMode, cleanupInterval: settings.cleanupInterval, cleanupUnit: settings.cleanupUnit,
      cleanupMaxImages: settings.cleanupMaxImages, cleanupOlderThanDays: settings.cleanupOlderThanDays });
  }
  async materialize(row, signal) {
    if (row.blob instanceof Blob) return row;
    const load = async (url) => {
      const response = await fetch(url, { credentials: 'same-origin', signal });
      if (!response.ok) throw new Error(response.status === 404 ? '服务器图片已删除或文件缺失' : '服务器原图下载失败，请重试');
      return response.blob();
    };
    return { ...row, blob: await load(row.srcURL), thumbnail: await load(row.thumbnailURL) };
  }
}
