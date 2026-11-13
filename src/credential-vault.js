import { randomUUID } from './crypto-compat.js';
import { CONNECTION_PROVIDERS, validKeyRef } from './connections.js';
import { createCredentialStore } from './credential-store.js';
import { credentialError, credentialFailure } from './credential-errors.js';

export function createCredentialVault({ account, storage, request, database }) {
  const storageName = `linghuashi-credential-vault:${encodeURIComponent(account)}`;
  const durable = database || createCredentialStore(account);
  let mode;
  const cache = new Map();
  const secretName = 'api_key_generic';
  const secretLabel = (provider) => `灵画师 · ${{ novelai: 'NovelAI', openai: 'OpenAI', comfyui: 'ComfyUI', sdwebui: 'SDWebUI', assistant: '提示词助手', localtools: '本地组件' }[provider]}`;
  const assertProvider = (provider) => {
    if (![...CONNECTION_PROVIDERS, 'assistant', 'localtools'].includes(provider)) throw new Error('未知接口类型');
  };
  const browserSecrets = () => {
    if (!storage) throw credentialError('CREDENTIAL_UNAVAILABLE');
    let saved;
    try { saved = JSON.parse(storage.getItem(storageName) || '{}'); }
    catch (error) {
      if (error instanceof SyntaxError) throw credentialError('CREDENTIAL_CORRUPT');
      throw error;
    }
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw credentialError('CREDENTIAL_CORRUPT');
    return saved;
  };
  async function storageMode() {
    if (!mode) mode = request
      ? request('settings', {}).then((data) => data.allowKeysExposure ? 'tavern' : 'browser').catch(() => 'browser')
      : Promise.resolve('browser');
    return mode;
  }
  async function read(provider, ref) {
    assertProvider(provider);
    if (!ref) return '';
    if (!validKeyRef(ref)) throw credentialError('CREDENTIAL_INVALID');
    const cacheId = `${provider}:${ref}`;
    if (cache.has(cacheId)) return cache.get(cacheId);
    const [store, id] = ref.split(':');
    let value;
    if (store === 'tavern') {
      if (!request) throw credentialError('CREDENTIAL_MISSING');
      const state = await request('read', {});
      const records = state?.[secretName];
      const record = Array.isArray(records)
        ? records.find((item) => item.id === id && item.label === secretLabel(provider)) : null;
      if (!record) throw credentialError('CREDENTIAL_MISSING');
      const data = await request('find', { key: secretName, id });
      value = data?.value;
    } else {
      let failure;
      try { value = browserSecrets()[id]?.[provider]; } catch (error) { failure = error; }
      if (typeof value !== 'string' || !value) {
        try { value = await durable.read(provider, id); }
        catch (error) { throw credentialError(credentialFailure(failure || error, 'read').code); }
      }
    }
    if (typeof value !== 'string' || !value) throw credentialError('CREDENTIAL_MISSING');
    cache.set(cacheId, value);
    return value;
  }
  async function write(provider, value, ref = '') {
    assertProvider(provider);
    if (typeof value !== 'string' || value.length > 4096) throw credentialError('CREDENTIAL_INVALID');
    const key = value.trim();
    if (!key) return '';
    if (ref) {
      try { if (await read(provider, ref) === key) return ref; } catch {}
    }
    let store = await storageMode();
    let id;
    if (store === 'tavern') {
      const save = async () => {
        const state = await request('read', {});
        const records = state?.[secretName];
        const previous = Array.isArray(records) ? records.find((item) => item.active) : null;
        const data = await request('write', { key: secretName, value: key, label: secretLabel(provider) });
        if (!validKeyRef(`tavern:${data?.id}`)) throw credentialError('CREDENTIAL_SERVER');
        // Preserve another extension's selected generic secret. Our presets
        // always read their immutable IDs, including inactive records.
        if (previous) await request('rotate', { key: secretName, id: previous.id });
        const confirmed = await request('find', { key: secretName, id: data.id });
        if (confirmed?.value !== key) throw credentialError('CREDENTIAL_SERVER');
        return data.id;
      };
      try {
        id = globalThis.navigator?.locks
          ? await navigator.locks.request(`linghuashi-secret-write:${encodeURIComponent(account)}`, save)
          : await save();
      } catch {
        // Only the key explicitly supplied for this write can use local fallback.
        // Reading a denied Tavern reference never borrows another saved secret.
        store = 'browser';
      }
    }
    if (store === 'browser') {
      id = randomUUID();
      let failure;
      try {
        const saved = browserSecrets();
        saved[id] = { [provider]: key };
        storage.setItem(storageName, JSON.stringify(saved));
        if (browserSecrets()[id]?.[provider] !== key) throw credentialError('CREDENTIAL_UNAVAILABLE');
      } catch (error) { failure = error; }
      if (failure) {
        try { await durable.write(provider, id, key); }
        catch (error) {
          const local = credentialFailure(failure), backup = credentialFailure(error);
          throw credentialError(backup.code === 'CREDENTIAL_UNAVAILABLE' ? local.code : backup.code);
        }
      }
    }
    const result = `${store}:${id}`;
    if (!validKeyRef(result)) throw credentialError('CREDENTIAL_INVALID');
    cache.set(`${provider}:${result}`, key);
    return result;
  }
  return { read, write };
}
