import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createTaskLedger, TASK_ACTIONS } from './task-ledger.mjs';
import { createReferenceAssets, REFERENCE_ACTIONS } from './reference-assets.mjs';
import { currentDrawing, insertVersion, selectVersion, removeVersions, normalizeVersion, protectedVersionGroups, versionGroupId } from './image-versions.mjs';
import { BACKUP_ACTIONS, STORAGE_VERSION, STORAGE_PROTOCOL, normalizeBackupChats } from './backup-records.mjs';
import { storedAssistantPlan } from './assistant-plan.mjs';

export const info = { id: 'linghuashi-storage', name: 'Linghuashi Image Storage', description: 'Account isolated image, parameter and chat storage.' };
const MAX_IMAGE = 20 * 1024 * 1024;
const MAX_ROWS = 10000;
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value)
  && !['__proto__', 'constructor', 'prototype', 'toString'].includes(value);
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const clone = (value) => JSON.parse(JSON.stringify(value));
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';

function binding(value) {
  if (!object(value) || !/^[a-f0-9]{64}$/.test(value.id) || !/^[a-f0-9]{64}$/.test(value.branch)
    || typeof value.chatKey !== 'string' || value.chatKey.length > 2048
    || !Number.isSafeInteger(value.swipe) || value.swipe < 0
    || !Number.isSafeInteger(value.slot) || value.slot < 0 || value.slot >= 16) return null;
  return { id: value.id, branch: value.branch, chatKey: value.chatKey, swipe: value.swipe, slot: value.slot,
    ...(value.kind === 'smart' ? { kind: 'smart' } : {}),
    characterName: text(value.characterName, 120), chatName: text(value.chatName, 120) };
}

function safeSnapshot(value) {
  if (value === null || value === undefined) return null;
  if (!object(value) || !['novelai', 'openai', 'comfyui', 'sdwebui'].includes(value.provider)) throw fail('图片参数格式无效');
  if (JSON.stringify(value).length > 2000000) throw fail('图片参数过大');
  const clean = (item, depth = 0) => {
    if (depth > 40) throw fail('图片参数层级过深');
    if (Array.isArray(item)) return item.map((entry) => clean(entry, depth + 1));
    if (!object(item)) return item;
    return Object.fromEntries(Object.entries(item)
      .filter(([key]) => !/^(?:keyRef|api[_-]?key|api[_-]?token|authorization|password|access[_-]?token|headers|credentials|secret)$/i.test(key))
      .map(([key, entry]) => [key, clean(entry, depth + 1)]));
  };
  return clean(value);
}

function imageData(value, limit) {
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(limit / 3) * 4
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw fail('图片数据无效或超过大小限制');
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.length > limit) throw fail('图片超过大小限制');
  const type = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpg'
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : '';
  if (!type) throw fail('仅支持 PNG、JPG 和 WebP 图片');
  return { bytes, type, mime: `image/${type === 'jpg' ? 'jpeg' : type}` };
}

function folderFor(row) {
  const key = row.chatBinding?.chatKey;
  if (!key) return 'workshop';
  let owner = key;
  try { owner = JSON.stringify(JSON.parse(key).slice(0, 2)); } catch {}
  return path.join(`character-${hash(owner).slice(0, 16)}`, `chat-${hash(key).slice(0, 16)}`);
}

function policy(value = {}) {
  const number = (key, min, max, fallback) => Math.max(min, Math.min(max, Math.round(Number(value[key]) || fallback)));
  return { active: value.active === true,
    cleanupMode: ['manual', 'time', 'count'].includes(value.cleanupMode) ? value.cleanupMode : 'manual',
    cleanupUnit: value.cleanupUnit === 'hours' ? 'hours' : 'days',
    cleanupInterval: number('cleanupInterval', 1, 365, 7),
    cleanupMaxImages: number('cleanupMaxImages', 1, MAX_ROWS, 200),
    cleanupOlderThanDays: number('cleanupOlderThanDays', 1, 3650, 7) };
}

async function atomicFile(target, bytes) {
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, target);
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}

