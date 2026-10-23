import test from 'node:test';
import assert from 'node:assert/strict';
import { bindSmartSlot, chatIdentity } from './chat.js';
import { saveDrawingState, createAssistantHost } from './assistant-host.js';
import { inspectDrawingState, readDrawingState, reviseDrawingState, undoDrawingState } from './assistant-state.js';
import { DEFAULT_TASK_MESSAGES, validateTaskMessages, importTaskTemplates, exportTaskTemplates,
  composeTaskMessages, freezeIllustrationCharacters } from './assistant-workflow.js';

const context = () => ({
  chatId: 'state-editor', characterId: 0, characters: [{ avatar: 'one.png', name: '阿青' }],
  chat: [{ mes: '阿青换上蓝色外套。', name: '阿青', send_date: 'first' },
    { mes: '阿青微笑着坐下。', name: '阿青', send_date: 'second' }], saveChat: async () => {},
});
const values = (outfit = 'red coat') => ({ appearance: '', outfit, action: 'sitting', expression: 'smiling' });
const request = (state, extra = {}) => ({ chatKey: state.chatKey, revision: state.revision, key: 'one', ...extra });
async function seed(ctx) {
  const scene = { chatKey: chatIdentity(ctx), entries: [{ profileId: 'one' }] };
  for (const [index, fields] of [[0, { outfit: 'blue coat', evidence: '蓝色外套' }],
    [1, { action: 'sitting', expression: 'smiling', evidence: '微笑着坐下' }]]) {
    await saveDrawingState(ctx, (await bindSmartSlot(ctx, ctx.chat[index])).binding,
      [{ profileId: 'one', name: '阿青', ...fields }], scene, []);
  }
}

test('state inspector attributes inherited fields to their own original message and quote', async () => {
  const ctx = context(); await seed(ctx);
  const state = await inspectDrawingState(ctx);
  assert.equal(state.characters[0].outfit, 'blue coat');
  assert.equal(state.sources.one.outfit.index, 0);
  assert.equal(state.sources.one.outfit.evidence, '蓝色外套');
  assert.equal(state.sources.one.action.index, 1);
  assert.equal(state.sources.one.action.evidence, '微笑着坐下');
  assert.equal(state.writable, true);
});

test('manual corrections preserve identity and mark only changed fields as manual, with exact undo', async () => {
  const ctx = context(); await seed(ctx);
  const original = structuredClone(ctx.chat), cards = structuredClone(ctx.characters);
  const edit = await reviseDrawingState(ctx, request(await inspectDrawingState(ctx), { values: values() }));
  assert.equal(edit.inspection.characters[0].outfit, 'red coat');
  assert.equal(edit.inspection.characters[0].evidence, '');
  assert.equal(edit.inspection.sources.one.outfit.kind, 'manual');
  assert.equal(edit.inspection.sources.one.outfit.evidence, '');
  assert.equal(edit.inspection.sources.one.action.kind, 'automatic');
  assert.deepEqual(ctx.characters, cards);
  await undoDrawingState(ctx, request(edit.inspection), edit.undo);
  assert.deepEqual(ctx.chat, original);
});

test('deliberate blank fields and removed characters do not reappear through old state merging', async () => {
  const ctx = context(); await seed(ctx);
  const empty = await reviseDrawingState(ctx, request(await inspectDrawingState(ctx), { values: values('') }));
  assert.equal((await readDrawingState(ctx))[0].outfit, '');
  assert.equal(empty.inspection.sources.one.outfit, undefined);
  const removed = await reviseDrawingState(ctx, request(empty.inspection), true);
  assert.deepEqual(await readDrawingState(ctx), []);
  const copy = structuredClone(ctx.chat);
  assert.deepEqual(await readDrawingState({ ...ctx, chat: copy }), []);
  await undoDrawingState(ctx, request(removed.inspection), removed.undo);
  assert.equal((await readDrawingState(ctx))[0].outfit, '');
});

