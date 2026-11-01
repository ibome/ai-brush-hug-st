import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorageService } from './index.mjs';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
const bound = { id: 'a'.repeat(64), branch: 'b'.repeat(64), chatKey: '["character","fixture.png","chat-one"]', swipe: 0, slot: 0 };
const day = 86400000;
const current = Date.parse('2026-10-13T00:00:00Z');
const row = (id, values = {}) => ({ id, title: 'Saved image', createdAt: current, width: 1, height: 1,
  snapshot: { provider: 'novelai', params: { positive: 'garden', negative: 'blurry', seed: 17, model: 'nai-diffusion-4-5-full' } },
  ...values });
const add = (value, extra = {}) => ({ row: value, image: png, thumbnail: png, ...extra });

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linghuashi-storage-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  const user = async (handle) => {
    const accountRoot = path.join(root, handle);
    await fs.mkdir(accountRoot, { recursive: true });
    return { profile: { handle }, directories: { root: accountRoot, userImages: path.join(accountRoot, 'user', 'images') } };
  };
  return { root, user, service: createStorageService(options) };
}

test('original, parameters, thumbnail and chat association survive a new service instance', async (t) => {
  const { user, service } = await fixture(t);
  const account = await user('account-a');
  await service.dispatch(account, 'add', add(row('one', { chatBinding: bound, favorite: true })));
  const fresh = createStorageService();
  const list = await fresh.dispatch(account, 'list');
  assert.equal(list.rows.length, 1);
  assert.equal(list.rows[0].snapshot.params.seed, 17);
  assert.equal(list.rows[0].favorite, true);
  const original = await fresh.image(account, 'one');
  assert.deepEqual(await fs.readFile(original.file), Buffer.from(png, 'base64'));
  assert.ok(original.file.includes('character-') && original.file.includes('chat-'));
  const record = await fresh.dispatch(account, 'chat/get', { id: bound.id });
  assert.equal(record.status, 'completed');
  assert.deepEqual(record.savedIds, ['one']);
  assert.deepEqual(await fresh.dispatch(account, 'audit'), { missing: [], orphans: 0, pendingFiles: 0 });
});

test('retrying an accepted save is idempotent and conflicting image IDs are rejected', async (t) => {
  const { user, service } = await fixture(t);
  const account = await user('account-a');
  await service.dispatch(account, 'add', add(row('one')));
  assert.equal((await service.dispatch(account, 'add', add(row('one')))).existing, true);
  assert.equal((await service.dispatch(account, 'list')).rows.length, 1);
  await assert.rejects(service.dispatch(account, 'add', { ...add(row('one')), image: Buffer.concat([Buffer.from(png, 'base64'), Buffer.from('different')]).toString('base64') }), { status: 409 });
});

test('account directories isolate records, original downloads and caller supplied account names', async (t) => {
  const { user, service } = await fixture(t);
  const a = await user('account-a'); const b = await user('account-b');
  await service.dispatch(a, 'add', add(row('one')));
  assert.equal((await service.dispatch(b, 'list', { account: 'account-a' })).rows.length, 0);
  await assert.rejects(service.image(b, 'one'), { status: 404 });
  await service.dispatch(b, 'remove', { ids: ['one'], account: 'account-a' });
  assert.equal((await service.dispatch(a, 'list')).rows.length, 1);
  await assert.rejects(service.dispatch({}, 'list'), { status: 401 });
});

test('deployment account allowlist rejects unrelated accounts', async (t) => {
  const { user, service } = await fixture(t, { allowedAccounts: ['account-a'] });
  await service.dispatch(await user('account-a'), 'list');
  await assert.rejects(service.dispatch(await user('account-b'), 'list'), { status: 403 });
});

test('concurrent writes preserve both records and only one chat reservation wins', async (t) => {
  const { user, service } = await fixture(t);
  const account = await user('account-a');
  await Promise.all(['one', 'two'].map((id) => service.dispatch(account, 'add', add(row(id)))));
  assert.equal((await service.dispatch(account, 'list')).rows.length, 2);
  const reservations = await Promise.all(['job-one', 'job-two'].map((requestId) => service.dispatch(account, 'chat/reserve', { binding: bound, requestId })));
  assert.equal(reservations.filter(Boolean).length, 1);
  const first = reservations.find(Boolean);
  assert.equal(await service.dispatch(account, 'chat/reserve', { binding: bound, requestId: 'stale', force: true, previousRequestId: 'wrong' }), null);
  const second = await service.dispatch(account, 'chat/reserve', { binding: bound, requestId: 'replacement', force: true, previousRequestId: first.requestId });
  assert.equal(second.requestId, 'replacement');
  assert.equal(await service.dispatch(account, 'chat/update', { id: bound.id, requestId: first.requestId, value: { status: 'failed' } }), null);
});

test('batch saves recover without losing partial pictures or downgrading a completed task', async (t) => {
  const { user, service } = await fixture(t);
  const account = await user('account-a');
  await service.dispatch(account, 'chat/reserve', { binding: bound, requestId: 'job-one' });
  await service.dispatch(account, 'add', add(row('one', { chatBinding: bound, batchId: 'batch' }), { requestId: 'job-one', batchSize: 2 }));
  assert.equal((await service.dispatch(account, 'chat/get', { id: bound.id })).status, 'running');
  await service.dispatch(account, 'add', add(row('one', { chatBinding: bound, batchId: 'batch' }), { requestId: 'job-one', batchSize: 2 }));
  await service.dispatch(account, 'add', add(row('two', { chatBinding: bound, batchId: 'batch' }), { requestId: 'job-one', batchSize: 2 }));
  const final = await service.dispatch(account, 'chat/update', { id: bound.id, requestId: 'job-one', value: { status: 'running', savedIds: [] } });
  assert.equal(final.status, 'completed');
  assert.deepEqual(final.savedIds, ['one', 'two']);
});

