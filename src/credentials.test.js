import test from 'node:test';
import assert from 'node:assert/strict';
import { createCredentialVault } from './credential-vault.js';
import { credentialError, credentialFailure, credentialSavedMessage } from './credential-errors.js';
import { normalizeConnections, normalizeConnection, saveConnectionProfile, deleteConnectionProfile, setCurrentConnection } from './connections.js';
globalThis.window = { addEventListener() {} };
const { normalizeNovelAIState, saveNovelAIPreset, loadNovelAIPreset, novelAIPresetDirty } = await import('./ui/novelai.js');
const { normalizeOpenAIState, saveOpenAIPreset, loadOpenAIPreset } = await import('./ui/openai.js');
const { normalizeComfyState, saveComfyPreset, loadComfyPreset } = await import('./ui/comfyui.js');
const { captureSnapshot } = await import('./ui/drawings.js');

const storage = () => {
  const data = new Map();
  return { getItem: (key) => data.get(key) || null, setItem: (key, value) => data.set(key, value), data };
};
const fixture = () => {
  const state = {};
  normalizeNovelAIState(state); normalizeOpenAIState(state); normalizeComfyState(state);
  normalizeConnections(state);
  return state;
};
const ref = 'tavern:88fe3a4a-29e0-4f67-bcab-100cad406186';

test('normalization retains only connection fields and secret references', () => {
  assert.deepEqual(normalizeConnection('novelai', { keyRef: ref, key: 'hidden', endpoint: 'https://fixture.example', headers: {} }),
    { keyRef: ref, endpoint: 'https://fixture.example' });
  assert.equal(normalizeConnection('novelai', { keyRef: 'plain-secret' }).keyRef, '');
});

test('each provider preset survives normalization and restores its connection', () => {
  for (const [provider, normalize, save, load, list] of [
    ['novelai', normalizeNovelAIState, saveNovelAIPreset, loadNovelAIPreset, 'novelaiPresets'],
    ['openai', normalizeOpenAIState, saveOpenAIPreset, loadOpenAIPreset, 'openaiPresets'],
    ['comfyui', normalizeComfyState, saveComfyPreset, loadComfyPreset, 'comfyPresets'],
  ]) {
    const state = fixture();
    state.presetBindings[provider] = 'legacy';
    state.connections[provider] = normalizeConnection(provider, { keyRef: ref, endpoint: 'https://fixture.example',
      path: '/images/custom', timeout: 75, auth: 'bearer', key: 'must-not-be-saved' });
    const preset = save(state, 'Fixture');
    normalize(state);
    state.connections[provider] = normalizeConnection(provider);
    load(state, preset.id);
    assert.equal(state.connections[provider].keyRef, ref);
    assert.equal(state.connections[provider].endpoint, 'https://fixture.example');
    if (provider === 'openai') {
      assert.equal(state.openaiPath, '/images/custom');
      assert.equal(state.openaiTimeout, 75);
    }
    if (provider === 'comfyui') {
      assert.equal(state.connections.comfyui.auth, 'bearer');
      assert.equal(state.comfyTimeout, 75);
    }
    assert.ok(!JSON.stringify(state[list]).includes('must-not-be-saved'));
  }
});

test('legacy and built-in presets preserve the current connection', () => {
  const state = fixture();
  state.connections.novelai = { keyRef: ref, endpoint: 'https://fixture.example' };
  state.novelaiPresets = [{ id: 'legacy', name: 'Legacy', params: { ...state.novelai, steps: 12 } }];
  normalizeNovelAIState(state);
  loadNovelAIPreset(state, 'legacy');
  assert.equal(state.novelai.steps, 12);
  assert.equal(state.connections.novelai.keyRef, ref);
  loadNovelAIPreset(state, 'default');
  assert.equal(state.connections.novelai.keyRef, ref);
});

