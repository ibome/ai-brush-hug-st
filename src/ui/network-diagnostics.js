import { escapeHtml as esc } from '../config.js';
import { icon, paintIcons } from '../icons.js';
import { formatNetworkDiagnostics, runNetworkDiagnostics } from '../network-diagnostics.js';

const command = (glyph, title, action, disabled = false) =>
  `<button type="button" class="ui-button secondary" data-network-action="${action}" ${disabled ? 'disabled' : ''}>${icon(glyph)}<span>${title}</span></button>`;
const outcomeTitle = (row) => row.outcome === 'http' ? `HTTP ${row.httpStatus}` : ({
  opaque: '不透明响应', timeout: '超时', 'network-error': '请求失败', 'mixed-content': '协议冲突',
  'relay-ok': '转发通过', 'relay-empty': '模型列表为空', 'relay-error': '转发未通过',
  csp: '策略拦截', 'invalid-header': '认证字符异常', cancelled: '已取消',
})[row.outcome] || '待检测';

export class NetworkDiagnosticPanel {
  constructor({ context, relayProbe, onClose = () => {} }) { this.context = context; this.relayProbe = relayProbe; this.onClose = onClose; }
  open(source) {
    if (this.dialog?.isConnected) { this.dialog.focus(); return; }
    this.source = { ...(source || this.context()) };
    this.report = null; this.busy = false; this.message = '';
    const dialog = document.createElement('dialog');
    const relay = this.source.provider === 'assistant' && this.source.apiTransport === 'tavern';
    dialog.className = 'network-diagnostic-dialog';
    dialog.setAttribute('aria-labelledby', 'network-diagnostic-title');
    dialog.innerHTML = `<header><div><h2 id="network-diagnostic-title">${relay ? '酒馆转发网络检测' : '当前设备网络检测'}</h2><p>${relay ? '当前浏览器 → 酒馆 → 独立 API' : '当前浏览器 → 当前接口'}</p></div>
      <button type="button" class="ui-icon-button" data-network-action="close" title="关闭" aria-label="关闭网络检测">${icon('x')}</button></header>
      <div class="network-diagnostic-body"><p class="network-diagnostic-scope">只读检测，不提交生图或文字生成请求。日志已隐藏秘钥，不会自动发送。</p>
      <p class="network-diagnostic-progress" role="status" aria-live="polite"></p><ol class="network-diagnostic-results"></ol>
      <div class="network-diagnostic-findings"></div>
      <details class="network-diagnostic-log"><summary>${icon('list-checks')}诊断日志</summary>
        <textarea aria-label="诊断日志" rows="9" readonly spellcheck="false"></textarea></details></div>
      <footer><span class="network-diagnostic-message" role="status"></span><div class="network-diagnostic-actions"></div></footer>`;
    document.body.append(dialog);
    this.dialog = dialog;
    dialog.addEventListener('click', (event) => {
      const action = event.target.closest('[data-network-action]')?.dataset.networkAction;
      if (action === 'close') this.close();
      if (action === 'cancel') this.controller?.abort();
      if (action === 'run') void this.run();
      if (action === 'copy') void this.copy();
      if (action === 'download') this.download();
    });
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); this.close(); });
    dialog.addEventListener('close', () => {
      this.controller?.abort();
      dialog.remove();
      if (this.dialog === dialog) this.dialog = null;
      this.onClose();
    }, { once: true });
    dialog.showModal(); paintIcons(dialog); void this.run();
  }
  close() { this.controller?.abort(); this.dialog?.close(); }
  refresh() {
    const dialog = this.dialog;
    if (!dialog?.isConnected) return;
    const report = this.report;
    dialog.querySelector('.network-diagnostic-progress').textContent = this.busy
      ? `正在检测：${report?.current || '准备检查'}`
      : report?.status === 'cancelled' ? '已取消，保留已完成的检查结果' : '检测完成';
    dialog.querySelector('.network-diagnostic-results').innerHTML = (report?.checks || []).map((row) => {
      const tone = row.outcome === 'relay-ok' || row.outcome === 'http' && (row.httpStatus < 400 || !row.authenticated && [401, 404, 405].includes(row.httpStatus))
        ? 'success' : ['opaque', 'relay-empty'].includes(row.outcome) ? 'warning' : 'error';
      return `<li data-tone="${tone}"><div>${icon(tone === 'success' ? 'circle-check' : tone === 'warning' ? 'circle' : 'circle-alert')}
        <strong>${esc(row.label)}</strong><span>${esc(outcomeTitle(row))} · ${row.durationMs} ms</span></div>
        <small>${esc(row.url)}</small><p>${esc(row.detail)}</p></li>`;
    }).join('');
    dialog.querySelector('.network-diagnostic-findings').innerHTML = `${report?.note ? `<p>${esc(report.note)}</p>` : ''}${report?.conclusions?.length
      ? `<h3>检查结果</h3><ul>${report.conclusions.map((text) => `<li>${esc(text)}</li>`).join('')}</ul>` : ''}`;
    dialog.querySelector('[aria-label="诊断日志"]').value = report ? formatNetworkDiagnostics(report) : '';
    dialog.querySelector('.network-diagnostic-message').textContent = this.message;
    dialog.querySelector('.network-diagnostic-actions').innerHTML = `${this.busy ? command('square', '停止检测', 'cancel')
      : command('refresh-cw', '重新检测', 'run')}${command('copy', '复制诊断日志', 'copy', this.busy || !report)}
      ${command('download', '下载日志', 'download', this.busy || !report)}`;
    paintIcons(dialog);
  }
  async run() {
    if (this.busy || !this.dialog?.isConnected) return;
    const dialog = this.dialog, controller = new AbortController();
    this.controller = controller; this.busy = true; this.message = ''; this.report = null; this.refresh();
    try {
      const report = await runNetworkDiagnostics(this.source, {
        signal: controller.signal, relayProbe: this.relayProbe,
        onProgress: (report) => { if (this.dialog === dialog) { this.report = report; this.refresh(); } },
      });
      if (this.dialog === dialog) this.report = report;
    } catch {
      if (this.dialog === dialog) this.message = '检测未能完成，请重新检测；已完成的结果仍可复制。';
    } finally {
      if (this.dialog === dialog) { this.busy = false; this.controller = null; this.refresh(); }
    }
  }
  async copy() {
    if (this.busy || !this.report || !this.dialog?.isConnected) return;
    const dialog = this.dialog, text = formatNetworkDiagnostics(this.report);
    try {
      await navigator.clipboard.writeText(text);
      if (this.dialog === dialog) { this.message = '诊断日志已复制，可手动发送给作者'; this.refresh(); }
    } catch {
      if (this.dialog !== dialog) return;
      this.message = '浏览器限制自动复制，请长按下方已选中的日志复制';
      this.refresh();
      dialog.querySelector('.network-diagnostic-log').open = true;
      const input = dialog.querySelector('[aria-label="诊断日志"]');
      input.focus(); input.select();
    }
  }
  download() {
    if (this.busy || !this.report) return;
    const url = URL.createObjectURL(new Blob([formatNetworkDiagnostics(this.report)], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = `linghuashi-network-${this.report.createdAt.slice(0, 10)}.txt`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.message = '日志下载已准备'; this.refresh();
  }
}
