import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createStorageService } from './index.mjs';
import { ASSET_CHUNK } from './reference-assets.mjs';
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'linghuashi-references-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const user = (name) => ({ profile: { handle: name }, directories: { root: path.join(directory, name),
    userImages: path.join(directory, name, 'user/images') } });
  await fs.mkdir(user('a').directories.root); await fs.mkdir(user('b').directories.root);
  return { service: createStorageService({ allowedAccounts: ['a', 'b'] }), user };
}
test('chunked reference survives restart and verifies exact content', async (t) => {
  const { service, user } = await fixture(t), bytes = Buffer.alloc(ASSET_CHUNK + 150, 25), id = hash(bytes);
  for (let offset = 0; offset < bytes.length; offset += ASSET_CHUNK) {
    await service.dispatch(user('a'), 'reference/put', { id, offset, total: bytes.length, mime: 'application/octet-stream',
      data: bytes.subarray(offset, offset + ASSET_CHUNK).toString('base64') });
  }
  const restored = createStorageService({ allowedAccounts: ['a'] });
  const first = await restored.dispatch(user('a'), 'reference/get', { id });
  const second = await restored.dispatch(user('a'), 'reference/get', { id, offset: ASSET_CHUNK });
  assert.deepEqual(Buffer.concat([Buffer.from(first.data, 'base64'), Buffer.from(second.data, 'base64')]), bytes);
  assert.equal((await restored.dispatch(user('a'), 'reference/list')).rows.length, 1);
});
test('foreign accounts cannot read assets even with a known content hash', async (t) => {
  const { service, user } = await fixture(t), bytes = Buffer.alloc(200, 45), id = hash(bytes);
  await service.dispatch(user('a'), 'reference/put', { id, offset: 0, total: bytes.length, mime: 'application/octet-stream', data: bytes.toString('base64') });
  await assert.rejects(service.dispatch(user('b'), 'reference/get', { id }), (error) => error.status === 404);
});
test('partial upload is not readable and repeated chunks must match', async (t) => {
  const { service, user } = await fixture(t), bytes = Buffer.alloc(ASSET_CHUNK + 1, 45), id = hash(bytes);
  const body = { id, offset: 0, total: bytes.length, mime: 'application/octet-stream', data: bytes.subarray(0, ASSET_CHUNK).toString('base64') };
  await service.dispatch(user('a'), 'reference/put', body);
  await service.dispatch(user('a'), 'reference/put', body);
  await assert.rejects(service.dispatch(user('a'), 'reference/get', { id }), (error) => error.status === 404);
  await assert.rejects(service.dispatch(user('a'), 'reference/put', { ...body, data: Buffer.alloc(ASSET_CHUNK, 46).toString('base64') }), /不一致/);
});
test('path traversal, forged checksums, noncontiguous chunks and fake image types are rejected', async (t) => {
  const { service, user } = await fixture(t), bytes = Buffer.alloc(200, 45), id = hash(bytes);
  const body = { id, offset: 0, total: bytes.length, mime: 'application/octet-stream', data: bytes.toString('base64') };
  await assert.rejects(service.dispatch(user('a'), 'reference/get', { id: '../secrets.json' }), /标识/);
  await assert.rejects(service.dispatch(user('a'), 'reference/put', { ...body, id: 'a'.repeat(64) }), /校验/);
  await assert.rejects(service.dispatch(user('a'), 'reference/put', { ...body, offset: 10, total: 300 }), /不连续/);
  await assert.rejects(service.dispatch(user('a'), 'reference/put', { ...body, mime: 'image/png' }), /格式/);
});
