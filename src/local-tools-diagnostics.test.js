import test from 'node:test';
import assert from 'node:assert/strict';
import { readLocalEnvironment, localToolsDiagnostic, localInstallationCommands } from './local-tools-diagnostics.js';
import { localToolsClient } from './local-tools.js';
const report = { type: 'linghuashi-local-tools-environment', formatVersion: 1, python: '3.12.8', system: 'Windows',
  architecture: 'AMD64', virtualenv: true, freeBytes: 1200000000, port: 8765,
  dependencies: [{ name: 'numpy', installed: true, version: '2.1.0' }], checks: [{ id: 'python', ok: true }] };
test('component reports whitelist fields and never copy tokens, paths or arbitrary errors', () => {
  const secret = 'private-secret-value';
  const environment = readLocalEnvironment({ ...report, token: secret, path: 'C:/private', environment: { SECRET: secret } });
  assert.ok(!JSON.stringify(environment).includes(secret)); assert.ok(!JSON.stringify(environment).includes('private'));
  const output = localToolsDiagnostic({ endpoint: 'https://private.example/path/', environment: { ...report, token: secret },
    failure: { category: 'auth', status: 401, message: secret } });
  assert.equal(output.failure, 'auth'); assert.equal(output.target.kind, 'custom-host');
  assert.ok(!JSON.stringify(output).includes('private')); assert.ok(!JSON.stringify(output).includes(secret));
  assert.throws(() => readLocalEnvironment({ type: 'another-tool' }), /environment/);
});
test('wizard commands use origin only and explicitly select remote listening', () => {
  const local = localInstallationCommands('windows', 'same', 'https://tavern.test/subpath/?key=hidden');
  assert.ok(local.start.includes("'https://tavern.test'")); assert.ok(!local.start.includes('hidden'));
  assert.ok(!local.start.includes('0.0.0.0'));
  const remote = localInstallationCommands('unix', 'other', 'https://tavern.test');
  assert.ok(remote.start.endsWith('--host 0.0.0.0')); assert.equal(remote.check, 'sh check-env.sh');
});
test('connection checks distinguish auth, origin and protocol failures without image submission', async () => {
  const calls = [];
  for (const [status, category] of [[401, 'auth'], [403, 'origin'], [503, 'http']]) {
    const client = localToolsClient({ endpoint: 'https://component.test/v1/', key: 'fixture',
      request: async (url, options) => { calls.push([url.pathname, options.method]); return Response.json({}, { status }); } });
    await assert.rejects(client.status(), (error) => error.category === category && error.status === status);
  }
  const bad = localToolsClient({ endpoint: 'https://component.test', key: 'fixture', request: async () => Response.json({}) });
  await assert.rejects(bad.status(), (error) => error.category === 'protocol');
  assert.deepEqual(calls, Array.from({ length: 3 }, () => ['/v1/status', 'GET']));
});
