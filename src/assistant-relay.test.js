import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssistantRelay } from './assistant-relay.js';
import { normalizeAssistant, requestAssistantModels, requestAssistantText } from './prompt-assistant.js';
import { createAssistantHost } from './assistant-host.js';
import { createAssistantTrace } from './assistant-diagnostics.js';
import { saveAssistantScheme, exportAssistantSchemes, importAssistantSchemes } from './assistant-schemes.js';

const settings = { source: 'api', apiTransport: 'tavern', endpoint: 'https://relay.test/customer/v1/',
  model: 'independent-model', maxTokens: 4000, temperature: 0.6 };
const key = 'fixture-independent-key';
const messages = [{ role: 'system', content: 'fixture rules' }, { role: 'user', content: 'fixture input' }];
const raw = '{"shouldDraw":true,"positive":"reading","negative":"","scene":"reading","aspect":"square"}';
const completion = { choices: [{ message: { content: raw }, finish_reason: 'stop' }] };
const context = { mainApi: 'openai', chatCompletionSettings: { custom_model: 'chat-model', custom_url: 'https://chat.test/v1' },
  getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'x-csrf-token': 'fixture-csrf' }) };

test('relay selection defaults to direct and survives assistant scheme export without credentials', () => {
  assert.equal(normalizeAssistant().apiTransport, 'direct');
  assert.equal(normalizeAssistant({ apiTransport: 'invalid' }).apiTransport, 'direct');
  const { library } = saveAssistantScheme([], { name: 'relay', settings });
  const exported = exportAssistantSchemes(library);
  assert.equal(importAssistantSchemes([], exported)[0].settings.apiTransport, 'tavern');
  assert.equal(exported.schemes[0].settings.keyRef, undefined);
});

test('model relay uses normalized URLs, authenticated Tavern headers and its own explicit API key', async () => {
  const before = structuredClone(context.chatCompletionSettings);
  for (const suffix of ['', '/', '/v1', '/v1/', '/v1/models/', '/v1/chat/completions/']) {
    let count = 0;
    const relay = createAssistantRelay({ getContext: () => context, fetcher: async (url, init) => {
      count++;
      assert.equal(url, '/api/backends/chat-completions/status');
      assert.equal(init.credentials, 'same-origin');
      assert.equal(init.headers['x-csrf-token'], 'fixture-csrf');
      const body = JSON.parse(init.body);
      assert.equal(body.custom_url, 'https://relay.test/customer/v1');
      assert.equal(body.chat_completion_source, 'custom');
      assert.equal(body.custom_api_format, 'openai_compat');
      assert.deepEqual(JSON.parse(body.custom_include_headers), { Authorization: `Bearer ${key}` });
      assert.equal(body.secret_id, undefined);
      assert.equal(body.messages, undefined);
      return Response.json({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }] });
    } });
    assert.deepEqual(await relay.request('models', { settings: { ...settings, endpoint: `https://relay.test/customer${suffix}` }, key }), ['a', 'b']);
    assert.equal(count, 1);
  }
  assert.deepEqual(context.chatCompletionSettings, before);
});

test('relay preserves message and preset order plus text, JSON and tool response contracts', async () => {
  const sentMessages = [...messages, { role: 'assistant', content: 'fixture example' }];
  for (const responseMode of ['text', 'json', 'tool']) {
    const execution = [];
    const relay = createAssistantRelay({ getContext: () => context, fetcher: async (url, init) => {
      assert.equal(url, '/api/backends/chat-completions/generate');
      const body = JSON.parse(init.body), extras = JSON.parse(body.custom_include_body);
      assert.deepEqual(body.messages, sentMessages);
      assert.equal(body.model, 'independent-model');
      assert.equal(body.max_tokens, 4000);
      assert.equal(body.temperature, 0.6);
      assert.equal(body.stream, false);
      assert.equal(body.custom_prompt_post_processing, undefined);
      if (responseMode === 'json') assert.deepEqual(extras.response_format, { type: 'json_object' });
      if (responseMode === 'tool') {
        assert.equal(extras.parallel_tool_calls, false);
        assert.equal(body.tools[0].function.name, 'submit_linghuashi_result');
        return Response.json({ choices: [{ message: { tool_calls: [{ function: {
          name: 'submit_linghuashi_result', arguments: JSON.stringify({ result: raw }),
        } }] }, finish_reason: 'tool_calls' }] });
      }
      return Response.json(completion);
    } });
    assert.equal(await relay.request('text', { settings: { ...settings, responseMode }, key, messages: sentMessages },
      { onExecution: (value) => execution.push(value) }), raw);
    assert.equal(execution.at(-1).route, 'independent-tavern');
    assert.equal(execution.at(-1).httpStatus, 200);
    assert.equal(execution.at(-1).model, settings.model);
  }
});

