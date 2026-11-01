import { sha256 } from '@noble/hashes/sha2.js';

export function randomUUID(source = globalThis.crypto) {
  if (typeof source?.randomUUID === 'function') return source.randomUUID();
  if (typeof source?.getRandomValues !== 'function') throw new Error('浏览器不支持安全随机数，请更新浏览器后重试');
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function sha256Hex(value, source = globalThis.crypto) {
  const bytes = ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array(value);
  let digest;
  if (typeof source?.subtle?.digest === 'function') digest = new Uint8Array(await source.subtle.digest('SHA-256', bytes));
  else {
    const state = sha256.create();
    // Yield between large blocks so HTTP deployments can hash images without freezing the UI.
    for (let offset = 0; offset < bytes.length; offset += 1024 * 1024) {
      if (offset) await new Promise((resolve) => setTimeout(resolve, 0));
      state.update(bytes.subarray(offset, offset + 1024 * 1024));
    }
    digest = state.digest();
  }
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function requireBackupCrypto() {
  if (!globalThis.crypto?.subtle) throw new Error('加密备份需要 HTTPS 或本机 localhost 安全环境；普通备份与生图仍可使用');
  return globalThis.crypto.subtle;
}
