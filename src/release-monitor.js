import { RELEASE, checkRelease, compareVersions } from './release.js';

export const RELEASE_CACHE_KEY = `linghuashi:release:${RELEASE.repository}`;
export const RELEASE_CHECK_INTERVAL = 60 * 60 * 1000;
export const RELEASE_RETRY_INTERVAL = 15 * 60 * 1000;

function normalizeRelease(value) {
  if (!value || typeof value !== 'object' || typeof value.version !== 'string') return null;
  if (!value.version) return { version: '', newer: false, message: '尚无正式发布版本', notes: '', url: `${RELEASE.url}/releases` };
  const newer = compareVersions(value.version, RELEASE.version) > 0;
  return { version: value.version, newer, message: newer ? `发现新版本 ${value.version}` : '当前已是最新版本',
    notes: String(value.notes || '').slice(0, 12000), url: `${RELEASE.url}/releases/tag/v${value.version}` };
}

export function createReleaseMonitor({ storage, now = Date.now, check = checkRelease } = {}) {
  let state = { status: 'idle', release: null, checkedAt: 0, attemptedAt: 0, error: '' };
  let pending;
  let destroyed = false;
  const listeners = new Set();
  const snapshot = () => ({ ...state, release: state.release ? { ...state.release } : null });
  function emit() {
    for (const listener of listeners) {
      try { listener(snapshot()); } catch { /* An observer must not interrupt version checks. */ }
    }
  }
  function readCache() {
    try {
      const cached = JSON.parse(storage?.getItem(RELEASE_CACHE_KEY) || 'null');
      if (!cached || cached.schema !== 1 || cached.repository !== RELEASE.repository
        || !Number.isFinite(cached.checkedAt) || !Number.isFinite(cached.attemptedAt)
        || cached.checkedAt < 0 || cached.attemptedAt < 0
        || cached.checkedAt > now() || cached.attemptedAt > now()) return;
      const release = cached.release ? normalizeRelease(cached.release) : null;
      if (cached.checkedAt && !release) return;
      if (cached.attemptedAt < state.attemptedAt) return;
      state = { status: release?.newer ? 'available' : cached.failed ? 'error' : release ? 'current' : 'idle',
        release, checkedAt: cached.checkedAt, attemptedAt: cached.attemptedAt,
        error: cached.failed ? '暂时无法检查更新，可稍后重试' : '' };
    } catch { /* Unavailable or invalid browser caches do not block the extension. */ }
  }
  function saveCache(failed) {
    try {
      storage?.setItem(RELEASE_CACHE_KEY, JSON.stringify({ schema: 1, repository: RELEASE.repository,
        release: state.release, checkedAt: state.checkedAt, attemptedAt: state.attemptedAt, failed }));
    } catch { /* Version checks also work when browser storage is unavailable. */ }
  }
  readCache();
  return {
    getState: snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    refreshCache() {
      if (destroyed || pending) return;
      readCache(); emit();
    },
    check({ force = false } = {}) {
      if (destroyed) return Promise.resolve(snapshot());
      if (pending) return pending;
      readCache();
      const age = now() - state.attemptedAt;
      const delay = state.error ? RELEASE_RETRY_INTERVAL : RELEASE_CHECK_INTERVAL;
      if (!force && state.attemptedAt && age < delay) { emit(); return Promise.resolve(snapshot()); }
      state = { ...state, status: 'checking', attemptedAt: now(), error: '' };
      emit();
      pending = (async () => {
        try {
          const release = normalizeRelease(await check());
          if (!release) throw new Error('版本信息读取失败');
          if (!destroyed) {
            state = { ...state, status: release.newer ? 'available' : 'current', release, checkedAt: now(), error: '' };
            saveCache(false);
          }
        } catch (error) {
          if (!destroyed) {
            state = { ...state, status: state.release?.newer ? 'available' : 'error',
              error: error instanceof Error ? error.message : '版本信息读取失败' };
            saveCache(true);
          }
        }
        if (!destroyed) emit();
        return snapshot();
      })().finally(() => { pending = null; });
      return pending;
    },
    destroy() { destroyed = true; listeners.clear(); },
  };
}