test('read-only relay probes never borrow saved custom credentials and expose no upstream payload', async () => {
  const requests = [];
  const relay = createAssistantRelay({ getContext: () => context, fetcher: async (url, init) => {
    requests.push(JSON.parse(init.body));
    return Response.json({ error: true, message: `Bearer ${key} private path`, data: [] });
  } });
  for (const probeKey of ['', key]) {
    const result = await relay.request('probe', { settings, key: probeKey });
    assert.equal(result.outcome, 'relay-error');
    assert.equal(result.httpStatus, 200);
    assert.doesNotMatch(JSON.stringify(result), /fixture-independent-key|private path/);
  }
  assert.deepEqual(requests.map((row) => JSON.parse(row.custom_include_headers).Authorization), ['', `Bearer ${key}`]);
  assert.ok(requests.every((row) => !row.model && !row.messages && !row.secret_id));
});

test('relay errors stay sanitized and never retry or fall back to browser requests', async () => {
  for (const response of [() => new Response('private', { status: 403 }),
    () => new Response('<html>private</html>'), () => Response.json({ error: { message: 'private' } }),
    () => { throw new TypeError(`private ${key}`); }]) {
    let calls = 0;
    const relay = createAssistantRelay({ getContext: () => context, fetcher: async () => { calls++; return response(); } });
    await assert.rejects(relay.request('text', { settings, key, messages }),
      (error) => !/private|fixture-independent-key/.test(error.message));
    assert.equal(calls, 1);
  }
});

test('relay validates input and supports cancellation before and during a request', async () => {
  let count = 0, captured;
  const relay = createAssistantRelay({ getContext: () => context, fetcher: async (_url, { signal }) => {
    count++; captured = signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  await assert.rejects(relay.request('text', { settings, key: 'invalid\nkey', messages }), /无效/);
  await assert.rejects(relay.request('text', { settings, key, messages: [] }), /格式/);
  await assert.rejects(relay.request('models', { settings: { ...settings, apiTransport: 'direct' }, key }), /酒馆转发/);
  assert.equal(count, 0);
  const controller = new AbortController();
  const pending = relay.request('models', { settings, key }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(captured.aborted, true);
  await assert.rejects(relay.request('models', { settings, key }, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(count, 1);
});

test('relay deadline remains active on older browsers without AbortSignal.any', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const relay = createAssistantRelay({ getContext: () => context, fetcher: (_url, { signal }) =>
    new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
  const pending = relay.request('models', { settings, key });
  t.mock.timers.tick(15001);
  await assert.rejects(pending, { name: 'TimeoutError' });
});

test('common assistant entry points dispatch relay calls without direct network access', async () => {
  const calls = [], executions = [];
  const relay = async (action, value) => {
    calls.push({ action, value });
    return action === 'models' ? ['independent-model'] : { text: raw,
      execution: { model: settings.model, source: 'openai-compatible', route: 'independent-tavern' } };
  };
  const fetcher = () => assert.fail('direct fetch must not run');
  assert.deepEqual(await requestAssistantModels(settings, key, { relay, fetcher }), ['independent-model']);
  assert.equal(await requestAssistantText(settings, key, messages, { relay, fetcher, onExecution: (row) => executions.push(row) }), raw);
  assert.deepEqual(calls.map((row) => row.action), ['models', 'text']);
  assert.equal(calls[1].value.key, key);
  assert.deepEqual(calls[1].value.messages, messages);
  assert.equal(executions.at(-1).route, 'independent-tavern');
  await assert.rejects(requestAssistantModels(settings, key), /酒馆内使用/);
});

test('host relay bridge returns execution metadata and forwards cancellation', async () => {
  const results = [];
  let captured;
  const host = createAssistantHost({ getContext: () => context, settings: () => ({}),
    post: (_type, value) => results.push(value), relay: { async request(action, value, options) {
      if (action === 'text') { options.onExecution({ route: 'independent-tavern', model: value.settings.model }); return raw; }
      captured = options.signal;
      return new Promise((_resolve, reject) => captured.addEventListener('abort', () => reject(captured.reason), { once: true }));
    } } });
  await host.receive({ requestId: 'text', action: 'relay-text', settings, key, messages, diagnostics: true });
  assert.equal(results[0].value.execution.route, 'independent-tavern');
  assert.equal(results[0].value.text, raw);
  const pending = host.receive({ requestId: 'models', action: 'relay-models', settings, key });
  await host.receive({ requestId: 'models', action: 'cancel' });
  await pending;
  assert.equal(captured.aborted, true);
  assert.match(results.at(-1).error, /取消/);
  host.destroy();
});

test('assistant trace identifies relay but omits credentials, path and message contents', () => {
  const trace = createAssistantTrace('generate', settings);
  trace.execution({ route: 'independent-tavern', model: settings.model });
  trace.request(messages);
  trace.finish();
  const report = trace.report();
  assert.equal(report.apiTransport, 'tavern');
  assert.equal(report.execution.route, 'independent-tavern');
  assert.doesNotMatch(JSON.stringify(report), /fixture rules|fixture input|customer|fixture-independent-key/);
});