test('count cleanup removes old unprotected pictures and preserves favorites and chat references', async (t) => {
  const { user, service } = await fixture(t, { now: () => current });
  const account = await user('account-a');
  for (const value of [row('old', { createdAt: current - day * 10 }), row('new'),
    row('favorite', { createdAt: current - day * 20, favorite: true }),
    row('chat', { createdAt: current - day * 20, chatBinding: bound })]) {
    await service.dispatch(account, 'add', add(value));
  }
  const deletedFile = (await service.image(account, 'old')).file;
  await service.dispatch(account, 'policy', { active: true, cleanupMode: 'count', cleanupMaxImages: 4, cleanupOlderThanDays: 7 });
  const result = await service.dispatch(account, 'cleanup');
  assert.deepEqual(result.ids, ['old']);
  assert.deepEqual((await service.dispatch(account, 'list')).rows.map((item) => item.id).sort(), ['chat', 'favorite', 'new']);
  await assert.rejects(fs.access(deletedFile));
});

test('timed cleanup runs without a browser and resumes after server restart', async (t) => {
  let time = current;
  const { user, service } = await fixture(t, { now: () => time });
  const account = await user('account-a');
  await service.dispatch(account, 'add', add(row('one')));
  await service.dispatch(account, 'policy', { active: true, cleanupMode: 'time', cleanupInterval: 1, cleanupUnit: 'hours' });
  const fresh = createStorageService({ now: () => time });
  await fresh.enroll(account);
  time += 3600001;
  await fresh.tick();
  assert.equal((await fresh.dispatch(account, 'list')).rows.length, 0);
});

test('manual removal requires explicit confirmation for referenced images', async (t) => {
  const { user, service } = await fixture(t);
  const account = await user('account-a');
  await service.dispatch(account, 'add', add(row('chat', { chatBinding: bound })));
  await assert.rejects(service.dispatch(account, 'remove', { ids: ['chat'] }), { status: 409 });
  await service.dispatch(account, 'remove', { ids: ['chat'], allowReferenced: true });
  assert.equal((await service.dispatch(account, 'list')).rows.length, 0);
  assert.equal((await service.dispatch(account, 'chat/get', { id: bound.id })).status, 'completed');
  await assert.rejects(service.image(account, 'chat'), { status: 404 });
});

test('storage audit detects missing originals and untracked files', async (t) => {
  const { user, service } = await fixture(t);
  const account = await user('account-a');
  await service.dispatch(account, 'add', add(row('one')));
  const original = (await service.image(account, 'one')).file;
  await fs.rm(original);
  await fs.writeFile(path.join(account.directories.userImages, 'linghuashi', 'untracked.png'), Buffer.from(png, 'base64'));
  const result = await service.dispatch(account, 'audit');
  assert.deepEqual(result.missing, ['one']);
  assert.equal(result.orphans, 1);
});

test('failed metadata writes do not leave a successful record or orphan images', async (t) => {
  const { user, service } = await fixture(t);
  const account = await user('account-a');
  await service.dispatch(account, 'policy', { active: true });
  const index = path.join(account.directories.root, 'linghuashi', 'index.json');
  await fs.rm(index);
  await fs.mkdir(index);
  await assert.rejects(service.dispatch(account, 'add', add(row('one'))));
  assert.equal((await service.dispatch(account, 'list')).rows.length, 0);
  assert.deepEqual(await fs.readdir(path.join(account.directories.userImages, 'linghuashi', 'workshop')), []);
});

test('stored snapshots remove credential fields and reject unsafe image IDs and data', async (t) => {
  const { user, service } = await fixture(t);
  const account = await user('account-a');
  const saved = await service.dispatch(account, 'add', add(row('one', {
    snapshot: { provider: 'comfyui', config: { params: { positive: 'garden' }, graph: { 1: { inputs: { api_key: 'fixture-secret', value: 1 } } }, headers: { Authorization: 'fixture-secret' } }, keyRef: 'fixture-ref' },
  })));
  assert.ok(!JSON.stringify(saved.row.snapshot).includes('fixture-secret'));
  assert.ok(!JSON.stringify(saved.row.snapshot).includes('fixture-ref'));
  for (const id of ['../escape', '/absolute', '__proto__', 'constructor']) await assert.rejects(service.dispatch(account, 'add', add(row(id))));
  await assert.rejects(service.dispatch(account, 'add', { ...add(row('invalid')), image: Buffer.from('not an image').toString('base64') }));
});

test('image directories symlinked outside the account are rejected', async (t) => {
  const { root, user, service } = await fixture(t);
  const account = await user('account-a');
  const outside = path.join(root, 'outside');
  await fs.mkdir(outside);
  await fs.mkdir(account.directories.userImages, { recursive: true });
  await fs.symlink(outside, path.join(account.directories.userImages, 'linghuashi'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(service.dispatch(account, 'list'), { status: 403 });
});
