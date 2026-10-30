import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createTaskLedger, LEASE_MS } from '../server/linghuashi-storage/task-ledger.mjs';
import { TaskPersistence } from './task-persistence.js';
import { GenerationQueue, GenerationError, submitGeneration, downloadResults, wait } from './generation.js';
import { canRecoverGeneration } from './generation-recovery.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRXYAAAAASUVORK5CYII=', 'base64');
const settings = { enabled: true, generationMode: 'queue', concurrency: 2, queueInterval: 0 };
const plan = () => ({ provider: 'openai', model: 'test', url: 'https://fixture.test/images/generations',
  headers: { Authorization: 'Bearer secret' }, body: { model: 'test', prompt: 'garden' },
  identityFields: ['https://fixture.test', '/images/generations', 'test'],
  snapshot: { provider: 'openai', params: { model: 'test', positive: 'garden', seed: 17 } },
  keyRef: `tavern:${crypto.randomUUID()}`, storageLocation: 'server', timeout: 5 });
const eventually = async (check) => {
  for (let i = 0; i < 200; i++) { if (check()) return; await wait(5); }
  assert.fail('Expected task state was not reached');
};
function fixture() {
  let state, time = Date.now();
  const buffers = new Map();
  const request = (action, body) => ledger.dispatch(action, body);
  const ledger = createTaskLedger({
    now: () => time, load: async () => state,
    save: async (value) => { state = structuredClone(value); },
    writeChunk: async (id, offset, bytes) => {
      const old = buffers.get(id) || new Uint8Array();
      const next = new Uint8Array(Math.max(old.length, offset + bytes.length));
      next.set(old); next.set(bytes, offset); buffers.set(id, next);
    },
    readChunk: async (id, offset, size) => buffers.get(id).slice(offset, offset + size),
    removeResult: async (id) => { buffers.delete(id); },
  });
  const persistence = () => new TaskPersistence({ request, settings: () => settings, readKey: async () => 'secret' });
  return { request, persistence, advance: () => { time += LEASE_MS + 1; } };
}
test('explicit insufficient-credit response is rejected without becoming uncertain or eligible for automatic resubmission', async () => {
  const f = fixture(), persistence = f.persistence(), current = plan(), record = await persistence.create(current);
  let posts = 0;
  const queue = new GenerationQueue({ settings: () => settings, persistence,
    run: (job) => submitGeneration(job, async () => { posts++; return new Response('', { status: 402 }); }) });
  const job = queue.add(current, { id: record.id });
  await eventually(() => job.status === 'failed' && queue.running === 0);
  const row = (await persistence.list()).rows[0];
  assert.equal(row.status, 'failed'); assert.equal(row.stage, 'rejected');
  assert.match(row.error, /余额|Anlas/); assert.equal(posts, 1);
  queue.pump(); assert.equal(posts, 1);
});

test('batch metadata and frozen prompts restore paused without triggering generation', async () => {
  const f = fixture(), persistence = f.persistence(), current = plan();
  current.snapshot.experiment = { id: crypto.randomUUID(), mode: 'batch', label: 'A / ink', index: 0, createdAt: Date.now() };
  const record = await persistence.create(current);
  current.snapshot.params.positive = 'edited after save';
  const rows = (await persistence.list()).rows;
  const queue = new GenerationQueue({ settings: () => settings, persistence, run: async () => { assert.fail('restoration must not generate'); } });
  queue.restore(rows);
  assert.equal(queue.jobs[0].status, 'paused');
  assert.equal(queue.jobs[0].plan.snapshot.params.positive, 'garden');
  assert.equal(queue.jobs[0].plan.snapshot.experiment.label, 'A / ink');
  assert.equal(rows[0].id, record.id);
});

test('accepted image response restores in a fresh queue and recovery does not POST again', async () => {
  const f = fixture(), first = f.persistence();
  const record = await first.create(plan());
  let posts = 0;
  const fetcher = async (_url, options) => {
    if (options.method === 'POST') { posts++; return new Response(png); }
    assert.fail('Unexpected remote download');
  };
  const queue = new GenerationQueue({
    settings: () => settings, persistence: first,
    run: async (job) => { await submitGeneration(job, fetcher); throw new Error('Simulated saving failure'); },
  });
  const one = queue.add(plan(), { id: record.id });
  await eventually(() => one.status === 'failed' && queue.running === 0);
  assert.equal(posts, 1);
  const second = f.persistence();
  const next = new GenerationQueue({
    settings: () => settings, persistence: second,
    run: async (job) => {
      await submitGeneration(job, fetcher);
      assert.equal(job.plan.identity, JSON.stringify(['https://fixture.test', '/images/generations', 'test', 'secret']));
      assert.equal((await downloadResults(job, fetcher))[0].blob.size, png.length);
      job.savedIds = [`${job.id}-0`];
    },
  });
  next.restore((await second.list()).rows);
  next.retry(record.id);
  await eventually(() => next.jobs[0].status === 'completed' && next.running === 0);
  assert.equal(posts, 1);
  assert.equal((await second.list()).rows[0].status, 'completed');
});