test('saving an existing preset records connection changes and preserves earlier keys in other presets', () => {
  const state = fixture();
  state.presetBindings.novelai = 'legacy';
  state.connections.novelai = { keyRef: ref, endpoint: '' };
  const first = saveNovelAIPreset(state, 'First');
  state.connections.novelai.keyRef = '';
  assert.equal(novelAIPresetDirty(state), true);
  const second = saveNovelAIPreset(state, 'Second');
  assert.equal(first.connection.keyRef, ref);
  assert.equal(second.connection.keyRef, '');
  state.connections.novelai.endpoint = 'https://fixture.example';
  saveNovelAIPreset(state);
  assert.equal(second.connection.endpoint, 'https://fixture.example');
});

test('parameter-only presets preserve connections; named bindings use the latest saved service', () => {
  for (const [provider, save, load] of [
    ['novelai', saveNovelAIPreset, loadNovelAIPreset], ['openai', saveOpenAIPreset, loadOpenAIPreset],
    ['comfyui', saveComfyPreset, loadComfyPreset],
  ]) {
    const state = fixture();
    setCurrentConnection(state, provider, { endpoint: 'https://fixture.example/a', keyRef: ref });
    const named = saveConnectionProfile(state, provider, 'A');
    const params = save(state, 'Only parameters');
    assert.equal(params.connectionProfileId, '');
    assert.equal(params.connection, undefined);
    setCurrentConnection(state, provider, { endpoint: 'https://fixture.example/b' });
    load(state, params.id);
    assert.equal(state.connections[provider].endpoint, 'https://fixture.example/b');
    state.presetBindings[provider] = named.id;
    const bound = save(state, 'Bound');
    load(state, bound.id);
    assert.equal(state.connections[provider].keyRef, ref);
    state.connections[provider].endpoint = 'https://fixture.example/updated';
    saveConnectionProfile(state, provider, 'A', named.id);
    load(state, bound.id);
    assert.equal(state.connections[provider].endpoint, 'https://fixture.example/updated');
    deleteConnectionProfile(state, provider, named.id);
    assert.equal(bound.connectionProfileId, '');
    load(state, bound.id);
    assert.equal(state.connections[provider].endpoint, 'https://fixture.example/updated');
  }
});

test('connection migration is idempotent, deduplicates saved connections, and preserves legacy snapshots', () => {
  const state = { novelaiPresets: [{ id: 'old', name: 'Cake', connection: { endpoint: 'https://fixture.example', keyRef: ref } }],
    connections: { novelai: { endpoint: 'https://fixture.example', keyRef: ref } } };
  normalizeConnections(state);
  assert.equal(state.connectionProfiles.novelai.length, 1);
  const first = JSON.stringify(state.connectionProfiles);
  normalizeConnections(state);
  assert.equal(JSON.stringify(state.connectionProfiles), first);
  assert.equal(state.novelaiPresets[0].connection.keyRef, ref);
});

test('missing bindings reject before changing generation parameters', () => {
  const state = fixture();
  const original = structuredClone(state.novelai);
  state.novelaiPresets.push({ id: 'missing', name: 'Missing', params: { ...state.novelai, steps: 2 }, connectionProfileId: 'missing-service' });
  assert.throws(() => loadNovelAIPreset(state, 'missing'), /已删除/);
  assert.deepEqual(state.novelai, original);
});

test('image parameter snapshots exclude every provider connection and secret reference', () => {
  const state = fixture();
  for (const provider of ['novelai', 'openai', 'comfyui']) {
    state.provider = provider;
    state.connections[provider].keyRef = ref;
    const snapshot = JSON.stringify(captureSnapshot(state));
    assert.ok(!snapshot.includes(ref));
    assert.ok(!snapshot.includes('keyRef'));
    assert.ok(!snapshot.includes('connection'));
  }
});

test('browser vault survives recreation and isolates accounts and providers', async () => {
  const saved = storage();
  const a = createCredentialVault({ account: 'a', storage: saved });
  const keyRef = await a.write('novelai', 'fixture-key');
  assert.equal(await createCredentialVault({ account: 'a', storage: saved }).read('novelai', keyRef), 'fixture-key');
  await assert.rejects(createCredentialVault({ account: 'b', storage: saved }).read('novelai', keyRef));
  await assert.rejects(a.read('openai', keyRef));
  await assert.rejects(a.write('unknown', 'fixture-key'));
});

