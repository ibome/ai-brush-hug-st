import { randomUUID } from './crypto-compat.js';
export const CONNECTION_PROVIDERS = ['novelai', 'openai', 'comfyui', 'sdwebui'];
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const timeout = (value, fallback, max) => Math.max(5, Math.min(max, Math.round(Number(value) || fallback)));

export function validKeyRef(value) {
  return typeof value === 'string' && /^(?:tavern|browser):[a-f0-9-]{36}$/.test(value);
}

export function normalizeConnection(provider, value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const result = {
    keyRef: validKeyRef(input.keyRef) ? input.keyRef : '',
    endpoint: text(input.endpoint, 512),
  };
  if (provider === 'openai') {
    result.path = text(input.path, 200) || '/images/generations';
    result.timeout = timeout(input.timeout, 180, 600);
  } else if (provider === 'comfyui') {
    result.auth = input.auth === 'bearer' ? 'bearer' : 'none';
    result.timeout = timeout(input.timeout, 15, 120);
  } else if (provider === 'sdwebui') {
    result.auth = ['basic', 'bearer'].includes(input.auth) ? input.auth : 'none';
    result.username = text(input.username, 200);
    result.timeout = timeout(input.timeout, 600, 600);
    result.textTaskId = input.textTaskId === true;
    result.imageTaskId = input.imageTaskId === true;
    result.progressMode = ['internal', 'native'].includes(input.progressMode) ? input.progressMode : 'none';
  }
  return result;
}

export function normalizeConnections(state) {
  const saved = state.connections || {};
  state.connections = Object.fromEntries(CONNECTION_PROVIDERS.map((provider) => [
    provider, normalizeConnection(provider, saved[provider] || (provider === 'openai' ? {
      endpoint: state.openaiEndpoint, path: state.openaiPath, timeout: state.openaiTimeout,
    } : provider === 'comfyui' ? { timeout: state.comfyTimeout } : {})),
  ]));
  const migrated = state.connectionLibraryVersion === 1;
  const library = state.connectionProfiles || {};
  const selected = state.connectionProfileIds || {};
  state.connectionProfiles = {};
  state.connectionProfileIds = {};
  state.presetBindings = state.presetBindings && typeof state.presetBindings === 'object' && !Array.isArray(state.presetBindings) ? state.presetBindings : {};
  for (const provider of CONNECTION_PROVIDERS) {
    const ids = new Set(), names = new Set();
    const entries = (Array.isArray(library[provider]) ? library[provider] : []).slice(0, 50).flatMap((entry) => {
      const name = text(entry?.name, 40).trim();
      if (!entry || !validProfileId(entry.id) || !name || ids.has(entry.id) || names.has(name.toLocaleLowerCase())) return [];
      ids.add(entry.id); names.add(name.toLocaleLowerCase());
      return [{ id: entry.id, name, connection: normalizeConnection(provider, entry.connection) }];
    });
    if (!migrated && !entries.length) {
      const current = normalizeConnection(provider, state.connections[provider]);
      const add = (name, connection) => {
        const same = entries.find((entry) => JSON.stringify(entry.connection) === JSON.stringify(connection));
        if (same) return same.id;
        const entry = { id: randomUUID(), name: uniqueName(entries, name), connection };
        entries.push(entry);
        return entry.id;
      };
      state.connectionProfileIds[provider] = add('当前接口', current);
      const presets = state[{ novelai: 'novelaiPresets', openai: 'openaiPresets', comfyui: 'comfyPresets', sdwebui: 'sdwebuiPresets' }[provider]] || [];
      for (const preset of presets) {
        if (preset.connection && entries.length < 50) add(preset.name, normalizeConnection(provider, preset.connection));
      }
    } else state.connectionProfileIds[provider] = entries.some((entry) => entry.id === selected[provider]) ? selected[provider] : '';
    state.connectionProfiles[provider] = entries;
    const preset = state[{ novelai: 'novelaiPresets', openai: 'openaiPresets', comfyui: 'comfyPresets', sdwebui: 'sdwebuiPresets' }[provider]]
      ?.find((entry) => entry.id === state[{ novelai: 'novelaiPresetId', openai: 'openaiPresetId', comfyui: 'comfyPresetId', sdwebui: 'sdwebuiPresetId' }[provider]]);
    state.presetBindings[provider] = preset?.connectionProfileId || (preset?.connection ? 'legacy' : '');
  }
  state.connectionLibraryVersion = 1;
}

export function presetConnection(provider, preset) {
  if (Object.hasOwn(preset || {}, 'connectionProfileId')) return {
    connectionProfileId: validProfileId(preset.connectionProfileId) ? preset.connectionProfileId : '',
  };
  return preset?.connection && typeof preset.connection === 'object'
    ? { connection: normalizeConnection(provider, preset.connection) } : {};
}

