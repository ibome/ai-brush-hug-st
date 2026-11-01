import test from 'node:test';
import assert from 'node:assert/strict';
import { RELEASE, checkRelease } from './release.js';
import { createReleaseMonitor, RELEASE_CACHE_KEY, RELEASE_CHECK_INTERVAL, RELEASE_RETRY_INTERVAL } from './release-monitor.js';

function fixture() {
  let clock = 100000000;
  const values = new Map();
  let calls = 0, result = { version: '99.0.0', notes: 'New features' };
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  const options = { storage, now: () => clock, check: async () => {
    calls++;
    if (result instanceof Error) throw result;
    return result;
  } };
  return { options, storage, values, get calls() { return calls; },
    advance: (time) => { clock += time; }, result: (value) => { result = value; } };
}

test('automatic checks are cached for an hour across extension instances and installed upgrades clear the badge', async () => {
  const f = fixture(), monitor = createReleaseMonitor(f.options);
  assert.equal((await monitor.check()).release.newer, true);
  assert.equal((await monitor.check()).status, 'available');
  const next = createReleaseMonitor(f.options);
  assert.equal((await next.check()).release.version, '99.0.0');
  assert.equal(f.calls, 1);
  f.advance(RELEASE_CHECK_INTERVAL);
  f.result({ version: RELEASE.version });
  assert.equal((await next.check()).release.newer, false);
  assert.equal(f.calls, 2);
  assert.equal(createReleaseMonitor(f.options).getState().status, 'current');
});

test('simultaneous automatic and manual checks share one request and explicit checks bypass the cache', async () => {
  let complete, calls = 0;
  const monitor = createReleaseMonitor({ check: () => { calls++; return new Promise((resolve) => { complete = resolve; }); } });
  const automatic = monitor.check(), manual = monitor.check({ force: true });
  assert.equal(automatic, manual);
  complete({ version: RELEASE.version });
  await automatic;
  const forced = monitor.check({ force: true });
  assert.equal(calls, 2);
  complete({ version: '99.0.0' });
  assert.equal((await forced).release.newer, true);
});

test('background failures cool down across reloads, keep the last known update, and recover', async () => {
  const f = fixture(), monitor = createReleaseMonitor(f.options);
  await monitor.check();
  f.advance(RELEASE_CHECK_INTERVAL);
  f.result(new Error('rate limited'));
  const failed = await monitor.check();
  assert.equal(failed.release.newer, true);
  assert.equal(failed.error, 'rate limited');
  const reloaded = createReleaseMonitor(f.options);
  await reloaded.check();
  assert.equal(f.calls, 2);
  f.advance(RELEASE_RETRY_INTERVAL);
  f.result({ version: RELEASE.version });
  assert.equal((await reloaded.check()).error, '');
  assert.equal(f.calls, 3);
});

test('missing, corrupt, future and malicious cached values are discarded without blocking checks', async () => {
  const f = fixture();
  for (const raw of ['{', JSON.stringify({ schema: 1, repository: RELEASE.repository, checkedAt: 99999999999, attemptedAt: 99999999999 }),
    JSON.stringify({ schema: 1, repository: RELEASE.repository, checkedAt: 1, attemptedAt: 1, release: { version: '<img src=x>' } })]) {
    f.values.set(RELEASE_CACHE_KEY, raw);
    assert.equal(createReleaseMonitor(f.options).getState().release, null);
  }
  const monitor = createReleaseMonitor({ check: f.options.check, storage: {
    getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); },
  } });
  assert.equal((await monitor.check()).status, 'available');
  assert.equal((await createReleaseMonitor({ check: async () => ({ version: '' }) }).check()).release.newer, false);
});

test('cache messages update observers, unsubscribe works, and disposed monitors ignore pending responses', async () => {
  const f = fixture(), first = createReleaseMonitor(f.options), second = createReleaseMonitor(f.options);
  let events = 0;
  const unsubscribe = second.subscribe(() => { events++; });
  await first.check(); second.refreshCache();
  assert.equal(second.getState().release.newer, true);
  assert.equal(events, 1);
  unsubscribe(); second.refreshCache(); assert.equal(events, 1);
  let finish;
  const disposed = createReleaseMonitor({ check: () => new Promise((resolve) => { finish = resolve; }) });
  const work = disposed.check();
  disposed.destroy(); finish({ version: '99.0.0' }); await work;
  assert.equal(disposed.getState().release, null);
});

test('release requests omit credentials and reject malformed or preview versions', async () => {
  let captured;
  const request = async (url, options) => {
    captured = { url, options };
    return { ok: true, json: async () => ({ tag_name: 'v99.0.0', body: 'Notes' }) };
  };
  const release = await checkRelease({ request });
  assert.equal(release.newer, true);
  assert.equal(captured.options.credentials, 'omit');
  assert.equal(captured.url, `https://api.github.com/repos/${RELEASE.repository}/releases/latest`);
  assert.equal(release.url, `${RELEASE.url}/releases/tag/v99.0.0`);
  for (const data of [{ tag_name: 'nightly' }, { tag_name: 'v99.0.0', prerelease: true }, { tag_name: 'v99.0.0', draft: true }]) {
    await assert.rejects(checkRelease({ request: async () => ({ ok: true, json: async () => data }) }));
  }
  assert.equal((await checkRelease({ request: async () => ({ status: 404 }) })).newer, false);
  await assert.rejects(checkRelease({ request: async () => ({ status: 429 }) }), /受限/);
});
