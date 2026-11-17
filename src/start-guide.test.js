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
  assert.equal(chat.some((row) => row.id === 'assistant'), false);
  assert.equal(chat.find((row) => row.id === 'chat').result.canSubmit, true);
  assert.equal(guideSteps({ goal: 'chat' }, { image: configured, assistant: missing, storage: configured,
    chat: { assistant: { autoPrompt: true } } }).some((row) => row.id === 'assistant'), true);
  assert.ok(!guideSteps({ goal: 'manual' }, { image: configured, storage: configured }).some((row) => row.id === 'assistant'));
});
test('typed text failures offer relevant actions without blaming a readable response on device networking', () => {
  for (const category of ['model', 'quota', 'authentication', 'permission', 'parameters', 'compatibility', 'preset']) {
    assert.deepEqual(failureActions({ scope: 'assistant', message: '旧的网络失败提示', diagnostic: { errorCategory: category } }),
      ['assistant-config', 'assistant-diagnostic']);
  }
  assert.deepEqual(failureActions({ scope: 'assistant', diagnostic: { errorCategory: 'response' } }),
    ['assistant-response', 'assistant-config', 'assistant-diagnostic']);
  assert.deepEqual(failureActions({ scope: 'assistant', failure: { category: 'busy' } }), ['assistant-diagnostic']);
  assert.equal(failureActions({ scope: 'assistant', diagnostic: { errorCategory: 'network' } })[0], 'assistant-network');
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
  assert.equal(storageReadiness({ written: true }).code, 'ready');
  assert.equal(storageReadiness({ written: true, error: '保存暂不可用' }).code, 'error');
});

test('an unused independent API credential does not block the current Tavern source', () => {
  const base = { installed: true, tavernCurrent: 'current-model', credentialError: '此秘钥无法读取' };
  assert.equal(assistantReadiness({ ...base, source: 'tavern' }).code, 'configured');
  assert.equal(assistantReadiness({ ...base, source: 'api', endpoint: 'https://example.test', model: 'text' }).code, 'error');
});
test('missing models remain manually usable but do not imply the list validated them', () => {
  const base = { source: 'tavern', installed: true, tavernCurrent: 'removed', modelSource: 'tavern', models: ['available'] };
  assert.equal(assistantReadiness(base).label, '模型未在列表中');
  assert.equal(assistantReadiness(base).canSubmit, true);
  assert.equal(assistantReadiness({ ...base, model: 'available' }).code, 'configured');
  assert.equal(assistantReadiness({ ...base, succeeded: true }).code, 'ready');
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

test('task capacity issues direct users to pending tasks instead of changing their API or deleting images', () => {
  for (const message of [
    '最多保留 100 条任务，请清理已完成记录',
    '最多保留 32 条未完成任务',
    '最多保留 32 个等待或运行任务',
    '还有 32 个生图任务需要处理，请打开“查看待处理任务”',
    '待恢复响应超过 512 MB，请清理已完成任务',
    '待保存的图片响应已达到 512 MB，请打开“查看待处理任务”',
  ]) assert.deepEqual(failureActions({ message }), ['task-records']);
});
test('unapplied outfit validation opens the character controls instead of API or storage configuration', () => {
  for (const message of ['请先填写自定义服装提示词', '请选择有效服装', '服装库已满，请先整理角色档案', '角色或服装配置已变化，请重新生成']) {
    assert.deepEqual(failureActions({ message }), ['outfit-settings']);
  }
});
