export class FirstSuccessVerification {
  constructor() { this.attempts = new Map(); this.recognized = new Map(); this.storageWrites = new Set(); }
  recognize(context, bindings) {
    this.recognized.set(context, new Set(bindings.filter((id) => typeof id === 'string').slice(-100)));
    while (this.recognized.size > 32) this.recognized.delete(this.recognized.keys().next().value);
  }
  begin(context, { id, bindingId = '', requestId = '', storageContext = '' }) {
    this.attempts.set(id, { context, id, bindingId, requestId, storageContext, status: 'queued', generated: false, saved: false, inserted: false, savedIds: [], failure: '' });
    while (this.attempts.size > 100) this.attempts.delete(this.attempts.keys().next().value);
  }
  mark(id, stage, savedIds = []) {
    const attempt = this.attempts.get(id);
    if (!attempt) return;
    if (stage === 'generated') { attempt.generated = true; attempt.failure = ''; }
    if (stage === 'saved' && attempt.generated && savedIds.length) {
      attempt.saved = true; attempt.savedIds = savedIds.slice(0, 32); attempt.failure = '';
      if (attempt.storageContext) this.storageWrites.add(attempt.storageContext);
    }
  }
  storageWritten(context) { return this.storageWrites.has(context); }
  fail(id, phase) {
    const attempt = this.attempts.get(id);
    if (attempt) attempt.failure = attempt.saved ? '图片已保存，后续刷新尚未完成'
      : ['saving', 'task-state', 'refreshing'].includes(phase) ? '保存尚未完成，可在任务记录中核对' : '本次任务未完成，可在任务记录中核对';
  }
  update(id, status, phase) {
    const attempt = this.attempts.get(id);
    if (!attempt) return;
    attempt.status = status;
    if (['queued', 'running', 'completed'].includes(status)) attempt.failure = '';
    else if (status === 'paused') attempt.failure = '任务已暂停，可在任务记录中手动继续';
    else if (['failed', 'uncertain', 'cancelled'].includes(status)) this.fail(id, phase);
  }
  inserted(context, records) {
    for (const attempt of this.attempts.values()) {
      if (attempt.context !== context || !attempt.saved || !attempt.bindingId) continue;
      if (records.some((row) => row.bindingId === attempt.bindingId && row.requestId === attempt.requestId
        && row.imageIds?.some((id) => attempt.savedIds.includes(id)))) attempt.inserted = true;
    }
  }
  result(context, chat = false) {
    const attempt = [...this.attempts.values()].reverse().find((row) => row.context === context && Boolean(row.bindingId) === chat);
    const recognized = attempt ? true : chat && Boolean(this.recognized.get(context)?.size);
    return { recognized, generated: Boolean(attempt?.generated), saved: Boolean(attempt?.saved),
      inserted: Boolean(attempt?.inserted), status: attempt?.status || '', failure: attempt?.failure || '',
      complete: Boolean(attempt?.saved && (!chat || attempt.inserted)) };
  }
}
