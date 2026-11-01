export function getBrowserStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function readBrowserCache(key) {
  try { return getBrowserStorage()?.getItem(key) ?? null; } catch { return null; }
}

export function writeBrowserCache(key, value) {
  try {
    const storage = getBrowserStorage();
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch { return false; }
}