test('same-message reanalysis respects a manual snapshot and later evidence advances it normally', async () => {
  const ctx = context(); await seed(ctx);
  const edited = await reviseDrawingState(ctx, request(await inspectDrawingState(ctx), { values: values() }));
  const scene = { chatKey: chatIdentity(ctx), entries: [{ profileId: 'one' }] };
  await saveDrawingState(ctx, (await bindSmartSlot(ctx, ctx.chat[1])).binding,
    [{ profileId: 'one', outfit: 'wrong coat', evidence: '阿青' }], scene);
  assert.equal((await readDrawingState(ctx))[0].outfit, 'red coat');
  await assert.rejects(undoDrawingState(ctx, request(edited.inspection), edited.undo), /变化/);
  ctx.chat.push({ mes: '阿青穿着绿色外套走来。', name: '阿青', send_date: 'third' });
  await saveDrawingState(ctx, (await bindSmartSlot(ctx, ctx.chat[2])).binding,
    [{ profileId: 'one', outfit: 'green coat', evidence: '绿色外套' }], scene);
  const beforeRead = structuredClone(ctx.chat);
  assert.equal((await readDrawingState(ctx))[0].outfit, 'green coat');
  assert.equal((await inspectDrawingState(ctx)).sources.one.outfit.index, 2);
  assert.deepEqual(ctx.chat, beforeRead);
});

test('source edits, swipes, deletion and chat switches reject stale correction or undo', async () => {
  for (const mutate of [
    (ctx) => { ctx.chat[0].mes = '阿青留在家里。'; },
    (ctx) => { ctx.chat[0].swipe_id = 1; },
    (ctx) => { ctx.chat.shift(); },
    (ctx) => { ctx.chatId = 'other'; },
  ]) {
    const ctx = context(); await seed(ctx);
    const state = await inspectDrawingState(ctx);
    mutate(ctx);
    await assert.rejects(reviseDrawingState(ctx, request(state, { values: values() })), /变化/);
  }
  const ctx = context(); await seed(ctx);
  const edited = await reviseDrawingState(ctx, request(await inspectDrawingState(ctx), { values: values() }));
  ctx.chat[0].mes = '早先的状态已被编辑。';
  assert.equal((await readDrawingState(ctx))[0].outfit, '');
  await assert.rejects(undoDrawingState(ctx, request(edited.inspection), edited.undo), /变化/);
});

test('state editor writes and undo both roll back after saveChat failure', async () => {
  const ctx = context(); await seed(ctx);
  const before = structuredClone(ctx.chat);
  ctx.saveChat = async () => { throw new Error('private save failure'); };
  await assert.rejects(reviseDrawingState(ctx, request(await inspectDrawingState(ctx), { values: values() })), /保存失败/);
  assert.deepEqual(ctx.chat, before);
  ctx.saveChat = async () => {};
  const edited = await reviseDrawingState(ctx, request(await inspectDrawingState(ctx), { values: values() }));
  const saved = structuredClone(ctx.chat);
  ctx.saveChat = async () => { throw new Error(); };
  await assert.rejects(undoDrawingState(ctx, request(edited.inspection), edited.undo), /保存失败/);
  assert.deepEqual(ctx.chat, saved);
});

test('manual editor rejects arbitrary roles, extra fields and oversized values, while profile locks still win', async () => {
  const ctx = context(); await seed(ctx);
  const state = await inspectDrawingState(ctx);
  for (const extra of [{ key: 'unknown', values: values() }, { values: { ...values(), evidence: 'forged' } },
    { values: { ...values(), appearance: 'x'.repeat(4001) } }]) {
    await assert.rejects(reviseDrawingState(ctx, request(state, extra)));
  }
  await reviseDrawingState(ctx, request(state, { values: values() }));
  const plan = { positive: 'portrait' };
  freezeIllustrationCharacters(plan, { entries: [{ profileId: 'one', profile: { lockOutfit: true } }] }, await readDrawingState(ctx));
  assert.equal(plan.characters[0].outfit, '');
});