test('keys are immutable for preset references; unchanged keys reuse references; clearing keeps older keys', async () => {
  const vault = createCredentialVault({ account: 'a', storage: storage() });
  const first = await vault.write('novelai', 'first-key');
  assert.equal(await vault.write('novelai', 'first-key', first), first);
  const second = await vault.write('novelai', 'second-key', first);
  assert.notEqual(first, second);
  assert.equal(await vault.read('novelai', first), 'first-key');
  assert.equal(await vault.write('novelai', '', second), '');
  assert.equal(await vault.read('novelai', second), 'second-key');
});

test('Tavern vault uses its supported generic namespace, provider label and immutable ID', async () => {
  const store = new Map();
  const saved = storage();
  const request = async (action, body) => {
    if (action === 'settings') return { allowKeysExposure: true };
    if (action === 'read') return { api_key_generic: [...store.values()] };
    assert.equal(body.key, 'api_key_generic');
    if (action === 'write') {
      const id = crypto.randomUUID();
      store.set(id, { id, value: body.value, label: body.label, active: true });
      return { id };
    }
    return { value: store.get(body.id)?.value };
  };
  const keyRef = await createCredentialVault({ account: 'a', storage: saved, request }).write('novelai', 'fixture-key');
  assert.ok(keyRef.startsWith('tavern:'));
  assert.equal(saved.data.size, 0);
  assert.equal(await createCredentialVault({ account: 'a', storage: saved, request }).read('novelai', keyRef), 'fixture-key');
});

test('built-in-only Tavern find restores inactive presets by exact ID without the flattened view endpoint', async () => {
  const firstId = crypto.randomUUID();
  const secondId = crypto.randomUUID();
  const actions = [];
  const records = {
    api_key_generic: [
      { id: firstId, value: 'old-preset-key', label: '灵画师 · NovelAI', active: false },
      { id: secondId, value: 'current-key', label: '灵画师 · NovelAI', active: true },
      { id: crypto.randomUUID(), value: 'other-provider-key', label: '灵画师 · OpenAI', active: false },
    ],
  };
  const request = async (action, body) => {
    actions.push(action);
    if (action === 'settings') return { allowKeysExposure: true };
    if (action === 'read') return records;
    if (action === 'find') {
      if (body.key !== 'api_key_generic') throw new Error('404: custom namespace absent from built-in secret state');
      return { value: records.api_key_generic.find(item => item.id === body.id)?.value || '' };
    }
    if (action === 'view') return { api_key_generic: 'current-key' };
    throw new Error('Unexpected write');
  };
  const saved = storage();
  const vault = createCredentialVault({ account: 'a', storage: saved, request });
  assert.equal(await vault.read('novelai', `tavern:${firstId}`), 'old-preset-key');
  assert.equal(await vault.read('novelai', `tavern:${secondId}`), 'current-key');
  assert.equal(await vault.write('novelai', 'current-key', `tavern:${secondId}`), `tavern:${secondId}`);
  assert.deepEqual(actions, ['read', 'find', 'read', 'find']);
  assert.equal(saved.data.size, 0);
  assert.equal(records.api_key_generic[0].active, false);
  await assert.rejects(vault.read('openai', `tavern:${firstId}`));
  await assert.rejects(vault.read('novelai', `tavern:${crypto.randomUUID()}`));
});

test('Tavern secret lookup failure cannot bypass disabled exposure or a rejected account view', async () => {
  let views = 0;
  const disabled = createCredentialVault({ account: 'a', storage: storage(), request: async (action) => {
    if (action === 'settings') return { allowKeysExposure: false };
    if (action === 'read') return { api_key_generic: [{ id: ref.split(':')[1], label: '灵画师 · NovelAI', value: '**********' }] };
    if (action === 'view') views++;
    throw new Error('403');
  } });
  await assert.rejects(disabled.read('novelai', ref));
  assert.equal(views, 0);
  const rejected = createCredentialVault({ account: 'a', storage: storage(), request: async (action) => {
    if (action === 'settings') return { allowKeysExposure: true };
    throw new Error('403');
  } });
  await assert.rejects(rejected.read('novelai', ref));
});

