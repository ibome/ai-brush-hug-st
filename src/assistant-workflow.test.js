import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAssistant, buildAssistantMessages, parseAssistantResult, requestAssistantText } from './prompt-assistant.js';
import { composeTaskMessages, normalizeTaskMessages, freezeIllustrationCharacters, selectedIllustration,
  validateIllustrationAnchors, evidencedCharacterStates, mergeCharacterStates } from './assistant-workflow.js';
import { assistantResponseParameters, extractAssistantResponse, ASSISTANT_RESULT_TOOL } from './assistant-response.js';
import { bindSmartSlot, chatIdentity } from './chat.js';
import { findBoundMessage, readDrawingState, saveDrawingState, clearDrawingState, collectAssistantContext } from './assistant-host.js';
import { createTavernTextAccess } from './tavern-text.js';
import { storedAssistantPlan } from '../server/linghuashi-storage/assistant-plan.mjs';

const base = [{ role: 'system', content: 'JSON RULES' }, { role: 'user', content: '{"INPUT":"{{rules}}"}' }];
const scene = { version: 1, chatKey: '', entries: [{
  profileId: 'one', profile: { id: 'one', name: '阿青', lockAppearance: true, lockOutfit: false },
  action: '', expression: '',
}] };
const shot = (positive, anchor) => ({ scene: positive, positive, negative: '', aspect: 'portrait', anchor });
const plan = () => ({ shouldDraw: true, illustrations: [
  shot('reading a book', '阿青在窗边读书。'), shot('walking into garden', '她走进花园。'),
] });
const context = () => ({
  chatId: 'state-chat', characterId: 0, characters: [{ avatar: 'one.png', name: '阿青' }],
  name2: '阿青', chat: [
    { mes: '阿青换上了蓝色外套。', name: '阿青', send_date: 'first', is_user: false },
    { mes: '阿青在窗边读书。她走进花园。', name: '阿青', send_date: 'second', is_user: false },
  ],
  saveChat: async () => {},
});

test('workflow changes remain opt-in and message customization is bounded per task', () => {
  const settings = normalizeAssistant();
  assert.equal(settings.illustrationCount, 1);
  assert.equal(settings.rememberState, false);
  assert.equal(settings.responseMode, 'text');
  assert.deepEqual(composeTaskMessages(base, 'illustrate', settings), base);
  assert.deepEqual(normalizeTaskMessages({ illustrate: Array(17).fill(base[0]), unknown: base }), {});
  assert.deepEqual(normalizeTaskMessages({ illustrate: [{ role: 'tool', content: '' }] }), {});
});

test('custom task messages preserve roles and order without recursively expanding source data', () => {
  const rows = [{ role: 'system', content: 'before {{rules}}' }, { role: 'assistant', content: 'example' },
    { role: 'user', content: '{{input}}' }, { role: 'user', content: 'after' }];
  const messages = composeTaskMessages(base, 'illustrate', { taskMessages: { illustrate: rows } });
  assert.deepEqual(messages.map((row) => row.role), ['system', 'assistant', 'user', 'user']);
  assert.equal(messages[0].content, 'before JSON RULES');
  assert.equal(messages[2].content, '{"INPUT":"{{rules}}"}');
  assert.deepEqual(composeTaskMessages(base, 'polish', { taskMessages: { illustrate: rows } }), base);
});

test('required task placeholders cannot disappear, duplicate or change role', () => {
  for (const rows of [
    [{ role: 'system', content: 'rules' }, base[1]],
    [{ role: 'system', content: '{{rules}}{{rules}}' }, { role: 'user', content: '{{input}}' }],
    [{ role: 'user', content: '{{rules}}' }, { role: 'user', content: '{{input}}' }],
  ]) assert.throws(() => composeTaskMessages(base, 'illustrate', { taskMessages: { illustrate: rows } }), /任务消息需保留/);
});

