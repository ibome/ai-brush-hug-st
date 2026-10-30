import { randomUUID, sha256Hex } from './crypto-compat.js';
import { canRecoverGeneration } from './generation-recovery.js';
export const EXTENSION_API_VERSION = 1;
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const clone = (value) => structuredClone(value);
export const externalSource = (value = { id: 'external', name: '其他扩展' }) => {
  if (!object(value) || !identifier(value.id) || typeof value.name !== 'string'
    || !value.name.trim() || value.name.length > 60) throw apiError('INVALID_SOURCE', '扩展来源需包含有效 id 和 1 至 60 字的名称');
  return { id: value.id, name: value.name.trim() };
};
export function apiError(code, message, taskId = '') {
  return Object.assign(new Error(message), { name: code === 'CANCELLED' ? 'AbortError' : 'LinghuashiError', code, ...(taskId ? { taskId } : {}) });
}
export function normalizeExtensionOptions(value) {
  if (!object(value)) throw apiError('INVALID_OPTIONS', '请传入生图参数对象');
  const allowed = new Set(['prompt', 'negativePrompt', 'artist', 'provider', 'presetId', 'params',
    'requestId', 'storageLocation', 'useCharacterProfiles', 'useAdvanced', 'chat']);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw apiError('INVALID_OPTIONS', '包含不支持的参数；接口地址和秘钥请在灵画师内配置');
  if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 32000) {
    throw apiError('INVALID_OPTIONS', '正向提示词需为 1 至 32000 字符');
  }
  const result = { prompt: value.prompt.trim() };
  for (const [key, maximum] of [['negativePrompt', 32000], ['artist', 4000]]) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== 'string' || value[key].length > maximum) throw apiError('INVALID_OPTIONS', `${key} 超过限制或不是文本`);
      result[key] = value[key];
    }
  }
  if (value.provider !== undefined) {
    if (!['novelai', 'openai', 'comfyui', 'sdwebui'].includes(value.provider)) throw apiError('INVALID_OPTIONS', '未知生图模式');
    result.provider = value.provider;
  }
  for (const key of ['presetId', 'requestId']) if (value[key] !== undefined) {
    if (!identifier(value[key])) throw apiError('INVALID_OPTIONS', `${key} 格式无效`);
    result[key] = value[key];
  }
  if (value.storageLocation !== undefined) {
    if (!['browser', 'server'].includes(value.storageLocation)) throw apiError('INVALID_OPTIONS', '未知图片存储位置');
    result.storageLocation = value.storageLocation;
  }
  for (const key of ['useCharacterProfiles', 'useAdvanced']) if (value[key] !== undefined) {
    if (typeof value[key] !== 'boolean') throw apiError('INVALID_OPTIONS', `${key} 需为布尔值`);
    result[key] = value[key];
  }
  if (value.params !== undefined) {
    if (!object(value.params) || Object.keys(value.params).length > 32) throw apiError('INVALID_OPTIONS', 'params 无效');
    result.params = {};
    for (const key of Object.keys(value.params).sort()) {
      const item = value.params[key];
      if (!/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(key)
        || !['string', 'number', 'boolean'].includes(typeof item)
        || typeof item === 'number' && !Number.isFinite(item)
        || typeof item === 'string' && item.length > 500) throw apiError('INVALID_OPTIONS', 'params 仅支持有限的生图参数');
      result.params[key] = item;
    }
  }
  if (value.chat !== undefined) {
    const chat = value.chat;
    if (!object(chat) || Object.keys(chat).some((key) => !['chatKey', 'messageId', 'slot'].includes(key))
      || typeof chat.chatKey !== 'string' || !chat.chatKey || chat.chatKey.length > 2048
      || !Number.isSafeInteger(chat.messageId) || chat.messageId < 0
      || !Number.isSafeInteger(chat.slot) || chat.slot < 0 || chat.slot > 15) {
      throw apiError('INVALID_OPTIONS', '聊天目标需包含 chatKey、messageId 和 slot');
    }
    result.chat = { chatKey: chat.chatKey, messageId: chat.messageId, slot: chat.slot };
  }
  return result;
}
export async function extensionDigest(value) {
  return sha256Hex(new TextEncoder().encode(JSON.stringify(value)));
}
export async function extensionTaskId(source, requestId) {
  const hash = await extensionDigest(['linghuashi-extension-v1', source.id, requestId]);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}