test('host permits only one state mutation, guards tavern generation and keeps undo receipts private', async () => {
  const ctx = context(); await seed(ctx);
  const posts = []; let busy = true, release;
  const host = createAssistantHost({ getContext: () => ctx, settings: () => ({}),
    post: (_type, value) => posts.push(value), isBusy: () => busy });
  const read = await inspectDrawingState(ctx);
  await host.receive({ requestId: 'one', action: 'state-edit', ...request(read, { values: values() }) });
  assert.match(posts.at(-1).error, /当前任务/);
  busy = false;
  ctx.saveChat = () => new Promise((resolve) => { release = resolve; });
  const pending = host.receive({ requestId: 'two', action: 'state-edit', ...request(read, { values: values() }) });
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
  await host.receive({ requestId: 'three', action: 'state-remove', ...request(read) });
  assert.match(posts.at(-1).error, /当前任务/);
  release(); await pending;
  const result = posts.at(-1).value;
  assert.equal(result.canUndo, true); assert.equal('undo' in result, false);
  ctx.saveChat = async () => {};
  await host.receive({ requestId: 'four', action: 'state-undo', ...request(result) });
  assert.equal(posts.at(-1).value.characters[0].outfit, 'blue coat');
  host.destroy();
});

const bundle = (tasks) => ({ format: 'linghuashi-task-messages', version: 1, tasks });
test('live task validation matches composition and preserves roles and native macros', () => {
  const rows = [{ role: 'system', content: '{{user}}\n{{rules}}' },
    { role: 'assistant', content: 'example' }, { role: 'user', content: '{{input}}' }];
  assert.deepEqual(validateTaskMessages(rows), []);
  assert.equal(composeTaskMessages([{ role: 'system', content: 'rules' }, { role: 'user', content: 'input' }],
    'generate', { taskMessages: { generate: rows } })[0].content, '{{user}}\nrules');
  for (const invalid of [[{ role: 'user', content: '{{rules}}{{input}}' }],
    [{ role: 'system', content: '{{rules}}{{rules}}' }, DEFAULT_TASK_MESSAGES[1]],
    [{ role: 'system', content: '{{rules}}' }, { role: 'user', content: '' }]]) {
    assert.ok(validateTaskMessages(invalid).length);
    assert.throws(() => composeTaskMessages([], 'generate', { taskMessages: { generate: invalid } }));
  }
});

test('template files round trip seven tasks and contain only task messages', () => {
  const tasks = { generate: [...DEFAULT_TASK_MESSAGES, { role: 'assistant', content: 'example' }] };
  const exported = exportTaskTemplates(tasks);
  assert.equal(Object.keys(exported.tasks).length, 7);
  assert.deepEqual(importTaskTemplates(JSON.parse(JSON.stringify(exported))).generate, tasks.generate);
  assert.deepEqual(Object.keys(exported), ['format', 'version', 'tasks']);
  tasks.generate[0] = { role: 'system', content: 'changed' };
  assert.equal(exported.tasks.generate[0].content, '{{rules}}');
});

test('malformed or oversized template imports fail atomically, including unexpected API fields', () => {
  const valid = bundle({ generate: DEFAULT_TASK_MESSAGES }), original = JSON.stringify(valid);
  for (const invalid of [null, { ...valid, version: 2 }, { ...valid, apiKey: 'private' },
    bundle({ unknown: DEFAULT_TASK_MESSAGES }), bundle({}),
    bundle({ generate: [...DEFAULT_TASK_MESSAGES, { role: 'tool', content: 'x' }] }),
    bundle({ generate: [{ ...DEFAULT_TASK_MESSAGES[0], endpoint: 'https://example.test' }, DEFAULT_TASK_MESSAGES[1]] }),
    bundle({ generate: [...DEFAULT_TASK_MESSAGES, { role: 'user', content: 'x'.repeat(8001) }] }),
    bundle({ generate: DEFAULT_TASK_MESSAGES, illustrate: [{ role: 'system', content: '{{rules}}' }] })]) {
    assert.throws(() => importTaskTemplates(invalid));
    assert.equal(JSON.stringify(valid), original);
  }
  const large = Array.from({ length: 16 }, (_, index) => ({ role: index === 0 ? 'system' : 'user',
    content: index === 0 ? '{{rules}}' : index === 1 ? '{{input}}' : 'x'.repeat(8000) }));
  assert.throws(() => importTaskTemplates(bundle({ generate: large })), /96000/);
});