test('multiple illustration results are explicit, bounded and preserve independent prompts', () => {
  const parsed = parseAssistantResult(JSON.stringify(plan()));
  assert.equal(parsed.positive, 'reading a book');
  assert.equal(parsed.illustrations.length, 2);
  assert.equal(selectedIllustration(parsed, 1).positive, 'walking into garden');
  assert.equal('illustrations' in selectedIllustration(parsed, 1), false);
  assert.throws(() => selectedIllustration(parsed, 2));
  assert.throws(() => parseAssistantResult(JSON.stringify({ shouldDraw: true, illustrations: Array(5).fill(shot('x', 'y')) })), /1 至 4/);
  assert.throws(() => parseAssistantResult(JSON.stringify({ shouldDraw: true, illustrations: [shot('', 'y')] })), /正向/);
  assert.throws(() => parseAssistantResult(JSON.stringify({ shouldDraw: true, illustrations: [shot('x', ''), shot('y', '')] })), /定位句/);
});

test('unmatched or repeated anchors fall back instead of guessing an insertion location', () => {
  const parsed = parseAssistantResult(JSON.stringify(plan()));
  validateIllustrationAnchors(parsed, '阿青在窗边读书。\n她走进花园。');
  assert.equal(parsed.anchor, '阿青在窗边读书。');
  parsed.illustrations[1].anchor = '重复句子。';
  validateIllustrationAnchors(parsed, '阿青在窗边读书。重复句子。重复句子。');
  assert.equal(parsed.illustrations[1].anchor, undefined);
  assert.equal(parseAssistantResult(JSON.stringify(parsed), { stored: true }).illustrations.length, 2);
});

test('continuity cannot override locked profiles or manual actions and remains independent per shot', () => {
  const parsed = parseAssistantResult(JSON.stringify(plan()));
  parsed.illustrations[1].characters = [{ profileId: 'one', action: 'walking', outfit: 'green coat' }];
  scene.entries[0].action = '';
  freezeIllustrationCharacters(parsed, scene, [{ profileId: 'one', name: '阿青', appearance: 'pink hair', outfit: 'blue coat' }]);
  assert.equal(parsed.illustrations[0].characters[0].outfit, 'blue coat');
  assert.equal(parsed.illustrations[1].characters[0].outfit, 'green coat');
  assert.equal(parsed.illustrations[0].characters[0].appearance, '');
  const manual = structuredClone(scene); manual.entries[0].action = 'sitting';
  manual.entries[0].profile.lockOutfit = true;
  freezeIllustrationCharacters(parsed, manual, [{ profileId: 'one', outfit: 'red coat', action: 'running' }]);
  assert.equal(parsed.illustrations[1].characters[0].action, 'sitting');
  assert.equal(parsed.illustrations[1].characters[0].outfit, '');
});

test('state extraction requires a known identity and a literal source quote', () => {
  const states = [
    { profileId: 'one', name: '阿青', outfit: 'blue coat', evidence: '换上了蓝色外套' },
    { profileId: 'unknown', name: '陌生人', outfit: 'red coat', evidence: '换上了蓝色外套' },
    { name: '另一个人', outfit: 'dress', evidence: '杜撰' },
  ];
  assert.equal(evidencedCharacterStates(states, '阿青换上了蓝色外套。', scene).length, 1);
  assert.deepEqual(mergeCharacterStates([{ profileId: 'one', outfit: 'blue coat', appearance: 'black hair' }],
    [{ profileId: 'one', outfit: 'red coat' }]).map((row) => [row.outfit, row.appearance]), [['red coat', 'black hair']]);
});

