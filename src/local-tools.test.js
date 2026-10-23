import test from 'node:test';
import assert from 'node:assert/strict';
import { localToolsBase, normalizeLocalTools, localTaskOptions, localOutputSize, localTagsText, localToolsClient, localImageMime } from './local-tools.js';

test('image magic supports mobile files without MIME labels and rejects disguised SVG', () => {
  assert.equal(localImageMime(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])), 'image/png');
  assert.equal(localImageMime(new TextEncoder().encode('RIFF0000WEBP')), 'image/webp');
  assert.throws(() => localImageMime(new TextEncoder().encode('<svg></svg>')), /不是支持/);
});

test('local component addresses preserve proxy prefixes and accept v1 or slash suffixes', () => {
  for (const suffix of ['', '/', '/v1', '/v1/']) {
    assert.equal(localToolsBase(`https://tools.example/proxy${suffix}`), 'https://tools.example/proxy/');
  }
  for (const url of ['file:///tmp/a', 'https://user:secret@tools.example', 'https://tools.example/?token=secret']) {
    assert.throws(() => localToolsBase(url));
  }
  assert.deepEqual(normalizeLocalTools({ endpoint: 'https://local.example', key: 'unwanted-secret', token: 'hidden' }),
    { endpoint: 'https://local.example', keyRef: '' });
});

test('upscale limits stop large allocations and label thresholds remain bounded', () => {
  assert.deepEqual(localOutputSize(768, 1024, 'fsrcnn-x4'), { width: 3072, height: 4096, scale: 4 });
  assert.throws(() => localOutputSize(2000, 2000, 'fsrcnn-x4'), /超过/);
  assert.throws(() => localOutputSize(8193, 1, 'wd-vit-v3'));
  assert.throws(() => localTaskOptions('wd-vit-v3', { threshold: 1.5 }));
  assert.equal(localTaskOptions('fsrcnn-x2').kind, 'upscale');
  assert.equal(localTagsText({ tags: [{ tag: 'green_hair', score: 0.9 }, { tag: 'green_hair', score: 0.8 }],
    characters: [{ tag: 'character_name', score: 0.95 }] }), 'green_hair');
});

test('component requests use only its token and read the result before deleting it', async () => {
  const calls = [], id = 'a'.repeat(32);
  let resultRead = false;
  const client = localToolsClient({ endpoint: 'https://tools.test/prefix/v1/', key: 'component-test-token',
    request: async (url, options) => {
      calls.push([String(url), options]);
      assert.equal(options.headers.Authorization, 'Bearer component-test-token');
      assert.equal(options.credentials, 'omit');
      if (String(url).endsWith('/result')) { resultRead = true; return Response.json({ tags: [] }); }
      if (options.method === 'DELETE') { assert.ok(resultRead); return Response.json({ status: 'cancelled' }); }
      return Response.json({ id, status: 'completed' });
    } });
  assert.deepEqual(await client.run({ kind: 'tags', model: 'wd-vit-v3', image: 'fixture' }), { tags: [] });
  assert.equal(calls.length, 3);
  assert.ok(calls.every(([url]) => url.startsWith('https://tools.test/prefix/v1/jobs')));
});

test('failed and cancelled local jobs are released without automatic retry', async () => {
  let posted = 0, deleted = 0;
  const client = localToolsClient({ endpoint: 'http://127.0.0.1:8765', key: 'test-token', request: async (_url, options) => {
    if (options.method === 'POST') { posted++; return Response.json({ id: 'b'.repeat(32), status: 'failed', error: 'model damaged' }); }
    if (options.method === 'DELETE') deleted++;
    return Response.json({});
  } });
  await assert.rejects(() => client.run({ kind: 'tags' }), /model damaged/);
  assert.equal(posted, 1); assert.equal(deleted, 1);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(() => client.status(cancelled.signal), /取消/);
});

test('incompatible service and authentication failures produce actionable errors', async () => {
  const wrong = localToolsClient({ endpoint: 'https://tools.test', key: 'test-token', request: async () => Response.json({}) });
  await assert.rejects(() => wrong.status(), /不是兼容/);
  const denied = localToolsClient({ endpoint: 'https://tools.test', key: 'test-token',
    request: async () => Response.json({ error: 'denied' }, { status: 401 }) });
  await assert.rejects(() => denied.status(), /令牌/);
});
