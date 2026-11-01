import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createStorageService } from './index.mjs';
import { CHUNK_SIZE, LEASE_MS } from './task-ledger.mjs';

const uuid = () => crypto.randomUUID();
const plan = (extra = {}) => ({
  provider: 'openai', model: 'nai-diffusion-4-5-full',
  url: 'https://example.test/v1/images/generations', headers: { Authorization: 'Bearer NEVER-PERSIST' },
  body: { model: 'nai-diffusion-4-5-full', prompt: 'garden', negative_prompt: 'blurry', seed: 17 },
  snapshot: { provider: 'openai', params: { model: 'nai-diffusion-4-5-full', positive: 'garden', negative: 'blurry', seed: 17 } },
  storageLocation: 'server', keyRef: `tavern:${uuid()}`, ...extra,
});
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linghuashi-tasks-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let time = Date.now();
  const service = createStorageService({ now: () => time });
  const user = (handle = 'a') => ({ profile: { handle }, directories: { root: path.join(root, handle), userImages: path.join(root, handle, 'user/images') } });
  await fs.mkdir(user().directories.root, { recursive: true });
  const call = (action, body = {}, account = user()) => service.dispatch(account, `task/${action}`, body);
  const create = async (extra) => call('create', { id: uuid(), plan: plan(extra) });
  const claim = async (row, settings = {}) => {
    const body = { id: row.id, owner: uuid(), token: uuid(), settings };
    const result = await call('claim', body);
    return { ...body, result };
  };
  return { root, user, service, call, create, claim, advance: (ms = LEASE_MS + 1) => { time += ms; }, now: () => time };
}

test('frozen task survives restart with parameters and secret reference, but no headers or key', async (t) => {
  const f = await fixture(t);
  const row = await f.create();
  const fresh = createStorageService({ now: f.now });
  const restored = (await fresh.dispatch(f.user(), 'task/list')).rows[0];
  assert.equal(restored.status, 'paused');
  assert.equal(restored.plan.snapshot.params.negative, 'blurry');
  assert.equal(restored.plan.body.seed, 17);
  assert.equal(restored.plan.keyRef, row.plan.keyRef);
  assert.ok(!JSON.stringify(restored).includes('NEVER-PERSIST'));
  assert.ok(!(await fs.readFile(path.join(f.user().directories.root, 'linghuashi/tasks.json'), 'utf8')).includes('NEVER-PERSIST'));
});

test('two pages claiming the same task produce one owner and stale token cannot submit', async (t) => {
  const f = await fixture(t), row = await f.create();
  const claims = await Promise.all([f.claim(row), f.claim(row)]);
  assert.equal(claims.filter((claim) => !claim.result.busy).length, 1);
  const owned = claims.find((claim) => !claim.result.busy);
  const other = claims.find((claim) => claim.result.busy);
  await assert.rejects(f.call('update', { ...other, value: { stage: 'submitting' } }), { status: 409 });
  await f.call('update', { ...owned, value: { stage: 'submitting' } });
  await assert.rejects(f.call('update', { ...owned, value: { stage: 'submitting' } }), { status: 409 });
});

test('one chat request cannot create two image jobs even with different task IDs', async (t) => {
  const f = await fixture(t);
  const chatRequestId = uuid();
  await f.create({ chatRequestId });
  await assert.rejects(f.create({ chatRequestId }), /已有任务/);
  assert.equal((await f.call('list')).rows.length, 1);
});

test('smart drafts preserve prompts, message kind and skipped decisions after server restart', async (t) => {
  const f = await fixture(t);
  const bound = { id: 'a'.repeat(64), branch: 'b'.repeat(64), chatKey: 'fixture-chat', swipe: 0, slot: 0, kind: 'smart' };
  const requestId = uuid();
  await f.service.dispatch(f.user(), 'chat/reserve', { binding: bound, requestId });
  await f.service.dispatch(f.user(), 'chat/update', { id: bound.id, requestId,
    value: { status: 'drafted', assistant: { shouldDraw: true, positive: 'rainy window', negative: 'blurry', scene: '窗边', aspect: 'portrait' } } });
  const fresh = createStorageService();
  const row = await fresh.dispatch(f.user(), 'chat/get', { id: bound.id });
  assert.equal(row.binding.kind, 'smart'); assert.equal(row.assistant.positive, 'rainy window'); assert.equal(row.status, 'drafted');
  await fresh.dispatch(f.user(), 'chat/update', { id: bound.id, requestId,
    value: { status: 'skipped', assistant: { shouldDraw: false, reason: '仅对话' } } });
  assert.equal((await fresh.dispatch(f.user(), 'chat/get', { id: bound.id })).status, 'skipped');
});