test('drawing state is bounded to the message branch, prior floor and current chat', async () => {
  const ctx = context(), binding = (await bindSmartSlot(ctx, ctx.chat[0])).binding;
  const localScene = { ...scene, chatKey: chatIdentity(ctx) };
  const state = [{ profileId: 'one', name: '阿青', outfit: 'blue coat', evidence: '换上了蓝色外套' }];
  await saveDrawingState(ctx, binding, state, localScene, []);
  assert.equal((await readDrawingState(ctx))[0].outfit, 'blue coat');
  assert.deepEqual(await readDrawingState(ctx, 0), []);
  const material = await collectAssistantContext(ctx, { rememberState: true, includeWorld: false });
  assert.equal(material.drawingState[0].outfit, 'blue coat');
  ctx.chatId = 'other-chat';
  assert.deepEqual(await readDrawingState(ctx), []);
  ctx.chatId = 'state-chat'; ctx.chat[0].mes += 'changed';
  assert.deepEqual(await readDrawingState(ctx), []);
});

test('state persistence and clearing roll back cleanly if chat saving fails', async () => {
  const ctx = context(), binding = (await bindSmartSlot(ctx, ctx.chat[0])).binding;
  const localScene = { ...scene, chatKey: chatIdentity(ctx) };
  const state = [{ profileId: 'one', outfit: 'blue coat', evidence: '蓝色外套' }];
  ctx.saveChat = async () => { throw new Error('private failure'); };
  await assert.rejects(saveDrawingState(ctx, binding, state, localScene, []), /保存失败/);
  assert.equal(ctx.chat[0].extra.linghuashiDrawingState, undefined);
  ctx.saveChat = async () => {};
  await saveDrawingState(ctx, binding, state, localScene, []);
  ctx.saveChat = async () => { throw new Error(); };
  await assert.rejects(clearDrawingState(ctx, chatIdentity(ctx)), /清除失败/);
  assert.equal((await readDrawingState(ctx)).length, 1);
  ctx.saveChat = async () => {};
  await clearDrawingState(ctx, chatIdentity(ctx));
  assert.deepEqual(await readDrawingState(ctx), []);
});

test('later state does not retain changes inherited from an edited earlier message', async () => {
  const ctx = context(), localScene = { ...scene, chatKey: chatIdentity(ctx) };
  const first = (await bindSmartSlot(ctx, ctx.chat[0])).binding;
  await saveDrawingState(ctx, first, [{ profileId: 'one', outfit: 'blue coat', evidence: '蓝色外套' }], localScene);
  const second = (await bindSmartSlot(ctx, ctx.chat[1])).binding;
  await saveDrawingState(ctx, second, [{ profileId: 'one', action: 'reading', evidence: '在窗边读书' }], localScene);
  assert.equal((await readDrawingState(ctx))[0].outfit, 'blue coat');
  assert.equal((await readDrawingState(ctx))[0].action, 'reading');
  ctx.chat[0].mes = '阿青留在家中。';
  const remaining = await readDrawingState(ctx);
  assert.ok(!remaining[0].outfit);
  assert.equal(remaining[0].action, 'reading');
});

test('each illustration has its own stable task binding without changing the original smart ID', async () => {
  const ctx = context();
  const root = await bindSmartSlot(ctx, ctx.chat[1]), first = await bindSmartSlot(ctx, ctx.chat[1], 0);
  const second = await bindSmartSlot(ctx, ctx.chat[1], 1);
  assert.equal(root.binding.id, first.binding.id);
  assert.notEqual(root.binding.id, second.binding.id);
  assert.equal(await findBoundMessage(ctx, second.binding), ctx.chat[1]);
  assert.equal(await bindSmartSlot(ctx, ctx.chat[1], 4), null);
  ctx.chat[1].swipe_id = 1;
  assert.equal(await findBoundMessage(ctx, second.binding), null);
});