test('saving a generic secret preserves another extension active selection and provider isolation', async () => {
  const originalId = crypto.randomUUID();
  const records = [{ id: originalId, value: 'another-extension-key', label: 'Another extension', active: true }];
  const request = async (action, body) => {
    if (action === 'settings') return { allowKeysExposure: true };
    if (action === 'read') return { api_key_generic: structuredClone(records) };
    assert.equal(body.key, 'api_key_generic');
    if (action === 'write') {
      records.forEach(item => { item.active = false; });
      const id = crypto.randomUUID();
      records.push({ id, value: body.value, label: body.label, active: true });
      return { id };
    }
    if (action === 'rotate') {
      records.forEach(item => { item.active = item.id === body.id; });
      return {};
    }
    if (action === 'find') return { value: records.find(item => item.id === body.id)?.value || '' };
    throw new Error('Unsupported operation');
  };
  const saved = storage();
  const keyRef = await createCredentialVault({ account: 'a', storage: saved, request }).write('novelai', 'fixture-key');
  assert.equal(records.find(item => item.active).id, originalId);
  assert.equal(records.find(item => item.id === keyRef.split(':')[1]).active, false);
  const fresh = createCredentialVault({ account: 'a', storage: saved, request });
  assert.equal(await fresh.read('novelai', keyRef), 'fixture-key');
  await assert.rejects(fresh.read('openai', keyRef));
  await assert.rejects(fresh.read('novelai', `tavern:${originalId}`));
});

test('disabled exposure and unavailable server secret endpoints save an explicitly entered key locally', async () => {
  const saved = storage();
  const fallback = createCredentialVault({ account: 'a', storage: saved,
    request: async () => ({ allowKeysExposure: false }) });
  assert.ok((await fallback.write('novelai', 'fixture-key')).startsWith('browser:'));
  const serverStorage = storage();
  const request = async (action) => {
    if (action === 'settings') return { allowKeysExposure: true };
    throw new Error('write failed');
  };
  const fallbackRef = await createCredentialVault({ account: 'b', storage: serverStorage, request }).write('novelai', 'fixture-key');
  assert.ok(fallbackRef.startsWith('browser:'));
  assert.equal(await createCredentialVault({ account: 'b', storage: serverStorage, request }).read('novelai', fallbackRef), 'fixture-key');
  assert.match(credentialSavedMessage(fallbackRef), /当前浏览器/);
});

test('browser credential quota failures preserve existing references and never claim a new key was saved', async () => {
  const saved = storage();
  const first = await createCredentialVault({ account: 'a', storage: saved }).write('novelai', 'existing-fixture-key');
  const previous = [...saved.data.entries()];
  saved.setItem = () => { throw new DOMException('Fixture quota exceeded', 'QuotaExceededError'); };
  const vault = createCredentialVault({ account: 'a', storage: saved });
  assert.equal(await vault.read('novelai', first), 'existing-fixture-key');
  assert.equal(await vault.write('novelai', 'existing-fixture-key', first), first);
  await assert.rejects(vault.write('novelai', 'new-fixture-key', first), { code: 'CREDENTIAL_QUOTA' });
  assert.deepEqual([...saved.data.entries()], previous);
});

const databaseFixture = () => {
  const accounts = new Map();
  return (account) => {
    if (!accounts.has(account)) accounts.set(account, new Map());
    const values = accounts.get(account);
    return {
      async read(provider, id) { return values.get(`${provider}:${id}`); },
      async write(provider, id, key) {
        assert.ok(!values.has(`${provider}:${id}`));
        values.set(`${provider}:${id}`, key);
      },
    };
  };
};

test('full localStorage falls back durably and preserves immutable old preset keys and isolation', async () => {
  const saved = storage(), databases = databaseFixture();
  const original = createCredentialVault({ account: 'a', storage: saved, database: databases('a') });
  const first = await original.write('openai', 'original-fixture-key');
  const previous = [...saved.data.entries()];
  saved.setItem = () => { throw new DOMException('private detail', 'QuotaExceededError'); };
  const second = await original.write('openai', 'replacement-fixture-key', first);
  assert.notEqual(second, first);
  assert.ok(second.startsWith('browser:'));
  assert.deepEqual([...saved.data.entries()], previous);
  const fresh = createCredentialVault({ account: 'a', storage: saved, database: databases('a') });
  assert.equal(await fresh.read('openai', first), 'original-fixture-key');
  assert.equal(await fresh.read('openai', second), 'replacement-fixture-key');
  assert.equal(await fresh.write('openai', 'replacement-fixture-key', second), second);
  await assert.rejects(fresh.read('assistant', second));
  await assert.rejects(createCredentialVault({ account: 'b', storage: saved, database: databases('b') }).read('openai', second));
  assert.equal(await fresh.write('openai', '', second), '');
  assert.equal(await fresh.read('openai', second), 'replacement-fixture-key');
});

