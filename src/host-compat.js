const HOSTS = Object.freeze({
  sillytavern: Object.freeze({ kind: 'sillytavern', name: 'SillyTavern', serverPlugins: true, network: 'browser-direct' }),
  tauritavern: Object.freeze({ kind: 'tauritavern', name: 'TauriTavern', serverPlugins: false, network: 'webview-direct' }),
});

export function hostEnvironment(environment = globalThis) {
  const current = environment.window || environment;
  const native = (value) => value?.__LINGHUASHI_ENV__?.host?.kind === 'tauritavern'
    || value?.__TAURI_RUNNING__ === true || Boolean(value?.__TAURITAVERN__?.api)
    || Boolean(value?.__TAURITAVERN_MAIN_READY__);
  if (native(current)) return HOSTS.tauritavern;
  try {
    if (current.parent && current.parent !== current && native(current.parent)) return HOSTS.tauritavern;
  } catch { /* A cross-origin parent cannot provide a host contract. */ }
  return HOSTS.sillytavern;
}

export async function resolveHostAccount({ environment = globalThis, request = fetch } = {}) {
  const current = environment.window || environment;
  if (hostEnvironment(environment).kind === 'tauritavern') {
    await (current.__TAURITAVERN__?.ready || current.__TAURITAVERN_MAIN_READY__);
    // TauriTavern v2.3 uses one local default-user directory and has no users/me route.
    return 'default-user';
  }
  const response = await request('/api/users/me', { credentials: 'same-origin' });
  if (!response.ok) throw new Error('酒馆账号无法读取');
  const profile = await response.json();
  if (typeof profile.handle !== 'string' || !profile.handle) throw new Error('酒馆账号无效');
  return profile.handle;
}

function nativeWindowMatches(target, environment) {
  const location = environment.location;
  if (hostEnvironment(environment).kind !== 'tauritavern' || location?.protocol !== 'tauri:') return false;
  try {
    return target.location.protocol === location.protocol && target.location.host === location.host;
  } catch { return false; }
}

export function isWindowMessage(event, source, environment = globalThis) {
  if (!source || event.source !== source) return false;
  const origin = environment.location?.origin;
  if (origin && origin !== 'null' && event.origin === origin) return true;
  return nativeWindowMatches(source, environment)
    && (event.origin === 'null' || event.origin === origin);
}

export function postWindowMessage(target, value, environment = globalThis) {
  if (!target) return;
  if (environment.location?.protocol === 'tauri:') {
    // Opaque custom-scheme origins need *, but only a verified same-host window receives data.
    if (nativeWindowMatches(target, environment)) target.postMessage(value, '*');
    return;
  }
  const origin = environment.location?.origin;
  if (origin && origin !== 'null') target.postMessage(value, origin);
}

export function showExtensionSurface(host) {
  if (typeof host.showPopover === 'function') {
    host.popover = 'manual';
    try { host.showPopover(); return; } catch { /* Older embedded views use a fixed surface. */ }
  }
  host.removeAttribute('popover');
  host.style.display = 'block';
  host.style.zIndex = '2147483000';
}
