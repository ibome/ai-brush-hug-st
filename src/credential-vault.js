import { randomUUID } from './crypto-compat.js';
import { CONNECTION_PROVIDERS, validKeyRef } from './connections.js';

export function createCredentialVault({ account, storage, request }) {
  const storageName = `linghuashi-credential-vault:${encodeURIComponent(account)}`;
  let mode;
  const cache = new Map();
  const secretName = 'api_key_generic';
  const secretLabel = (provider) => `灵画师 · ${{ novelai: 'NovelAI', openai: 'OpenAI', comfyui: 'ComfyUI', sdwebui: 'SDWebUI', assistant: '提示词助手', localtools: '本地组件' }[provider]}`;
  const assertProvider = (provider) => {
    if (![...CONNECTION_PROVIDERS, 'assistant', 'localtools'].includes(provider)) throw new Error('未知接口类型');
  };
  const browserSecrets = () => {
    const saved = JSON.parse(storage.getItem(storageName) || '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
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
    if (!validKeyRef(ref)) throw new Error('秘钥引用无效');
    const cacheId = `${provider}:${ref}`;
    if (cache.has(cacheId)) return cache.get(cacheId);
    const [store, id] = ref.split(':');
    let value;
    if (store === 'tavern') {
      if (!request) throw new Error('请在原酒馆账号中读取该秘钥');
      const state = await request('read', {});
      const records = state?.[secretName];
      const record = Array.isArray(records)
        ? records.find((item) => item.id === id && item.label === secretLabel(provider)) : null;
      if (!record) throw new Error('保存的秘钥关联无法读取，请重新填写并保存预设');
      const data = await request('find', { key: secretName, id });
      value = data.value;
    } else value = browserSecrets()[id]?.[provider];
    if (typeof value !== 'string' || !value) throw new Error('保存的秘钥无法读取，请重新填写并保存预设');
    cache.set(cacheId, value);
    return value;
  }
  async function write(provider, value, ref = '') {
    assertProvider(provider);
    if (typeof value !== 'string' || value.length > 4096) throw new Error('秘钥长度无效');
    const key = value.trim();
    if (!key) return '';
    if (ref) {
      try { if (await read(provider, ref) === key) return ref; } catch {}
    }
    const store = await storageMode();
    let id;
    if (store === 'tavern') {
      const save = async () => {
        const state = await request('read', {});
        const records = state?.[secretName];
        const previous = Array.isArray(records) ? records.find((item) => item.active) : null;
        const data = await request('write', { key: secretName, value: key, label: secretLabel(provider) });
        if (!validKeyRef(`tavern:${data.id}`)) throw new Error('秘钥保存失败，请重试');
        // Preserve another extension's selected generic secret. Our presets
        // always read their immutable IDs, including inactive records.
        if (previous) await request('rotate', { key: secretName, id: previous.id });
        return data.id;
      };
      id = globalThis.navigator?.locks
        ? await navigator.locks.request(`linghuashi-secret-write:${encodeURIComponent(account)}`, save)
        : await save();
    } else {
      id = randomUUID();
      const saved = browserSecrets();
      saved[id] = { [provider]: key };
      try { storage.setItem(storageName, JSON.stringify(saved)); }
      catch { throw new Error('浏览器秘钥存储空间不足或不可用，请备份并整理站点存储后重试'); }
    }
    const result = `${store}:${id}`;
    if (!validKeyRef(result)) throw new Error('秘钥保存失败，请重试');
    cache.set(`${provider}:${result}`, key);
    return result;
  }
  return { read, write };
}
