import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssistantTrace, safeAssistantEndpoint, assistantErrorCategory } from './assistant-diagnostics.js';
import { BUILTIN_ASSISTANT_SCHEMES, saveAssistantScheme, normalizeAssistantSchemes, resolveAssistantScheme,
  exportAssistantSchemes, importAssistantSchemes } from './assistant-schemes.js';
import { checkAssistantPlan, fixAssistantPlan, assistantPlanRevision, lintPromptField } from './assistant-lint.js';
import { normalizeAssistant, requestAssistantText } from './prompt-assistant.js';
import { createTavernTextAccess } from './tavern-text.js';
import { createAssistantHost } from './assistant-host.js';

const ref = 'browser:11111111-1111-4111-8111-111111111111';
const settings = () => normalizeAssistant({ source: 'api', endpoint: 'https://example.test/proxy/v1/',
  model: 'model-a', keyRef: ref, maxTokens: 4000, presetMode: 'current', autoImage: true,
  taskMessages: { illustrate: [{ role: 'system', content: '{{rules}}' }, { role: 'user', content: '{{input}}' }] } });
test('diagnostics whitelist excludes secret/chat/preset contents and retains actual ordered counts', () => {
  let clock = 10000;
  const trace = createAssistantTrace('illustrate', settings(), { now: () => clock });
  trace.step('preset');
  trace.context({ messages: 4, characters: 2, worldCharacters: 900, privateChat: 'PRIVATE_CHAT' });
  trace.request([{ role: 'system', content: 'PRIVATE_PRESET' }, { role: 'user', content: 'PRIVATE_CHAT' }],
    [{ name: 'PRIVATE_NAME', role: 'system', content: 'PRIVATE_PRESET' }]);
  clock += 100; trace.step('request');
  trace.execution({ model: 'model-b', route: 'independent-api', source: 'openai-compatible', headers: 'PRIVATE_HEADER', response: 'PRIVATE_RESPONSE' });
  clock += 200; trace.finish(new Error('PRIVATE_ERROR sk-abcdefghijklmnopqrstuv'));
  clock += 2000;
  const report = trace.report(), serialized = JSON.stringify(report);
  for (const content of ['PRIVATE_', 'abcdefghijklmnopqrstuv', 'keyRef', '/proxy/', 'headers', 'started']) assert.ok(!serialized.includes(content));
  assert.equal(report.execution.model, 'model-b');
  assert.equal(report.durationMs, 300);
  assert.deepEqual(report.stages.map((row) => row.durationMs), [100, 200]);
  assert.deepEqual(report.presetOrder, [{ order: 1, role: 'system', characters: 14 }]);
  assert.equal(trace.presetNames[0], 'PRIVATE_NAME');
});
test('diagnostics remove endpoint userinfo, query, path and private host details', () => {
  assert.equal(safeAssistantEndpoint('https://user:pass@example.test/secret?key=value'), 'https://example.test');
  assert.equal(safeAssistantEndpoint('http://192.168.1.2:8000/v1'), 'http://[本地地址]');
  assert.equal(safeAssistantEndpoint('file:///secret'), '');
});
test('parse failures mentioning presets are response errors and diagnostics retain larger output limits', () => {
  const trace = createAssistantTrace('comic', normalizeAssistant({ maxTokens: 32768 }));
  trace.step('parse');
  trace.finish(new Error('回复中未找到完整的分镜 JSON；请核对聊天预设'));
  assert.equal(trace.report().errorCategory, 'response');
  assert.equal(trace.report().maxTokens, 32768);
  assert.equal(assistantErrorCategory(Object.assign(new Error('请检查预设'), { comicParseFailure: true })), 'response');
  assert.equal(assistantErrorCategory(new Error('预设顺序存在重复条目')), 'preset');
  assert.equal(assistantErrorCategory(new DOMException('取消', 'AbortError'), 'parse'), 'cancelled');
  assert.equal(assistantErrorCategory(new Error('请求超时'), 'request'), 'timeout');
});
test('native model diagnostics read the submitted model without status probes or native setting changes', async () => {
  const native = { chat_completion_source: 'custom', custom_model: 'current-model' };
  let calls = 0, metadata;
  const context = { mainApi: 'openai', chatCompletionSettings: native,
    getChatCompletionModel: (value) => value.custom_model,
    generateRaw: async () => { calls++; return 'result'; } };
  const access = createTavernTextAccess({ getContext: () => context,
    loadAPI: async () => { throw new Error('must not import'); },
    fetcher: async () => { throw new Error('must not probe'); } });
  assert.equal(await access.generate([], normalizeAssistant(), undefined, { onExecution: (value) => { metadata = value; } }), 'result');
  assert.equal(calls, 1);
  assert.deepEqual(metadata, { model: 'current-model', source: 'custom', route: 'native' });
  assert.deepEqual(native, { chat_completion_source: 'custom', custom_model: 'current-model' });
});
test('host diagnostic envelope is optional and forwards sanitized metadata on success and failure', async () => {
  const responses = [];
  let fail = false;
  const host = createAssistantHost({ getContext: () => ({}), settings: () => ({}), post: (_type, row) => responses.push(row),
    textAccess: { generate: async (_messages, _options, _signal, hooks) => {
      hooks.onExecution?.({ model: 'actual', route: 'native', source: 'custom', key: 'PRIVATE_KEY' });
      if (fail) throw new Error('PRIVATE_UPSTREAM');
      return 'response';
    } } });
  const messages = [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }];
  await host.receive({ action: 'text', requestId: 'plain', messages });
  assert.equal(responses[0].value, 'response');
  await host.receive({ action: 'text', requestId: 'diagnostic', messages, diagnostics: true });
  assert.equal(responses[1].value.text, 'response');
  assert.equal(responses[1].value.execution.model, 'actual');
  fail = true;
  await host.receive({ action: 'text', requestId: 'failed', messages, diagnostics: true });
  assert.equal(responses[2].execution.model, 'actual');
  assert.ok(!JSON.stringify(responses).includes('PRIVATE_'));
  host.destroy();
});
test('independent API diagnostics contain status and actual submitted model without extra model calls', async () => {
  let calls = 0, execution = {};
  await assert.rejects(requestAssistantText(settings(), 'fixture-secret', [], {
    onExecution: (value) => Object.assign(execution, value),
    fetcher: async () => { calls++; return new Response('', { status: 429 }); },
  }), /限流/);
  assert.equal(calls, 1);
  assert.deepEqual(execution, { model: 'model-a', source: 'openai-compatible', route: 'independent-api', httpStatus: 429 });
});
test('custom schemes round trip full settings but discard raw key fields and stale API links', () => {
  const saved = saveAssistantScheme([], { name: '我的方案', settings: { ...settings(), key: 'PRIVATE', apiLink: { endpoint: 'https://example.test', openaiRef: ref, assistantRef: ref } } });
  const next = resolveAssistantScheme(saved.library, saved.id, normalizeAssistant());
  assert.equal(next.keyRef, ref);
  assert.equal(next.autoImage, true);
  assert.equal(next.maxTokens, 4000);
  assert.equal(next.apiLink, null);
  assert.equal(next.key, undefined);
  assert.deepEqual(next.taskMessages, settings().taskMessages);
});
test('built-in schemes preserve credentials, chosen model, native preset and automation switches', () => {
  for (const row of BUILTIN_ASSISTANT_SCHEMES) {
    const current = settings(), next = resolveAssistantScheme([], row.id, current);
    for (const field of ['keyRef', 'endpoint', 'model', 'presetMode', 'autoImage', 'autoPrompt']) assert.equal(next[field], current[field]);
  }
  assert.equal(resolveAssistantScheme([], 'builtin-story', settings()).illustrationCount, 3);
});
test('scheme imports drop local credential references, remap IDs/names and validate atomically', () => {
  const saved = saveAssistantScheme([], { name: '日常', settings: settings() });
  const exported = exportAssistantSchemes(saved.library);
  assert.ok(!JSON.stringify(exported).includes(ref));
  const malicious = structuredClone(exported); malicious.schemes[0].settings.keyRef = ref;
  const rows = importAssistantSchemes(saved.library, malicious);
  assert.equal(rows.length, 2); assert.notEqual(rows[0].id, rows[1].id);
  assert.equal(rows[1].settings.keyRef, ''); assert.equal(rows[1].name, '日常 (2)');
  const invalid = structuredClone(exported); invalid.schemes.push({ id: 'invalid', name: 'bad', settings: { taskMessages: { illustrate: [{ role: 'user', content: '{{rules}} {{input}}' }] } } });
  assert.throws(() => importAssistantSchemes(saved.library, invalid), /无效/);
  assert.equal(saved.library.length, 1);
});
test('scheme limits and malformed placeholders fail before changing the library', () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({ id: `s-${index}`, name: `方案${index}`, settings: normalizeAssistant() }));
  assert.throws(() => saveAssistantScheme(rows, { name: '超额', settings: {} }), /30/);
  assert.throws(() => saveAssistantScheme([], { name: '无占位符', settings: { taskMessages: { illustrate: [{ role: 'system', content: '{{rules}}' }] } } }), /input/);
  assert.equal(normalizeAssistantSchemes([{ id: 'x', name: 'X', settings: {} }, { id: 'x', name: 'Y', settings: {} }]).length, 1);
});
test('duplicate correction keeps weighting, groups, LoRA and escaped punctuation intact', () => {
  const value = 'blue_eyes, blue eyes, {blue eyes}, (blue eyes:1.2), (blue eyes:1.5), 1.4::blue eyes, smile::, <lora:test:1>, tag\\,suffix';
  const result = lintPromptField(value);
  assert.deepEqual(result.duplicates, ['blue eyes']);
  for (const raw of ['{blue eyes}', '(blue eyes:1.2)', '(blue eyes:1.5)', '1.4::blue eyes, smile::', '<lora:test:1>', 'tag\\,suffix']) {
    assert.ok(result.corrected.includes(raw));
  }
  assert.equal(lintPromptField('A beautiful woman reading a book in a library, A beautiful woman reading a book in a library').duplicates.length, 0);
});
test('lint separates advisory conflicts from safe explicit fixes and protects intentional multicolor', () => {
  const plan = { positive: 'blue hair, red hair, blue eyes', negative: 'blue eyes' };
  const issues = checkAssistantPlan(plan);
  assert.ok(issues.some((row) => row.code === 'conflict'));
  assert.ok(issues.some((row) => row.code === 'positive-negative'));
  assert.ok(issues.every((row) => !row.fix));
  assert.ok(!checkAssistantPlan({ positive: 'blue hair, red hair, gradient hair' }).some((row) => row.code === 'conflict'));
  assert.ok(!checkAssistantPlan({ ...plan, characters: [{ profileId: 'a' }, { profileId: 'b' }] }).some((row) => row.code === 'conflict'));
});
test('fixes require unchanged draft and affect only the selected scene', () => {
  const plan = { positive: 'first', illustrations: [{ positive: 'first' }, { positive: 'smile, smile, blue eyes', anchor: 'missing' }] };
  const options = { target: '她在窗边读书。', shotIndex: 1, revision: assistantPlanRevision(plan) };
  const issue = checkAssistantPlan(plan, options).find((row) => row.code === 'duplicate');
  const next = fixAssistantPlan(plan, issue.id, options);
  assert.equal(next.illustrations[0].positive, 'first');
  assert.equal(next.illustrations[1].positive, 'smile, blue eyes');
  assert.equal(plan.illustrations[1].positive, 'smile, smile, blue eyes');
  assert.throws(() => fixAssistantPlan(next, issue.id, options), /已改变/);
  const anchor = checkAssistantPlan(next, options).find((row) => row.code === 'anchor');
  const cleared = fixAssistantPlan(next, anchor.id, { ...options, revision: assistantPlanRevision(next) });
  assert.equal(cleared.illustrations[1].anchor, undefined);
});
test('missing selected character fixes use only the frozen local profile selection', () => {
  const plan = { positive: 'scene', characters: [], characterScene: { entries: [
    { profileId: 'alice', profile: { name: 'Alice' }, action: 'reading' },
  ] } };
  const issue = checkAssistantPlan(plan).find((row) => row.code === 'missing-character');
  const fixed = fixAssistantPlan(plan, issue.id, { revision: assistantPlanRevision(plan) });
  assert.deepEqual(fixed.characters.map((row) => [row.profileId, row.action]), [['alice', 'reading']]);
});
test('unknown anchors are reported as unverified without destructive correction', () => {
  const issues = checkAssistantPlan({ positive: 'scene', anchor: '她在窗边' });
  assert.equal(issues[0].code, 'anchor-unverified'); assert.equal(issues[0].fix, undefined);
});
test('explicit multiple-character tags suppress uncertain global hair color conflicts', () => {
  for (const prefix of ['2girls', 'multiple girls', '1girl, 1boy']) {
    assert.ok(!checkAssistantPlan({ positive: `${prefix}, red hair, blue hair` }).some((row) => row.code === 'conflict'));
  }
});
