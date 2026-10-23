import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExperience, imageReadiness, assistantReadiness, storageReadiness, guideSteps, guideStepComplete, failureActions } from './start-guide.js';

test('first-use defaults preserve established users and never change automation', () => {
  assert.equal(normalizeExperience(null).level, 'common');
  assert.deepEqual(normalizeExperience(null, true), { version: 1, level: 'full', goal: '', dismissed: true, completed: false });
  assert.equal(normalizeExperience({ goal: 'comic', level: 'common', dismissed: false }, true).goal, 'comic');
  const configured = { canSubmit: true }, missing = { canSubmit: false };
  const chat = guideSteps({ goal: 'chat' }, { image: configured, assistant: missing, storage: configured,
    chat: { auto: true, inline: true, assistant: { autoPrompt: false } } });
  assert.equal(chat.find((row) => row.id === 'assistant').optional, true);
  assert.equal(chat.find((row) => row.id === 'chat').result.canSubmit, true);
  assert.equal(guideSteps({ goal: 'chat' }, { image: configured, assistant: missing, storage: configured,
    chat: { assistant: { autoPrompt: true } } }).find((row) => row.id === 'assistant').optional, false);
  assert.ok(!guideSteps({ goal: 'manual' }, { image: configured, storage: configured }).some((row) => row.id === 'assistant'));
});

test('image readiness separates configuration, a successful probe and real image verification', () => {
  const input = { provider: 'openai', endpoint: 'https://example.test', hasKey: true, model: 'image-model' };
  assert.equal(imageReadiness({ ...input, hasKey: false }).canSubmit, false);
  assert.equal(imageReadiness({ ...input, endpoint: 'https://secret:password@example.test' }).canSubmit, false);
  assert.equal(imageReadiness(input).code, 'configured');
  assert.equal(imageReadiness({ ...input, probe: { tone: 'success' } }).code, 'configured');
  assert.equal(imageReadiness({ ...input, generated: true }).code, 'ready');
  assert.equal(imageReadiness({ ...input, model: '', generated: true }).canSubmit, false);
  assert.equal(imageReadiness({ ...input, generated: true, credentialError: '保存失败' }).code, 'error');
  assert.equal(imageReadiness({ provider: 'comfyui', endpoint: 'http://localhost:8188', workflowReady: false }).canSubmit, false);
  assert.equal(imageReadiness({ provider: 'sdwebui', endpoint: 'http://localhost:7860' }).canSubmit, true);
  assert.equal(imageReadiness({ provider: 'novelai', hasKey: true, route: 'unknown', model: 'nai-diffusion-4-5-full' }).canSubmit, false);
});

test('first-use completion excludes pending or failed probes while allowing configured accounts', () => {
  assert.equal(guideStepComplete({ result: { code: 'error', canSubmit: true } }), false);
  assert.equal(guideStepComplete({ result: { code: 'checking', canSubmit: true } }), false);
  assert.equal(guideStepComplete({ result: { code: 'configured', canSubmit: true } }), true);
  assert.equal(guideStepComplete({ optional: true, result: { code: 'missing', canSubmit: false } }), true);
});

test('text model enumeration and readable storage do not claim paid calls or writes succeeded', () => {
  const a = { source: 'api', endpoint: 'https://example.test/v1', model: 'text-model', hasKey: true };
  assert.equal(assistantReadiness({ ...a, modelSource: 'api' }).code, 'configured');
  assert.equal(assistantReadiness({ ...a, succeeded: true }).code, 'ready');
  assert.equal(assistantReadiness({ ...a, model: '' }).canSubmit, false);
  assert.equal(assistantReadiness({ source: 'tavern', installed: true }).code, 'unverified');
  assert.equal(assistantReadiness({ source: 'tavern', installed: false }).canSubmit, false);
  assert.equal(storageReadiness({ location: 'server', installed: false }).canSubmit, false);
  assert.equal(storageReadiness({ error: 'storage offline' }).code, 'error');
  assert.match(storageReadiness({}).detail, /尚未进行写入测试/);
});

test('failure actions prioritize recovery and never resubmit uncertain generation', () => {
  assert.deepEqual(failureActions({ phase: 'saving', execution: true, status: 'failed' }),
    ['task-retry', 'storage-check', 'storage-settings', 'backup-settings']);
  assert.ok(!failureActions({ execution: false, status: 'uncertain', stage: 'submitting' }).includes('task-retry'));
  assert.ok(failureActions({ execution: true, status: 'uncertain' }).includes('task-retry'));
  assert.ok(!failureActions({ execution: true, status: 'running' }).includes('task-retry'));
  assert.ok(failureActions({ scope: 'assistant', message: 'JSON 解析失败' }).includes('assistant-response'));
  assert.ok(!failureActions({ scope: 'assistant', message: '连接超时' }).includes('assistant-response'));
});