test('legacy invalid responses stay nonrecoverable after reload without losing the original task', async () => {
  const f = fixture(), persistence = f.persistence(), current = plan(), record = await persistence.create(current);
  let posts = 0;
  const queue = new GenerationQueue({
    settings: () => settings, persistence,
    run: async (job) => {
      await submitGeneration(job, async () => { posts++; return new Response('{"error":"wrong address"}'); });
      throw new GenerationError('接口没有返回可用图片；不支持异步任务式图片响应');
    },
  });
  const failed = queue.add(current, { id: record.id });
  await eventually(() => failed.status === 'failed' && queue.running === 0);
  const rows = (await persistence.list()).rows;
  assert.ok(rows[0].execution);
  assert.equal(canRecoverGeneration(rows[0]), false);
  const restored = new GenerationQueue({ settings: () => settings, persistence: f.persistence(),
    run: () => assert.fail('An invalid cached response must not be retried') });
  restored.restore(rows);
  restored.retry(record.id);
  assert.equal(restored.jobs[0].status, 'failed');
  assert.equal(posts, 1);
  assert.equal((await persistence.list()).rows[0].id, record.id);
});

test('unsubmitted records restore paused and do not generate until manually resumed', async () => {
  const f = fixture(), persistence = f.persistence(), record = await persistence.create(plan());
  let posts = 0;
  const queue = new GenerationQueue({
    settings: () => settings, persistence,
    run: (job) => submitGeneration(job, async () => { posts++; return new Response(png); }),
  });
  queue.restore((await persistence.list()).rows);
  queue.pump();
  await wait(25);
  assert.equal(posts, 0);
  queue.retry(record.id);
  await eventually(() => queue.jobs[0].status === 'completed' && queue.running === 0);
  assert.equal(posts, 1);
});

test('network loss after submission persists uncertainty and cannot be retried by the queue', async () => {
  const f = fixture(), persistence = f.persistence(), record = await persistence.create(plan());
  let posts = 0;
  const queue = new GenerationQueue({
    settings: () => settings, persistence,
    run: (job) => submitGeneration(job, async () => { posts++; throw new TypeError('Disconnected'); }),
  });
  const job = queue.add(plan(), { id: record.id });
  await eventually(() => job.status === 'uncertain' && queue.running === 0);
  queue.retry(job.id);
  await wait(20);
  assert.equal(posts, 1);
  assert.equal((await persistence.list()).rows[0].status, 'uncertain');
});

test('missing original Key leaves an unsubmitted task recoverable without contacting provider', async () => {
  const f = fixture();
  const persistence = new TaskPersistence({ request: f.request, settings: () => settings, readKey: async () => { throw new Error('Missing'); } });
  const record = await persistence.create(plan());
  let posts = 0;
  const queue = new GenerationQueue({ settings: () => settings, persistence, run: async () => { posts++; } });
  const job = queue.add(plan(), { id: record.id });
  await eventually(() => job.status === 'failed' && queue.running === 0);
  assert.equal(posts, 0);
  assert.equal((await persistence.list()).rows[0].stage, 'waiting');
});

test('failed response checkpoint can save retained bytes on this page without a second POST', async () => {
  const f = fixture();
  let reject = true, posts = 0;
  const persistence = new TaskPersistence({
    request: (action, body) => action === 'task/execution-put' && reject
      ? Promise.reject(new Error('Disk temporarily unavailable')) : f.request(action, body),
    settings: () => settings, readKey: async () => 'secret',
  });
  const record = await persistence.create(plan());
  const queue = new GenerationQueue({
    settings: () => settings, persistence,
    run: async (job) => {
      await submitGeneration(job, async () => { posts++; return new Response(png); });
      await downloadResults(job);
    },
  });
  const job = queue.add(plan(), { id: record.id });
  await eventually(() => job.status === 'uncertain' && queue.running === 0);
  assert.ok(job.execution.bytes);
  queue.restore((await persistence.list()).rows);
  assert.ok(job.execution.bytes);
  reject = false;
  queue.retry(job.id);
  await eventually(() => job.status === 'completed' && queue.running === 0);
  assert.equal(posts, 1);
});