export function extensionMetadata(value) {
  if (!object(value) || value.apiVersion !== EXTENSION_API_VERSION || !identifier(value.requestId)
    || !/^[a-f0-9]{64}$/.test(value.fingerprint || '')) return null;
  try { return { apiVersion: EXTENSION_API_VERSION, source: externalSource(value.source),
    requestId: value.requestId, fingerprint: value.fingerprint }; } catch { return null; }
}
export function publicExtensionTask(job) {
  const metadata = extensionMetadata(job.plan?.snapshot?.extensionRequest);
  if (!metadata) throw apiError('TASK_NOT_FOUND', '未找到此扩展的任务');
  const task = { id: job.id, requestId: metadata.requestId, source: metadata.source,
    provider: job.plan.provider, model: job.plan.model, status: job.status, phase: job.phase || 'waiting',
    storageLocation: job.plan.storageLocation, createdAt: job.createdAt,
    startedAt: job.startedAt || null, finishedAt: job.finishedAt || null,
    imageIds: [...(job.savedIds || [])], imageCount: job.imageCount || job.savedIds?.length || 0,
    error: String(job.error || '').replace(/\b(?:pst-|sk-|STD-)[A-Za-z0-9_-]+/g, '[已隐藏]').slice(0, 500),
    cancellable: ['queued', 'running', 'paused', 'uncertain', 'failed'].includes(job.status)
      && !(job.status === 'running' && job.phase === 'saving'),
    recoverable: canRecoverGeneration(job) };
  const progress = job.progress;
  if (progress && Number.isFinite(progress.value) && Number.isFinite(progress.max)
    && progress.value >= 0 && progress.max > 0) task.progress = {
    value: Math.min(progress.value, progress.max), max: progress.max,
    ...(typeof progress.node === 'string' ? { node: progress.node.slice(0, 80) } : {}),
  };
  return task;
}