test('structured modes submit only the selected contract and extract only the declared result tool', async () => {
  assert.deepEqual(assistantResponseParameters('text'), {});
  assert.deepEqual(assistantResponseParameters('json'), { response_format: { type: 'json_object' } });
  const raw = JSON.stringify({ shouldDraw: false });
  const data = { choices: [{ message: { tool_calls: [{ function: { name: ASSISTANT_RESULT_TOOL,
    arguments: JSON.stringify({ result: raw }) } }] } }] };
  assert.equal(extractAssistantResponse(data), raw);
  await requestAssistantText({ model: 'test', endpoint: 'https://example.test', responseMode: 'tool' }, 'fixture-key', base, {
    fetcher: async (_url, options) => {
      const payload = JSON.parse(options.body);
      assert.equal(payload.tools[0].function.name, ASSISTANT_RESULT_TOOL);
      assert.equal(payload.tool_choice.function.name, ASSISTANT_RESULT_TOOL);
      return Response.json(data);
    },
  });
  data.choices[0].message.tool_calls[0].function.name = 'unexpected';
  assert.throws(() => extractAssistantResponse(data), /未知或多个/);
});

test('envelope compatibility never treats reasoning, refusals, or truncated content as a valid result', () => {
  const raw = '{"shouldDraw":false}';
  for (const data of [{ output_text: raw }, { output: [{ content: [{ type: 'output_text', text: raw }] }] },
    { choices: [{ message: { content: [{ type: 'text', text: raw }] } }] }]) {
    assert.equal(extractAssistantResponse(data), raw);
  }
  assert.throws(() => extractAssistantResponse({ choices: [{ finish_reason: 'length', message: { content: raw } }] }),
    (error) => /截断/.test(error.message) && error.assistantResponse === raw && !JSON.stringify(error).includes(raw));
  assert.throws(() => extractAssistantResponse({ choices: [{ message: { reasoning_content: raw } }] }), /有效结果/);
  assert.throws(() => extractAssistantResponse({ choices: [{ message: { refusal: 'no' } }] }), /未提供/);
});

test('native tool mode uses the current model without modifying the Tavern settings', async () => {
  const ctx = { mainApi: 'openai', chatCompletionSettings: { custom_model: 'current', temp_openai: 0.8 },
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }) };
  const baseline = structuredClone(ctx.chatCompletionSettings);
  const access = createTavernTextAccess({ getContext: () => ctx, loadAPI: async () => ({
    getChatCompletionModel: () => 'current',
    createGenerationParameters: async (_settings, model, _type, messages) => ({ generate_data: { model, messages } }),
  }), fetcher: async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'current');
    assert.equal(body.tools[0].function.name, ASSISTANT_RESULT_TOOL);
    return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: ASSISTANT_RESULT_TOOL,
      arguments: '{"result":"{\\"shouldDraw\\":false}"}' } }] } }] });
  } });
  assert.equal(await access.generate(base, normalizeAssistant({ responseMode: 'tool' })), '{"shouldDraw":false}');
  assert.deepEqual(ctx.chatCompletionSettings, baseline);
});

test('storage retains multiple plans and character directions but discards arbitrary metadata', () => {
  const parsed = parseAssistantResult(JSON.stringify(plan()));
  parsed.apiKey = 'secret'; parsed.illustrations[0].apiKey = 'secret';
  const saved = storedAssistantPlan(parsed);
  assert.equal(saved.illustrations.length, 2);
  assert.equal(saved.anchor, '阿青在窗边读书。');
  assert.equal(JSON.stringify(saved).includes('secret'), false);
  assert.throws(() => storedAssistantPlan({ illustrations: Array(5).fill({}) }), /列表/);
});

test('multi-scene prompts separate their output count from per-scene sample counts', () => {
  const messages = buildAssistantMessages({ operation: 'illustrate', settings: { illustrationCount: 3, count: 4, rememberState: true },
    context: { drawingState: [{ name: '阿青', outfit: 'coat' }] } });
  assert.match(messages[0].content, /up to 3/);
  assert.match(messages[0].content, /characterStates/);
  assert.equal(JSON.parse(messages[1].content).DRAWING_STATE[0].outfit, 'coat');
});
