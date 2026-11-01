import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { currentDrawing, drawingGroups, insertVersion, selectVersion, removeVersions, groupVersions, editRelation } from './image-versions.mjs';
import { createStorageService } from './index.mjs';
import { frozenPlan } from './task-ledger.mjs';
import { cleanupPlan } from '../../src/retention.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
const binding = { id: 'a'.repeat(64), branch: 'b'.repeat(64), chatKey: '["character","fixture.png","version-chat"]', swipe: 0, slot: 0 };
const row = (id, extra = {}) => ({ id, title: id, createdAt: Date.now(), width: 1, height: 1,
  snapshot: { provider: 'novelai', params: { positive: id, seed: 19 } }, ...extra });
const add = (value) => ({ row: value, image: png, thumbnail: png });

test('legacy images remain independent and preserve their chat slots', () => {
  const rows = [row('one'), row('two')];
  assert.equal(drawingGroups(rows).length, 2);
  assert.equal(currentDrawing(rows, 'one').id, 'one');
  assert.equal(currentDrawing(rows, 'missing'), null);
});

test('branching retains every result and assigns monotonic numbers on concurrent collisions', () => {
  const first = row('one');
  let rows = insertVersion([], first);
  rows = insertVersion(rows, row('two', { version: editRelation(first) }));
  rows = insertVersion(rows, row('three', { version: editRelation(first) }));
  assert.deepEqual(groupVersions(rows, 'one').map((item) => item.version.number), [1, 2, 3]);
  assert.equal(currentDrawing(rows, 'one').id, 'three');
  assert.equal(rows[2].version.parentId, 'one');
  assert.equal(first.version, undefined);
});

test('selecting an old version changes current flags without mutating images or prompts', () => {
  let rows = insertVersion([], row('one'));
  rows = insertVersion(rows, row('two', { version: editRelation(rows[0]) }));
  const selected = selectVersion(rows, 'one');
  assert.equal(currentDrawing(selected, 'two').id, 'one');
  assert.equal(currentDrawing(rows, 'one').id, 'two');
  assert.equal(selected[1].snapshot, rows[1].snapshot);
  assert.throws(() => selectVersion(rows, 'missing'));
});

test('deleting current or original preserves the remaining group and does not mutate caller flags', () => {
  let rows = insertVersion([], row('one'));
  rows = insertVersion(rows, row('two', { version: editRelation(rows[0]) }));
  const withoutRoot = removeVersions(rows, ['one']);
  assert.equal(currentDrawing(withoutRoot, 'one').id, 'two');
  const withoutCurrent = removeVersions(rows, ['two']);
  assert.equal(currentDrawing(withoutCurrent, 'one').id, 'one');
  assert.equal(rows[0].versionCurrent, false);
  assert.equal(currentDrawing(removeVersions(rows, ['one', 'two']), 'one'), null);
});

test('out-of-order archive restores original version numbers and selected old version', () => {
  const rows = [row('three', { version: { groupId: 'one', parentId: 'one', number: 3 }, versionCurrent: false }),
    row('two', { version: { groupId: 'one', parentId: 'one', number: 2 }, versionCurrent: false }),
    row('one', { versionCurrent: true })].reduce(insertVersion, []);
  assert.deepEqual(groupVersions(rows, 'one').map((item) => item.version.number), [1, 2, 3]);
  assert.equal(currentDrawing(rows, 'one').id, 'one');
});

test('cache cleanup protects entire favorite and chat-bound version groups', () => {
  const rows = [row('one'), row('two', { favorite: true, version: editRelation(row('one')) }),
    row('chat', { chatBinding: binding }), row('chat-two', { version: editRelation(row('chat')) }), row('loose')];
  const plan = cleanupPlan(rows, { cacheLocation: 'browser', cleanupMode: 'time',
    cleanupUnit: 'hours', cleanupInterval: 1 }, 0);
  assert.deepEqual(plan.ids, ['loose']);
});

