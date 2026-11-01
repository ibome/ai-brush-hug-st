import { escapeHtml as esc } from '../config.js';
import { icon, paintIcons } from '../icons.js';
import { debugPhaseTitle } from '../debug-errors.js';
import { runStorageDiagnostics, formatDebugReport } from '../storage-diagnostics.js';
import '../styles/debug-tools.css';

const PROVIDERS = { novelai: 'NovelAI', openai: 'OpenAI 兼容', comfyui: 'ComfyUI', sdwebui: 'SDWebUI', assistant: '提示词助手 · 独立 API' };
const command = (glyph, text, action, disabled = false) =>
  `<button type="button" class="ui-button secondary" data-debug-action="${action}" ${disabled ? 'disabled' : ''}>${icon(glyph)}<span>${text}</span></button>`;
const bytes = (value) => value === null || value === undefined ? '未知' : value < 1024 ? `${value} B`
  : value < 1048576 ? `${(value / 1024).toFixed(1)} KB` : value < 1073741824 ? `${(value / 1048576).toFixed(1)} MB` : `${(value / 1073741824).toFixed(2)} GB`;

export class DebugToolsPanel {
  constructor({ provider, network, networkContext, storageContext, failures }) {
    this.provider = provider; this.network = network; this.networkContext = networkContext;
    this.storageContext = storageContext; this.failures = failures;
    this.busy = false; this.report = null; this.message = ''; this.logOpen = false;
    this.logCreatedAt = new Date().toISOString();
  }
  html() { return `<section class="debug-tools-page" data-debug-root aria-label="调试工具">${this.body()}</section>`; }
  selectProvider(provider) { if (Object.hasOwn(PROVIDERS, provider)) this.provider = provider; }
  body() {
    const recent = this.failures(), latest = this.network.report, report = this.report;
    const hasLog = Boolean(report || latest || recent.length);
    this.logText = formatDebugReport({ storage: report, network: latest, failures: recent, createdAt: this.logCreatedAt });
    return `<div class="page-heading"><div><h1>调试工具</h1><p>当前设备 · ${this.storageContext().storageLocation === 'server' ? '酒馆服务器存图' : '浏览器存图'}</p></div></div>
      <section class="debug-tool-section" aria-labelledby="debug-network-title">
        <div class="debug-tool-heading"><h2 id="debug-network-title">${icon('plug')}网络检测</h2>
          ${latest ? `<span>${esc(PROVIDERS[latest.provider] || '接口')} · ${latest.status === 'cancelled' ? '已停止' : '已有检测记录'}</span>` : ''}</div>
        <div class="debug-tool-toolbar"><label>检测接口<select aria-label="网络检测接口" data-debug-provider>
          ${Object.entries(PROVIDERS).map(([value, title]) => `<option value="${value}" ${this.provider === value ? 'selected' : ''}>${title}</option>`).join('')}</select></label>
          ${command('scan', '检测当前设备网络', 'network')}</div>
      </section>
      <section class="debug-tool-section" aria-labelledby="debug-storage-title">
        <div class="debug-tool-heading"><h2 id="debug-storage-title">${icon('hard-drive')}存储与缓存</h2><span role="status">${this.busy
          ? `正在检测：${esc(report?.current || '准备检查')}` : report ? report.status === 'cancelled' ? '已停止，保留部分结果' : '检测完成' : '待检测'}</span></div>
        <div class="debug-tool-toolbar">${this.busy ? command('square', '停止检测', 'stop') : command('list-checks', report ? '重新检测存储与缓存' : '检测存储与缓存', 'storage')}
          <button type="button" class="ui-button secondary" data-page="settings">${icon('settings-2')}<span>图片存储设置</span></button></div>
        ${report ? `<ul class="debug-checks">${report.checks.map((row) => `<li data-outcome="${esc(row.outcome)}">
          <div>${icon(row.outcome === 'pass' ? 'circle-check' : row.outcome === 'error' ? 'circle-alert' : 'circle')}<strong>${esc(row.label)}</strong>
            <span>${({ pass: '通过', warning: '需留意', error: '异常', unsupported: '未提供', cancelled: '已停止' })[row.outcome] || ''} · ${row.durationMs} ms</span></div>
          <p>${esc(row.detail)}</p>${row.id === 'quota' && row.metrics ? `<dl class="debug-metrics"><div><dt>站点使用估计</dt><dd>${bytes(row.metrics.usage)}</dd></div>
            <div><dt>站点配额估计</dt><dd>${bytes(row.metrics.quota)}</dd></div><div><dt>剩余额度估计</dt><dd>${bytes(row.metrics.remaining)}</dd></div></dl>` : ''}
          ${row.metrics?.counts ? `<div class="debug-counts">${Object.entries(row.metrics.counts).map(([key, value]) =>
            `${esc(({ drawings: '图片', meta: '元数据项', tasks: '任务存储项', assets: '参考素材' })[key] || '存储项')}：${value}`).join(' · ')}</div>` : ''}
          ${row.id === 'server-storage' && row.metrics ? `<div class="debug-counts">账号原图 ${row.metrics.originals ?? '未知'} · 缩略图 ${row.metrics.thumbnails ?? '未知'} · 未配对 ${row.metrics.unmatched ?? '未知'}</div>` : ''}
        </li>`).join('')}</ul>${report.conclusions?.length ? `<ul class="debug-findings">${report.conclusions.map((text) => `<li>${esc(text)}</li>`).join('')}</ul>` : ''}` : ''}
      </section>
      <section class="debug-tool-section" aria-labelledby="debug-failures-title">
        <div class="debug-tool-heading"><h2 id="debug-failures-title">${icon('history')}最近失败记录</h2><span>当前页面 · ${recent.length} 条</span></div>
        ${recent.length ? `<ul class="debug-failures">${recent.slice().reverse().map((row) => `<li>
          <div><strong>${esc(PROVIDERS[row.provider] || '任务')} · ${esc(debugPhaseTitle(row.phase))}</strong><time>${esc(new Date(row.createdAt).toLocaleString())}</time></div>
          <p>${esc(row.message)}</p><small>${esc(row.code)} · ${esc(row.errorName)}${row.httpStatus ? ` · HTTP ${row.httpStatus}` : ''}
            · ${row.storageLocation === 'server' ? '酒馆服务器' : '浏览器'}${row.responseRetained ? ' · 已保留接口响应' : ''}${row.imageSaved ? ' · 图片已保存' : ''}</small>
        </li>`).join('')}</ul>` : '<p class="debug-empty">当前页面暂无生图失败记录</p>'}
      </section>
      <div class="debug-log-toolbar">${command('copy', '复制调试日志', 'copy', this.busy || !hasLog)}${command('download', '下载日志', 'download', this.busy || !hasLog)}
        <span class="debug-message" role="status">${esc(this.message)}</span></div>
      <details class="debug-log" ${this.logOpen ? 'open' : ''}><summary>${icon('list-checks')}调试日志</summary>
        <textarea aria-label="调试日志" readonly rows="10" spellcheck="false">${esc(this.logText)}</textarea></details>`;
  }
  refresh() {
    const root = document.querySelector('[data-debug-root]');
    if (!root) return;
    this.logOpen = root.querySelector('.debug-log')?.open ?? this.logOpen;
    root.innerHTML = this.body(); paintIcons(root);
  }
  async runStorage() {
    if (this.busy) return;
    const controller = new AbortController();
    this.controller = controller; this.busy = true; this.message = ''; this.report = null; this.refresh();
    try {
      this.report = await runStorageDiagnostics(this.storageContext(), { signal: controller.signal,
        onProgress: (report) => { this.report = report; this.refresh(); } });
    } catch { this.message = '检测未完成，已取得的结果仍可复制'; }
    finally { this.busy = false; this.controller = null; this.refresh(); }
  }
  stop() { this.controller?.abort(); }
  async copy() {
    if (this.busy) return;
    try { await navigator.clipboard.writeText(this.logText); this.message = '调试日志已复制，可手动发送给作者'; this.refresh(); }
    catch {
      this.message = '浏览器限制自动复制，请长按下方已选中的日志复制'; this.refresh();
      const details = document.querySelector('[data-debug-root] .debug-log');
      if (details) details.open = true;
      this.logOpen = true;
      const input = document.querySelector('[data-debug-root] [aria-label="调试日志"]');
      input?.focus(); input?.select();
    }
  }
  download() {
    if (this.busy) return;
    const url = URL.createObjectURL(new Blob([this.logText], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = `linghuashi-debug-${new Date().toISOString().slice(0, 10)}.txt`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.message = '日志下载已准备'; this.refresh();
  }
  bind(container) {
    const root = container.querySelector('[data-debug-root]');
    if (!root) return;
    root.addEventListener('change', (event) => { if (event.target.matches('[data-debug-provider]')) this.selectProvider(event.target.value); });
    root.addEventListener('toggle', (event) => { if (event.target.matches('.debug-log')) this.logOpen = event.target.open; }, true);
    root.addEventListener('click', (event) => {
      const action = event.target.closest('[data-debug-action]')?.dataset.debugAction;
      if (action === 'network') this.network.open(this.networkContext(this.provider));
      if (action === 'storage') void this.runStorage();
      if (action === 'stop') this.stop();
      if (action === 'copy') void this.copy();
      if (action === 'download') this.download();
    });
  }
}