// This bridge is used only between the Tavern host and its own extension iframe.
export function createExtensionAPI({ version, ensureReady, send, timeout = 150000 }) {
  const pending = new Map(), subscriptions = new Map(), urls = new Map();
  let destroyed = false;
  function revoke(key) {
    for (const url of urls.get(key) || []) URL.revokeObjectURL(url);
    urls.delete(key);
  }
  function receive(data) {
    if (data?.type === 'linghuashi:extension-response') {
      const request = pending.get(data.requestId);
      if (request) request.finish(data.error ? apiError(data.error.code || 'REQUEST_FAILED', data.error.message, data.error.taskId) : null, data.value);
    } else if (data?.type === 'linghuashi:extension-task' && data.task?.source?.id && data.task?.id) {
      for (const callback of subscriptions.get(`${data.task.source.id}:${data.task.id}`) || []) {
        try { callback(clone(data.task)); } catch { /* A consumer callback must not interrupt the queue. */ }
      }
    }
  }
  async function request(source, action, body = {}, { signal } = {}) {
    if (destroyed) throw apiError('UNAVAILABLE', '灵画师已卸载，请刷新后重试');
    signal?.throwIfAborted();
    await ensureReady();
    signal?.throwIfAborted();
    if (destroyed) throw apiError('UNAVAILABLE', '灵画师已卸载');
    if (pending.size >= 64) throw apiError('BUSY', '扩展接口请求过多，请稍后重试');
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      const abort = () => {
        send('linghuashi:extension-abort', { requestId });
        finish(apiError('CANCELLED', '扩展调用已取消'));
      };
      const finish = (error, value) => {
        if (!pending.delete(requestId)) return;
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(value);
      };
      const timer = setTimeout(() => {
        finish(apiError('REQUEST_TIMEOUT', '调用超时，请用原 requestId 查询任务，勿重复创建新请求'));
      }, timeout);
      pending.set(requestId, { finish });
      signal?.addEventListener('abort', abort, { once: true });
      try { send('linghuashi:extension-request', { requestId, apiVersion: EXTENSION_API_VERSION, source, action, body }); }
      catch { finish(apiError('UNAVAILABLE', '灵画师连接已中断')); }
    });
  }
  function connect(input) {
    const source = externalSource(input);
    const resultKey = (id) => `${source.id}:${id}`;
    const subscribe = (id, callback) => {
      if (typeof id !== 'string' || typeof callback !== 'function') throw apiError('INVALID_OPTIONS', '请提供任务编号和进度回调');
      const key = resultKey(id), callbacks = subscriptions.get(key) || new Set();
      callbacks.add(callback); subscriptions.set(key, callbacks);
      return () => { callbacks.delete(callback); if (!callbacks.size) subscriptions.delete(key); };
    };
    const getResult = async (id) => {
      const value = await request(source, 'result', { id });
      const key = resultKey(id);
      const created = [];
      const images = value.images.map(({ blob, thumbnail, url, thumbnailUrl, ...image }) => {
        if (blob instanceof Blob) { url = URL.createObjectURL(blob); created.push(url); }
        if (thumbnail instanceof Blob) { thumbnailUrl = URL.createObjectURL(thumbnail); created.push(thumbnailUrl); }
        return { ...image, url, thumbnailUrl };
      });
      // Previously returned URLs stay usable until releaseResult or page unload.
      urls.set(key, [...(urls.get(key) || []), ...created]);
      return { ...value, images };
    };
    const submit = (options, controls) => request(source, 'submit', normalizeExtensionOptions(options), controls);
    const getTask = (id, controls) => request(source, 'get', { id }, controls);
    const cancelTask = (id) => request(source, 'cancel', { id });
    const generate = async (options, { signal, onProgress, timeoutMs = 1800000 } = {}) => {
      if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 86400000) throw apiError('INVALID_OPTIONS', 'timeoutMs 需为 1000 至 86400000 毫秒');
      if (onProgress !== undefined && typeof onProgress !== 'function') throw apiError('INVALID_OPTIONS', 'onProgress 需为函数');
      const task = await submit(options, { signal });
      let stopped = false, timer, wake;
      const deadline = Date.now() + timeoutMs;
      const notify = (value) => { try { onProgress?.(clone(value)); } catch { /* Isolate extension callbacks. */ } };
      const unsubscribe = subscribe(task.id, (value) => { notify(value); wake?.(); });
      const abort = () => { stopped = true; void cancelTask(task.id).catch(() => {}); wake?.(); };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      try {
        let current = task;
        while (true) {
          if (stopped) throw apiError('CANCELLED', '生图等待已取消', task.id);
          notify(current);
          if (current.status === 'completed') return await getResult(task.id);
          if (['cancelled', 'failed', 'paused', 'uncertain'].includes(current.status)) {
            throw apiError(`TASK_${current.status.toUpperCase()}`, current.error || `任务状态：${current.status}`, task.id);
          }
          if (Date.now() >= deadline) throw apiError('WAIT_TIMEOUT', '等待超时，任务仍可按编号查询', task.id);
          await new Promise((resolve) => {
            wake = resolve;
            timer = setTimeout(resolve, Math.min(1500, deadline - Date.now()));
          });
          clearTimeout(timer); wake = null;
          if (!stopped) current = await getTask(task.id, { signal });
        }
      } finally { clearTimeout(timer); unsubscribe(); signal?.removeEventListener('abort', abort); }
    };
    return Object.freeze({ source: Object.freeze(source), submit, generate, getTask, getResult, cancelTask,
      listTasks: () => request(source, 'list'),
      listPresets: (provider) => request(source, 'presets', { provider }),
      getCapabilities: () => request(source, 'capabilities'),
      subscribe,
      releaseResult: (id) => revoke(resultKey(id)),
    });
  }
  const client = connect();
  return { api: Object.freeze({ version, apiVersion: EXTENSION_API_VERSION, ...client, connect,
    ready: client.getCapabilities }), receive,
    destroy() {
      destroyed = true;
      for (const entry of pending.values()) entry.finish(apiError('UNAVAILABLE', '灵画师已卸载'));
      subscriptions.clear();
      for (const key of urls.keys()) revoke(key);
    } };
}