test('durable redraw plans preserve parent, group, note and binding without a root chat request', () => {
  const plan = frozenPlan({ provider: 'novelai', snapshot: row('one').snapshot, body: {},
    url: 'https://example.test/ai/generate-image', storageLocation: 'server', chatBinding: binding,
    imageEdit: editRelation(row('one'), '换成白裙') });
  assert.equal(plan.imageEdit.note, '换成白裙');
  assert.equal(plan.imageEdit.parentId, 'one');
  assert.equal(plan.chatRequestId, '');
  assert.deepEqual(plan.chatBinding, binding);
  assert.throws(() => frozenPlan({ ...plan, imageEdit: { groupId: '../bad', parentId: '../bad' } }));
});

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linghuashi-versions-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const user = (handle = 'a') => ({ profile: { handle }, directories: { root: path.join(root, handle), userImages: path.join(root, handle, 'user/images') } });
  await fs.mkdir(user().directories.root, { recursive: true });
  return { user, service: createStorageService() };
}

test('server redraw only updates one of two chat pictures and survives restart and deleted root', async (t) => {
  const { user, service } = await fixture(t);
  await service.dispatch(user(), 'add', add(row('one', { chatBinding: binding })));
  await service.dispatch(user(), 'add', add(row('sibling', { chatBinding: binding })));
  await service.dispatch(user(), 'add', add(row('two', { version: editRelation(row('one')) })));
  const originalChat = await service.dispatch(user(), 'chat/get', { id: binding.id });
  assert.deepEqual(originalChat.savedIds, ['one', 'sibling']);
  const fresh = createStorageService();
  assert.equal((await fresh.dispatch(user(), 'image/get', { id: 'one', current: true })).id, 'two');
  assert.equal((await fresh.dispatch(user(), 'image/get', { id: 'sibling', current: true })).id, 'sibling');
  assert.deepEqual((await fresh.dispatch(user(), 'image/get', { id: 'two' })).chatBinding, { ...binding, characterName: '', chatName: '' });
  await fresh.dispatch(user(), 'version/select', { id: 'one' });
  assert.equal((await fresh.dispatch(user(), 'image/get', { id: 'one', current: true })).id, 'one');
  await fresh.dispatch(user(), 'remove', { ids: ['one'], allowReferenced: true });
  assert.equal((await fresh.dispatch(user(), 'image/get', { id: 'one', current: true })).id, 'two');
  assert.deepEqual((await fresh.dispatch(user(), 'chat/get', { id: binding.id })).savedIds, ['one', 'sibling']);
});

test('repeated version save is idempotent and does not override manually selected version', async (t) => {
  const { user, service } = await fixture(t);
  await service.dispatch(user(), 'add', add(row('one')));
  const child = row('two', { version: editRelation(row('one')) });
  await service.dispatch(user(), 'add', add(child));
  await service.dispatch(user(), 'version/select', { id: 'one' });
  assert.equal((await service.dispatch(user(), 'add', add(child))).existing, true);
  assert.equal((await service.dispatch(user(), 'image/get', { id: 'one', current: true })).id, 'one');
  assert.equal((await service.dispatch(user(), 'list')).rows.length, 2);
});

test('concurrent selection leaves one current version and other accounts cannot select it', async (t) => {
  const { user, service } = await fixture(t);
  await service.dispatch(user(), 'add', add(row('one')));
  await service.dispatch(user(), 'add', add(row('two', { version: editRelation(row('one')) })));
  await Promise.all(['one', 'two'].map((id) => service.dispatch(user(), 'version/select', { id })));
  assert.equal((await service.dispatch(user(), 'list')).rows.filter((item) => item.versionCurrent).length, 1);
  await fs.mkdir(user('b').directories.root);
  await assert.rejects(service.dispatch(user('b'), 'version/select', { id: 'two' }));
  assert.equal(await service.dispatch(user('b'), 'image/get', { id: 'one', current: true }), null);
});

test('server automatic cleanup keeps all versions of favorite groups and selects remaining current', async (t) => {
  const { user, service } = await fixture(t);
  await service.dispatch(user(), 'add', add(row('one', { createdAt: Date.now() - 86400000 * 20 })));
  await service.dispatch(user(), 'add', add(row('two', { favorite: true, version: editRelation(row('one')) })));
  await service.dispatch(user(), 'policy', { active: true, cleanupMode: 'count', cleanupMaxImages: 1, cleanupOlderThanDays: 1 });
  assert.deepEqual((await service.dispatch(user(), 'cleanup')).ids, []);
  assert.equal((await service.dispatch(user(), 'list')).rows.length, 2);
});
