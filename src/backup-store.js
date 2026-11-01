import { storageKey } from './runtime.js';

export class BackupStore {
  async db() {
    this.opened ||= new Promise((resolve, reject) => {
      const request = indexedDB.open(storageKey('linghuashi-backup-journal-v1'), 1);
      request.onupgradeneeded = () => request.result.createObjectStore('records');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.opened;
  }
  async get(key) {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const request = db.transaction('records').objectStore('records').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async put(key, value) {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('records', 'readwrite');
      transaction.objectStore('records').put(value, key);
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error || new Error('恢复记录保存失败'));
      transaction.onerror = () => {};
    });
  }
}
