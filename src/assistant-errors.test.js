import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantCallError, assistantFailureInfo, normalizeTavernError, tavernResponseError } from './assistant-errors.js';
import { assistantErrorCategory, createAssistantTrace } from './assistant-diagnostics.js';
import { createAssistantHost } from './assistant-host.js';
import { createTavernTextAccess } from './tavern-text.js';
import { normalizeAssistant } from './prompt-assistant.js';

const messages = [{ role: 'system', content: 'rules' }, { role: 'user', content: 'material' }];
const fixture = () => {
  const context = { mainApi: 'openai', chatCompletionSettings: {
    chat_completion_source: 'custom', custom_model: 'current', openai_max_tokens: 100,
  }, getChatCompletionModel: (settings) => settings.custom_model, getRequestHeaders: () => ({ 'Content-Type': 'application/json' }) };
  const api = { createGenerationParameters: async (settings, model, type, prompt) => ({
    generate_data: { model, type, messages: prompt, max_tokens: settings.openai_max_tokens, stream: true },
  }) };
  return { context, api };
};

test('explicitly selecting the current model uses native generation once without changing settings', async () => {
  const { context, api } = fixture(), original = structuredClone(context.chatCompletionSettings);
  let calls = 0, execution;
  context.generateRawData = async (request) => {
    calls++; assert.equal(request.responseLength, 8192);
    assert.deepEqual(request.prompt, messages);
    return { choices: [{ message: { content: '{"profiles":[]}' } }] };
  };
  context.extractMessageFromData = () => { throw new Error('must use raw utility content'); };
  const access = createTavernTextAccess({ getContext: () => context, loadAPI: async () => api,
    fetcher: () => { throw new Error('must not send another request'); } });
  assert.equal(await access.generate(messages, normalizeAssistant({ tavernModel: 'current', maxTokens: 8192 }), undefined,
    { onExecution: (value) => { execution = value; } }), '{"profiles":[]}');
  assert.equal(calls, 1); assert.equal(execution.route, 'native'); assert.equal(execution.model, 'current');
  assert.deepEqual(context.chatCompletionSettings, original);
});

test('other models and structured modes keep the selected model backend route', async () => {
  for (const options of [{ tavernModel: 'other' }, { tavernModel: 'current', responseMode: 'json' }]) {
    const { context, api } = fixture();
    let calls = 0, execution = {};
    context.generateRaw = () => { throw new Error('must use selected backend route'); };
    const access = createTavernTextAccess({ getContext: () => context, loadAPI: async () => api,
      fetcher: async (_url, request) => {
        calls++; const body = JSON.parse(request.body);
        assert.equal(body.model, options.tavernModel); assert.equal(body.stream, false);
        if (options.responseMode === 'json') assert.ok(body.json_schema);
        return Response.json({ choices: [{ message: { content: '{}' } }] });
      } });
    assert.equal(await access.generate(messages, normalizeAssistant(options), undefined,
      { onExecution: (value) => Object.assign(execution, value) }), '{}');
    assert.equal(calls, 1); assert.equal(execution.route, 'tavern-backend');
  }
});

test('backend HTTP 200 with an upstream error retains its category across the host bridge and diagnostics', async () => {
  for (const [payload, code] of [
    [{ error: { message: 'model not found PRIVATE_REPLY sk-private-credential', status: 404 } }, 'model'],
    [{ error: { message: 'insufficient_quota', status: 429 } }, 'quota'],
    [{ error: { message: 'unsupported parameter max_tokens', status: 400, param: 'max_tokens' } }, 'parameters'],
    [{ error: { message: 'invalid_api_key', status: 401 } }, 'authentication'],
    [{ error: { message: 'PRIVATE_REPLY sk-private-credential' } }, 'tavern-failed'],
  ]) {
    const { context, api } = fixture();
    let calls = 0, posted;
    const access = createTavernTextAccess({ getContext: () => context, loadAPI: async () => api,
      fetcher: async () => { calls++; return Response.json(payload); } });
    const options = normalizeAssistant({ tavernModel: 'other' });
    const host = createAssistantHost({ getContext: () => context, settings: () => options, textAccess: access,
      post: (_type, value) => { posted = value; } });
    await host.receive({ action: 'text', requestId: 'test', diagnostics: true, messages });
    assert.equal(posted.execution.httpStatus, 200);
    assert.equal(posted.failure.code, code); assert.equal(calls, 1);
    const clientError = Object.assign(new Error(posted.error), { assistantFailure: assistantFailureInfo(posted.failure) });
    const trace = createAssistantTrace('profile', options);
    trace.step('request'); trace.execution(posted.execution); trace.finish(clientError);
    const report = trace.report();
    assert.equal(report.failure.code, code);
    assert.notEqual(report.errorCategory, 'network');
    assert.ok(!JSON.stringify([posted, report]).includes('PRIVATE_REPLY'));
    assert.ok(!JSON.stringify([posted, report]).includes('private-credential'));
    host.destroy();
  }
});

