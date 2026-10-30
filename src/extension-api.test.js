import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtensionAPI, externalSource, normalizeExtensionOptions, extensionMetadata,
  extensionTaskId, extensionDigest, publicExtensionTask } from './extension-api.js';
import { createExtensionTaskService } from './extension-tasks.js';
import { GenerationQueue, wait } from './generation.js';
import { TaskPersistence } from './task-persistence.js';
import { createTaskLedger } from '../server/linghuashi-storage/task-ledger.mjs';

const source = { id: 'scene-extension', name: '场景扩展' };
const settings = () => ({ enabled: true, externalAPI: true, generationMode: 'queue', queueInterval: 0, concurrency: 1 });
const eventually = async (check) => {
  for (let index = 0; index < 200; index++) { if (await check()) return; await wait(5); }
  assert.fail('Expected extension task state');
};
function fixture({ prepareWait, runWait, failRun } = {}) {
  let saved, calls = 0, prepares = 0;
  const state = settings(), chunks = new Map();
  const ledger = createTaskLedger({ load: async () => saved, save: async (value) => { saved = structuredClone(value); },
    writeChunk: async (id, offset, bytes) => chunks.set(`${id}:${offset}`, bytes),
    readChunk: async (id, offset, count) => chunks.get(`${id}:${offset}`)?.slice(0, count), removeResult: async () => {} });
  const persistence = new TaskPersistence({ request: (action, body) => ledger.dispatch(action, body),
    settings: () => state, readKey: async () => 'fixture-secret' });
  let service;
  const queue = new GenerationQueue({ settings: () => state, persistence, changed: () => service?.report(() => {}),
    run: async (job) => {
      calls++; await runWait?.();
      job.controller.signal.throwIfAborted();
      if (failRun) throw failRun;
      await job.checkpoint({ stage: 'submitting' });
      job.execution = { bytes: new Uint8Array([1, 2, 3]) };
      await job.persistExecution();
      await job.checkpoint({ stage: 'saving', imageCount: 1 });
      job.savedIds = [`${job.id}-0`]; job.imageCount = 1;
    } });
  service = createExtensionTaskService({ queue, state: () => state, ready: async () => {},
    refresh: async () => queue.restore((await persistence.list()).rows),
    prepare: async (options) => {
      prepares++; await prepareWait?.();
      return { provider: options.provider || 'novelai', model: 'fixture', url: 'https://fixture.test/generate',
        body: { prompt: options.prompt }, headers: { Authorization: 'Bearer fixture-secret' },
        snapshot: { provider: 'novelai', params: { positive: options.prompt, negative: 'blur', seed: 1 } },
        storageLocation: 'browser', timeout: 5 };
    },
    create: (plan, id) => persistence.create(plan, id), result: async (job) => ({ task: publicExtensionTask(job),
      images: [{ id: `${job.id}-0`, blob: new Blob(['png'], { type: 'image/png' }), thumbnail: new Blob(['thumb']) }] }),
    capabilities: () => ({ apiVersion: 1, enabled: state.enabled, externalAPI: state.externalAPI }),
    presets: () => [{ id: 'current', name: '当前参数' }],
  });
  const dispatch = (action, body = {}, owner = source, requestId = crypto.randomUUID()) =>
    service.dispatch({ apiVersion: 1, requestId, source: owner, action, body });
  return { service, queue, dispatch, state, calls: () => calls, prepares: () => prepares, persistence };
}

test('extension options reject credentials, invalid sources and unbounded nested overrides', () => {
  assert.deepEqual(externalSource(), { id: 'external', name: '其他扩展' });
  for (const input of [null, { id: '../scene', name: 'Scene' }, { id: 'scene', name: '' }]) assert.throws(() => externalSource(input));
  for (const input of [{ prompt: '' }, { prompt: 'x', key: 'secret' }, { prompt: 'x', endpoint: 'https://example.test' },
    { prompt: 'x', params: { advanced: {} } }, { prompt: 'x', params: { seed: Infinity } },
    { prompt: 'x', chat: { messageId: 0, slot: 0 } }]) assert.throws(() => normalizeExtensionOptions(input));
});

test('stable ids are scoped to extension source and fingerprints have canonical parameter ordering', async () => {
  const first = await extensionTaskId(source, 'scene-1');
  assert.equal(first, await extensionTaskId({ ...source, name: '新名称' }, 'scene-1'));
  assert.notEqual(first, await extensionTaskId({ id: 'portrait', name: '头像' }, 'scene-1'));
  assert.match(first, /^[a-f0-9-]{36}$/);
  assert.equal(await extensionDigest(normalizeExtensionOptions({ prompt: 'x', params: { seed: 1, steps: 20 } })),
    await extensionDigest(normalizeExtensionOptions({ params: { steps: 20, seed: 1 }, prompt: 'x' })));
});

