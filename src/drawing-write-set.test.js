import test from 'node:test';
import assert from 'node:assert/strict';
import { insertVersion, selectVersion, removeVersions } from '../server/linghuashi-storage/image-versions.mjs';
import { changedVersionRows } from './drawing-write-set.js';

const image = (id) => ({ id, createdAt: 1, blob: new Blob(['image']), versionCurrent: true });
test('adding an independent drawing never rewrites hundreds of existing image blobs', () => {
  const rows = Array.from({ length: 499 }, (_, index) => image(`image-${index}`));
  const next = insertVersion(rows, image('new-image'));
  assert.deepEqual(changedVersionRows(rows, next).map((row) => row.id), ['new-image']);
});
test('version changes write only new rows and the previous current version', () => {
  const rows = [image('unrelated'), image('parent'), { ...image('older'), versionCurrent: false, version: { groupId: 'parent', number: 1 } }];
  const next = insertVersion(rows, { ...image('new'), version: { groupId: 'parent', parentId: 'parent', number: 2 } });
  assert.deepEqual(changedVersionRows(rows, next).map((row) => row.id), ['parent', 'new']);
  assert.deepEqual(changedVersionRows(next, selectVersion(next, 'parent')).map((row) => row.id), ['parent', 'new']);
  assert.deepEqual(changedVersionRows(next, removeVersions(next, ['new'])).map((row) => row.id), ['parent']);
});
test('an automatic cleanup with no removed images writes nothing', () => {
  const rows = [image('one'), image('two')];
  assert.deepEqual(changedVersionRows(rows, removeVersions(rows, [])), []);
});
