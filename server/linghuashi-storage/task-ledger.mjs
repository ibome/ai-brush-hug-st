import { normalizeVersion, validImageId } from './image-versions.mjs';

export const TASK_ACTIONS = [
  'task/list', 'task/create', 'task/claim', 'task/heartbeat', 'task/update',
  'task/execution-put', 'task/execution-get', 'task/cancel', 'task/clear', 'task/configure',
];
export const CHUNK_SIZE = 512 * 1024;
export const LEASE_MS = 30000;
const MAX_RESULT = 200 * 1024 * 1024;
const MAX_TOTAL = 512 * 1024 * 1024;
const MAX_TASKS = 100;
const MAX_PENDING = 32;
const idOK = (value) => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const clone = (value) => JSON.parse(JSON.stringify(value));
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const terminal = (row) => ['completed', 'cancelled'].includes(row.status);
const finished = (row) => terminal(row)
  || row.status === 'failed' && row.stage === 'rejected' && !row.execution && !row.captureSize;
const scheduling = (value = {}) => ({
  generationMode: value.generationMode === 'parallel' ? 'parallel' : 'queue',
  concurrency: Math.max(1, Math.min(16, Math.round(Number(value.concurrency) || 2))),
  queueInterval: Math.max(0, Math.min(3600, Number(value.queueInterval) || 0)),
});

function safeValue(value, depth = 0) {
  if (depth > 40) throw fail('任务参数层级过深', 400);
  if (Array.isArray(value)) return value.map((item) => safeValue(item, depth + 1));
  if (!object(value)) return value;
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:api[_-]?(?:key|token).*|authorization|password|access[_-]?token|headers|credentials|secret|__proto__|constructor|prototype)$/i.test(key)) {
      throw fail('任务参数含有秘钥字段，请移除后重试', 400);
    }
    if (key === 'extra' && typeof item === 'string' && item.trim()) {
      try { safeValue(JSON.parse(item), depth + 1); }
      catch (error) { if (error.status) throw error; }
    }
    safeValue(item, depth + 1);
  }
  return clone(value);
}

export function frozenPlan(plan) {
  if (!object(plan) || !['novelai', 'openai', 'comfyui', 'sdwebui'].includes(plan.provider)
    || !object(plan.snapshot) || !object(plan.body)) throw fail('任务参数无效', 400);
  const url = new URL(plan.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || [...url.searchParams.keys()].some((key) => /key|token|secret|password/i.test(key))) {
    throw fail('接口地址不能含有秘钥', 400);
  }
  const result = {
    provider: plan.provider, model: String(plan.model || '').slice(0, 200),
    snapshot: safeValue(plan.snapshot), body: safeValue(plan.body), url: url.href,
    base: plan.base || '', outputNode: plan.outputNode || '',
    timeout: Math.max(5, Math.min(600, Number(plan.timeout) || 600)),
    storageLocation: plan.storageLocation === 'server' ? 'server' : 'browser',
    keyRef: /^(?:tavern|browser):[a-f0-9-]{36}$/.test(plan.keyRef || '') ? plan.keyRef : '',
    ...(plan.provider === 'sdwebui' ? {
      auth: ['basic', 'bearer'].includes(plan.auth) ? plan.auth : 'none',
      username: String(plan.username || '').slice(0, 200),
      sdTaskIdSupported: plan.sdTaskIdSupported === true,
      sdProgressMode: ['internal', 'native'].includes(plan.sdProgressMode) ? plan.sdProgressMode : 'none',
    } : {}),
    identityFields: Array.isArray(plan.identityFields) && plan.identityFields.length === 3
      ? plan.identityFields.map((item) => String(item).slice(0, 512)) : [],
    chatRequestId: plan.chatRequestId || '', chatBinding: plan.chatBinding ? safeValue(plan.chatBinding) : null,
    imageEdit: plan.imageEdit ? normalizeVersion(plan.imageEdit, '') : null,
  };
  if (result.imageEdit && (!validImageId(result.imageEdit.groupId) || !validImageId(result.imageEdit.parentId))) throw fail('单图编辑来源无效', 400);
  if (result.base) {
    const base = new URL(result.base);
    if (base.origin !== url.origin || base.username || base.password || base.search || base.hash) throw fail('工作流地址无效', 400);
  }
  if (result.chatRequestId && !idOK(result.chatRequestId)) throw fail('聊天任务标识无效', 400);
  if (JSON.stringify(result).length > 2000000) throw fail('任务参数过大', 400);
  return result;
}

