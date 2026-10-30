import test from 'node:test';
import assert from 'node:assert/strict';
import { canRecoverGeneration, unusableGenerationResponse, INVALID_IMAGE_RESPONSE } from './generation-recovery.js';
import { failureActions } from './start-guide.js';

test('invalid image responses and old saved error messages cannot resume downloading', () => {
  for (const error of [
    '接口没有返回可用图片；不支持异步任务式图片响应',
    '服务返回的内容不是图片、ZIP 或图片 JSON',
    '图片响应缺少 b64_json 或 url',
    'NovelAI 图片响应缺少 image',
    '服务返回的图片地址不可使用',
    '图片 Base64 内容无效',
    '接口未返回可用图片：图片响应格式无效。请检查接口地址和返回格式，修正后重新生成',
  ]) {
    const task = { status: 'failed', execution: { size: 100 }, error };
    assert.equal(unusableGenerationResponse(task), true);
    assert.equal(canRecoverGeneration(task), false);
    assert.ok(!failureActions({ ...task, message: error }).includes('task-retry'));
  }
  assert.equal(canRecoverGeneration({ status: 'paused', execution: true,
    diagnostic: { code: INVALID_IMAGE_RESPONSE } }), false);
});

test('download and saving failures retain recovery while unaccepted submissions do not', () => {
  for (const status of ['failed', 'paused', 'uncertain']) {
    assert.equal(canRecoverGeneration({ status, execution: { size: 100 }, error: '网络请求失败' }), true);
    assert.equal(canRecoverGeneration({ status, execution: { promptId: 'accepted' } }), true);
  }
  assert.equal(canRecoverGeneration({ status: 'failed', stage: 'waiting' }), true);
  assert.equal(canRecoverGeneration({ status: 'uncertain', stage: 'submitting' }), false);
  assert.equal(canRecoverGeneration({ status: 'uncertain', stage: 'waiting' }), false);
  for (const status of ['running', 'queued', 'completed', 'cancelled']) {
    assert.equal(canRecoverGeneration({ status, execution: true }), false);
  }
});
