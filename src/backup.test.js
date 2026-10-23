import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window ||= { addEventListener() {} };
const { normalizeBackupConfig, mergeBackupConfig, portableCredentials, restoreBackupCredentials,
  scrubBackup, referencedAssets, rewriteBackupAssets } = await import('./backup-config.js');
const { createBackup, inspectBackup, encryptBackup, decryptBackup, backupHash, archiveTasks } = await import('./backup.js');
const { compareVersions, RELEASE } = await import('./release.js');
const { default: JSZip } = await import('jszip');
const fixture = () => normalizeBackupConfig({
  novelai: { positive: 'a blue butterfly' },
  novelaiPresets: [{ id: 'preset-a', name: 'Watercolor', params: { positive: 'soft watercolor' }, connectionProfileId: 'connection-a' }],
  connectionLibraryVersion: 1, connectionProfiles: { novelai: [{ id: 'connection-a', name: 'Primary',
    connection: { endpoint: 'https://example.test', keyRef: 'browser:11111111-1111-4111-8111-111111111111' } }] },
  connections: { novelai: { endpoint: 'https://example.test', keyRef: 'browser:11111111-1111-4111-8111-111111111111' } },
  artistLibrary: [{ id: 'artist-a', name: 'Ink', artist: 'ink illustration' }],
  characterProfiles: { profiles: [{ id: 'profile-a', name: 'Alice' }] },
});
const emptyAssets = { get() { throw new Error('Unexpected asset read'); } };
const file = (blob, name = 'backup.zip') => Object.assign(blob, { name });
const exportFixture = (options = {}) => createBackup({ state: fixture(), sections: ['general', 'connections', 'parameters', 'artists', 'characters', 'assistant'],
  assets: emptyAssets, readKey: async () => 'fixture-secret-value', ...options });