export function connectionDirty(state, provider, preset) {
  if (state.presetBindings?.[provider] !== undefined && state.presetBindings[provider]
    !== (preset?.connectionProfileId || (preset?.connection ? 'legacy' : ''))) return true;
  if (Object.hasOwn(preset || {}, 'connectionProfileId')) return false;
  return Boolean(preset?.connection) && JSON.stringify(normalizeConnection(provider, state.connections?.[provider]))
    !== JSON.stringify(normalizeConnection(provider, preset.connection));
}

export function applyPresetConnection(state, provider, preset) {
  const value = resolvePresetConnection(state, provider, preset);
  if (state.presetBindings) state.presetBindings[provider] = preset?.connectionProfileId || (preset?.connection ? 'legacy' : '');
  if (!value) return;
  setCurrentConnection(state, provider, value);
  if (state.connectionProfileIds) state.connectionProfileIds[provider] = preset.connectionProfileId
    || state.connectionProfiles[provider]?.find((entry) => JSON.stringify(entry.connection) === JSON.stringify(value))?.id || '';
}

export function setCurrentConnection(state, provider, value) {
  state.connections[provider] = normalizeConnection(provider, value);
  const connection = state.connections[provider];
  if (provider === 'openai') {
    state.openaiEndpoint = connection.endpoint;
    state.openaiPath = connection.path;
    state.openaiTimeout = connection.timeout;
  } else if (provider === 'comfyui') state.comfyTimeout = connection.timeout;
}

export const validProfileId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const assertProvider = (provider) => {
  if (!CONNECTION_PROVIDERS.includes(provider)) throw new Error('未知接口类型');
};
const uniqueName = (entries, value) => {
  let name = value.slice(0, 34), suffix = 1;
  while (entries.some((entry) => entry.name.toLocaleLowerCase() === name.toLocaleLowerCase())) name = `${value.slice(0, 34)} ${++suffix}`;
  return name;
};

export function resolvePresetConnection(state, provider, preset) {
  if (preset?.connectionProfileId) {
    const entry = state.connectionProfiles?.[provider]?.find((item) => item.id === preset.connectionProfileId);
    if (!entry) throw new Error('预设绑定的接口已删除，请选择其他接口或取消绑定');
    return normalizeConnection(provider, entry.connection);
  }
  return Object.hasOwn(preset || {}, 'connectionProfileId') ? null
    : preset?.connection ? normalizeConnection(provider, preset.connection) : null;
}

export function savePresetBinding(state, provider, preset) {
  const id = state.presetBindings?.[provider];
  delete preset.connection;
  delete preset.connectionProfileId;
  if (id === 'legacy' || id === undefined) preset.connection = normalizeConnection(provider, state.connections[provider]);
  else {
    if (id && !state.connectionProfiles[provider].some((entry) => entry.id === id)) throw new Error('绑定接口不存在');
    preset.connectionProfileId = id || '';
  }
  return preset;
}

export function saveConnectionProfile(state, provider, name, id = '') {
  assertProvider(provider);
  const entries = state.connectionProfiles[provider];
  const title = String(name || '').trim();
  if (!title || title.length > 40) throw new Error('接口名称需为 1 至 40 个字符');
  if (entries.some((entry) => entry.id !== id && entry.name.toLocaleLowerCase() === title.toLocaleLowerCase())) throw new Error('已有同名接口');
  const previous = entries.find((entry) => entry.id === id);
  if (id && !previous) throw new Error('接口配置不存在');
  if (!previous && entries.length >= 50) throw new Error('每种模式最多保存 50 个接口');
  const entry = { id: previous?.id || randomUUID(), name: title, connection: normalizeConnection(provider, state.connections[provider]) };
  if (previous) entries.splice(entries.indexOf(previous), 1, entry);
  else entries.push(entry);
  state.connectionProfileIds[provider] = entry.id;
  return entry;
}

export function deleteConnectionProfile(state, provider, id) {
  assertProvider(provider);
  state.connectionProfiles[provider] = state.connectionProfiles[provider].filter((entry) => entry.id !== id);
  if (state.connectionProfileIds[provider] === id) state.connectionProfileIds[provider] = '';
  for (const preset of state[{ novelai: 'novelaiPresets', openai: 'openaiPresets', comfyui: 'comfyPresets', sdwebui: 'sdwebuiPresets' }[provider]] || []) {
    if (preset.connectionProfileId === id) preset.connectionProfileId = '';
  }
  if (state.presetBindings[provider] === id) state.presetBindings[provider] = '';
}
