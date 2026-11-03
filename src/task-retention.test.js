import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTaskLedger } from '../server/linghuashi-storage/task-ledger.mjs';

const plan = () => ({
  provider: 'openai', model: 'test', url: 'https://example.test/v1/images/generations',
  body: { prompt: 'a quiet garden' }, snapshot: { provider: 'openai', params: { positive: 'a quiet garden' } },
});
const row = (status, time, extra = {}) => ({
  id: randomUUID(), plan: plan(), status, stage: 'waiting', phase: 'waiting',
  createdAt: time, updatedAt: time, finishedAt: time, savedIds: [],
  owner: '', token: '', leaseUntil: 0, ...extra,
});
function fixture(rows = []) {
  let saved = { version: 1, rows: Object.fromEntries(rows.map((item) => [item.id, item])), nextStart: 0 };
  let time = 100000, rejectSave = false;
  const buffers = new Map(rows.filter((item) => item.execution?.size || item.captureSize)
    .map((item) => [item.id, new Uint8Array([1])]));
  const failedRemovals = new Set();
  const request = createTaskLedger({
    now: () => ++time, load: async () => structuredClone(saved),
    save: async (value) => {
      if (rejectSave) throw new Error('disk unavailable');
      saved = structuredClone(value);
    },
    writeChunk: async (id, _offset, bytes) => buffers.set(id, bytes),
    readChunk: async (id, offset, size) => buffers.get(id)?.slice(offset, offset + size),
    removeResult: async (id) => {
      if (failedRemovals.has(id)) throw new Error('cache busy');
      buffers.delete(id);
    },
  }).dispatch;
  const create = () => request('task/create', { id: randomUUID(), plan: plan() });
  const claim = async (task) => {
    const owner = { id: task.id, owner: randomUUID(), token: randomUUID() };
    await request('task/claim', owner);
    return owner;
  };
  return { request, create, claim, buffers, failedRemovals,
    saved: () => structuredClone(saved), rejectSave: (value) => { rejectSave = value; } };
}

test('the 101st task automatically replaces the oldest ended record while preserving recent metadata', async () => {
  const rows = Array.from({ length: 100 }, (_, index) => row(index % 2 ? 'completed' : 'cancelled', 100 - index, {
    savedIds: [`saved-image-${index}`],
  }));
  const f = fixture(rows);
  const added = await f.create();
  const kept = (await f.request('task/list')).rows;
  assert.equal(kept.length, 100);
  assert.ok(!kept.some((item) => item.id === rows[99].id));
  assert.deepEqual(kept.find((item) => item.id === rows[0].id).savedIds, ['saved-image-0']);
  assert.ok(kept.some((item) => item.id === added.id));
});

test('hundreds of successful generations rotate history and release their response buffers', async () => {
  const f = fixture(), ids = [];
  for (let index = 0; index < 140; index++) {
    const task = await f.create(), owner = await f.claim(task);
    ids.push(task.id);
    await f.request('task/update', { ...owner, value: { stage: 'submitting' } });
    await f.request('task/execution-put', { ...owner, total: 1, offset: 0, data: 'YQ==' });
    await f.request('task/update', { ...owner, value: { status: 'completed', savedIds: [`image-${index}`] } });
    assert.equal(f.buffers.size, 0);
  }
  const kept = (await f.request('task/list')).rows;
  assert.deepEqual(kept.map((item) => item.id), ids.slice(-100));
  assert.ok(kept.every((item) => !item.execution && item.savedIds.length === 1));
});

test('automatic rotation and manual cleanup retain running, resumable and uncertain tasks', async () => {
  const protectedRows = [
    row('running', 1, { leaseUntil: Number.MAX_SAFE_INTEGER }),
    row('paused', 2),
    row('failed', 3, { stage: 'saving', execution: { size: 1 } }),
    row('uncertain', 4, { stage: 'submitting', captureSize: 2, captureOffset: 1 }),
    row('failed', 5, { stage: 'waiting' }),
  ];
  const ended = Array.from({ length: 95 }, (_, index) => row('completed', index + 20));
  const f = fixture([...protectedRows, ...ended]);
  const added = await f.create();
  await f.request('task/clear');
  assert.deepEqual((await f.request('task/list')).rows.map((item) => item.id), [
    ...protectedRows.map((item) => item.id), added.id,
  ]);
  assert.ok(f.buffers.has(protectedRows[2].id));
  assert.ok(f.buffers.has(protectedRows[3].id));
});

test('known rejected requests stay in recent history without consuming pending-task slots', async () => {
  const rejected = Array.from({ length: 100 }, (_, index) => row('failed', index + 1, { stage: 'rejected' }));
  const f = fixture(rejected);
  const added = await f.create();
  assert.equal((await f.request('task/list')).rows.length, 100);
  assert.ok(!f.saved().rows[rejected[0].id]);
  assert.equal((await f.request('task/clear')).cleared, 99);
  assert.deepEqual((await f.request('task/list')).rows.map((item) => item.id), [added.id]);
});

test('32 unresolved tasks give actionable guidance and are never silently removed', async () => {
  const rows = Array.from({ length: 32 }, (_, index) => row(index % 2 ? 'uncertain' : 'paused', index + 1));
  const f = fixture(rows);
  await assert.rejects(f.create(), /查看待处理任务/);
  assert.deepEqual((await f.request('task/list')).rows.map((item) => item.id), rows.map((item) => item.id));
  assert.equal((await f.request('task/clear')).cleared, 0);
});

test('old completed response caches are reclaimed without losing failed responses or image IDs', async () => {
  const old = Array.from({ length: 3 }, (_, index) => row('completed', index + 1, {
    stage: 'saving', execution: { size: 200 * 1024 * 1024 }, captureSize: 200 * 1024 * 1024,
    captureOffset: 200 * 1024 * 1024, savedIds: [`existing-image-${index}`],
  }));
  const recovery = row('failed', 4, { stage: 'saving', execution: { size: 200 * 1024 * 1024 } });
  const f = fixture([...old, recovery]);
  const task = await f.create(), owner = await f.claim(task);
  await f.request('task/update', { ...owner, value: { stage: 'submitting' } });
  await f.request('task/execution-put', { ...owner, total: 1, offset: 0, data: 'YQ==' });
  assert.ok(old.every((item) => !f.buffers.has(item.id)));
  assert.ok(f.buffers.has(recovery.id));
  for (const item of old) assert.deepEqual(f.saved().rows[item.id].savedIds, item.savedIds);
});

test('a failed metadata save preserves task history and buffers so creation can safely retry', async () => {
  const rows = Array.from({ length: 100 }, (_, index) => row('completed', index + 1, { execution: { size: 1 } }));
  const f = fixture(rows);
  f.rejectSave(true);
  await assert.rejects(f.create(), /disk unavailable/);
  assert.equal(Object.keys(f.saved().rows).length, 100);
  assert.equal(f.buffers.size, 100);
  f.rejectSave(false);
  await f.create();
  assert.equal(Object.keys(f.saved().rows).length, 100);
  assert.equal(f.buffers.size, 99);
});

test('temporary cache cleanup can retry without turning successful generation into failure', async () => {
  const old = row('completed', 1, { execution: { size: 1 }, savedIds: ['existing-image'] });
  const f = fixture([old]);
  f.failedRemovals.add(old.id);
  assert.equal((await f.request('task/list')).rows[0].status, 'completed');
  assert.ok(f.buffers.has(old.id));
  f.failedRemovals.clear();
  assert.deepEqual((await f.request('task/list')).rows[0].savedIds, ['existing-image']);
  assert.ok(!f.buffers.has(old.id));
});