test('non-JSON responses and HTTP failures remain distinct and never leak the response body', async () => {
  for (const [httpStatus, body, contentType, code] of [
    [200, '<html>PRIVATE_REPLY</html>', 'text/html', 'invalid-response'],
    [200, 'data: PRIVATE_REPLY', 'text/event-stream', 'invalid-response'],
    [200, 'null', 'application/json', 'invalid-response'],
    [401, 'PRIVATE_REPLY', 'text/plain', 'authentication'],
    [403, 'PRIVATE_REPLY', 'text/plain', 'permission'],
    [429, 'PRIVATE_REPLY', 'text/plain', 'rate-limit'],
    [503, 'PRIVATE_REPLY', 'text/html', 'upstream'],
  ]) {
    const { context, api } = fixture();
    let calls = 0;
    const access = createTavernTextAccess({ getContext: () => context, loadAPI: async () => api,
      fetcher: async () => { calls++; return new Response(body, { status: httpStatus, headers: { 'Content-Type': contentType } }); } });
    await assert.rejects(access.generate(messages, normalizeAssistant({ tavernModel: 'other' })), (error) => {
      assert.equal(error.assistantFailure.code, code);
      assert.equal(error.assistantFailure.httpStatus, httpStatus);
      assert.ok(!error.message.includes('PRIVATE_REPLY')); return true;
    });
    assert.equal(calls, 1);
  }
});

test('native upstream failures, busy locks, timeouts and unexpected local errors have distinct safe messages', async () => {
  const { context } = fixture();
  context.generateRawData = async () => ({ error: { message: 'invalid_api_key PRIVATE_REPLY', status: 401 } });
  context.extractMessageFromData = () => '';
  const access = createTavernTextAccess({ getContext: () => context });
  await assert.rejects(access.generate(messages, normalizeAssistant()), (error) => error.assistantFailure.code === 'authentication');
  let posted;
  const host = createAssistantHost({ getContext: () => context, settings: () => ({}), isBusy: () => true,
    post: (_type, value) => { posted = value; } });
  await host.receive({ action: 'text', requestId: 'busy', messages });
  assert.equal(posted.failure.code, 'busy'); assert.match(posted.error, /等待/); host.destroy();
  assert.equal(normalizeTavernError(new DOMException('PRIVATE', 'TimeoutError')).assistantFailure.category, 'timeout');
  assert.equal(normalizeTavernError(new TypeError('Failed to fetch')).assistantFailure.category, 'network');
  assert.equal(normalizeTavernError(new TypeError('PRIVATE cannot read properties')).assistantFailure.category, 'local-or-upstream');
  assert.equal(assistantErrorCategory(assistantCallError('authentication')), 'authentication');
});

test('diagnostic failure metadata rejects arbitrary fields, forged categories and provider content', () => {
  assert.deepEqual(assistantFailureInfo({ code: 'model', category: 'network', httpStatus: 200,
    upstreamStatus: 404, parameter: 'SECRET', responseType: 'PRIVATE', message: 'PRIVATE' }),
  { code: 'model', category: 'model', httpStatus: 200, upstreamStatus: 404 });
  assert.equal(assistantFailureInfo({ code: 'PRIVATE' }), undefined);
  const report = createAssistantTrace('profile', normalizeAssistant());
  report.step('parse'); report.finish(new Error('角色草稿不是有效 JSON'));
  assert.equal(report.report().errorCategory, 'response'); assert.equal(report.report().status, 'failed');
  assert.equal(tavernResponseError({ error: true }, { httpStatus: 200 }).assistantFailure.code, 'tavern-failed');
});
