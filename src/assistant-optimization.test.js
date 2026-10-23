import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoalescedSave } from './coalesced-save.js';
import { selectAssistantMessages, validateContextSelection, estimateTokens, assistantUsage } from './assistant-context.js';
import { collectAssistantContext } from './assistant-host.js';
import { normalizeAssistant, parseAssistantResult } from './prompt-assistant.js';
import { replaceSelectedScene, sceneReanalysisMessages } from './assistant-scene.js';
import { illustrationPlans } from './assistant-workflow.js';

const fixture = () => ({ chatId: 'fixture', characterId: 0, name2: 'Alice', characters: [{ avatar: 'a.png' }],
  chat: [{ name: 'User', is_user: true, mes: 'Start', send_date: 'a' },
    { name: 'Alice', mes: 'First scene.', send_date: 'b' },
    { name: 'User', is_user: true, mes: 'Next', send_date: 'c' },
    { name: 'Alice', mes: 'Second scene.', send_date: 'd' }] });
const shot = (positive, anchor = 'Original sentence.') => ({
  shouldDraw: true, reason: 'Old reason', scene: positive, positive, negative: 'bad hands', aspect: 'portrait', anchor,
});

test('rapid changes coalesce and a request flush saves the latest state exactly once', () => {
  const scheduled = new Map(), written = []; let counter = 0, value = '';
  const queue = createCoalescedSave(() => written.push(value), {
    schedule: (fn) => { scheduled.set(++counter, fn); return counter; }, cancel: (id) => scheduled.delete(id),
  });
  for (const char of 'long mobile edit') { value += char; queue.schedule(); }
  assert.equal(scheduled.size, 1); assert.equal(written.length, 0);
  queue.flush(); assert.deepEqual(written, ['long mobile edit']); assert.equal(scheduled.size, 0);
  queue.flush(); assert.equal(written.length, 1);
});
test('scheduled save failures remain observable and can be retried', () => {
  let task, failed = true, writes = 0; const errors = [];
  const queue = createCoalescedSave(() => { if (failed) throw new Error('full'); writes++; },
    { schedule: (fn) => { task = fn; return 1; }, cancel() {}, onError: (error) => errors.push(error.message) });
  queue.schedule(); task(); assert.deepEqual(errors, ['full']);
  failed = false; queue.schedule(); queue.flush(); assert.equal(writes, 1);
});
test('manual context selection preserves chronology, supports empty selection and refuses future messages', async () => {
  const context = fixture(), settings = normalizeAssistant({ contextMessages: 2 });
  const auto = await selectAssistantMessages(context, 3, settings);
  assert.deepEqual(auto.messages.map((row) => row.content), ['Next', 'Second scene.']);
  const selected = { chatKey: auto.contextSelection.chatKey, messages: auto.contextPreview.catalogue
    .filter((row) => [0, 2].includes(row.index)).map(({ index, revision }) => ({ index, revision })) };
  const manual = await selectAssistantMessages(context, 3, settings, selected);
  assert.deepEqual(manual.messages.map((row) => row.content), ['Start', 'Next']);
  assert.equal((await selectAssistantMessages(context, 3, settings, { ...selected, messages: [] })).messages.length, 0);
  await assert.rejects(selectAssistantMessages(context, 1, settings, selected), /范围/);
});
test('message revision detects edits, swipes, index shifts and cross-chat reuse', async () => {
  for (const mutate of [
    (context) => { context.chat[3].mes += 'Changed'; },
    (context) => { context.chat[3].swipe_id = 1; },
    (context) => { context.chat.unshift({ mes: 'Inserted' }); },
    (context) => { context.chatId = 'other'; },
  ]) {
    const context = fixture(), original = await selectAssistantMessages(context, 3, normalizeAssistant());
    mutate(context); await assert.rejects(validateContextSelection(context, original.contextSelection), /变化|失效/);
  }
});
test('truncation reports both partial and wholly omitted messages, keeping newest text', async () => {
  const context = fixture(); context.chat[3].mes = 'tail'.repeat(1000);
  const result = await selectAssistantMessages(context, 3, normalizeAssistant({ contextCharacters: 2000 }));
  assert.equal(result.messages.length, 1); assert.equal(result.messages[0].content.length, 2000);
  assert.equal(result.contextPreview.truncatedMessages, 4);
  assert.equal(result.contextPreview.catalogue.at(-1).includedCharacters, 2000);
});
test('context validation catches edits made while world book scan is running', async () => {
  const context = fixture();
  context.getWorldInfoPrompt = async () => { context.chat[0].mes = 'Edited'; return { worldInfoString: '' }; };
  await assert.rejects(collectAssistantContext(context, {}), /变化/);
});
test('usage estimate includes all prepared preset messages and exposes output limit without changing the request', () => {
  const messages = [{ role: 'system', content: 'a'.repeat(10000) }, { role: 'user', content: '中文场景' }];
  const before = JSON.stringify(messages), usage = assistantUsage(messages, {}, 4000);
  assert.ok(usage.input > 2500); assert.equal(usage.totalLimit, usage.input + 4000);
  assert.equal(JSON.stringify(messages), before); assert.equal(estimateTokens('12345678'), 2);
});
test('selected scene replacement preserves every other scene and frozen character profile', () => {
  const source = { ...shot('first'), illustrations: [shot('first'), shot('second'), shot('third')] };
  const before = JSON.stringify(source), result = replaceSelectedScene(source, 1, shot('revised'), ['anchor', 'negative', 'aspect']);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(result.illustrations[0], source.illustrations[0]);
  assert.deepEqual(result.illustrations[2], source.illustrations[2]);
  assert.equal(result.illustrations[1].positive, 'revised');
  for (const field of ['anchor', 'negative', 'aspect']) assert.equal(result.illustrations[1][field], source.illustrations[1][field]);
  assert.equal(result.positive, 'first');
  assert.equal(replaceSelectedScene(source, 0, shot('new first')).positive, 'new first');
  assert.equal(replaceSelectedScene({ ...shot(''), shouldDraw: false }, 0, shot('now drawable')).shouldDraw, true);
});
test('scene locks preserve missing fields and local profiles override model snapshots', () => {
  const source = shot('original'); delete source.anchor;
  source.characterScene = { version: 1, chatKey: '', entries: [{ profileId: 'local', action: '', expression: '',
    profile: { id: 'local', name: 'Local', lockAppearance: true, lockOutfit: true } }] };
  const result = replaceSelectedScene(source, 0, { ...shot('revised'),
    characterScene: { entries: [{ profileId: 'forged' }] },
    characters: [{ profileId: 'local', appearance: 'wrong', outfit: 'wrong', action: 'walking', expression: 'smile' }] }, ['anchor']);
  assert.equal(result.anchor, undefined); assert.deepEqual(result.characterScene, source.characterScene);
  assert.equal(result.characters[0].appearance, ''); assert.equal(result.characters[0].outfit, '');
  assert.equal(result.characters[0].action, 'walking');
});
test('scene reanalysis rejects multi-scene and empty output and limits task data to current scene', () => {
  const source = shot('old');
  assert.throws(() => replaceSelectedScene(source, 2, shot('new')));
  assert.throws(() => replaceSelectedScene(source, 0, { ...shot(''), shouldDraw: false }), /完整画面/);
  const multi = parseAssistantResult(JSON.stringify({ shouldDraw: true, illustrations: [shot('a', 'one'), shot('b', 'two')] }));
  assert.equal(illustrationPlans(multi).length, 2);
  assert.throws(() => replaceSelectedScene(source, 0, multi), /完整画面/);
  const messages = sceneReanalysisMessages([], source, 'Adjust light', ['anchor', 'unsafe']);
  const data = JSON.parse(messages[0].content);
  assert.deepEqual(data.LOCKED_FIELDS, ['anchor']); assert.equal(data.SELECTED_SCENE.positive, 'old');
});
