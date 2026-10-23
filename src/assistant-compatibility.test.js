import test from 'node:test';
import assert from 'node:assert/strict';
import { compatibilityIdentity, compatibilityFor, resolveAssistantCompatibility, saveCompatibility, assistantBudget } from './assistant-compatibility.js';
import { normalizeAssistant, requestAssistantText } from './prompt-assistant.js';
import { createAssistantRelay } from './assistant-relay.js';
import { extractAssistantResponse } from './assistant-response.js';

const settings = normalizeAssistant({ source: 'api', endpoint: 'https://example.test/team/', model: 'model-a' });
test('compatibility profiles normalize endpoint suffixes, isolate interfaces and models, and retain explicit task mode', () => {
  const profiles = saveCompatibility(settings, {}, { responseMode: 'tool', outputParameter: 'max_completion_tokens', omitTemperature: true, outputLimit: 12000 });
  const current = normalizeAssistant({ ...settings, compatibilityProfiles: profiles });
  assert.equal(compatibilityFor({ ...current, endpoint: 'https://example.test/team/v1/chat/completions/' }, {}).responseMode, 'tool');
  assert.equal(compatibilityFor({ ...current, model: 'model-b' }, {}), null);
  assert.equal(compatibilityFor({ ...current, endpoint: 'https://other.test/team' }, {}), null);
  assert.equal(resolveAssistantCompatibility({ ...current, responseModeOverride: 'text' }, {}).responseMode, 'text');
  const tavern = { ...current, source: 'tavern', tavernModel: '' };
  const a = compatibilityIdentity(tavern, { currentModel: 'm', tavernIdentity: 'interface-a' });
  const b = compatibilityIdentity(tavern, { currentModel: 'm', tavernIdentity: 'interface-b' });
  assert.notEqual(a, b);
  assert.throws(() => saveCompatibility({ ...settings, model: '' }, {}, {}), /接口和文字模型/);
});
test('unknown model limits remain unknown, estimates warn without altering enabled preset messages', () => {
  const messages = [{ role: 'system', content: '规则'.repeat(4000) }, { role: 'user', content: 'story' }];
  const before = structuredClone(messages);
  assert.equal(assistantBudget(messages, settings).warnings.length, 0);
  const budget = assistantBudget(messages, { ...settings, maxTokens: 4000, contextWindow: 1000, outputLimit: 2000 }, { operation: 'comic', units: 8 });
  assert.equal(budget.warnings.length, 2);
  assert.match(budget.error, /超过/);
  assert.deepEqual(messages, before);
});
test('direct and Tavern relay requests support completion token naming and omit temperature without retries', async () => {
  const options = { ...settings, outputParameter: 'max_completion_tokens', omitTemperature: true };
  const messages = [{ role: 'system', content: 'fixture rules' }, { role: 'user', content: 'fixture' }];
  let direct = 0, forwarded = 0;
  const response = { choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] };
  assert.equal(await requestAssistantText(options, 'fixture-key', messages, { fetcher: async (_, init) => {
    direct++; const body = JSON.parse(init.body);
    assert.equal(body.max_completion_tokens, 4000);
    assert.equal(body.max_tokens, undefined); assert.equal(body.temperature, undefined);
    return Response.json(response);
  } }), '{"ok":true}');
  const relay = createAssistantRelay({ getContext: () => ({ getRequestHeaders: () => ({}) }), fetcher: async (_, init) => {
    forwarded++; const body = JSON.parse(init.body), extra = JSON.parse(body.custom_include_body);
    assert.equal(extra.max_completion_tokens, 4000); assert.equal(extra.temperature, undefined);
    assert.deepEqual(JSON.parse(body.custom_exclude_body), ['temperature', 'max_tokens']);
    return Response.json(response);
  } });
  assert.equal(await relay.request('text', { settings: { ...options, apiTransport: 'tavern' }, key: 'fixture-key', messages }), '{"ok":true}');
  assert.equal(direct, 1); assert.equal(forwarded, 1);
});
test('truncated response stays recoverable with a specific flag', () => {
  assert.throws(() => extractAssistantResponse({ choices: [{ message: { content: '{"panels":[' }, finish_reason: 'length' }] }),
    (error) => error.assistantTruncated === true && error.assistantResponse === '{"panels":[');
});