test('external task source survives ledger persistence and is absent from credential-bearing response fields', async () => {
  const f = fixture();
  const task = await f.dispatch('submit', { prompt: 'garden', requestId: 'garden' });
  await eventually(() => f.queue.running === 0);
  const rows = (await f.persistence.list()).rows;
  assert.equal(extensionMetadata(rows[0].plan.snapshot.extensionRequest).source.id, source.id);
  const output = await f.dispatch('get', { id: task.id });
  assert.equal(output.status, 'completed');
  assert.doesNotMatch(JSON.stringify(output), /fixture-secret|Authorization|keyRef|https:/);
});

test('simultaneous retries of the same source request create and run only one task', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([
    f.dispatch('submit', { prompt: 'garden', requestId: 'same' }),
    f.dispatch('submit', { prompt: 'garden', requestId: 'same' }),
  ]);
  assert.equal(a.id, b.id);
  await eventually(() => f.queue.running === 0);
  assert.equal(f.calls(), 1); assert.equal(f.prepares(), 1);
  await assert.rejects(f.dispatch('submit', { prompt: 'different', requestId: 'same' }), { code: 'REQUEST_CONFLICT' });
});

test('a client can query persisted tasks after reload without re-submitting generation', async () => {
  const f = fixture();
  const task = await f.dispatch('submit', { prompt: 'x', requestId: 'restore' });
  await eventually(() => f.queue.running === 0);
  f.queue.jobs = [];
  assert.equal((await f.dispatch('get', { id: task.id })).status, 'completed');
  assert.equal((await f.dispatch('submit', { prompt: 'x', requestId: 'restore' })).id, task.id);
  assert.equal(f.calls(), 1);
});

test('source ownership prevents reading or cancelling another client task', async () => {
  const f = fixture(), other = { id: 'other', name: '其他扩展' };
  const task = await f.dispatch('submit', { prompt: 'x' });
  await eventually(() => f.queue.running === 0);
  for (const action of ['get', 'result', 'cancel']) {
    await assert.rejects(f.dispatch(action, { id: task.id }, other), { code: 'TASK_NOT_FOUND' });
  }
  assert.deepEqual(await f.dispatch('list', {}, other), []);
});

test('API disable prevents new generation while leaving existing task query and cancellation available', async () => {
  let release;
  const f = fixture({ runWait: () => new Promise((resolve) => { release = resolve; }) });
  const task = await f.dispatch('submit', { prompt: 'x' });
  await eventually(() => Boolean(release));
  f.state.externalAPI = false;
  await assert.rejects(f.dispatch('submit', { prompt: 'new' }), { code: 'API_DISABLED' });
  assert.equal((await f.dispatch('get', { id: task.id })).id, task.id);
  await f.dispatch('cancel', { id: task.id }); release();
  await eventually(() => f.queue.running === 0);
  assert.equal(f.queue.jobs[0].status, 'cancelled');
});

test('abort during preparation creates no durable task and performs no generation', async () => {
  let release;
  const f = fixture({ prepareWait: () => new Promise((resolve) => { release = resolve; }) });
  const requestId = crypto.randomUUID();
  const task = f.dispatch('submit', { prompt: 'x' }, source, requestId);
  await eventually(() => Boolean(release));
  f.service.abort(requestId); release();
  await assert.rejects(task, { name: 'AbortError' });
  assert.equal((await f.persistence.list()).rows.length, 0); assert.equal(f.calls(), 0);
});

test('saving tasks cannot be cancelled through the public interface', async () => {
  let release;
  const f = fixture({ runWait: () => new Promise((resolve) => { release = resolve; }) });
  const task = await f.dispatch('submit', { prompt: 'x' });
  await eventually(() => Boolean(release));
  f.queue.jobs[0].phase = 'saving';
  await assert.rejects(f.dispatch('cancel', { id: task.id }), { code: 'SAVING' });
  release(); await eventually(() => f.queue.running === 0);
});

test('querying immediately after cancellation does not replace the still-exiting worker controller', async () => {
  let release;
  const f = fixture({ runWait: () => new Promise((resolve) => { release = resolve; }) });
  const task = await f.dispatch('submit', { prompt: 'x' });
  await eventually(() => Boolean(release));
  const controller = f.queue.jobs[0].controller;
  await f.dispatch('cancel', { id: task.id });
  const queried = await f.dispatch('get', { id: task.id });
  assert.equal(queried.status, 'cancelled');
  assert.equal(f.queue.jobs[0].controller, controller);
  assert.equal(controller.signal.aborted, true);
  release(); await eventually(() => f.queue.running === 0);
});

test('abort received after persistence but before the submit response cancels the acknowledged queued task', async () => {
  let release;
  const f = fixture({ runWait: () => new Promise((resolve) => { release = resolve; }) });
  const blocker = await f.dispatch('submit', { prompt: 'blocker' });
  await eventually(() => Boolean(release));
  const requestId = crypto.randomUUID();
  const queued = await f.dispatch('submit', { prompt: 'queued' }, source, requestId);
  assert.equal(queued.status, 'queued');
  f.service.abort(requestId);
  assert.equal((await f.dispatch('get', { id: queued.id })).status, 'cancelled');
  release(); await eventually(() => f.queue.running === 0);
  assert.equal(f.calls(), 1);
  assert.equal((await f.dispatch('get', { id: blocker.id })).status, 'completed');
});