test('expired unsubmitted tasks pause; expired submitted tasks are uncertain and never reclaimable', async (t) => {
  const f = await fixture(t), one = await f.create();
  const owned = await f.claim(one);
  f.advance();
  assert.equal((await f.call('list')).rows[0].status, 'paused');
  await assert.rejects(f.call('update', { ...owned, value: { stage: 'submitting' } }), { status: 409 });
  const next = await f.claim(one);
  const submitted = await f.call('update', { ...next, value: { stage: 'submitting' } });
  f.advance(submitted.leaseUntil - f.now() + 1);
  assert.equal((await f.call('list')).rows[0].status, 'uncertain');
  await assert.rejects(f.claim(one), { status: 409 });
});

test('an in-flight response survives a missed heartbeat without allowing a second submission', async (t) => {
  const f = await fixture(t), row = await f.create({ timeout: 90 }), owned = await f.claim(row);
  const submitted = await f.call('update', { ...owned, value: { stage: 'submitting' } });
  assert.equal(submitted.leaseUntil - f.now(), 90000 + LEASE_MS);
  f.advance(43000);
  assert.equal((await f.call('list')).rows[0].status, 'running');
  assert.equal((await f.claim(row)).result.busy, true);
  await assert.rejects(f.call('update', { ...owned, value: { stage: 'submitting' } }), { status: 409 });
  await f.call('execution-put', { ...owned, total: 1, offset: 0, data: 'YQ==' });
  await f.call('update', { ...owned, value: { status: 'completed', savedIds: [`${row.id}-0`] } });
  const finished = (await f.call('list')).rows[0];
  assert.equal(finished.status, 'completed');
  assert.equal(finished.attempts, 1);
});

test('ComfyUI accepted prompt ID survives restart and claim retrieves without submission', async (t) => {
  const f = await fixture(t), row = await f.create({ provider: 'comfyui', base: 'https://example.test',
    url: 'https://example.test/prompt', snapshot: { provider: 'comfyui', config: { params: { positive: 'garden' } } } });
  const owned = await f.claim(row);
  await f.call('update', { ...owned, value: { stage: 'submitting' } });
  await f.call('execution-put', { ...owned, promptId: 'server-prompt-id' });
  f.advance();
  const fresh = createStorageService({ now: f.now });
  const restored = (await fresh.dispatch(f.user(), 'task/list')).rows[0];
  assert.equal(restored.status, 'paused');
  assert.equal(restored.execution.promptId, 'server-prompt-id');
  const takeover = { id: row.id, owner: uuid(), token: uuid() };
  await fresh.dispatch(f.user(), 'task/claim', takeover);
  await assert.rejects(fresh.dispatch(f.user(), 'task/update', { ...takeover, value: { stage: 'submitting' } }), { status: 409 });
});

test('chunked accepted bytes persist, duplicate chunk retries are idempotent and final completion is fenced', async (t) => {
  const f = await fixture(t), row = await f.create(), owned = await f.claim(row);
  await f.call('update', { ...owned, value: { stage: 'submitting' } });
  const bytes = crypto.randomBytes(CHUNK_SIZE + 31);
  const first = { ...owned, total: bytes.length, offset: 0, data: bytes.subarray(0, CHUNK_SIZE).toString('base64') };
  assert.equal((await f.call('execution-put', first)).accepted, false);
  await f.call('execution-put', first);
  await assert.rejects(f.call('execution-put', { ...first, data: Buffer.alloc(CHUNK_SIZE).toString('base64') }), { status: 409 });
  assert.equal((await f.call('execution-put', { ...owned, total: bytes.length, offset: CHUNK_SIZE, data: bytes.subarray(CHUNK_SIZE).toString('base64') })).accepted, true);
  f.advance();
  const fresh = createStorageService({ now: f.now });
  const takeover = { id: row.id, owner: uuid(), token: uuid() };
  const restored = await fresh.dispatch(f.user(), 'task/claim', takeover);
  assert.equal(restored.execution.size, bytes.length);
  const chunks = [];
  for (const offset of [0, CHUNK_SIZE]) chunks.push(Buffer.from((await fresh.dispatch(f.user(), 'task/execution-get', { ...takeover, offset })).data, 'base64'));
  assert.deepEqual(Buffer.concat(chunks), bytes);
  await assert.rejects(f.call('update', { ...owned, value: { status: 'completed' } }), { status: 409 });
  await fresh.dispatch(f.user(), 'task/update', { ...takeover, value: { status: 'completed', savedIds: [`${row.id}-0`] } });
  assert.equal((await fresh.dispatch(f.user(), 'task/list')).rows[0].status, 'completed');
});

