import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window = { addEventListener() {} };
const { diagnosticTimeout, probeSettingsCache, runStorageDiagnostics, storageDiagnosticConclusions, formatDebugReport } = await import('./storage-diagnostics.js');

function memory() {
  const values = new Map([['other-extension', 'private']]), calls = [];
  return { values, calls, getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { calls.push(['set', key]); values.set(key, value); },
    removeItem: (key) => { calls.push(['remove', key]); values.delete(key); } };
}

test('cache probe verifies and cleans only its own tiny key', () => {
  const storage = memory(), result = probeSettingsCache(storage, 'test');
  assert.deepEqual(result, { bytes: 1024, verified: true, cleaned: true });
  assert.deepEqual([...storage.values], [['other-extension', 'private']]);
  assert.deepEqual(storage.calls.map((row) => row[1]), ['linghuashi-debug-probe:test', 'linghuashi-debug-probe:test']);
  storage.values.set('linghuashi-debug-probe:collision', 'existing');
  assert.throws(() => probeSettingsCache(storage, 'collision'), /ProbeConflict/);
  assert.equal(storage.values.get('linghuashi-debug-probe:collision'), 'existing');
});

test('denied, full, mismatching and cleanup-denied caches report failures without clearing others', () => {
  for (const name of ['QuotaExceededError', 'SecurityError']) {
    const storage = memory();
    storage.setItem = () => { throw new DOMException('private', name); };
    assert.throws(() => probeSettingsCache(storage, 'test'), { name });
    assert.equal(storage.values.get('other-extension'), 'private');
  }
  const storage = memory(), original = storage.getItem;
  storage.getItem = (key) => key.includes('test') && storage.values.has(key) ? 'unexpected' : original(key);
  assert.throws(() => probeSettingsCache(storage, 'test'), /ProbeMismatch/);
  assert.equal(storage.values.get('other-extension'), 'private');
});

test('timeout and abort are bounded and never start an already cancelled operation', async () => {
  await assert.rejects(diagnosticTimeout(() => new Promise(() => {}), null, 5), { name: 'TimeoutError' });
  const controller = new AbortController();
  const pending = diagnosticTimeout(() => new Promise(() => {}), controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(diagnosticTimeout(() => assert.fail('must not start'), controller.signal), { name: 'AbortError' });
});

test('capacity unavailable does not imply full storage and parallel use is reported conditionally', () => {
  const report = { checks: [{ id: 'quota', outcome: 'unsupported' }], runtime: {} };
  assert.doesNotMatch(storageDiagnosticConclusions(report).join(' '), /剩余额度较少|配额不足/);
  report.runtime = { generationMode: 'parallel', concurrency: 2 };
  assert.match(storageDiagnosticConclusions(report).join(' '), /并行/);
  report.checks.push({ id: 'settings-cache', code: 'BROWSER_QUOTA', outcome: 'error' }, { id: 'image-write', outcome: 'pass' });
  assert.match(storageDiagnosticConclusions(report).join(' '), /分别处理/);
});

test('runner isolates blocked storage and reports no provider bodies, identifiers or database names', async () => {
  const env = { crypto, navigator: {}, location: { origin: 'http://user:private@example.test/path?key=secret', protocol: 'http:' },
    document: { visibilityState: 'hidden' }, isSecureContext: false };
  Object.defineProperty(env, 'localStorage', { get() { throw new DOMException('private', 'SecurityError'); } });
  const report = await runStorageDiagnostics({ storageLocation: 'server', runtime: {}, databases: [
    { id: 'tasks', name: 'private-account-name', stores: ['tasks'] },
  ], serverStatus: async () => ({ originals: 5, thumbnails: 4, unmatched: 1, enhanced: 'missing', diskFree: 'private' }) }, { environment: env });
  assert.equal(report.status, 'completed');
  assert.equal(report.checks.find((row) => row.id === 'settings-cache').code, 'STORAGE_BLOCKED');
  assert.equal(report.checks.find((row) => row.id === 'quota').outcome, 'unsupported');
  assert.equal(report.checks.find((row) => row.id === 'server-storage').metrics.diskFree, null);
  assert.doesNotMatch(JSON.stringify(report), /private|secret|account-name|\/path/);
  assert.match(report.conclusions.join(' '), /服务器磁盘/);
  const a = formatDebugReport({ storage: report }), b = formatDebugReport({ storage: report });
  assert.equal(a, b);
});
