import test from 'node:test';
import assert from 'node:assert/strict';
import { bindImageSlots, bindSmartSlot, chatIdentity } from './chat.js';
import { createChatAncestry, indexBranchImages } from './chat-branch.js';

const message = (mes) => ({ mes, send_date: '2026-11-22T00:00:00Z', name: 'Artist', swipe_id: 0 });
const context = (chatId, parent, chat = []) => ({
  chat, chatId, characterId: 0, characters: [{ avatar: 'artist.png' }], chatMetadata: { main_chat: parent },
});
const slots = (ctx, row = ctx.chat[0]) => bindImageSlots(ctx, row, 'image###', '###');
const drawing = (id, chatBinding, storageLocation = 'browser', version) => ({ id, chatBinding, storageLocation, version, blob: {} });

test('resolves existing nested branches by host metadata and stops at a cycle', async () => {
  const calls = [];
  const ancestry = createChatAncestry(async (path, { body, credentials }) => {
    const { avatar_url, file_name } = JSON.parse(body);
    assert.equal(path, '/api/chats/get');
    assert.equal(avatar_url, 'artist.png');
    assert.equal(credentials, 'same-origin');
    calls.push(file_name);
    return { ok: true, json: async () => [{ chat_metadata: { main_chat: file_name === 'branch' ? 'root' : 'child' } }] };
  });
  const ctx = { ...context('child', 'branch'), getRequestHeaders: () => ({}) };
  const expected = ['branch', 'root'].map((name) => chatIdentity(context(name)));
  assert.deepEqual(await ancestry(ctx), expected);
  assert.deepEqual(await ancestry(ctx), expected);
  assert.deepEqual(calls, ['branch', 'root']);
});

test('uses the current owner and retains the direct parent if host reads fail', async () => {
  let calls = 0;
  const ancestry = createChatAncestry(async (path, { body }) => {
    calls++;
    assert.equal(path, '/api/chats/group/get');
    assert.deepEqual(JSON.parse(body), { id: 'root' });
    return { ok: false };
  });
  const ctx = { ...context('branch', 'root'), groupId: 'group-1', groups: [{ id: 'group-1', chats: ['root', 'branch'] }],
    getRequestHeaders: () => ({}) };
  assert.deepEqual(await ancestry(ctx), [JSON.stringify(['group', 'group-1', 'root'])]);
  for (const name of ['branch', '../root', 'folder/root', '']) {
    assert.deepEqual(await ancestry({ ...ctx, chatMetadata: { main_chat: name } }), []);
  }
  assert.equal(calls, 1);
});

test('inherits only exact copied slots and skips changed text, swipe, date and other chats', async () => {
  const original = message('Start image###lake### next image###lake###');
  const root = context('root', null, [original]), parent = context('branch', 'root', [structuredClone(original)]);
  const child = context('child', 'branch', [structuredClone(original)]);
  const [old, oldSecond] = await slots(root), [near] = await slots(parent), [current, currentSecond] = await slots(child);
  const unrelated = (await slots(context('unrelated', null, [original])))[0];
  const ancestors = [chatIdentity(parent), chatIdentity(root)];
  const lookup = indexBranchImages({
    images: [drawing('unrelated', unrelated.binding), drawing('first', old.binding),
      drawing('closer', near.binding, 'server'), drawing('second', oldSecond.binding)],
    records: [{ binding: near.binding, storageLocation: 'server', status: 'running', savedIds: ['missing'], taskId: 'private' }],
  }, ancestors);
  const first = await lookup(child, child.chat[0], current, ['browser', 'server']);
  assert.notEqual(current.binding.id, first.binding.id);
  assert.equal(first.binding.id, near.binding.id);
  assert.equal(first.status, 'completed');
  assert.equal(first.taskId, undefined);
  assert.deepEqual(first.savedIds, ['closer']);
  assert.deepEqual((await lookup(child, child.chat[0], currentSecond, ['browser', 'server'])).savedIds, ['second']);
  for (const changes of [{ swipe_id: 1 }, { mes: `Edited ${original.mes}` }, { send_date: 'another date' }, { name: 'Other' }]) {
    const changed = context('child', 'branch', [{ ...original, ...changes }]);
    const [slot] = await slots(changed);
    assert.equal(await lookup(changed, changed.chat[0], slot, ['browser', 'server']), null);
  }
});

test('smart shots can be inherited individually without inheriting drafts or deleted images', async () => {
  const original = message('At the lake.');
  const root = context('root', null, [original]), branch = context('branch', 'root', [structuredClone(original)]);
  const primary = await bindSmartSlot(root, original), second = await bindSmartSlot(root, original, 1);
  const lookup = indexBranchImages({
    images: [drawing('v2', second.binding, 'browser', { groupId: 'v1', parentId: 'v1', number: 2 })],
    records: [{ binding: primary.binding, storageLocation: 'browser', status: 'drafted', savedIds: ['never-saved'] }],
  }, [chatIdentity(root)]);
  assert.equal(await lookup(branch, branch.chat[0], await bindSmartSlot(branch, branch.chat[0]), ['browser']), null);
  const inherited = await lookup(branch, branch.chat[0], await bindSmartSlot(branch, branch.chat[0], 1), ['browser']);
  assert.deepEqual(inherited.savedIds, ['v1']);
  assert.equal(inherited.binding.kind, 'smart');
});
