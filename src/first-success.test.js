import test from 'node:test';
import assert from 'node:assert/strict';
import { FirstSuccessVerification } from './first-success.js';

test('first success requires actual image, storage and matching chat load evidence from the same attempt', () => {
  const proof = new FirstSuccessVerification(), context = 'current-api:model:browser:chat';
  proof.recognize(context, ['binding']);
  assert.deepEqual(proof.result(context, true), { recognized: true, generated: false, saved: false, inserted: false, status: '', failure: '', complete: false });
  proof.begin(context, { id: 'task', bindingId: 'binding', requestId: 'request' });
  proof.mark('task', 'saved', ['image']);
  assert.equal(proof.result(context, true).saved, false);
  proof.mark('task', 'generated'); proof.mark('task', 'saved', ['image']);
  const receipt = { bindingId: 'binding', requestId: 'request', imageIds: ['image'] };
  for (const invalid of [{ ...receipt, bindingId: 'other' }, { ...receipt, requestId: 'old' }, { ...receipt, imageIds: ['old-image'] }]) {
    proof.inserted(context, [invalid]);
    assert.equal(proof.result(context, true).inserted, false);
  }
  proof.inserted('other-api:model:browser:chat', [receipt]);
  assert.equal(proof.result(context, true).complete, false);
  proof.inserted(context, [receipt]);
  assert.equal(proof.result(context, true).complete, true);
});

test('new attempts and configuration, storage, chat and manual scopes cannot borrow a previous success', () => {
  const proof = new FirstSuccessVerification();
  proof.begin('api:browser:one', { id: 'old', bindingId: 'binding', requestId: 'old' });
  proof.mark('old', 'generated'); proof.mark('old', 'saved', ['old-image']);
  proof.inserted('api:browser:one', [{ bindingId: 'binding', requestId: 'old', imageIds: ['old-image'] }]);
  proof.begin('api:browser:one', { id: 'new', bindingId: 'binding', requestId: 'new' });
  assert.equal(proof.result('api:browser:one', true).saved, false);
  for (const context of ['api:server:one', 'api:browser:two', 'other:browser:one']) {
    assert.equal(proof.result(context, true).complete, false);
  }
  assert.equal(proof.result('api:browser:one', false).complete, false);
  proof.begin('api:browser:one', { id: 'manual' });
  proof.mark('manual', 'generated'); proof.fail('manual', 'saving');
  assert.equal(proof.result('api:browser:one').saved, false);
  assert.match(proof.result('api:browser:one').failure, /保存尚未完成/);
  proof.mark('manual', 'saved', ['manual-image']);
  assert.equal(proof.result('api:browser:one').complete, true);
  assert.equal(proof.result('api:browser:one').failure, '');
  assert.equal(new FirstSuccessVerification().result('api:browser:one').complete, false);
});

test('save and display recovery clears stale errors without inventing image or chat evidence', () => {
  const proof = new FirstSuccessVerification(), context = 'api:browser:chat';
  proof.begin(context, { id: 'task', bindingId: 'binding', requestId: 'request' });
  proof.mark('task', 'generated');
  proof.update('task', 'failed', 'saving');
  assert.match(proof.result(context, true).failure, /保存尚未完成/);
  proof.update('task', 'queued');
  assert.equal(proof.result(context, true).failure, '');
  assert.equal(proof.result(context, true).generated, true);
  assert.equal(proof.result(context, true).saved, false);
  proof.update('task', 'running');
  proof.mark('task', 'saved', ['image']);
  proof.update('task', 'failed', 'refreshing');
  assert.match(proof.result(context, true).failure, /图片已保存/);
  proof.update('task', 'completed');
  assert.equal(proof.result(context, true).failure, '');
  assert.equal(proof.result(context, true).complete, false);
  proof.inserted(context, [{ bindingId: 'binding', requestId: 'request', imageIds: ['image'] }]);
  assert.equal(proof.result(context, true).complete, true);
  proof.begin(context, { id: 'unfinished' });
  proof.update('unfinished', 'paused');
  assert.match(proof.result(context).failure, /任务已暂停/);
  proof.update('unfinished', 'completed');
  assert.equal(proof.result(context).saved, false);
});

test('storage evidence follows actual writes to an account and location across chat and model changes', () => {
  const proof = new FirstSuccessVerification();
  proof.begin('api:model:chat-one', { id: 'saved', storageContext: 'account-one:browser' });
  proof.mark('saved', 'saved', ['image']);
  assert.equal(proof.storageWritten('account-one:browser'), false);
  proof.mark('saved', 'generated'); proof.mark('saved', 'saved', ['image']);
  proof.begin('other-api:other-model:chat-two', { id: 'pending', storageContext: 'account-one:browser' });
  assert.equal(proof.storageWritten('account-one:browser'), true);
  assert.equal(proof.storageWritten('account-one:server'), false);
  assert.equal(proof.storageWritten('account-two:browser'), false);
  assert.equal(new FirstSuccessVerification().storageWritten('account-one:browser'), false);
});
