import { randomUUID } from './crypto-compat.js';
import { createTaskLedger, frozenPlan, CHUNK_SIZE } from '../server/linghuashi-storage/task-ledger.mjs';
import { sdwebuiHeaders } from './sdwebui.js';

const toBase64 = (bytes) => {
  let text = ''; for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
};
const fromBase64 = (text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

export function createBrowserTaskRequest(name) {
  const opened = new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('tasks');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  async function read(key) {
    const db = await opened;
    return new Promise((resolve, reject) => {
      const request = db.transaction('tasks').objectStore('tasks').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function write(key, value, remove = false) {
    const db = await opened;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('tasks', 'readwrite');
      if (remove) tx.objectStore('tasks').delete(key);
      else tx.objectStore('tasks').put(value, key);
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => {};
    });
  }
  let work = Promise.resolve();
  return (action, body = {}) => {
    const run = async () => {
      const ledger = createTaskLedger({
        load: () => read('index'), save: (value) => write('index', value),
        writeChunk: (id, offset, bytes) => write(`${id}:${offset}`, bytes),
        readChunk: async (id, offset, size) => {
          const base = Math.floor(offset / CHUNK_SIZE) * CHUNK_SIZE;
          return (await read(`${id}:${base}`) || new Uint8Array()).slice(offset - base, offset - base + size);
        },
        removeResult: (id) => write(IDBKeyRange.bound(`${id}:`, `${id}:\uffff`), null, true),
      });
      return ledger.dispatch(action, body);
    };
    const locked = () => navigator.locks ? navigator.locks.request(name, run) : run();
    work = work.catch(() => {}).then(locked);
    return work;
  };
}

export class TaskPersistence {
  constructor({ request, settings, readKey, changed = () => {} }) {
    this.request = request; this.settings = settings; this.readKey = readKey; this.changed = changed;
    this.owner = randomUUID();
  }
  list() { return this.request('task/list'); }
  async clearLegacyHistory({ responses = false } = {}) {
    const { rows } = await this.list();
    const ended = rows.filter((row) => ['completed', 'cancelled'].includes(row.status)
      && (!responses || row.execution?.size))
      .sort((a, b) => (a.finishedAt || a.updatedAt || a.createdAt) - (b.finishedAt || b.updatedAt || b.createdAt));
    const ids = (responses ? ended : ended.slice(0, Math.max(1, rows.length - 99))).slice(0, 100).map((row) => row.id);
    return ids.length ? (await this.request('task/clear', { ids })).cleared : 0;
  }
  async create(plan, id = randomUUID()) {
    const body = { id, plan: frozenPlan(plan) };
    try { return await this.request('task/create', body); }
    catch (error) {
      if (!/^最多保留 100 条任务/.test(error.message) || !await this.clearLegacyHistory()) throw error;
      return this.request('task/create', body);
    }
  }
  async claim(job) {
    const token = randomUUID();
    const retained = job.execution;
    const result = await this.request('task/claim', { id: job.id, owner: this.owner, token,
      captureOnly: Boolean(retained?.bytes), settings: this.settings() });
    if (result.busy) return result;
    job.durable = { token };
    job.execution = result.execution || retained;
    job.plan = { ...result.plan, headers: {} };
    job.savedIds = result.savedIds;
    job.imageCount = result.imageCount;
    job.stage = result.stage;
    job.attempts = result.attempts;
    let activeKey = '';
    if (job.plan.keyRef) {
      try {
        const key = await this.readKey(job.plan.provider, job.plan.keyRef);
        if (!key) throw new Error();
        activeKey = key.trim();
        Object.assign(job.plan.headers, job.plan.provider === 'sdwebui' ? sdwebuiHeaders(job.plan, key) : { Authorization: `Bearer ${key.trim()}` });
      } catch { throw new Error('原任务的秘钥无法读取，请在原设备恢复该秘钥；任务参数已保留'); }
    }
    if (job.plan.provider === 'openai' && job.plan.identityFields.length === 3) {
      job.plan.identity = JSON.stringify([...job.plan.identityFields, activeKey]);
    }
    job.checkpoint = async (value) => {
      const row = await this.update(job, value);
      job.stage = row.stage;
      return row;
    };
    job.persistExecution = () => this.capture(job);
    job.heartbeat = setInterval(() => {
      void this.call(job, 'task/heartbeat').then((result) => {
        if (result.cancelled) job.controller.abort(new DOMException('任务已取消', 'AbortError'));
      }).catch(() => {
        job.controller.abort(new Error('任务执行权限无法续期，已停止后续操作'));
      });
    }, 8000);
    return result;
  }
  call(job, action, body = {}) {
    return this.request(action, { id: job.id, owner: this.owner, token: job.durable.token, ...body });
  }
  update(job, value) { return this.call(job, 'task/update', { value }); }
  async capture(job) {
    if (job.execution.promptId) await this.call(job, 'task/execution-put', { promptId: job.execution.promptId });
    else {
      const bytes = job.execution.bytes;
      for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
        const body = { offset, total: bytes.length, data: toBase64(bytes.subarray(offset, offset + CHUNK_SIZE)) };
        try { await this.call(job, 'task/execution-put', body); }
        catch (error) {
          if (!/^待恢复响应超过 512 MB/.test(error.message)
            || !await this.clearLegacyHistory({ responses: true })) throw error;
          await this.call(job, 'task/execution-put', body);
        }
      }
    }
    job.executionPersisted = true;
  }
  async hydrate(job) {
    if (job.execution?.bytes && !job.executionPersisted) await this.capture(job);
    if (!job.execution?.size || job.execution.bytes) return;
    const bytes = new Uint8Array(job.execution.size);
    for (let offset = 0; offset < bytes.length;) {
      const result = await this.call(job, 'task/execution-get', { offset });
      const chunk = fromBase64(result.data);
      if (!chunk.length || offset + chunk.length > bytes.length) throw new Error('任务响应文件不完整');
      bytes.set(chunk, offset); offset += chunk.length;
    }
    job.execution.bytes = bytes;
    job.executionPersisted = true;
  }
  async finish(job, error) {
    clearInterval(job.heartbeat);
    delete job.heartbeat;
    if (!job.durable) return;
    const result = await this.update(job, {
      status: job.status, savedIds: job.savedIds || [],
      error: job.error || '', cooldown: error?.cooldown || 0,
      rejected: [400, 401, 402, 403, 404, 413, 422, 429].includes(error?.status),
    });
    job.status = result.status;
    job.error = result.error;
    job.stage = result.stage;
    delete job.plan.headers;
    delete job.durable;
  }
  cancel(id) { return this.request('task/cancel', { id }); }
  clear() { return this.request('task/clear'); }
  configure() { return this.request('task/configure', this.settings()); }
}