test('configuration export excludes transient UI, raw keys, drafts and unknown fields', () => {
  const source = { ...fixture(), key: 'private', assistantInput: 'private scene', assistantDraft: { positive: 'private' },
    assistantHistory: [{ plan: { positive: 'private historical prompt' } }], history: ['private'], unknown: 'private', api_key: 'private' };
  const config = normalizeBackupConfig(source);
  for (const key of ['key', 'assistantInput', 'assistantDraft', 'assistantHistory', 'history', 'unknown', 'api_key']) assert.ok(!Object.hasOwn(config, key));
});
test('local component token follows encrypted credential slots and is omitted from ordinary settings', async () => {
  const keyRef = 'browser:44444444-4444-4444-8444-444444444444';
  const original = normalizeBackupConfig({ localTools: { endpoint: 'https://tools.example/proxy', keyRef, key: 'private-value' } });
  assert.equal(original.localTools.key, undefined);
  const exported = structuredClone(original);
  const secrets = await portableCredentials(exported, async (provider) => {
    assert.equal(provider, 'localtools'); return 'fixture-component-token';
  }, true);
  assert.equal(secrets[0].provider, 'localtools');
  assert.notEqual(exported.localTools.keyRef, keyRef);
  const restored = await restoreBackupCredentials(exported, fixture(), secrets, async (provider, key) => {
    assert.equal(provider, 'localtools'); assert.equal(key, 'fixture-component-token'); return keyRef;
  });
  assert.equal(restored.localTools.keyRef, keyRef);
  const ordinary = structuredClone(original);
  assert.deepEqual(await portableCredentials(ordinary, async () => { throw new Error('Should not read token'); }, false), []);
  assert.notEqual(ordinary.localTools.keyRef, keyRef);
  const withoutKey = await restoreBackupCredentials(ordinary, fixture(), [], async () => {
    throw new Error('Should not write a token');
  });
  assert.equal(withoutKey.localTools.keyRef, '');
});
test('assistant schemes participate in credential backup, restoration and conflict-safe merge', async () => {
  const source = fixture(), keyRef = 'browser:33333333-3333-4333-8333-333333333333';
  source.assistantSchemes = [{ id: 'scheme-a', name: '剧情', settings: { source: 'api', endpoint: 'https://assistant.example.test', model: 'model', keyRef } }];
  source.assistantSchemeId = 'scheme-a';
  const config = normalizeBackupConfig(source);
  const secrets = await portableCredentials(config, async () => 'fixture-secret', true);
  assert.ok(secrets.some((row) => row.provider === 'assistant'));
  assert.notEqual(config.assistantSchemes[0].settings.keyRef, keyRef);
  const restored = await restoreBackupCredentials(config, fixture(), secrets, async () => keyRef);
  assert.equal(restored.assistantSchemes[0].settings.keyRef, keyRef);
  const incoming = normalizeBackupConfig(source);
  incoming.assistantSchemes[0].settings.model = 'changed-model';
  const merged = mergeBackupConfig(normalizeBackupConfig(source), incoming, ['assistant']);
  assert.equal(merged.assistantSchemes.length, 2);
  assert.notEqual(merged.assistantSchemes[0].id, merged.assistantSchemes[1].id);
  assert.equal(merged.assistantSchemeId, 'scheme-a');
  assert.throws(() => normalizeBackupConfig({ assistantSchemes: [source.assistantSchemes[0], source.assistantSchemes[0]] }), /重复/);
  const shared = await inspectBackup(file(await exportFixture({ state: source, sections: ['assistant'], kind: 'share' })));
  assert.equal(shared.secrets.length, 0);
  assert.ok(!JSON.stringify(shared.manifest.config).includes(keyRef));
});
test('workbench, scoped reviews and reusable Vibe assets round trip through backup; share excludes reviews', () => {
  const asset = { id: 'a'.repeat(64), location: 'server', mime: 'image/png', width: 64, height: 64 };
  const source = { ...fixture(), workbench: { characters: 'red hair\nblue hair', seed: 42 },
    drawingReviews: { 'server:image-a': 'best' },
    vibeLibrary: [{ id: crypto.randomUUID(), name: 'Watercolor', category: 'Style', favorite: true, strength: .4, image: asset }] };
  const config = normalizeBackupConfig(source);
  assert.equal(config.workbench.characters, source.workbench.characters);
  assert.equal(config.drawingReviews['server:image-a'], 'best');
  assert.equal(config.vibeLibrary[0].strength, .4);
  assert.equal(referencedAssets(config).length, 1);
  assert.equal(Object.hasOwn(scrubBackup(config, { sharing: true }), 'drawingReviews'), false);
  const merged = mergeBackupConfig(fixture(), config, ['general', 'parameters']);
  assert.equal(merged.vibeLibrary.length, 1);
  assert.equal(merged.drawingReviews['server:image-a'], 'best');
});
test('tag libraries round trip through configuration and sharing and merge without duplicates', async () => {
  const state = fixture();
  state.tagLibrary = { version: 2, custom: [{ id: 'custom-fixture', name: '本地画风', en: 'fixture watercolor', category: '测试', aliases: ['水粉'],
    description: '用户记录的水彩经验', source: 'https://example.test/wiki', preview: 'data:image/webp;base64,UklGRg==' }],
    favorites: ['custom-fixture', 'builtin-smile'], recent: ['custom-fixture'],
    templates: [{ id: 'template-fixture', name: '我的雨夜', category: '场景', positive: 'night, rain', negative: 'blurry', artist: 'watercolor' }] };
  const pack = await inspectBackup(file(await exportFixture({ state, sections: ['tags'], kind: 'share' })));
  assert.deepEqual(pack.manifest.config.tagLibrary, state.tagLibrary);
  const current = normalizeBackupConfig(state);
  assert.deepEqual(mergeBackupConfig(current, pack.manifest.config, ['tags']).tagLibrary, state.tagLibrary);
  const changed = normalizeBackupConfig({ ...state, tagLibrary: {} });
  assert.deepEqual(mergeBackupConfig(changed, pack.manifest.config, ['tags'], 'replace').tagLibrary, state.tagLibrary);
  assert.throws(() => normalizeBackupConfig({ tagLibrary: { custom: [state.tagLibrary.custom[0], state.tagLibrary.custom[0]] } }));
  assert.throws(() => normalizeBackupConfig({ tagLibrary: { custom: [{ ...state.tagLibrary.custom[0], preview: 'https://example.test/remote.png' }] } }));
});
test('recursive scrubbing removes keys, credential headers and endpoint query tokens', () => {
  const clean = scrubBackup({ url: 'https://user:pass@example.test/v1?api_key=hidden&foo=yes',
    headers: { Authorization: 'hidden' }, nested: { password: 'hidden', prompt: `token ${'sk-'}${'1234567890'.repeat(3)}` } });
  assert.equal(clean.url, 'https://example.test/v1?foo=yes');
  assert.ok(!clean.headers); assert.ok(!clean.nested.password);
  assert.ok(!JSON.stringify(clean).includes('1234567890'));
});
test('credentials embedded in extra JSON are scrubbed and malformed JSON is rejected', () => {
  const cleaned = scrubBackup({ extra: JSON.stringify({ seed: 123, api_key: 'fixture-private-value', clientSecret: 'fixture-private-value' }) });
  assert.deepEqual(JSON.parse(cleaned.extra), { seed: 123 });
  assert.throws(() => scrubBackup({ extra: '{"api_key":' }));
});
test('duplicate and over-limit libraries fail instead of being silently truncated', () => {
  assert.throws(() => normalizeBackupConfig({ novelaiPresets: [fixture().novelaiPresets[0], fixture().novelaiPresets[0]] }));
  assert.throws(() => normalizeBackupConfig({ novelaiPresets: Array.from({ length: 51 }, (_, i) =>
    ({ id: `p${i}`, name: `P${i}`, params: {} })) }));
});
test('configuration backup round trip contains checksummed references and portable credential slots', async () => {
  const pack = await inspectBackup(file(await exportFixture()));
  assert.equal(pack.manifest.pluginVersion, RELEASE.version);
  assert.equal(pack.secrets.length, 0);
  assert.notEqual(pack.manifest.config.connections.novelai.keyRef, fixture().connections.novelai.keyRef);
  assert.equal(pack.manifest.images.length, 0);
});
test('encrypted backup keeps plaintext secrets and ZIP signature out of the outer file', async () => {
  const blob = await exportFixture({ includeKeys: true, password: 'fixture-password' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.ok(!new TextDecoder().decode(bytes).includes('fixture-secret-value'));
  assert.notEqual(String.fromCharCode(...bytes.slice(0, 2)), 'PK');
  const pack = await inspectBackup(file(blob), 'fixture-password');
  assert.ok(pack.encrypted); assert.equal(pack.secrets.length, 1);
});
test('wrong password and authenticated header tampering are rejected', async () => {
  const blob = await encryptBackup(new TextEncoder().encode('fixture'), 'fixture-password');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await assert.rejects(decryptBackup(bytes, 'wrong-password'), /密码/);
  bytes[bytes.length - 1] ^= 1;
  await assert.rejects(decryptBackup(bytes, 'fixture-password'), /损坏/);
});
test('short passwords and unreadable stored credentials block key backup', async () => {
  await assert.rejects(exportFixture({ includeKeys: true, password: 'short' }), /密码/);
  await assert.rejects(exportFixture({ includeKeys: true, password: 'fixture-password', readKey: async () => '' }), /无法读取/);
});
test('share packages exclude credentials and chat overrides', async () => {
  const state = fixture();
  state.characterProfiles.chats = [{ chatKey: 'private-chat', selection: [], overrides: [] }];
  const pack = await inspectBackup(file(await exportFixture({ kind: 'share', state, sections: ['parameters', 'artists', 'characters'] })));
  assert.equal(pack.secrets.length, 0); assert.equal(pack.manifest.identity, '');
  assert.equal(pack.manifest.config.novelaiPresets[0].connectionProfileId, '');
  assert.deepEqual(pack.manifest.config.characterProfiles.chats, []);
  await assert.rejects(exportFixture({ kind: 'share', includeKeys: true }), /分享/);
});
test('credential slot aliases stay shared inside a provider and are remapped on import', async () => {
  const state = fixture(), secrets = await portableCredentials(state, async () => 'fixture-secret', true);
  assert.equal(state.connections.novelai.keyRef, state.connectionProfiles.novelai[0].connection.keyRef);
  const imported = await restoreBackupCredentials(state, fixture(), secrets, async () => 'browser:22222222-2222-4222-8222-222222222222');
  assert.equal(imported.connections.novelai.keyRef, 'browser:22222222-2222-4222-8222-222222222222');
});
test('no-key import preserves matching local credentials and never borrows a different endpoint key', async () => {
  const state = fixture();
  await portableCredentials(state, async () => '', false);
  await restoreBackupCredentials(state, fixture(), [], async () => { throw new Error('Unexpected write'); });
  assert.equal(state.connections.novelai.keyRef, fixture().connections.novelai.keyRef);
  state.connections.novelai.endpoint = 'https://other.example.test';
  await restoreBackupCredentials(state, fixture(), [], async () => {});
  assert.equal(state.connections.novelai.keyRef, '');
});
test('invalid credential lists are validated before any write', async () => {
  let writes = 0;
  await assert.rejects(restoreBackupCredentials(fixture(), fixture(), [
    { provider: 'novelai', slot: 'browser:11111111-1111-4111-8111-111111111111', key: 'fixture-secret' },
    { provider: 'invalid', slot: 'invalid', key: 'fixture-secret' },
  ], async () => { writes++; }));
  assert.equal(writes, 0);
});
test('same imported key reuses a matching local reference without creating unused secrets', async () => {
  const state = fixture(), current = fixture(), original = current.connections.novelai.keyRef;
  const secrets = await portableCredentials(state, async () => 'fixture-secret', true);
  let writes = 0;
  await restoreBackupCredentials(state, current, secrets, async () => { writes++; },
    async () => 'fixture-secret');
  assert.equal(writes, 0); assert.equal(state.connections.novelai.keyRef, original);
});
test('merge keeps separate profiles with the same address but different immutable credentials', () => {
  const current = fixture(), incoming = fixture();
  incoming.connectionProfiles.novelai[0].connection.keyRef = 'browser:22222222-2222-4222-8222-222222222222';
  const next = mergeBackupConfig(current, incoming, ['connections']);
  assert.equal(next.connectionProfiles.novelai.length, 2);
  assert.notEqual(next.connectionProfiles.novelai[0].connection.keyRef, next.connectionProfiles.novelai[1].connection.keyRef);
});
test('merge preserves current parameters and remaps colliding connection bindings', () => {
  const current = fixture(), imported = fixture();
  imported.connectionProfiles.novelai[0].connection.endpoint = 'https://other.example.test';
  imported.novelaiPresets[0].params.positive = 'a new prompt';
  imported.novelai.positive = 'overwrite current';
  const result = mergeBackupConfig(current, imported, ['connections', 'parameters']);
  assert.equal(result.novelai.positive, 'a blue butterfly');
  assert.equal(result.connectionProfiles.novelai.length, 2);
  assert.equal(result.novelaiPresets.length, 2);
  assert.equal(result.novelaiPresets[1].connectionProfileId, result.connectionProfiles.novelai[1].id);
  assert.notEqual(result.novelaiPresets[0].id, result.novelaiPresets[1].id);
});
test('reimporting an unchanged config is idempotent and replacement respects selected sections', () => {
  const current = fixture(), imported = fixture();
  assert.equal(mergeBackupConfig(current, imported, ['artists']).artistLibrary.length, 1);
  imported.novelai.positive = 'changed'; imported.artistLibrary[0].artist = 'changed';
  const next = mergeBackupConfig(current, imported, ['parameters'], 'replace');
  assert.equal(next.novelai.positive, 'changed'); assert.equal(next.artistLibrary[0].artist, 'ink illustration');
});
test('reference discovery and location rewrite preserve model and extraction metadata', () => {
  const asset = { id: 'a'.repeat(64), location: 'server', mime: 'image/png', name: 'Source', width: 512, height: 512 };
  const value = { advanced: { source: asset, vibes: [{ encodings: { v4: { asset, information: 0.6 } } }] } };
  assert.equal(referencedAssets(value).length, 1);
  const next = rewriteBackupAssets(value, new Map([[asset.id, 'browser']]));
  assert.equal(next.advanced.source.location, 'browser');
  assert.equal(next.advanced.vibes[0].encodings.v4.information, 0.6);
  assert.equal(value.advanced.source.location, 'server');
});
test('referenced asset bytes are packaged and checksummed; missing references fail export', async () => {
  const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/octet-stream' });
  const asset = { id: await backupHash(await blob.arrayBuffer()), location: 'browser', mime: blob.type, width: 0, height: 0, name: 'Vibe' };
  const state = fixture();
  state.novelai.advanced = { mode: 'reference', vibes: [{ id: crypto.randomUUID(), name: 'Vibe', enabled: true, information: 1, strength: 0.6, encodings: { 'v4full': { asset, information: 1 } } }] };
  const pack = await inspectBackup(file(await exportFixture({ state, assets: { get: async () => blob } })));
  assert.equal(pack.manifest.files.length, 1);
  assert.equal(pack.contents.get(`assets/${asset.id}.bin`).size, 4);
  await assert.rejects(exportFixture({ state, assets: emptyAssets }), /Unexpected asset/);
});
test('corrupt file checksum, unsupported paths and plaintext secrets are rejected', async () => {
  const zip = await JSZip.loadAsync(await (await exportFixture()).arrayBuffer());
  zip.file('secrets.json', JSON.stringify([]));
  await assert.rejects(inspectBackup(file(await zip.generateAsync({ type: 'blob' }))), /秘钥/);
  zip.remove('secrets.json'); zip.file('unsupported.txt', 'invalid');
  await assert.rejects(inspectBackup(file(await zip.generateAsync({ type: 'blob' }))), /路径/);
});
test('task archival strips executable plans, endpoints, credentials and running state', () => {
  const rows = archiveTasks([{ id: 'task-a', status: 'running', execution: { promptId: 'secret' },
    plan: { endpoint: 'https://private.test', keyRef: 'private', headers: { Authorization: 'private' }, snapshot: { provider: 'novelai', params: { positive: 'blue' } } } }]);
  assert.equal(rows[0].status, 'paused');
  assert.ok(!rows[0].plan); assert.ok(!rows[0].execution);
  assert.ok(!JSON.stringify(rows).includes('private'));
});
test('release version comparison handles numeric segments and rejects invalid tags', () => {
  assert.equal(compareVersions('0.11.0', '0.9.0'), 1);
  assert.equal(compareVersions('v0.11.0', '0.11.0'), 0);
  assert.equal(compareVersions('0.10.9', '0.11.0'), -1);
  assert.throws(() => compareVersions('latest', '0.11.0'));
});