test('blocked, missing, malformed and silently discarded local storage can use independent durable storage', async () => {
  for (const kind of ['blocked', 'missing', 'malformed', 'discarded']) {
    const databases = databaseFixture(), saved = storage();
    const name = 'linghuashi-credential-vault:a';
    if (kind === 'blocked') saved.getItem = () => { throw new DOMException('private detail', 'SecurityError'); };
    if (kind === 'malformed') saved.setItem(name, '{invalid');
    if (kind === 'discarded') saved.setItem = () => {};
    const options = { account: 'a', storage: kind === 'missing' ? null : saved, database: databases('a') };
    const keyRef = await createCredentialVault(options).write('assistant', 'fixture-private-key');
    assert.equal(await createCredentialVault(options).read('assistant', keyRef), 'fixture-private-key');
    if (kind === 'malformed') assert.equal(saved.getItem(name), '{invalid');
  }
});

test('unreadable server writes never claim server persistence and do not reuse another provider secret', async () => {
  const saved = storage(), id = crypto.randomUUID();
  const request = async (action) => action === 'settings' ? { allowKeysExposure: true }
    : action === 'read' ? { api_key_generic: [] }
      : action === 'write' ? { id } : { value: 'different-fixture-key' };
  const options = { account: 'a', storage: saved, request };
  const keyRef = await createCredentialVault(options).write('openai', 'entered-fixture-key');
  assert.ok(keyRef.startsWith('browser:'));
  assert.equal(await createCredentialVault(options).read('openai', keyRef), 'entered-fixture-key');
  await assert.rejects(createCredentialVault(options).read('novelai', keyRef));
  await assert.rejects(createCredentialVault(options).read('openai', `tavern:${id}`));
});

test('failure of both local stores never caches a new key or overwrites the old reference', async () => {
  const saved = storage(), databases = databaseFixture();
  const options = { account: 'a', storage: saved, database: databases('a') };
  const original = await createCredentialVault(options).write('novelai', 'older-fixture-key');
  saved.setItem = () => { throw new DOMException('private detail', 'QuotaExceededError'); };
  const failing = createCredentialVault({ ...options, database: {
    read: options.database.read,
    async write() { throw new DOMException('private detail', 'QuotaExceededError'); },
  } });
  await assert.rejects(failing.write('novelai', 'unsaved-fixture-key', original), { code: 'CREDENTIAL_QUOTA' });
  assert.equal(await failing.read('novelai', original), 'older-fixture-key');
  await assert.rejects(failing.write('novelai', 'unsaved-fixture-key', original), { code: 'CREDENTIAL_QUOTA' });
});

test('credential failures expose only an allowlisted cause and actionable text', () => {
  const privateDetail = 'sk-private-fixture-key https://private.example/token';
  for (const error of [
    new DOMException(privateDetail, 'QuotaExceededError'),
    new DOMException(privateDetail, 'SecurityError'),
    new DOMException(privateDetail, 'TimeoutError'),
    new Error(privateDetail), { code: privateDetail, message: privateDetail },
    credentialError('CREDENTIAL_CORRUPT'),
  ]) {
    const failure = credentialFailure(error);
    assert.ok(!JSON.stringify(failure).includes(privateDetail));
    assert.ok(failure.code.startsWith('CREDENTIAL_'));
    assert.equal(credentialError(failure.code).message, failure.message);
  }
  assert.equal(credentialFailure(new Error(privateDetail), 'read').code, 'CREDENTIAL_MISSING');
  assert.match(credentialSavedMessage(ref), /酒馆账号/);
});
