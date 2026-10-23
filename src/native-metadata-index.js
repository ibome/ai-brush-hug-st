// Device-local cache only. Account image files remain authoritative.
export class NativeMetadataIndex {
  constructor(account, indexedDB = globalThis.indexedDB) {
    this.account = account; this.indexedDB = indexedDB;
  }
  db() {
    if (!this.indexedDB) return Promise.reject(new Error('图片索引缓存不可用'));
    this.opened ||= new Promise((resolve, reject) => {
      const request = this.indexedDB.open(`linghuashi-native-index-v1:${encodeURIComponent(this.account)}`, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('metadata', { keyPath: 'id' });
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); this.opened = null; };
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    }).catch((error) => { this.opened = null; throw error; });
    return this.opened;
  }
  async read() {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const request = db.transaction('metadata').objectStore('metadata').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async write(rows, removed = []) {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('metadata', 'readwrite'), store = transaction.objectStore('metadata');
      for (const id of removed) store.delete(id);
      for (const row of rows) store.put(row);
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error || new Error('图片索引缓存保存失败'));
      transaction.onerror = () => {};
    });
  }
}