test('a persistence outage still releases a prepared chat reservation when reconciliation also fails', async () => {
  let outage = false, abandoned = false;
  const failure = new Error('fixture persistence outage');
  const service = createExtensionTaskService({
    queue: { jobs: [] }, ready: async () => {}, state: settings,
    refresh: async () => { if (outage) throw new Error('fixture reconciliation outage'); },
    prepare: async () => ({ snapshot: {}, chatRequestId: 'prepared-chat' }),
    create: async () => { outage = true; throw failure; },
    abandon: async (plan, error) => {
      abandoned = plan.chatRequestId === 'prepared-chat' && error === failure;
    },
  });
  await assert.rejects(service.dispatch({ apiVersion: 1, source, action: 'submit',
    requestId: crypto.randomUUID(), body: { prompt: 'x' } }), (error) => error === failure);
  assert.equal(abandoned, true);
});

test('public progress omits fabricated percentages and removes credential-like error text', () => {
  const snapshot = { extensionRequest: { apiVersion: 1, source, requestId: 'x', fingerprint: 'a'.repeat(64) } };
  const job = { id: 'x', status: 'running', phase: 'retrieving', plan: { snapshot }, error: 'sk-private-secret',
    progress: { value: 2, max: 10, node: '3' } };
  assert.deepEqual(publicExtensionTask(job).progress, { value: 2, max: 10, node: '3' });
  assert.equal(publicExtensionTask(job).error, '[已隐藏]');
  job.progress.max = Infinity; assert.equal(publicExtensionTask(job).progress, undefined);
  job.status = 'failed'; job.execution = { size: 100 };
  job.error = '接口没有返回可用图片；不支持异步任务式图片响应';
  assert.equal(publicExtensionTask(job).recoverable, false);
  job.error = '保存失败';
  assert.equal(publicExtensionTask(job).recoverable, true);
});

function bridgeFixture(f = fixture(), timeout = 1000) {
  let bridge;
  bridge = createExtensionAPI({ version: 'fixture', timeout, ensureReady: async () => {},
    send: (type, value) => {
      if (type === 'linghuashi:extension-abort') { f.service.abort(value.requestId); return; }
      f.service.dispatch(value).then(
        (result) => bridge.receive({ type: 'linghuashi:extension-response', requestId: value.requestId, value: result }),
        (error) => bridge.receive({ type: 'linghuashi:extension-response', requestId: value.requestId,
          error: { code: error.code, message: error.message } }),
      );
    } });
  return { bridge, client: bridge.api.connect(source), f };
}

test('generate waits for save, isolates callbacks, and creates browser image URLs with explicit release', async () => {
  const { bridge, client, f } = bridgeFixture();
  const result = await client.generate({ prompt: 'x' }, { onProgress() { throw new Error('Consumer failure'); } });
  assert.equal(result.task.status, 'completed');
  assert.match(result.images[0].url, /^blob:/);
  assert.equal((await fetch(result.images[0].url)).status, 200);
  client.releaseResult(result.task.id);
  await assert.rejects(fetch(result.images[0].url));
  assert.equal(f.calls(), 1); bridge.destroy();
});

test('progress subscriptions are scoped and unsubscribe releases callbacks', () => {
  const { bridge, client } = bridgeFixture();
  let calls = 0;
  const off = client.subscribe('id', () => calls++);
  bridge.receive({ type: 'linghuashi:extension-task', task: { id: 'id', source: { id: 'other' } } });
  bridge.receive({ type: 'linghuashi:extension-task', task: { id: 'id', source } });
  off(); bridge.receive({ type: 'linghuashi:extension-task', task: { id: 'id', source } });
  assert.equal(calls, 1); bridge.destroy();
});

test('request timeout gives an explicit error and never retries generation automatically', async () => {
  let sent = 0;
  const bridge = createExtensionAPI({ version: 'test', timeout: 10, ensureReady: async () => {}, send: () => sent++ });
  await assert.rejects(bridge.api.submit({ prompt: 'x' }), { code: 'REQUEST_TIMEOUT' });
  assert.equal(sent, 1); bridge.destroy();
});

test('destroy rejects outstanding requests and ignores late replies', async () => {
  let sent;
  const bridge = createExtensionAPI({ version: 'test', ensureReady: async () => {}, send: (_type, data) => { sent = data; } });
  const request = bridge.api.ready(); await eventually(() => Boolean(sent));
  bridge.destroy();
  await assert.rejects(request, { code: 'UNAVAILABLE' });
  bridge.receive({ type: 'linghuashi:extension-response', requestId: sent.requestId, value: {} });
});
