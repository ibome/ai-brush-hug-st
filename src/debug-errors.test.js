import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyGenerationFailure, rememberGenerationFailure, recentGenerationFailures, storageFailureInfo, restoreStorageFailure } from './debug-errors.js';
const job = (phase, location = 'browser') => ({ plan: { storageLocation: location, provider: 'novelai' }, failurePhase: phase });
test('quota, server upload rejection and image processing failures have distinct causes', () => {
  const quota = classifyGenerationFailure(new DOMException('private', 'QuotaExceededError'), job('response-cache', 'server'));
  assert.equal(quota.code, 'BROWSER_QUOTA'); assert.match(quota.message, /浏览器/);
  const upload = classifyGenerationFailure(Object.assign(new Error('private'), { status: 413, scope: 'tavern-storage' }), job('saving', 'server'));
  assert.equal(upload.code, 'SERVER_UPLOAD_LIMIT'); assert.doesNotMatch(upload.message, /空间不足/);
  assert.equal(classifyGenerationFailure(new DOMException('private', 'EncodingError'), job('image-processing')).code, 'IMAGE_PROCESSING');
  assert.equal(classifyGenerationFailure(new Error('private'), job('saving')).code, 'UNCLASSIFIED_FAILURE');
  assert.equal(classifyGenerationFailure(Object.assign(new TypeError('private'), { scope: 'tavern-storage' }), job('saving', 'server')).code, 'STORAGE_NETWORK');
  assert.doesNotMatch(quota.message, /已保留响应/);
  assert.match(classifyGenerationFailure(new DOMException('', 'QuotaExceededError'), { ...job('saving'), execution: {} }).message, /已保留响应/);
});
test('unknown error details cannot leak keys, server bodies or prompts into debug reports', () => {
  const result = classifyGenerationFailure(new Error('sk-' + 'secret'.repeat(10) + ' prompt: private'), job('saving'));
  assert.doesNotMatch(JSON.stringify(result), /secret|private|prompt:/);
  assert.doesNotMatch(result.message, /空间不足/);
});
test('the storage message bridge retains only allowed error metadata, including quota and server limits', () => {
  for (const source of [
    Object.assign(new Error('private'), { status: 413, scope: 'tavern-storage', headers: { authorization: 'private' } }),
    new DOMException('private', 'QuotaExceededError'),
    Object.assign(new TypeError('private'), { scope: 'tavern-storage' }),
  ]) {
    const details = JSON.parse(JSON.stringify(storageFailureInfo(source)));
    assert.doesNotMatch(JSON.stringify(details), /private|headers|authorization/);
    const restored = restoreStorageFailure(source.message, details);
    assert.equal(restored.name, source.name);
    assert.equal(classifyGenerationFailure(restored, job('saving')).code, classifyGenerationFailure(source, job('saving')).code);
  }
  const restored = restoreStorageFailure('legacy error', { name: 'private', status: -1, scope: 'private', code: 'private' });
  assert.equal(restored.name, 'Error'); assert.equal(restored.status, 0); assert.equal(restored.scope, undefined);
});
test('retained response and actual saved status remain visible in a bounded memory-only log', () => {
  for (let index = 0; index < 25; index++) rememberGenerationFailure(new Error('private'), { ...job('saving'), execution: { bytes: new Uint8Array(1) } });
  const rows = recentGenerationFailures();
  assert.equal(rows.length, 20); assert.equal(rows[0].responseRetained, true);
  assert.doesNotMatch(JSON.stringify(rows), /private|bytes|keyRef|Authorization/);
  rows[0].code = 'changed';
  assert.notEqual(recentGenerationFailures()[0].code, 'changed');
});
