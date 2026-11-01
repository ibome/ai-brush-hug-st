import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { randomUUID, sha256Hex, requireBackupCrypto } from './crypto-compat.js';

test('HTTP environments get UUID v4 from secure random bytes without native randomUUID', () => {
  const source = { getRandomValues: (bytes) => webcrypto.getRandomValues(bytes) };
  const values = new Set(Array.from({ length: 1000 }, () => randomUUID(source)));
  assert.equal(values.size, 1000);
  for (const value of values) assert.match(value, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(randomUUID({ randomUUID() { assert.equal(this.marker, 1); return 'native'; }, marker: 1 }), 'native');
  assert.throws(() => randomUUID({}), /安全随机数/);
});

test('HTTP SHA256 matches native hashing for empty, offset, unicode and multiblock data', async () => {
  const offset = new Uint8Array([9, 97, 98, 99, 9]).subarray(1, 4);
  for (const value of [new Uint8Array(), offset, new TextEncoder().encode('灵画师'), new Uint8Array(2300000).fill(97)]) {
    const expected = createHash('sha256').update(value).digest('hex');
    assert.equal(await sha256Hex(value, {}), expected);
    assert.equal(await sha256Hex(value, webcrypto), expected);
  }
  assert.equal(await sha256Hex(offset.buffer, {}), createHash('sha256').update(new Uint8Array(offset.buffer)).digest('hex'));
});

test('large fallback hashing yields to pending UI work', async () => {
  let yielded = false;
  setTimeout(() => { yielded = true; }, 0);
  await sha256Hex(new Uint8Array(2200000), {});
  assert.equal(yielded, true);
});

test('encrypted backup capability is checked explicitly without weakening encryption', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) } });
  try { assert.throws(() => requireBackupCrypto(), /加密备份需要 HTTPS/); }
  finally { Object.defineProperty(globalThis, 'crypto', descriptor); }
});