test('partial capture is uncertain after interruption, not a recoverable accepted response', async (t) => {
  const f = await fixture(t), row = await f.create(), owned = await f.claim(row);
  await f.call('update', { ...owned, value: { stage: 'submitting' } });
  await f.call('execution-put', { ...owned, total: 2, offset: 0, data: 'YQ==' });
  const pending = (await f.call('list')).rows[0];
  f.advance(pending.leaseUntil - f.now() + 1);
  assert.equal((await f.call('list')).rows[0].status, 'uncertain');
  await assert.rejects(f.claim(row), { status: 409 });
});

test('rate rejection is known, server cooldown blocks later tasks, failed request cannot replay', async (t) => {
  const f = await fixture(t), row = await f.create(), later = await f.create(), owned = await f.claim(row);
  await f.call('update', { ...owned, value: { stage: 'submitting' } });
  const failed = await f.call('update', { ...owned, value: { status: 'failed', rejected: true, cooldown: LEASE_MS * 2 } });
  assert.equal(failed.stage, 'rejected');
  await assert.rejects(f.claim(row), { status: 409 });
  assert.equal((await f.claim(later)).result.busy, true);
  f.advance(); f.advance();
  assert.equal((await f.claim(later)).result.status, 'running');
});

test('global account concurrency blocks different pages and cancellation is heartbeat-visible', async (t) => {
  const f = await fixture(t), rows = await Promise.all([f.create(), f.create(), f.create()]);
  const settings = { generationMode: 'parallel', concurrency: 2 };
  const claims = await Promise.all(rows.map((row) => f.claim(row, settings)));
  assert.equal(claims.filter((claim) => !claim.result.busy).length, 2);
  const owned = claims.find((claim) => !claim.result.busy);
  await f.call('cancel', { id: owned.id });
  assert.equal((await f.call('heartbeat', owned)).cancelled, true);
  await assert.rejects(f.call('update', { ...owned, value: { stage: 'submitting' } }), { status: 409 });
});

test('stale page scheduling cannot increase account concurrency without an explicit settings change', async (t) => {
  const f = await fixture(t), one = await f.create(), two = await f.create();
  await f.call('configure', { generationMode: 'queue', queueInterval: 0, concurrency: 1 });
  await f.claim(one);
  assert.equal((await f.claim(two, { generationMode: 'parallel', concurrency: 16 })).result.busy, true);
  await f.call('configure', { generationMode: 'parallel', concurrency: 2, queueInterval: 0 });
  assert.equal((await f.claim(two)).result.status, 'running');
});

test('task cancel and clear remove only completed or closed task buffers, preserve image library', async (t) => {
  const f = await fixture(t), row = await f.create(), pending = await f.create();
  await f.call('cancel', { id: row.id });
  assert.equal((await f.call('clear')).cleared, 1);
  assert.deepEqual((await f.call('list')).rows.map((item) => item.id), [pending.id]);
  assert.equal((await f.service.dispatch(f.user(), 'list')).rows.length, 0);
});

test('task account isolation rejects secret fields, credential URLs and foreign response access', async (t) => {
  const f = await fixture(t), row = await f.create();
  await assert.rejects(f.create({ body: { api_key: 'secret' } }), { status: 400 });
  await assert.rejects(f.create({ snapshot: { provider: 'openai', params: { extra: '{"Authorization":"secret"}' } } }), { status: 400 });
  await assert.rejects(f.create({ url: 'https://example.test/v1?token=secret' }), { status: 400 });
  await fs.mkdir(f.user('b').directories.root, { recursive: true });
  assert.equal((await f.call('list', {}, f.user('b'))).rows.length, 0);
  await assert.rejects(f.call('claim', { id: row.id, owner: uuid(), token: uuid() }, f.user('b')), { status: 404 });
  await assert.rejects(f.service.dispatch({}, 'task/list'), { status: 401 });
});
