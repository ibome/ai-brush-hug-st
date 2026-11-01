import { randomUUID } from './crypto-compat.js';
import { EXTENSION_API_VERSION, apiError, externalSource, extensionDigest, extensionMetadata,
  extensionTaskId, normalizeExtensionOptions, publicExtensionTask } from './extension-api.js';

export function createExtensionTaskService({ queue, ready, refresh, state, prepare, create, result, capabilities, presets, abandon = () => {} }) {
  let submissions = Promise.resolve();
  const active = new Map(), submitted = new Map(), reports = new Map();
  const owned = (job, source) => extensionMetadata(job?.plan?.snapshot?.extensionRequest)?.source.id === source.id;
  async function find(id, source) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw apiError('TASK_NOT_FOUND', '任务编号无效');
    await refresh();
    const job = queue.jobs.find((row) => row.id === id && owned(row, source));
    if (!job) throw apiError('TASK_NOT_FOUND', '未找到此扩展的任务');
    return job;
  }
  async function submit(source, input, signal) {
    const options = normalizeExtensionOptions(input);
    const requestId = options.requestId || randomUUID();
    delete options.requestId;
    const fingerprint = await extensionDigest(options);
    const id = await extensionTaskId(source, requestId);
    await refresh();
    const previous = queue.jobs.find((row) => row.id === id);
    if (previous) {
      if (!owned(previous, source) || extensionMetadata(previous.plan.snapshot.extensionRequest).fingerprint !== fingerprint) {
        throw apiError('REQUEST_CONFLICT', '此 requestId 已用于不同参数，请查询原任务或使用新的编号', id);
      }
      return publicExtensionTask(previous);
    }
    signal.throwIfAborted();
    if (!state().enabled) throw apiError('DISABLED', '灵画师已关闭');
    if (state().externalAPI === false) throw apiError('API_DISABLED', '其他扩展调用已关闭');
    const metadata = { apiVersion: EXTENSION_API_VERSION, source, requestId, fingerprint };
    const plan = await prepare(options, metadata, signal, id);
    plan.snapshot.extensionRequest = metadata;
    let record;
    try {
      signal.throwIfAborted();
      if (!state().enabled || state().externalAPI === false) throw apiError('DISABLED', '灵画师或扩展调用已关闭');
      if (queue.jobs.filter((row) => ['queued', 'running'].includes(row.status)).length >= 32) {
        throw apiError('QUEUE_FULL', '生图队列已满，请稍后重试');
      }
      record = await create(plan, id);
    }
    catch (error) {
      // A second Tavern tab may have persisted this id while this tab prepared it.
      try { await refresh(); }
      catch { await abandon(plan, error); throw error; }
      const duplicate = queue.jobs.find((row) => row.id === id && owned(row, source));
      if (duplicate && extensionMetadata(duplicate.plan.snapshot.extensionRequest).fingerprint === fingerprint) return publicExtensionTask(duplicate);
      await abandon(plan, error);
      throw error;
    }
    if (record.status !== 'paused' || record.attempts || record.stage !== 'waiting') {
      queue.restore([record, ...queue.jobs.filter((row) => row.id !== record.id)]);
      return publicExtensionTask(queue.jobs.find((row) => row.id === record.id));
    }
    const job = queue.add(plan, { id: record.id, defer: true });
    if (signal.aborted || !state().enabled || state().externalAPI === false) queue.cancel(job.id);
    else queue.pump();
    return publicExtensionTask(job);
  }
  async function dispatch(data) {
    if (data.apiVersion !== EXTENSION_API_VERSION) throw apiError('API_VERSION', '不支持此扩展接口版本');
    const source = externalSource(data.source);
    if (data.action === 'submit') {
      const controller = new AbortController();
      active.set(data.requestId, controller);
      try {
        await ready();
        const work = submissions.catch(() => {}).then(() => submit(source, data.body, controller.signal));
        submissions = work.catch(() => {});
        const task = await work;
        submitted.set(data.requestId, task.id);
        while (submitted.size > 100) submitted.delete(submitted.keys().next().value);
        return task;
      } finally { active.delete(data.requestId); }
    }
    await ready();
    if (data.action === 'capabilities') return capabilities();
    if (data.action === 'presets') return presets(data.body?.provider);
    if (data.action === 'list') {
      await refresh();
      return queue.jobs.filter((job) => owned(job, source)).map(publicExtensionTask);
    }
    const job = await find(data.body?.id, source);
    if (data.action === 'get') return publicExtensionTask(job);
    if (data.action === 'result') {
      if (job.status !== 'completed') throw apiError('RESULT_NOT_READY', '任务尚未完成', job.id);
      return result(job);
    }
    if (data.action === 'cancel') {
      if (job.phase === 'saving' && job.status === 'running') throw apiError('SAVING', '图片正在保存，请等待完成', job.id);
      queue.cancel(job.id);
      return publicExtensionTask(job);
    }
    throw apiError('UNKNOWN_ACTION', '未知扩展接口操作');
  }
  return {
    dispatch,
    abort(id) {
      active.get(id)?.abort(apiError('CANCELLED', '扩展调用已取消'));
      const job = queue.jobs.find((row) => row.id === submitted.get(id));
      if (job && publicExtensionTask(job).cancellable) queue.cancel(job.id);
    },
    report(post) {
      for (const job of queue.jobs) {
        if (!extensionMetadata(job.plan.snapshot?.extensionRequest)) continue;
        const task = publicExtensionTask(job), serialized = JSON.stringify(task);
        if (reports.get(job.id) === serialized) continue;
        reports.set(job.id, serialized);
        post('linghuashi:extension-task', { task });
      }
      const ids = new Set(queue.jobs.map((row) => row.id));
      for (const id of reports.keys()) if (!ids.has(id)) reports.delete(id);
    },
  };
}
