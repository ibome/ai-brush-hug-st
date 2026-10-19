import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeStorage } from './native-storage.js';
import { createStorageRequest, serverDrawing } from './server-storage.js';
import { createTaskLedger } from '../server/linghuashi-storage/task-ledger.mjs';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRXYAAAAASUVORK5CYII=';
const bound = { id: 'a'.repeat(64), branch: 'b'.repeat(64), chatKey: '["character","avatar","main"]', swipe: 0, slot: 0 };
const row = (id, extra = {}) => ({ id, width: 1, height: 1, title: id, createdAt: 1000000, snapshot: { provider: 'novelai', params: { positive: 'garden', seed: 12 } }, ...extra });
const addition = (id, extra) => ({ row: row(id, extra), image: png, thumbnail: png });
const json = (value, status = 200) => Response.json(value, { status });
function memory() {
  const files = new Map(), calls = [], locks = new Map();
  let time = 1000000, failure = null;
  const lock = { request(name, run) {
    const next = (locks.get(name) || Promise.resolve()).catch(() => {}).then(run);
    locks.set(name, next); return next;
  } };
  function endpoint(account) {
    const key = (name) => `${account}/${name}`;
    const api = async (path, body, { missing = false } = {}) => {
      calls.push({ account, path, body });
      if (failure && failure(path, body)) { failure = null; throw new Error('temporary write failure'); }
      if (path === '/api/images/list') return [...files.keys()].filter((name) => name.startsWith(key(`user/images/${body.folder}/`)))
        .map((name) => name.split('/').at(-1));
      if (path === '/api/images/upload') {
        assert.match(body.ch_name, /^linghuashi(?:-thumbnails)?$/);
        assert.match(body.filename, /^lh-[A-Za-z0-9_-]+\.(png|jpg|webp)$/);
        const saved = `user/images/${body.ch_name}/${body.filename}`;
        files.set(key(saved), Buffer.from(body.image, 'base64')); return { path: saved };
      }
      if (path === '/api/files/upload') {
        assert.match(body.name, /^linghuashi-[A-Za-z0-9_.-]+$/);
        files.set(key(`user/files/${body.name}`), Buffer.from(body.data, 'base64'));
        return { path: `user/files/${body.name}` };
      }
      if (path.endsWith('/delete')) {
        if (!files.delete(key(body.path)) && !missing) throw new Error('missing');
        return {};
      }
      throw new Error(`unknown native route ${path}`);
    };
    const read = async (path) => {
      const data = files.get(key(new URL(path, 'https://fixture.test').pathname.replace(/^\//, '')));
      return data ? new Response(data) : new Response('', { status: 404 });
    };
    return { api, read, account, now: () => time, locks: lock };
  }
  return { files, calls, endpoint, native: (account) => createNativeStorage(endpoint(account)),
    advance: (amount) => { time += amount; }, fail: (predicate) => { failure = predicate; } };
}

test('native account images, metadata, references and favorites survive a fresh adapter without a server plugin', async () => {
  const f = memory(), a = f.native('a');
  await a('add', addition('image-a', { favorite: true }));
  const result = await f.native('a')('list');
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].favorite, true);
  assert.equal(result.rows[0].snapshot.params.positive, 'garden');
  assert.deepEqual(await f.native('b')('list').then((value) => value.rows), []);
  const displayed = serverDrawing(result.rows[0], 'a');
  assert.match(displayed.srcURL, /^\/user\/images\/linghuashi\/lh-image-a.png\?account=a$/);
  assert.equal((await f.endpoint('b').read(displayed.srcURL)).status, 404);
  await a('favorite', { id: 'image-a', favorite: false });
  assert.equal((await f.native('a')('list')).rows[0].favorite, false);
  assert.ok([...f.files.keys()].every((name) => name.startsWith('a/user/')));
});

test('diagnostics only lists current account image folders and returns counts without paths or names', async () => {
  const f = memory(), a = f.native('a');
  await a('add', addition('private-image'));
  f.files.set('a/user/images/linghuashi/lh-orphan.png', new Uint8Array(1));
  f.files.set('b/user/images/linghuashi/lh-other-account.png', new Uint8Array(1));
  f.calls.length = 0;
  assert.deepEqual(await a('diagnostics/status'), {
    readable: true, originals: 2, thumbnails: 1, maxRecords: 10000, diskFree: null, unmatched: 1,
  });
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every((row) => row.account === 'a' && row.path === '/api/images/list'));
  assert.doesNotMatch(JSON.stringify(await a('diagnostics/status')), /private|orphan|other-account|user\//);
});

test('independent devices adding images cannot overwrite each other through a shared index', async () => {
  const f = memory();
  const a = f.native('same'), b = f.native('same');
  await Promise.all([a('add', addition('first')), b('add', addition('second'))]);
  assert.deepEqual((await f.native('same')('list')).rows.map((row) => row.id).sort(), ['first', 'second']);
  const reservations = await Promise.all([a('chat/reserve', { binding: bound, requestId: 'first-job' }), b('chat/reserve', { binding: bound, requestId: 'second-job' })]);
  assert.equal(reservations.filter(Boolean).length, 1);
});

test('native version selection and cleanup preserve an entire favorite or chat-bound group', async () => {
  const f = memory(), a = f.native('a');
  await a('add', addition('root', { chatBinding: bound }));
  await a('add', addition('edit', { version: { groupId: 'root', parentId: 'root', number: 2 } }));
  await a('version/select', { id: 'root' });
  assert.equal((await a('image/get', { id: 'root', current: true })).id, 'root');
  await a('add', addition('favorite', { favorite: true }));
  await a('add', addition('unprotected'));
  await a('policy', { active: true, cleanupMode: 'time', cleanupInterval: 1, cleanupUnit: 'hours' });
  f.advance(3600001);
  assert.deepEqual((await a('cleanup')).ids, ['unprotected']);
  assert.deepEqual((await f.native('a')('list')).rows.map((row) => row.id).sort(), ['edit', 'favorite', 'root']);
  await assert.rejects(a('remove', { ids: ['root'] }), /聊天配图/);
  await a('remove', { ids: ['root'], allowReferenced: true });
  assert.equal((await a('image/get', { id: 'edit', current: true })).id, 'edit');
});

test('a lost metadata acknowledgement retries the same image without duplication or another generation', async () => {
  const f = memory(), a = f.native('a');
  f.fail((path, body) => path === '/api/files/upload' && body.name.startsWith('linghuashi-image-'));
  await assert.rejects(a('add', addition('retry')), /temporary/);
  assert.equal((await a('list')).rows.length, 0);
  assert.equal((await a('audit')).orphans, 1);
  await a('add', addition('retry'));
  assert.equal((await a('add', addition('retry'))).existing, true);
  assert.equal((await f.native('a')('list')).rows.length, 1);
  const changed = Buffer.from(png, 'base64'); changed[changed.length - 1] ^= 1;
  await assert.rejects(a('add', { ...addition('retry'), image: changed.toString('base64') }), /同 ID/);
});

test('native storage rejects path injection and strips credentials including nested extra JSON', async () => {
  const f = memory(), a = f.native('a'), token = 'sk-' + 'private'.repeat(8);
  await assert.rejects(a('add', addition('../escape')), /标识/);
  await assert.rejects(a('remove', { ids: ['../../else'] }), /删除列表/);
  await a('add', addition('safe', { snapshot: { provider: 'novelai', keyRef: 'vault-id',
    params: { api_key: token, extra: JSON.stringify({ headers: { authorization: token }, token, prompt: `garden ${token}` }),
      url: `https://user:password@example.test/v1?api_key=${token}&a=1` } } }));
  const raw = f.files.get('a/user/files/linghuashi-image-safe.json').toString();
  assert.ok(!raw.includes(token)); assert.ok(!raw.includes('vault-id')); assert.ok(!raw.includes('user:password'));
  assert.match(raw, /redacted/);
});

test('chat pictures reconstruct after refresh and a completed binding cannot be downgraded', async () => {
  const f = memory(), a = f.native('a');
  await a('chat/reserve', { binding: bound, requestId: 'job' });
  for (const id of ['one', 'two']) await a('add', { ...addition(id, { chatBinding: bound, batchId: 'batch' }), requestId: 'job', batchSize: 2 });
  const fresh = f.native('a'), chat = await fresh('chat/get', { id: bound.id });
  assert.equal(chat.status, 'completed'); assert.deepEqual(chat.savedIds, ['one', 'two']);
  assert.equal((await fresh('chat/update', { id: bound.id, requestId: 'job', value: { status: 'queued' } })).status, 'completed');
  assert.equal((await fresh('chat/reserve', { binding: bound, requestId: 'new' })), null);
  assert.equal((await fresh('backup/chats')).rows.length, 1);
});

test('native reference chunks are verified, persisted in the account and isolated', async () => {
  const f = memory(), a = f.native('a'), bytes = Uint8Array.from(Buffer.from(png, 'base64'));
  const id = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  await assert.rejects(a('reference/put', { id, total: bytes.length, offset: 3, data: png, mime: 'image/png' }), /大小|重新/);
  const saved = await a('reference/put', { id, total: bytes.length, offset: 0, data: png, mime: 'image/png', width: 1, height: 1 });
  assert.equal(saved.complete, true);
  assert.equal((await f.native('a')('reference/get', { id, offset: 0 })).data, png);
  await assert.rejects(f.native('b')('reference/get', { id }), /不存在/);
  await assert.rejects(a('reference/get', { id, offset: -1 }), /校验/);
});

function ledger() {
  let state;
  const service = createTaskLedger({ load: async () => state, save: async (value) => { state = structuredClone(value); },
    writeChunk: async () => {}, readChunk: async () => new Uint8Array(), removeResult: async () => {} });
  return (action, body) => service.dispatch(action, body);
}
const plan = { provider: 'openai', model: 'fixture', url: 'https://fixture.test/v1/images/generations', body: { prompt: 'garden' },
  headers: {}, snapshot: { provider: 'openai', params: { positive: 'garden' } }, identityFields: ['fixture'], timeout: 5, storageLocation: 'server' };
test('optional plugin detection only falls back on absence; failed image writes do not change storage location', async () => {
  const f = memory(), native = f.endpoint('a'), browserTasks = ledger(), remoteTasks = ledger();
  let installed = false, denied = false, failAdd = false;
  const request = async (url, options = {}) => {
    const path = new URL(url, 'https://fixture.test').pathname, body = options.body ? JSON.parse(options.body) : {};
    if (path.startsWith('/api/plugins/linghuashi-storage/')) {
      const action = path.split('/linghuashi-storage/')[1];
      if (action === 'backup/status') return denied ? json({ error: 'restricted component' }, 403) : installed ? json({ version: '0.21.0', protocol: 2 }) : json({}, 404);
      if (!installed) return json({}, 404);
      if (action.startsWith('task/')) return json(await remoteTasks(action, body));
      if (action === 'list') return json({ rows: [] });
      if (action === 'add') return failAdd ? json({ error: 'write forbidden' }, 403) : json({ row: body.row });
      return json({});
    }
    if (options.method === 'POST') return json(await native.api(path, body));
    return native.read(path);
  };
  const router = () => createStorageRequest(() => ({ 'x-csrf-token': 'fixture' }), { account: 'a', request, browserTasks, locks: native.locks, now: native.now });
  let a = router();
  assert.equal((await a('components/status')).enhanced, 'missing');
  await a('add', addition('native-before-install'));
  const localId = '11111111-1111-1111-1111-111111111111', remoteId = '22222222-2222-2222-2222-222222222222';
  await a('task/create', { id: localId, plan });
  installed = true; a = router();
  assert.equal((await a('components/status')).enhanced, 'installed');
  assert.equal((await a('list')).rows[0].id, 'native-before-install');
  await a('task/create', { id: remoteId, plan });
  assert.deepEqual((await a('task/list')).rows.map((row) => row.id).sort(), [localId, remoteId]);
  assert.equal((await a('task/cancel', { id: localId })).status, 'cancelled');
  failAdd = true;
  await assert.rejects(a('add', addition('failed-remote')), /write forbidden/);
  assert.ok(!f.files.has('a/user/files/linghuashi-image-failed-remote.json'));
  denied = true; a = router();
  assert.equal((await a('components/status')).enhanced, 'denied');
  await a('add', addition('restricted-native'));
  assert.equal((await a('list')).rows.length, 2);
});

test('TauriTavern saves and reloads images, references and tasks without probing Node plugin routes', async () => {
  const f = memory(), native = f.endpoint('default-user'), browserTasks = ledger(), calls = [];
  const request = async (url, options = {}) => {
    const path = new URL(url, 'https://tauri.localhost').pathname;
    calls.push(path);
    assert.ok(!path.startsWith('/api/plugins/'), 'native clients must not probe unsupported Node routes');
    return options.method === 'POST' ? json(await native.api(path, JSON.parse(options.body))) : native.read(path);
  };
  const adapter = () => createStorageRequest(() => ({ 'Content-Type': 'application/json' }), {
    account: 'default-user', enhancedSupported: false, request, browserTasks, locks: native.locks, now: native.now,
  });
  const a = adapter();
  assert.equal((await a('components/status', { refresh: true })).enhanced, 'unsupported');
  assert.equal(calls.length, 0);
  await a('add', addition('tauri-image', { favorite: true }));
  const id = '33333333-3333-4333-8333-333333333333';
  await a('task/create', { id, plan });
  const bytes = Uint8Array.from(Buffer.from(png, 'base64'));
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  await a('reference/put', { id: hash, total: bytes.length, offset: 0, data: png, mime: 'image/png', width: 1, height: 1 });
  const fresh = adapter();
  assert.equal((await fresh('list')).rows[0].favorite, true);
  assert.equal((await fresh('task/list')).rows[0].id, id);
  assert.equal((await fresh('reference/get', { id: hash, offset: 0 })).data, png);
  assert.equal((await fresh('backup/status')).enhanced, 'unsupported');
  assert.equal((await fresh('diagnostics/status')).enhanced, 'unsupported');
  assert.equal((await fresh('components/status')).taskStorage, 'browser');
});
