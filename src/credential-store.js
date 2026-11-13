import { credentialError } from './credential-errors.js';

const databaseFactory = () => {
  try { return globalThis.indexedDB; } catch { return null; }
};

export function createCredentialStore(account, factory = databaseFactory(), timeout = 2500) {
  const name = `linghuashi-credentials-v1:${encodeURIComponent(account)}`;
  async function transaction(mode, operation) {
    if (!factory) throw credentialError('CREDENTIAL_UNAVAILABLE');
    let db, tx, abandoned = false, timer;
    try {
      return await Promise.race([
        new Promise((resolve, reject) => {
          const opening = factory.open(name, 1);
          opening.onupgradeneeded = () => {
            if (abandoned) { opening.transaction.abort(); return; }
            opening.result.createObjectStore('secrets');
          };
          opening.onerror = () => reject(opening.error);
          opening.onblocked = () => reject(credentialError('CREDENTIAL_BLOCKED'));
          opening.onsuccess = () => {
            db = opening.result;
            if (abandoned) { db.close(); return; }
            db.onversionchange = () => db.close();
            try {
              tx = db.transaction('secrets', mode);
              let value;
              const result = operation(tx.objectStore('secrets'));
              result.onsuccess = () => { value = result.result; };
              tx.oncomplete = () => resolve(value);
              tx.onabort = () => reject(tx.error || credentialError('CREDENTIAL_UNAVAILABLE'));
              tx.onerror = () => {};
            } catch (error) { reject(error); }
          };
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(credentialError('CREDENTIAL_TIMEOUT')), timeout);
        }),
      ]);
    } finally {
      abandoned = true; clearTimeout(timer);
      try { tx?.abort(); } catch {}
      db?.close();
    }
  }
  const read = (provider, id) => transaction('readonly', (store) => store.get(`${provider}:${id}`));
  return {
    read,
    async write(provider, id, key) {
      await transaction('readwrite', (store) => store.add(key, `${provider}:${id}`));
      if (await read(provider, id) !== key) throw credentialError('CREDENTIAL_UNAVAILABLE');
    },
  };
}