// Callers serialize all operations per account, including payload writes and metadata commits.
export function createTaskLedger({ load, save, writeChunk, readChunk, removeResult, now = Date.now }) {
  let state;
  async function initialize() {
    state ||= await load() || { version: 1, rows: {}, nextStart: 0 };
    if (state.version !== 1 || !object(state.rows)) throw fail('任务记录无法读取', 500);
  }
  async function commit(change) {
    const before = clone(state);
    try { const value = await change(); await save(state); return value; }
    catch (error) { state = before; throw error; }
  }
  async function releaseFinishedResults() {
    const released = [];
    for (const row of Object.values(state.rows)) {
      if (!terminal(row) || !row.execution && !row.captureSize) continue;
      try { await removeResult(row.id); released.push(row.id); } catch {}
    }
    if (!released.length) return;
    // Saved images live in the image library; these are only temporary provider responses.
    try {
      await commit(() => {
        for (const id of released) {
          delete state.rows[id].execution;
          delete state.rows[id].captureSize;
          delete state.rows[id].captureOffset;
        }
      });
    } catch {}
  }
  function expire(row) {
    if (row.status !== 'running' || row.leaseUntil > now()) return;
    row.status = row.execution ? 'paused' : row.stage === 'waiting' ? 'paused' : 'uncertain';
    row.error = row.status === 'uncertain' ? '请求可能已受理，请核对服务任务记录；不会自动重新提交' : '';
    row.owner = ''; row.token = ''; row.leaseUntil = 0;
  }
  function publicRow(row) {
    const { token, captureSize, captureOffset, ...value } = row;
    return clone(value);
  }
  function renew(row) {
    // Waiting for a provider must survive browser timer suspension during the request.
    const responseWindow = row.stage === 'submitting' && !row.execution
      ? row.plan.timeout * 1000 : 0;
    row.leaseUntil = now() + LEASE_MS + responseWindow;
  }
  function owned(body) {
    const row = state.rows[body.id];
    if (!row || row.owner !== body.owner || row.token !== body.token || row.leaseUntil <= now() || row.status !== 'running') {
      throw fail('任务已由其他页面接管或执行权限已过期');
    }
    if (row.cancelRequested) throw fail('任务已请求取消');
    renew(row);
    row.updatedAt = now();
    return row;
  }
  async function dispatch(action, body = {}) {
    await initialize();
    if (!TASK_ACTIONS.includes(action)) throw fail('未知任务操作', 404);
    if (action === 'task/configure') return commit(() => {
      state.settings = scheduling(body);
      return state.settings;
    });
    if (action === 'task/list') {
      if (Object.values(state.rows).some((row) => row.status === 'running' && row.leaseUntil <= now())) {
        await commit(() => { for (const row of Object.values(state.rows)) expire(row); });
      }
      await releaseFinishedResults();
      return { rows: Object.values(state.rows).map(publicRow), serverTime: now() };
    }
    if (action === 'task/create') {
      if (!idOK(body.id)) throw fail('任务 ID 无效', 400);
      const plan = frozenPlan(body.plan);
      if (state.rows[body.id]) {
        if (JSON.stringify(state.rows[body.id].plan) !== JSON.stringify(plan)) throw fail('同一任务参数不一致');
        return publicRow(state.rows[body.id]);
      }
      if (plan.chatRequestId && Object.values(state.rows).some((row) => row.plan.chatRequestId === plan.chatRequestId)) {
        throw fail('该聊天请求已有任务，请查看原任务记录');
      }
      const rows = Object.values(state.rows);
      if (rows.filter((row) => !finished(row)).length >= MAX_PENDING) {
        throw fail('还有 32 个生图任务需要处理，请打开“查看待处理任务”，等待完成、继续保存或关闭不需要的任务后再试');
      }
      const expired = rows.filter(finished)
        .sort((a, b) => (a.finishedAt || a.updatedAt || a.createdAt) - (b.finishedAt || b.updatedAt || b.createdAt))
        .slice(0, Math.max(0, rows.length - MAX_TASKS + 1));
      const result = await commit(() => {
        for (const row of expired) delete state.rows[row.id];
        const row = { id: body.id, plan, createdAt: now(), updatedAt: now(), status: 'paused',
          stage: 'waiting', phase: 'waiting', attempts: 0, savedIds: [], error: '',
          owner: '', token: '', leaseUntil: 0, cancelRequested: false };
        state.rows[row.id] = row;
        return publicRow(row);
      });
      await Promise.all(expired.map((row) => removeResult(row.id).catch(() => {})));
      return result;
    }
    if (action === 'task/claim') {
      if (!idOK(body.owner) || !idOK(body.token)) throw fail('执行标识无效', 400);
      return commit(() => {
        for (const row of Object.values(state.rows)) expire(row);
        const row = state.rows[body.id];
        if (!row) throw fail('任务不存在', 404);
        if (row.status === 'running' && row.owner === body.owner && row.token === body.token) return { ...publicRow(row), token: row.token };
        if (row.status === 'running') return { busy: true };
        const captureOnly = body.captureOnly === true && row.stage === 'submitting' && !row.execution;
        if (terminal(row) || (row.status === 'uncertain' && !captureOnly)
          || (!row.execution && row.stage !== 'waiting' && !captureOnly)) throw fail('该任务不能再次提交，请先核对生成结果');
        state.settings ||= scheduling(body.settings);
        const settings = state.settings;
        const limit = settings.generationMode === 'parallel' ? Math.max(1, Math.min(16, Number(settings.concurrency) || 2)) : 1;
        if (Object.values(state.rows).filter((item) => item.status === 'running').length >= limit
          || state.nextStart > now()) return { busy: true, retryAfter: Math.max(1000, state.nextStart - now()) };
        row.status = 'running'; row.owner = body.owner; row.token = body.token; renew(row);
        row.phase = row.execution ? 'retrieving' : 'waiting'; row.error = ''; row.cancelRequested = false;
        row.attempts++; row.startedAt = now(); row.updatedAt = now();
        row.interval = settings.generationMode === 'parallel' ? 0 : Math.max(0, Math.min(3600, Number(settings.queueInterval) || 0)) * 1000;
        return { ...publicRow(row), token: row.token };
      });
    }
    if (action === 'task/heartbeat') {
      const row = state.rows[body.id];
      if (row?.cancelRequested && row.owner === body.owner && row.token === body.token) return { cancelled: true };
      return commit(() => { const current = owned(body); return { leaseUntil: current.leaseUntil }; });
    }
    if (action === 'task/execution-put') {
      await releaseFinishedResults();
      return commit(async () => {
        const row = owned(body);
        if (!['submitting', 'accepted', 'saving'].includes(row.stage)) throw fail('任务尚未提交');
        if (body.promptId !== undefined) {
          if (row.plan.provider !== 'comfyui' || typeof body.promptId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(body.promptId)) throw fail('ComfyUI 任务标识无效', 400);
          if (row.execution && row.execution.promptId !== body.promptId) throw fail('任务标识不一致');
          row.execution = { promptId: body.promptId };
        } else {
          if (row.plan.provider === 'comfyui' || !Number.isSafeInteger(body.total) || body.total < 1 || body.total > MAX_RESULT
            || !Number.isSafeInteger(body.offset) || body.offset < 0 || typeof body.data !== 'string'
            || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.data) || body.data.length > Math.ceil(CHUNK_SIZE / 3) * 4) throw fail('任务响应块无效', 400);
          const bytes = Uint8Array.from(atob(body.data), (char) => char.charCodeAt(0));
          if (!bytes.length || bytes.length > CHUNK_SIZE || body.offset + bytes.length > body.total) throw fail('任务响应块大小无效', 400);
          const total = Object.values(state.rows).reduce((sum, item) => sum + (item.execution?.size || item.captureSize || 0), 0);
          if (total - (row.captureSize || row.execution?.size || 0) + body.total > MAX_TOTAL) {
            throw fail('待保存的图片响应已达到 512 MB，请打开“查看待处理任务”，继续保存已有图片或关闭不需要的任务后再试');
          }
          if (row.captureSize && row.captureSize !== body.total) throw fail('任务响应大小不一致');
          const offset = row.captureOffset || 0;
          if (body.offset > offset) throw fail('任务响应块不连续');
          if (body.offset < offset) {
            const previous = await readChunk(row.id, body.offset, bytes.length);
            if (previous.length !== bytes.length || previous.some((byte, index) => byte !== bytes[index])) throw fail('任务响应块内容不一致');
          } else {
            await writeChunk(row.id, body.offset, bytes);
            row.captureOffset = body.offset + bytes.length;
          }
          row.captureSize = body.total;
          if (row.captureOffset === body.total) row.execution = { size: body.total };
        }
        if (row.execution) { row.stage = 'accepted'; row.phase = 'retrieving'; renew(row); }
        return { accepted: Boolean(row.execution), offset: row.captureOffset || 0 };
      });
    }
    if (action === 'task/execution-get') {
      const row = owned(body);
      if (!row.execution?.size || !Number.isSafeInteger(body.offset) || body.offset < 0 || body.offset >= row.execution.size) throw fail('可恢复响应不存在', 404);
      const bytes = await readChunk(row.id, body.offset, Math.min(CHUNK_SIZE, row.execution.size - body.offset));
      if (!bytes.length) throw fail('任务响应文件缺失', 500);
      let text = ''; for (const byte of bytes) text += String.fromCharCode(byte);
      return { data: btoa(text), total: row.execution.size };
    }
    if (action === 'task/update') {
      await commit(() => {
        // Finalizing a cancelled worker still requires its unexpired fencing token.
        const candidate = state.rows[body.id];
        const cancelled = candidate?.cancelRequested;
        if (cancelled && ['completed', 'failed', 'cancelled'].includes(body.value?.status)
          && candidate.owner === body.owner && candidate.token === body.token) candidate.cancelRequested = false;
        const row = owned(body);
        const value = body.value || {};
        if (value.stage === 'submitting') {
          if (row.stage !== 'waiting' || row.execution) throw fail('任务已经提交过，禁止重复提交');
          row.stage = 'submitting'; row.phase = 'submitting';
          renew(row);
        } else if (value.stage === 'saving') {
          if (!row.execution) throw fail('任务响应尚未保存');
          row.stage = 'saving'; row.phase = 'saving';
          row.imageCount = Math.max(1, Math.min(32, Number(value.imageCount) || 1));
        }
        if (value.status) {
          if (!['completed', 'failed', 'cancelled'].includes(value.status)) throw fail('任务状态无效', 400);
          if (value.status === 'completed' && !row.execution) throw fail('任务结果尚未保存');
          row.status = value.status;
          if (value.status !== 'completed' && !row.execution && row.stage !== 'waiting') {
            row.status = value.rejected === true ? 'failed' : 'uncertain';
            if (value.rejected === true) row.stage = 'rejected';
          }
          row.error = String(value.error || '').slice(0, 500);
          if (row.status === 'uncertain') row.error = '请求可能已受理，请核对服务任务记录；不会自动重新提交';
          row.savedIds = Array.isArray(value.savedIds) ? value.savedIds.filter((id) => /^[A-Za-z0-9_-]{1,80}$/.test(id)).slice(0, 32) : row.savedIds;
          row.phase = row.status === 'completed' ? 'done' : row.phase;
          row.finishedAt = now(); row.owner = ''; row.token = ''; row.leaseUntil = 0;
          state.nextStart = Math.max(state.nextStart, now() + row.interval, now() + Math.min(3600000, Math.max(0, Number(value.cooldown) || 0)));
        } else if (cancelled) row.cancelRequested = true;
        return publicRow(row);
      });
      await releaseFinishedResults();
      return publicRow(state.rows[body.id]);
    }
    if (action === 'task/cancel') {
      await commit(() => {
        const row = state.rows[body.id];
        if (!row) throw fail('任务不存在', 404);
        expire(row);
        if (row.status === 'running') row.cancelRequested = true;
        else if (!terminal(row)) { row.status = 'cancelled'; row.finishedAt = now(); }
        row.updatedAt = now();
        return publicRow(row);
      });
      await releaseFinishedResults();
      return publicRow(state.rows[body.id]);
    }
    if (action === 'task/clear') {
      if (body.ids !== undefined && (!Array.isArray(body.ids) || body.ids.length > MAX_TASKS || !body.ids.every(idOK))) throw fail('清理任务列表无效', 400);
      const ids = Object.values(state.rows).filter((row) => finished(row) && (!body.ids || body.ids.includes(row.id))).map((row) => row.id);
      await commit(() => { for (const id of ids) delete state.rows[id]; });
      await Promise.all(ids.map((id) => removeResult(id).catch(() => {})));
      return { cleared: ids.length };
    }
  }
  return { dispatch };
}
