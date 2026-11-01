import { currentAccount, storageKey, storageRequest, isInstalled } from './runtime.js';
import { sha256Hex } from './crypto-compat.js';

const CHUNK = 512 * 1024;
const MAX_ASSET = 4 * 1024 * 1024;
export const assetBase64 = (bytes) => {
  let value = '';
  for (let index = 0; index < bytes.length; index += 16384) value += String.fromCharCode(...bytes.subarray(index, index + 16384));
  return btoa(value);
};
export const assetBytes = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
export function normalizeAsset(value) {
  if (!value || !/^[a-f0-9]{64}$/.test(value.id) || !['browser', 'server'].includes(value.location)) return null;
  return { id: value.id, location: value.location, name: String(value.name || '参考图').slice(0, 120),
    mime: ['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'].includes(value.mime) ? value.mime : 'image/png',
    width: Math.max(0, Math.min(4096, Number(value.width) || 0)), height: Math.max(0, Math.min(4096, Number(value.height) || 0)) };
}

export class ReferenceAssets {
  constructor({ mode = () => 'browser', request = storageRequest } = {}) {
    this.mode = mode; this.request = request; this.cache = new Map(); this.pending = new Map();
  }
  cacheKey(asset) { return `${currentAccount()}:${asset.location}:${asset.id}`; }
  remember(asset, blob) {
    const key = this.cacheKey(asset);
    this.cache.delete(key); this.cache.set(key, blob);
    let bytes = [...this.cache.values()].reduce((sum, value) => sum + value.size, 0);
    while (this.cache.size > 16 || bytes > 32 * 1024 * 1024) {
      const oldest = this.cache.keys().next().value;
      bytes -= this.cache.get(oldest).size; this.cache.delete(oldest);
    }
    return blob;
  }
  async database() {
    this.opened ||= new Promise((resolve, reject) => {
      const request = indexedDB.open(storageKey(`linghuashi-references-${currentAccount()}`), 1);
      request.onupgradeneeded = () => request.result.createObjectStore('assets', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.opened;
  }
  async browserRead(id) {
    const db = await this.database();
    return new Promise((resolve, reject) => {
      const request = db.transaction('assets').objectStore('assets').get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async put(blob, metadata = {}, location = this.mode()) {
    if (!(blob instanceof Blob) || !blob.size || blob.size > MAX_ASSET) throw new Error('参考素材需小于 4 MB');
    if (location === 'server' && !isInstalled()) throw new Error('酒馆服务器素材需在酒馆内上传');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const id = await sha256Hex(bytes);
    const asset = normalizeAsset({ ...metadata, id, location, mime: blob.type || 'application/octet-stream' });
    if (location === 'server') {
      for (let offset = 0; offset < bytes.length; offset += CHUNK) {
        const result = await this.request('reference/put', { ...asset, total: bytes.length, offset, data: assetBase64(bytes.subarray(offset, offset + CHUNK)) });
        if (result.complete) break;
      }
    } else {
      const db = await this.database();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('assets', 'readwrite'), store = tx.objectStore('assets');
        const all = store.getAll();
        all.onsuccess = () => {
          const entries = all.result;
          if (!entries.some((item) => item.id === id) && (entries.length >= 128
            || entries.reduce((sum, item) => sum + item.blob.size, 0) + blob.size > 128 * 1024 * 1024)) { tx.abort(); return; }
          store.put({ ...asset, blob, createdAt: Date.now() });
        };
        tx.oncomplete = resolve;
        tx.onabort = () => reject(new Error('浏览器参考素材空间不足，最多 128 项 / 128 MB'));
        tx.onerror = () => {};
      });
    }
    this.remember(asset, blob);
    return asset;
  }
  async get(value) {
    const asset = normalizeAsset(value);
    if (!asset) throw new Error('参考素材引用无效，请重新上传');
    const key = this.cacheKey(asset);
    if (this.cache.has(key)) return this.remember(asset, this.cache.get(key));
    if (this.pending.has(key)) return this.pending.get(key);
    const pending = this.load(asset).then((blob) => this.remember(asset, blob));
    this.pending.set(key, pending);
    try { return await pending; }
    finally { this.pending.delete(key); }
  }
  async load(asset) {
    if (asset.location === 'browser') {
      const row = await this.browserRead(asset.id);
      if (!(row?.blob instanceof Blob)) throw new Error('此设备缺少参考素材，请在原设备使用或重新上传');
      return row.blob;
    }
    const chunks = [];
    let offset = 0, total;
    do {
      const result = await this.request('reference/get', { id: asset.id, offset });
      const bytes = assetBytes(result.data);
      total = result.row.size;
      if (!bytes.length || total > MAX_ASSET || offset + bytes.length > total) throw new Error('参考素材数据不完整');
      chunks.push(bytes); offset += bytes.length;
    } while (offset < total);
    const blob = new Blob(chunks, { type: asset.mime });
    const checksum = await sha256Hex(await blob.arrayBuffer());
    if (checksum !== asset.id) throw new Error('参考素材校验失败，请重新上传');
    return blob;
  }
}

export async function normalizeReferenceImage(file, { maxSide = 1536, width, height } = {}) {
  if (!file || file.size > 20 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请上传 20 MB 内的 PNG、JPG 或 WebP');
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 32 * 1024 * 1024) throw new Error('原图像素过大，请先缩小图片');
    const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = width || Math.max(64, Math.round(bitmap.width * ratio / 64) * 64);
    canvas.height = height || Math.max(64, Math.round(bitmap.height * ratio / 64) * 64);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob || blob.size > MAX_ASSET) {
      if (width || height) throw new Error('此尺寸的参考图超过 4 MB，请缩小尺寸');
      canvas.width = Math.round(canvas.width / 2 / 64) * 64 || 64;
      canvas.height = Math.round(canvas.height / 2 / 64) * 64 || 64;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    }
    if (!blob || blob.size > MAX_ASSET) throw new Error('参考图压缩后仍超过 4 MB，请缩小图片');
    return { blob, width: canvas.width, height: canvas.height, name: file.name || '参考图' };
  } finally { bitmap.close(); }
}
