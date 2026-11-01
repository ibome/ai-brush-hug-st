import test from 'node:test';
import assert from 'node:assert/strict';
import { bindImageSlots, bindingIsCurrent, chatIdentity, parseImageTags, validBinding, CHAT_DEFAULTS } from './chat.js';

const message = (mes, values = {}) => ({ mes, name: 'Artist', send_date: '2026-10-13T12:00:00Z', swipe_id: 0, ...values });
const context = (chat) => ({
  chat, chatId: 'session', characterId: 0, characters: [{ avatar: 'artist.png' }],
});
const settings = { enabled: true, triggerPrefix: 'image###', triggerSuffix: '###' };

test('fresh installs default to automatic inline images without confirmation; saved choices win', () => {
  assert.deepEqual(CHAT_DEFAULTS, { auto: true, confirm: false, inline: true });
  assert.deepEqual({ ...CHAT_DEFAULTS, auto: false, confirm: true, inline: false },
    { auto: false, confirm: true, inline: false });
});

test('extracts multiple multiline tags in order, including identical prompts', () => {
  const result = parseImageTags('story image###  girl,\nblue hair ### and image###girl,\nblue hair###');
  assert.equal(result.length, 2);
  assert.equal(result[0].prompt, 'girl,\nblue hair');
  assert.equal(result[1].index, 1);
  assert.equal(result[0].prompt, result[1].prompt);
});

test('ignores empty, incomplete and quoted code examples', () => {
  const text = '```txt\nimage###example###\n``` `image###inline###` image###### image###valid### image###unfinished';
  assert.deepEqual(parseImageTags(text).map((slot) => slot.prompt), ['valid']);
  assert.equal(parseImageTags('~~~\nimage###example###').length, 0);
});

test('treats custom wrappers literally and bounds tag counts and text sizes', () => {
  assert.equal(parseImageTags('[img]((real.*))[/img]', '[img]((', '))[/img]')[0].prompt, 'real.*');
  assert.equal(parseImageTags('image###a###'.repeat(40)).length, 16);
  assert.equal(parseImageTags(`image###${'a'.repeat(32001)}###`).length, 0);
  assert.equal(parseImageTags('a'.repeat(1000001)).length, 0);
  assert.equal(parseImageTags('anything', '', '###').length, 0);
});

test('identifies chats by owner as well as filename', () => {
  const a = context([]);
  const b = { ...a, characters: [{ avatar: 'other.png' }] };
  assert.notEqual(chatIdentity(a), chatIdentity(b));
  assert.notEqual(chatIdentity(a), chatIdentity({ ...a, groupId: 'group1' }));
  assert.equal(chatIdentity({ ...a, chatId: null }), '');
});

test('never binds user or system messages', async () => {
  for (const value of [{ is_user: true }, { is_system: true }]) {
    const row = message('image###cat###', value);
    assert.deepEqual(await bindImageSlots(context([row]), row), []);
  }
});

test('binding is stable after deleting/reordering preceding messages', async () => {
  const row = message('image###cat### image###cat###');
  const before = await bindImageSlots(context([message('hello'), row]), row);
  const after = await bindImageSlots(context([row]), row);
  assert.equal(before[0].binding.id, after[0].binding.id);
  assert.notEqual(before[0].binding.id, before[1].binding.id);
  assert.equal(validBinding(before[0].binding), true);
});

test('swipe and edited message text have independent bindings', async () => {
  const row = message('image###cat###');
  const a = await bindImageSlots(context([row]), row);
  row.swipe_id = 1;
  const b = await bindImageSlots(context([row]), row);
  row.mes = 'changed image###cat###';
  const c = await bindImageSlots(context([row]), row);
  assert.notEqual(a[0].binding.id, b[0].binding.id);
  assert.notEqual(b[0].binding.id, c[0].binding.id);
});

test('rejects completion or submission against switched, edited or deleted messages', async () => {
  const row = message('image###cat###');
  const ctx = context([row]);
  const [slot] = await bindImageSlots(ctx, row);
  const entry = { ...slot, message: row, text: row.mes };
  assert.equal(bindingIsCurrent(entry, ctx, settings), true);
  assert.equal(bindingIsCurrent(entry, { ...ctx, chatId: 'other' }, settings), false);
  assert.equal(bindingIsCurrent(entry, context([]), settings), false);
  assert.equal(bindingIsCurrent(entry, ctx, { ...settings, enabled: false }), false);
  row.mes = 'image###dog###';
  assert.equal(bindingIsCurrent(entry, ctx, settings), false);
});

test('rejects changed wrappers and branch, and invalid bindings', async () => {
  const row = message('image###cat###');
  const ctx = context([row]);
  const [slot] = await bindImageSlots(ctx, row);
  const entry = { ...slot, message: row, text: row.mes };
  assert.equal(bindingIsCurrent(entry, ctx, { ...settings, triggerPrefix: 'draw###' }), false);
  row.swipe_id = 1;
  assert.equal(bindingIsCurrent(entry, ctx, settings), false);
  assert.equal(Boolean(validBinding({ ...slot.binding, id: '../bad' })), false);
});
