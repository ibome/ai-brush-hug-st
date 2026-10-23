import test from 'node:test';
import assert from 'node:assert/strict';
import { bindImageSlots, bindSmartSlot, chatIdentity } from './chat.js';
import { buildReadingSnapshot, createChatReader, normalizeReaderSettings, readerRange, readerParts } from './chat-reader.js';

const message = (mes, date = 'one', extra = {}) => ({ mes, name: '角色', send_date: date, swipe_id: 0, ...extra });
const context = (chat) => ({ chat, chatId: 'main', characterId: 0, characters: [{ avatar: 'one.png' }], name2: '故事' });
const data = () => ({ images: [], records: [], warnings: [] });
const options = { triggerPrefix: 'image###', triggerSuffix: '###' };
const images = (snapshot) => snapshot.messages.flatMap((row) => row.parts.flatMap((part) => part.images || []));
const text = (snapshot) => snapshot.messages.flatMap((row) => row.parts.filter((part) => part.type === 'text').map((part) => part.text)).join('');
const row = (id, binding, extra = {}) => ({ id, chatBinding: binding, storageLocation: 'browser', title: id,
  width: 64, height: 64, blob: new Blob(['image']), versionCurrent: true, ...extra });
async function fixture() {
  const c = context([message('开始image###one###中间image###two###结束')]);
  const slots = await bindImageSlots(c, c.chat[0], options.triggerPrefix, options.triggerSuffix);
  const d = data();
  d.images = slots.map((slot, index) => row(`pic-${index}`, slot.binding));
  return { c, d, slots };
}
test('reading preferences and floor range are bounded without silent truncation', () => {
  assert.deepEqual(normalizeReaderSettings(null), { fontSize: 18, lineHeight: 1.9, imageWidth: 85, showUser: true });
  assert.deepEqual(normalizeReaderSettings({ fontSize: 100, lineHeight: -1, imageWidth: 'bad', showUser: false }),
    { fontSize: 28, lineHeight: 1.4, imageWidth: 85, showUser: false });
  assert.deepEqual(readerRange(8, { start: 2, end: 4 }), { start: 2, end: 4 });
  for (const range of [{ start: 0 }, { start: 2, end: 1 }, { end: 9 }, { start: 1.5 }]) assert.throws(() => readerRange(8, range), /范围/);
  assert.throws(() => readerRange(3001), /最多/);
  assert.throws(() => readerRange(0), /打开/);
});
test('image tags become ordered image parts, raw code examples remain literal', async () => {
  const { c, d } = await fixture();
  c.chat.push(message('`image###example###`', 'two'));
  const s = await buildReadingSnapshot(c, options, d);
  assert.deepEqual(s.messages[0].parts.map((part) => part.type), ['text', 'images', 'text', 'images', 'text']);
  assert.deepEqual(images(s).map((pic) => pic.id), ['pic-0', 'pic-1']);
  assert.equal(text(s), '开始中间结束`image###example###`');
  assert.equal(s.chatKey, chatIdentity(c));
});
test('only current branch, swipe, owner and exact message identity match', async () => {
  const { c, d, slots } = await fixture();
  const sameText = message(c.chat[0].mes, 'different-date');
  c.chat.push(sameText);
  d.images.push(row('wrong-id', { ...slots[0].binding, id: 'f'.repeat(64) }));
  d.images.push(row('wrong-chat', { ...slots[0].binding, chatKey: 'other' }));
  let s = await buildReadingSnapshot(c, options, d);
  assert.equal(images(s).filter((pic) => !pic.missing).length, 2);
  assert.equal(images(s).filter((pic) => pic.missing).length, 2);
  c.chat[0].swipe_id = 1;
  s = await buildReadingSnapshot(c, options, d);
  assert.ok(images(s).every((pic) => pic.missing));
});
test('only the selected version is included and deleted selection falls back to surviving version', async () => {
  const { c, d, slots } = await fixture();
  d.images[0].versionCurrent = false;
  d.images.push(row('v2', slots[0].binding, { version: { groupId: 'pic-0', parentId: 'pic-0', number: 2 } }));
  d.records = [{ binding: slots[0].binding, savedIds: ['pic-0', 'v2'], storageLocation: 'browser' }];
  assert.deepEqual(images(await buildReadingSnapshot(c, options, d)).map((pic) => pic.id), ['v2', 'pic-1']);
  d.images = d.images.filter((pic) => pic.id !== 'v2');
  d.records[0].savedIds = ['pic-0'];
  assert.equal(images(await buildReadingSnapshot(c, options, d))[0].id, 'pic-0');
});
test('browser and server pictures remain distinct, missing images carry their source floor', async () => {
  const { c, d, slots } = await fixture();
  d.images.push(row('pic-0', slots[0].binding, { storageLocation: 'server' }));
  d.records.push({ binding: slots[1].binding, storageLocation: 'server', savedIds: ['deleted'] });
  const pics = images(await buildReadingSnapshot(c, options, d));
  assert.deepEqual(pics.slice(0, 2).map((pic) => pic.key), ['browser:pic-0', 'server:pic-0']);
  assert.equal(pics.find((pic) => pic.id === 'deleted').index, 0);
});
test('smart pictures use unique whitespace-normalized anchor or message end', async () => {
  const c = context([message('她坐在\n窗边。然后翻开书。')]), d = data();
  const slot = await bindSmartSlot(c, c.chat[0]);
  d.images = [row('smart', slot.binding)];
  d.records = [{ binding: slot.binding, storageLocation: 'browser', savedIds: ['smart'], assistant: { anchor: '她坐在 窗边。' } }];
  let s = await buildReadingSnapshot(c, options, d);
  assert.equal(s.messages[0].parts[0].text, '她坐在\n窗边。');
  d.records[0].assistant.anchor = '不在原文';
  s = await buildReadingSnapshot(c, options, d);
  assert.equal(s.messages[0].parts[0].text, c.chat[0].mes);
  c.chat[0].mes = '重复。重复。';
  const repeated = await bindSmartSlot(c, c.chat[0]); d.images = [row('repeat', repeated.binding)];
  d.records = [{ binding: repeated.binding, assistant: { anchor: '重复。' } }];
  s = await buildReadingSnapshot(c, options, d);
  assert.equal(s.messages[0].parts[0].text, '重复。重复。');
});
test('system messages are omitted, user messages preserved, metadata is bounded', async () => {
  const { c, d } = await fixture();
  c.chat.unshift(message('系统', 'system', { is_system: true }), message('用户', 'user', { is_user: true }));
  d.images[0].width = '" onerror="evil'; d.images[0].height = Infinity;
  const s = await buildReadingSnapshot(c, options, d);
  assert.equal(s.messages.length, 2);
  assert.equal(s.messages[0].role, 'user');
  assert.equal(images(s)[0].width, 1);
  assert.equal(images(s)[0].height, 1);
  const limited = await buildReadingSnapshot(c, options, d, { start: 2, end: 2 });
  assert.equal(limited.messages.length, 1);
  assert.equal(images(limited).length, 0);
  assert.deepEqual(readerParts('abc', [{ start: 1, end: 2, slot: 0, images: [] }, { start: 1, end: 3, slot: 1, images: [] }]),
    [{ type: 'text', text: 'a' }, { type: 'images', images: [] }, { type: 'text', text: 'c' }]);
});
test('oversized text fails explicitly and pre-aborted reads stop', async () => {
  await assert.rejects(buildReadingSnapshot(context([message('x'.repeat(4000001))]), options, data()), /400 万/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(buildReadingSnapshot(context([message('x')]), options, data(), undefined, controller.signal), { name: 'AbortError' });
});
test('host validates source and selected image versions and releases thumbnail URLs', async () => {
  const { c, d } = await fixture(), revoked = [];
  const original = URL.revokeObjectURL; URL.revokeObjectURL = (url) => revoked.push(url);
  try {
    const reader = createChatReader({ getContext: () => c, settings: () => options, load: async () => d,
      image: async (id) => d.images.find((pic) => pic.id === id), preview: (pic) => `blob:${pic.id}` });
    const s = await reader.receive('reader-read', {});
    const expected = { chatKey: s.chatKey, revision: s.revision };
    assert.equal(s.messages[0].parts[1].images[0].preview, 'blob:pic-0');
    assert.equal((await reader.receive('reader-image', { ...expected, key: 'browser:pic-0' })).blob.size, 5);
    assert.equal((await reader.receive('reader-validate', expected)).valid, true);
    d.images[0].title = 'changed';
    await assert.rejects(reader.receive('reader-validate', expected), /版本已变化/);
    c.chat[0].swipe_id = 2;
    await assert.rejects(reader.receive('reader-image', { ...expected, key: 'browser:pic-0' }), /来源已变化/);
    reader.reset();
    assert.deepEqual(revoked, ['blob:pic-0', 'blob:pic-1']);
    await assert.rejects(reader.receive('reader-validate', expected), /阅读版本已变化/);
    reader.destroy();
    await assert.rejects(reader.receive('reader-read', {}), /关闭/);
  } finally { URL.revokeObjectURL = original; }
});
test('source changes or chat reset during storage and hashing prevent a stale read', async () => {
  const { c, d } = await fixture(); let reader;
  reader = createChatReader({ getContext: () => c, settings: () => options, preview: () => '',
    load: async () => { c.chat[0].mes += 'edit'; return d; } });
  await assert.rejects(reader.receive('reader-read', {}), /聊天已变化/);
  reader = createChatReader({ getContext: () => c, preview: () => '', load: async () => d,
    settings: () => { c.chat[0].mes += 'during-build'; return options; } });
  await assert.rejects(reader.receive('reader-read', {}), /聊天已变化/);
  reader = createChatReader({ getContext: () => c, settings: () => options, preview: () => '',
    load: async () => { reader.reset(); return d; } });
  await assert.rejects(reader.receive('reader-read', {}), /聊天已变化/);
});
test('source mutation while loading an original is rejected even when same object is edited', async () => {
  const { c, d } = await fixture();
  const reader = createChatReader({ getContext: () => c, settings: () => options, preview: () => '', load: async () => d,
    image: async (id) => { c.chat[0].mes += 'edit'; return d.images.find((pic) => pic.id === id); } });
  const s = await reader.receive('reader-read', {});
  await assert.rejects(reader.receive('reader-image', { chatKey: s.chatKey, revision: s.revision, key: 'browser:pic-0' }), /聊天已变化/);
});
test('active Tavern generation and invalid ranges fail before loading storage', async () => {
  let called = 0;
  const reader = createChatReader({ getContext: () => context([message('x')]), settings: () => options, isBusy: () => true,
    load: async () => { called++; return data(); } });
  await assert.rejects(reader.receive('reader-read', {}), /正在输出/);
  assert.equal(called, 0);
});
