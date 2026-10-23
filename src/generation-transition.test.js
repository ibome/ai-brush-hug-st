import test from 'node:test';
import assert from 'node:assert/strict';
import { generationTransitionState } from './generation-transition.js';

test('queue and confirmation take precedence over stale generation phases', () => {
  assert.equal(generationTransitionState({ status: 'queued', phase: 'saving' }).stage, 'queued');
  const confirm = generationTransitionState({ status: 'confirming', phase: 'submitting' });
  assert.equal(confirm.animated, false);
  assert.equal(confirm.title, '等待确认提示词');
});

test('real retrieval and save states have separate labels and safe cancellation', () => {
  assert.equal(generationTransitionState({ status: 'running', phase: 'retrieving' }).title, '正在取回图片');
  const saving = generationTransitionState({ status: 'running', phase: 'saving', progress: { value: 100, max: 100 } });
  assert.equal(saving.cancellable, false);
  assert.equal(saving.progress, null);
  for (const status of ['completed', 'failed', 'cancelled', 'paused', 'uncertain']) {
    assert.equal(generationTransitionState({ status, phase: 'retrieving' }), null);
  }
});

test('percentages require finite actual node progress and never leak into queue or unknown progress', () => {
  const valid = generationTransitionState({ status: 'running', phase: 'retrieving', progress: { value: 8, max: 20, node: '42' } });
  assert.equal(valid.progress.percent, 40);
  assert.match(valid.detail, /8 \/ 20 · 节点 #42/);
  for (const progress of [undefined, { value: NaN, max: 100 }, { value: 1, max: 0 }, { value: 1, max: Infinity }, { value: -1, max: 10 }, { value: '1', max: 10 }]) {
    assert.equal(generationTransitionState({ status: 'running', phase: 'retrieving', progress }).progress, null);
  }
  assert.equal(generationTransitionState({ status: 'queued', progress: { value: 2, max: 4 } }).progress, null);
});

test('cross-page tasks show static sync status without suggesting local progress or cancel', () => {
  const status = generationTransitionState({ status: 'running', phase: 'saving', progress: { value: 2, max: 4 } }, { remote: true });
  assert.equal(status.animated, false);
  assert.equal(status.cancellable, false);
  assert.equal(status.progress, null);
  assert.equal(status.title, '等待任务状态同步');
});

test('chat preparation distinguishes a local window wait from model analysis', () => {
  const blocked = generationTransitionState({ status: 'preparing', phase: 'window' });
  assert.equal(blocked.title, '等待关闭编辑窗口');
  assert.match(blocked.detail, /尚未提交生图/);
  assert.equal(blocked.cancellable, true);
  const analysis = generationTransitionState({ status: 'preparing', phase: 'analysis' });
  assert.equal(analysis.title, '正在分析画面');
  assert.match(analysis.detail, /文字模型/);
  assert.equal(analysis.progress, null);
  assert.equal(generationTransitionState({ status: 'preparing', phase: 'unknown' }).title, '准备生图');
});
