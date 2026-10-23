export class UIStateSync {
  constructor({ timeout = 8000, changed = () => {} } = {}) {
    Object.assign(this, { timeout, changed });
    this.value = { status: 'idle', requestId: '', error: '' };
  }
  set(value) { this.value = value; this.changed({ ...value }); }
  begin(requestId) {
    clearTimeout(this.timer);
    this.set({ status: 'pending', requestId, error: '' });
    this.timer = setTimeout(() => this.set({ status: 'unconfirmed', requestId, error: '酒馆尚未确认接收，请重试保存' }), this.timeout);
    this.timer?.unref?.();
  }
  receive(requestId, error = '') {
    if (!requestId || requestId !== this.value.requestId) return;
    clearTimeout(this.timer);
    this.set({ status: error ? 'error' : 'received', requestId, error: error ? '酒馆未能接收设置，请重试保存' : '' });
  }
}
