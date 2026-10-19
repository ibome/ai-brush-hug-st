import test from 'node:test';
import assert from 'node:assert/strict';
import { installedExtension, createExtensionUpdater } from './extension-update.js';
import { RELEASE } from './release.js';

const moduleURL = 'https://tavern.test/scripts/extensions/third-party/Linghuashi%20Custom/dist/index.js?build=test';
function fixture(options = {}) {
  const calls = [];
  let busy = false, complete;
  const updater = createExtensionUpdater({
    moduleURL: options.moduleURL || moduleURL, nativeUpdates: Boolean(options.nativeUpdates),
    getHeaders: () => ({ 'x-csrf-token': 'fixture' }), isBusy: () => busy,
    request: async (url, init) => {
      calls.push({ url, ...init, body: init.body && JSON.parse(init.body) });
      if (url.includes('/discover')) return Response.json([{ name: 'third-party/Linghuashi Custom', type: options.global ? 'global' : 'local' }]);
      if (url.includes('/version')) return Response.json({
        currentBranchName: options.zip ? '' : options.branch || 'main',
        currentCommitHash: options.zip ? '' : 'previous',
        remoteUrl: options.remote || `${RELEASE.url}.git`,
      });
      if (url.includes('/update')) {
        if (options.hold) await new Promise((resolve) => { complete = resolve; });
        return options.fail ? new Response('', { status: options.fail }) : Response.json({ shortCommitHash: 'updated' });
      }
      return Response.json({ version: options.stale ? RELEASE.version : '99.0.0' });
    },
  });
  return { calls, updater, busy: () => { busy = true; }, finish: () => complete() };
}
test('installation identity follows the actual module URL, including renamed directories', () => {
  assert.equal(installedExtension(moduleURL).name, 'Linghuashi Custom');
  assert.throws(() => installedExtension('https://tavern.test/preview.js'));
  assert.throws(() => installedExtension(moduleURL.replace('Linghuashi%20Custom', 'bad%2Fname')));
});
test('explicit update uses native CSRF-protected API and verifies the installed manifest', async () => {
  for (const global of [false, true]) {
    const f = fixture({ global });
    assert.deepEqual(await f.updater.update('99.0.0'), { version: '99.0.0', reloadRequired: true });
    assert.equal(f.calls.length, 4);
    const update = f.calls.find((row) => row.url === '/api/extensions/update');
    assert.deepEqual(update.body, { extensionName: 'Linghuashi Custom', global });
    assert.equal(update.headers['x-csrf-token'], 'fixture');
    assert.equal(update.credentials, 'same-origin');
    assert.equal(f.calls.at(-1).cache, 'no-store');
  }
});
test('rapid update clicks share a single native write', async () => {
  const f = fixture({ hold: true });
  const first = f.updater.update('99.0.0'), second = f.updater.update('99.0.0');
  assert.equal(first, second);
  while (!f.calls.some((row) => row.url.endsWith('/update'))) await new Promise((resolve) => setImmediate(resolve));
  f.finish(); await first;
  assert.equal(f.calls.filter((row) => row.url.endsWith('/update')).length, 1);
});
test('busy generation, ZIP, wrong remote and non-main branch cannot start an update', async () => {
  const busy = fixture(); busy.busy();
  await assert.rejects(busy.updater.update('99.0.0'), /聊天生成/);
  for (const [options, message] of [[{ zip: true }, /ZIP/], [{ remote: 'https://github.com/other/repo.git' }, /来源/],
    [{ branch: 'development' }, /main/]]) {
    const f = fixture(options);
    await assert.rejects(f.updater.update('99.0.0'), message);
    assert.equal(f.calls.filter((row) => row.url.endsWith('/update')).length, 0);
  }
});
test('permission and git failures are actionable and a stale manifest cannot report success', async () => {
  for (const [options, message] of [[{ fail: 403 }, /权限/], [{ fail: 500 }, /Git/], [{ stale: true }, /目标版本/]]) {
    const f = fixture(options);
    await assert.rejects(f.updater.update('99.0.0'), message);
  }
});
test('native extension updates accept custom-scheme URLs and do not pretend to cancel native writes', async () => {
  const nativeURL = moduleURL.replace('https://tavern.test', 'tauri://localhost');
  assert.equal(installedExtension(nativeURL).manifestURL,
    'tauri://localhost/scripts/extensions/third-party/Linghuashi%20Custom/manifest.json');
  const f = fixture({ moduleURL: nativeURL, nativeUpdates: true });
  assert.equal((await f.updater.update('99.0.0')).reloadRequired, true);
  assert.equal(f.calls.find((row) => row.url === '/api/extensions/update').signal, undefined);
  assert.ok(f.calls.find((row) => row.url === '/api/extensions/version').signal);
  await assert.rejects(fixture({ nativeUpdates: true, fail: 500 }).updater.update('99.0.0'), /设备网络/);
});
