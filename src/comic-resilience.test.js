import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheComicPreview, readComicThumbnail, COMIC_THUMBNAIL_BYTES } from './comic-resilience.js';
import { UIStateSync } from './ui-state-sync.js';

test('settings acknowledgements are revision-bound and an unconfirmed save can be retried', async () => {
  const states = [], sync = new UIStateSync({ timeout: 15, changed: (row) => states.push(row.status) });
  sync.begin('old'); sync.begin('current'); sync.receive('old');
  assert.equal(sync.value.status, 'pending');
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(sync.value.status, 'unconfirmed');
  sync.begin('retry'); sync.receive('current', 'old error');
  assert.equal(sync.value.status, 'pending');
  sync.receive('retry'); assert.equal(sync.value.status, 'received');
  assert.deepEqual(states, ['pending', 'pending', 'unconfirmed', 'pending', 'received']);
  sync.begin('failed'); sync.receive('failed', 'secret-looking upstream response');
  assert.equal(sync.value.status, 'error');
  assert.ok(!sync.value.error.includes('upstream'));
});
test('preview cache remains bounded and does not evict usable images for an oversized thumbnail', () => {
  const cache = new Map(), blob = new Blob(['1234']);
  assert.equal(cacheComicPreview(cache, 'first', blob, 8), true);
  cacheComicPreview(cache, 'second', blob, 8);
  cacheComicPreview(cache, 'third', blob, 8);
  assert.deepEqual([...cache.keys()], ['second', 'third']);
  assert.equal(cacheComicPreview(cache, 'huge', new Blob(['123456789']), 8), false);
  assert.deepEqual([...cache.keys()], ['second', 'third']);
  cacheComicPreview(cache, 'second', blob, 8);
  assert.deepEqual([...cache.keys()], ['third', 'second']);
});
test('read-only thumbnails reject invalid bodies and oversized streams, then succeed on explicit retry', async () => {
  const row = { thumbnailURL: '/thumb' };
  await assert.rejects(readComicThumbnail(row, { request: async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }) }), /无法读取/);
  await assert.rejects(readComicThumbnail(row, { request: async () => new Response('image', {
    headers: { 'content-type': 'image/png', 'content-length': String(COMIC_THUMBNAIL_BYTES + 1) } }) }), /过大/);
  await assert.rejects(readComicThumbnail(row, { request: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(COMIC_THUMBNAIL_BYTES + 1)); controller.close(); },
  }), { headers: { 'content-type': 'image/png' } }) }), /过大/);
  const blob = await readComicThumbnail(row, { request: async () => new Response('image', { headers: { 'content-type': 'image/png' } }) });
  assert.equal(await blob.text(), 'image');
});
test('thumbnail cancellation stops the read and timeouts do not submit any generation', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  await assert.rejects(readComicThumbnail({ thumbnailURL: '/thumb' }, { signal: controller.signal, request: async () => { calls++; } }), { name: 'AbortError' });
  assert.equal(calls, 0);
  await assert.rejects(readComicThumbnail({ thumbnailURL: '/thumb' }, { timeout: 10, request: (_url, { signal }) =>
    new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }); }) }), { name: 'AbortError' });
});