export function createStorageService({ allowedAccounts = null, now = Date.now } = {}) {
  const accounts = new Map();
  const locks = new Map();
  const serialized = (handle, operation) => {
    const work = (locks.get(handle) || Promise.resolve()).catch(() => {}).then(operation);
    locks.set(handle, work);
    void work.finally(() => { if (locks.get(handle) === work) locks.delete(handle); }).catch(() => {});
    return work;
  };
  async function secureDirectory(target, root) {
    await fs.mkdir(target, { recursive: true });
    const actual = await fs.realpath(target);
    const parent = await fs.realpath(root);
    if (actual !== parent && !actual.startsWith(parent + path.sep)) throw fail('图片目录不在账号目录内', 403);
    return actual;
  }
  async function account(user) {
    const handle = user?.profile?.handle;
    if (!validId(handle) || !user?.directories?.root || !user?.directories?.userImages) throw fail('请先登录酒馆账号', 401);
    if (allowedAccounts && !allowedAccounts.includes(handle)) throw fail('当前账号尚未安装服务器存图组件', 403);
    const root = path.resolve(user.directories.root);
    let entry = accounts.get(handle);
    if (entry) {
      if (entry.root !== root) throw fail('账号目录发生变化', 409);
      return entry;
    }
    const metadata = await secureDirectory(path.join(root, 'linghuashi'), root);
    const images = await secureDirectory(path.join(user.directories.userImages, 'linghuashi'), root);
    const file = path.join(metadata, 'index.json');
    let index;
    try { index = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw fail('服务器图片记录无法读取，请检查存储', 500);
      index = { version: 1, revision: 0, rows: {}, chats: {}, policy: policy(), lastCleanup: now(), pendingDelete: [] };
    }
    if (index.version !== 1 || !object(index.rows) || !object(index.chats)) throw fail('服务器图片记录版本无效', 500);
    const results = await secureDirectory(path.join(metadata, 'task-results'), root);
    const tasksFile = path.join(metadata, 'tasks.json');
    const taskFile = (id) => path.join(results, `${id}.bin`);
    const tasks = createTaskLedger({
      now,
      load: async () => {
        try { return JSON.parse(await fs.readFile(tasksFile, 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') return null; throw fail('服务器任务记录无法读取', 500); }
      },
      save: (value) => atomicFile(tasksFile, JSON.stringify(value)),
      writeChunk: async (id, offset, bytes) => {
        const stream = await fs.open(taskFile(id), offset ? 'r+' : 'w', 0o600);
        try {
          let written = 0;
          while (written < bytes.length) {
            const result = await stream.write(bytes, written, bytes.length - written, offset + written);
            if (!result.bytesWritten) throw fail('任务响应无法写入', 500);
            written += result.bytesWritten;
          }
          await stream.sync();
        } finally { await stream.close(); }
      },
      readChunk: async (id, offset, size) => {
        const stream = await fs.open(taskFile(id), 'r');
        try {
          const bytes = Buffer.alloc(size);
          const result = await stream.read(bytes, 0, size, offset);
          return new Uint8Array(bytes.subarray(0, result.bytesRead));
        } finally { await stream.close(); }
      },
      removeResult: (id) => fs.rm(taskFile(id), { force: true }),
    });
    const referencesDirectory = await secureDirectory(path.join(metadata, 'references'), root);
    entry = { handle, root, images, metadata, file, index, tasks, references: createReferenceAssets(referencesDirectory) };
    accounts.set(handle, entry);
    return entry;
  }
  const save = async (entry) => {
    entry.index.revision++;
    await atomicFile(entry.file, JSON.stringify(entry.index));
  };
  const filesFor = (entry, row) => {
    if (!validId(row.id) || !['png', 'jpg', 'webp'].includes(row.extension)
      || !['png', 'jpg', 'webp'].includes(row.thumbExtension)) throw fail('图片记录无效', 500);
    const folder = path.join(entry.images, folderFor(row));
    return [path.join(folder, `${row.id}.${row.extension}`), path.join(folder, `${row.id}.thumb.${row.thumbExtension}`)];
  };
  async function purge(entry) {
    const failed = [];
    for (const row of entry.index.pendingDelete || []) {
      try { for (const file of filesFor(entry, row)) await fs.rm(file, { force: true }); }
      catch { failed.push(row); }
    }
    if (failed.length !== (entry.index.pendingDelete || []).length) {
      entry.index.pendingDelete = failed;
      await save(entry);
    }
  }
  async function remove(entry, ids, allowReferenced, automatic = false) {
    const rows = ids.map((id) => entry.index.rows[id]).filter(Boolean);
    if (!allowReferenced && rows.some((row) => row.chatBinding)) throw fail('所选图片包含聊天配图，请确认后删除', 409);
    const protectedGroups = protectedVersionGroups(Object.values(entry.index.rows));
    const removable = rows.filter((row) => !automatic || !protectedGroups.has(versionGroupId(row)));
    const previous = clone(entry.index);
    entry.index.rows = Object.fromEntries(removeVersions(Object.values(entry.index.rows), removable.map((row) => row.id)).map((row) => [row.id, row]));
    entry.index.pendingDelete = [...(entry.index.pendingDelete || []), ...removable];
    try { await save(entry); } catch (error) { entry.index = previous; throw error; }
    await purge(entry);
    return { ids: removable.map((row) => row.id), pendingFiles: entry.index.pendingDelete.length };
  }
  async function cleanup(entry) {
    await purge(entry);
    const settings = entry.index.policy;
    if (!settings?.active || settings.cleanupMode === 'manual') return { ids: [], due: false };
    const rows = Object.values(entry.index.rows);
    const period = settings.cleanupInterval * (settings.cleanupUnit === 'hours' ? 3600000 : 86400000);
    const due = settings.cleanupMode === 'time' ? now() - entry.index.lastCleanup >= period : rows.length >= settings.cleanupMaxImages;
    if (!due) return { ids: [], due: false };
    const cutoff = now() - settings.cleanupOlderThanDays * 86400000;
    const protectedGroups = protectedVersionGroups(rows);
    const ids = rows.filter((row) => !protectedGroups.has(versionGroupId(row))
      && (settings.cleanupMode === 'time' || row.createdAt < cutoff)).map((row) => row.id);
    const result = await remove(entry, ids, false, true);
    entry.index.lastCleanup = now();
    await save(entry);
    return { ...result, due: true };
  }
  async function dispatch(user, action, body = {}) {
    const handle = user?.profile?.handle;
    return serialized(handle, async () => {
      const entry = await account(user);
      if (action === 'backup/status') return { version: STORAGE_VERSION, protocol: STORAGE_PROTOCOL, account: entry.handle };
      if (action === 'backup/chats') return { rows: Object.values(entry.index.chats) };
      if (action === 'backup/chats-merge') {
        let rows;
        try { rows = normalizeBackupChats(body.rows, new Set(Object.keys(entry.index.rows))); }
        catch (error) { throw fail(error.message); }
        const before = clone(entry.index);
        let imported = 0;
        for (const row of rows) {
          if (entry.index.chats[row.binding.id]) continue;
          entry.index.chats[row.binding.id] = row; imported++;
        }
        try { if (imported) await save(entry); }
        catch (error) { entry.index = before; throw error; }
        return { imported };
      }
      if (REFERENCE_ACTIONS.includes(action)) return entry.references.dispatch(action, body);
      if (TASK_ACTIONS.includes(action)) {
        const result = await entry.tasks.dispatch(action, body);
        const rows = action === 'task/list' ? result.rows : result?.plan ? [result] : [];
        let changed = false;
        for (const task of rows) {
          if (task.plan.imageEdit) continue;
          const id = task.plan.chatBinding?.id;
          const previous = entry.index.chats[id];
          if (!previous || previous.requestId !== task.plan.chatRequestId) continue;
          const recoverable = Boolean(task.execution) || task.stage === 'waiting';
          const status = task.status === 'paused' ? 'failed' : task.status === 'uncertain' ? 'failed' : task.status;
          const next = { ...previous, status, taskId: task.id, phase: task.phase,
            error: task.status === 'paused' ? '任务已恢复，等待手动继续' : task.error,
            recoverable, savedIds: [...new Set([...previous.savedIds, ...task.savedIds])], updatedAt: task.updatedAt };
          if (JSON.stringify(next) !== JSON.stringify(previous)) { entry.index.chats[id] = next; changed = true; }
        }
        if (changed) await save(entry);
        return result;
      }
      if (action === 'list') {
        const rows = Object.values(entry.index.rows);
        return { rows, revision: entry.index.revision, directory: 'user/images/linghuashi',
          bytes: rows.reduce((sum, row) => sum + row.bytes + row.thumbBytes, 0),
          pendingFiles: entry.index.pendingDelete.length, maxRecords: MAX_ROWS };
      }
      if (action === 'image/get') return validId(body.id) ? body.current === true
        ? currentDrawing(Object.values(entry.index.rows), body.id) : entry.index.rows[body.id] || null : null;
      if (action === 'version/select') {
        if (!validId(body.id) || !entry.index.rows[body.id]) throw fail('图片已经删除', 404);
        const before = clone(entry.index);
        entry.index.rows = Object.fromEntries(selectVersion(Object.values(entry.index.rows), body.id).map((row) => [row.id, row]));
        try { await save(entry); } catch (error) { entry.index = before; throw error; }
        return { selected: body.id };
      }
      if (action === 'policy') {
        const next = policy(body);
        if (JSON.stringify(next) !== JSON.stringify(entry.index.policy)) {
          const before = clone(entry.index);
          entry.index.policy = next;
          entry.index.lastCleanup = now();
          try { await save(entry); } catch (error) { entry.index = before; throw error; }
        }
        return { saved: true };
      }
      if (action === 'cleanup') return cleanup(entry);
      if (action === 'add') {
        const value = body.row;
        if (!object(value) || !validId(value.id)) throw fail('图片 ID 无效');
        const image = imageData(body.image, MAX_IMAGE);
        const thumbnail = imageData(body.thumbnail, 1024 * 1024);
        const existing = entry.index.rows[value.id];
        const digest = hash(image.bytes);
        if (existing) {
          if (existing.digest !== digest) throw fail('同 ID 图片内容不同，请重新导入', 409);
          return { row: existing, existing: true };
        }
        if (Object.keys(entry.index.rows).length >= MAX_ROWS) throw fail('服务器最多保存 10000 张图片，请先导出并清理', 409);
        const snapshot = safeSnapshot(value.snapshot);
        const width = Number(value.width); const height = Number(value.height);
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 40000000) throw fail('图片尺寸无效');
        const createdAt = Number(value.createdAt);
        const row = {
          id: value.id, title: text(value.title, 100) || '未命名图片',
          createdAt: Number.isFinite(createdAt) && createdAt > 0 && createdAt <= now() + 86400000 ? createdAt : now(),
          source: snapshot?.provider || 'unknown', snapshot, favorite: value.favorite === true, demo: false,
          batchId: text(value.batchId, 80), chatBinding: binding(value.chatBinding),
          version: normalizeVersion(value.version, value.id), versionCurrent: value.versionCurrent !== false,
          width, height, bytes: image.bytes.length, thumbBytes: thumbnail.bytes.length,
          mime: image.mime, thumbMime: thumbnail.mime, extension: image.type, thumbExtension: thumbnail.type, digest,
        };
        const merged = insertVersion(Object.values(entry.index.rows), row);
        Object.assign(row, merged.at(-1));
        const [original, thumb] = filesFor(entry, row);
        await secureDirectory(path.dirname(original), entry.images);
        const before = clone(entry.index);
        try {
          await atomicFile(original, image.bytes);
          await atomicFile(thumb, thumbnail.bytes);
          entry.index.rows = Object.fromEntries(merged.map((item) => [item.id, item]));
          if (row.chatBinding && !row.version.parentId) {
            const id = row.chatBinding.id;
            const previous = entry.index.chats[id];
            const sameRequest = !body.requestId || !previous || previous.requestId === body.requestId;
            if (sameRequest) {
              const savedIds = [...new Set([...(previous?.savedIds || []), row.id])];
              const batch = Object.values(entry.index.rows).filter((item) => item.batchId === row.batchId && item.chatBinding?.id === id);
              const complete = !body.requestId || batch.length >= Math.max(1, Math.min(32, Number(body.batchSize) || 1));
              entry.index.chats[id] = { ...previous, binding: row.chatBinding,
                requestId: previous?.requestId || body.requestId || row.batchId || row.id,
                status: complete ? 'completed' : 'running', phase: complete ? '' : 'saving',
                savedIds, updatedAt: now(), error: '', recoverable: false };
            }
          }
          await save(entry);
        } catch (error) {
          entry.index = before;
          await Promise.all([original, thumb].map((file) => fs.rm(file, { force: true }).catch(() => {})));
          throw error;
        }
        return { row };
      }
      if (action === 'favorite') {
        if (!validId(body.id) || typeof body.favorite !== 'boolean') throw fail('收藏参数无效');
        if (!entry.index.rows[body.id]) throw fail('图片已经删除', 404);
        const previous = clone(entry.index);
        entry.index.rows[body.id].favorite = body.favorite;
        try { await save(entry); } catch (error) { entry.index = previous; throw error; }
        return { saved: true };
      }
      if (action === 'remove') {
        if (!Array.isArray(body.ids) || body.ids.length > MAX_ROWS || !body.ids.every(validId)) throw fail('删除列表无效');
        return remove(entry, [...new Set(body.ids)], body.allowReferenced === true);
      }
      if (action === 'chat/list') {
        if (typeof body.chatKey !== 'string' || body.chatKey.length > 2048) throw fail('聊天标识无效');
        return Object.values(entry.index.chats).filter((row) => row.binding.chatKey === body.chatKey);
      }
      if (action === 'chat/get') return validId(body.id) ? entry.index.chats[body.id] || null : null;
      if (action === 'chat/reserve') {
        const bound = binding(body.binding);
        if (!bound || !validId(body.requestId)) throw fail('聊天任务参数无效');
        const previous = entry.index.chats[bound.id];
        if (previous && body.force !== true) return null;
        if (previous && previous.requestId !== body.previousRequestId) return null;
        const before = clone(entry.index);
        const row = { binding: bound, requestId: body.requestId, status: 'preparing', savedIds: [], updatedAt: now() };
        entry.index.chats[bound.id] = row;
        try { await save(entry); } catch (error) { entry.index = before; throw error; }
        return row;
      }
      if (action === 'chat/update') {
        const previous = entry.index.chats[body.id];
        if (!previous || previous.requestId !== body.requestId) return null;
        const value = body.value;
        if (!object(value) || !['preparing', 'confirming', 'queued', 'running', 'completed', 'failed', 'cancelled', 'drafted', 'skipped'].includes(value.status)) throw fail('聊天任务状态无效');
        if (previous.status === 'completed' && ['preparing', 'confirming', 'queued', 'running'].includes(value.status)) return previous;
        const before = clone(entry.index);
        const savedIds = Array.isArray(value.savedIds) ? value.savedIds.filter(validId).slice(0, 32) : previous.savedIds;
        const row = { ...previous, status: value.status, phase: text(value.phase, 30), error: text(value.error, 500),
          recoverable: value.recoverable === true, savedIds: [...new Set([...previous.savedIds, ...savedIds])], updatedAt: now() };
        if (value.assistant && object(value.assistant)) {
          try { row.assistant = storedAssistantPlan(value.assistant,
            (scene) => safeSnapshot({ provider: 'novelai', characterScene: scene }).characterScene); }
          catch (error) { throw fail(error.message); }
        }
        entry.index.chats[body.id] = row;
        try { await save(entry); } catch (error) { entry.index = before; throw error; }
        return row;
      }
      if (action === 'audit') {
        const expected = new Set(Object.values(entry.index.rows).flatMap((row) => filesFor(entry, row)));
        for (const row of entry.index.pendingDelete) filesFor(entry, row).forEach((file) => expected.add(file));
        const missing = [];
        for (const row of Object.values(entry.index.rows)) {
          if (await Promise.all(filesFor(entry, row).map((file) => fs.access(file).then(() => false, () => true))).then((flags) => flags.some(Boolean))) missing.push(row.id);
        }
        let orphans = 0;
        const walk = async (directory) => {
          for (const item of await fs.readdir(directory, { withFileTypes: true })) {
            const file = path.join(directory, item.name);
            if (item.isDirectory()) await walk(file);
            else if (item.isFile() && !expected.has(file)) orphans++;
          }
        };
        await walk(entry.images);
        return { missing, orphans, pendingFiles: entry.index.pendingDelete.length };
      }
      throw fail('未知存储操作', 404);
    });
  }
  async function image(user, id, thumbnail = false) {
    if (!validId(id)) throw fail('图片 ID 无效');
    return serialized(user?.profile?.handle, async () => {
      const entry = await account(user);
      const row = entry.index.rows[id];
      if (!row) throw fail('图片已经删除', 404);
      const file = filesFor(entry, row)[thumbnail ? 1 : 0];
      await fs.access(file).catch(() => { throw fail('服务器图片文件缺失', 404); });
      return { file, mime: thumbnail ? row.thumbMime : row.mime };
    });
  }
  return {
    dispatch, image,
    async enroll(user) { return serialized(user.profile.handle, () => account(user)); },
    async tick() {
      await Promise.all([...accounts.values()].map((entry) => serialized(entry.handle, () => cleanup(entry))
        .catch(() => { console.error('[Linghuashi] Scheduled storage cleanup failed'); })));
    },
    async drain() { await Promise.allSettled([...locks.values()]); },
  };
}

let running;
let timer;
export async function init(router) {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  let allowedAccounts = null;
  try { allowedAccounts = JSON.parse(await fs.readFile(path.join(directory, 'allowed-accounts.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (allowedAccounts !== null && (!Array.isArray(allowedAccounts) || !allowedAccounts.every(validId))) throw new Error('Invalid storage account configuration');
  running = createStorageService({ allowedAccounts });
  for (const action of ['list', 'image/get', 'version/select', 'policy', 'cleanup', 'add', 'favorite', 'remove', 'audit', 'chat/list', 'chat/get', 'chat/reserve', 'chat/update', ...TASK_ACTIONS, ...REFERENCE_ACTIONS, ...BACKUP_ACTIONS]) {
    router.post(`/${action}`, async (request, response) => {
      try {
        response.set('Cache-Control', 'no-store');
        response.json(await running.dispatch(request.user, action, request.body));
      } catch (error) { response.status(error.status || 500).json({ error: error.status ? error.message : '服务器图片存储失败，请重试' }); }
    });
  }
  router.get('/image/:id', async (request, response) => {
    try {
      if (request.query.account && request.query.account !== request.user?.profile?.handle) throw fail('图片账号不匹配', 403);
      const result = await running.image(request.user, request.params.id, request.query.thumbnail === '1');
      response.set('Cache-Control', 'private, no-cache');
      response.type(result.mime);
      response.sendFile(result.file);
    } catch (error) { response.status(error.status || 500).json({ error: error.status ? error.message : '服务器图片读取失败' }); }
  });
  if (globalThis.DATA_ROOT) {
    const dataRoot = path.resolve(globalThis.DATA_ROOT);
    const handles = allowedAccounts || (await fs.readdir(dataRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory() && validId(entry.name)).map((entry) => entry.name);
    for (const handle of handles) {
      const root = path.join(dataRoot, handle);
      try {
        await fs.access(path.join(root, 'linghuashi', 'index.json'));
        await running.enroll({ profile: { handle }, directories: { root, userImages: path.join(root, 'user', 'images') } });
      } catch (error) { if (error.code !== 'ENOENT') console.error('[Linghuashi] Saved storage could not be loaded'); }
    }
  }
  timer = setInterval(() => { void running.tick(); }, 60000);
  timer.unref();
  console.log('[Linghuashi] Server image storage ready');
}

export async function exit() {
  clearInterval(timer);
  await running?.drain();
}
