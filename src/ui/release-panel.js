import { escapeHtml as esc } from '../config.js';
import { icon, paintIcons } from '../icons.js';
import { RELEASE } from '../release.js';
import { getReleaseState, subscribeReleaseState, checkReleaseVersion, isInstalled, storageRequest,
  openExtensionManager, updateExtensionVersion, reloadUpdatedExtension } from '../runtime.js';
import { updateMascots } from './update-mascots.js';

const button = (glyph, label, action, disabled = false, primary = false) =>
  `<button type="button" class="ui-button ${primary ? '' : 'secondary'}" data-release-action="${action}" ${disabled ? 'disabled' : ''}>${icon(glyph)}<span>${label}</span></button>`;

export class ReleasePanel {
  constructor({ getTheme, beforeUpdate, onChange }) {
    Object.assign(this, { getTheme, beforeUpdate, onChange });
    this.open = true;
    this.state = getReleaseState();
    this.busy = false;
    this.message = '';
    this.error = '';
    this.updated = null;
    this.backend = null;
    subscribeReleaseState((value) => {
      const previous = this.state.release;
      this.state = value;
      if (this.hasUpdate && (!previous?.newer || previous.version !== value.release.version)) this.open = true;
      this.refresh();
    });
  }
  get hasUpdate() { return Boolean(this.state.release?.newer && !this.updated); }
  html() { return `<details class="settings-band backup-band release-band" data-release-fold ${this.open ? 'open' : ''}>${this.body()}</details>`; }
  body() {
    const latest = this.state.release, newer = this.hasUpdate, disabled = this.busy;
    const theme = this.getTheme();
    return `<summary>${icon('refresh-cw')}<span>版本与更新</span>${newer ? `<span class="release-new">有更新 v${esc(latest.version)}</span>` : ''}${icon('chevron-down')}</summary>
      ${newer ? `<div class="release-announcement"><img src="${updateMascots[theme] || updateMascots.whale}" alt="" width="128" height="128" decoding="async" /><div><strong>插件更新啦！</strong><p>v${esc(RELEASE.version)} ${icon('arrow-right')} v${esc(latest.version)}</p>
        ${isInstalled() ? button('download', this.busy ? '正在更新…' : '立即更新', 'install', disabled, true) : ''}</div></div>` : ''}
      <dl class="backup-version"><div><dt>前端版本</dt><dd>v${esc(RELEASE.version)}${this.updated ? ` · 已下载 v${esc(this.updated.version)}` : ''}</dd></div><div><dt>服务器组件</dt><dd>${esc(this.backend
        ? this.backend.enhanced === 'unsupported' ? '内置本机存储 · 不支持服务端增强组件'
          : this.backend.version === 'native' ? '内置账号存储 · 增强组件未安装'
          : `${this.backend.version} · ${this.backend.protocol === RELEASE.storageProtocol ? '协议兼容' : '需同步更新'}` : '尚未检查')}</dd></div></dl>
      <div class="backup-actions">${this.updated ? button('rotate-cw', '刷新酒馆以生效', 'reload', disabled, true) : ''}
        ${button('refresh-cw', this.state.status === 'checking' ? '正在检查…' : '检查版本', 'check', disabled || this.state.status === 'checking')}
        ${isInstalled() ? button('settings-2', '打开扩展管理', 'manager', disabled) : ''}
        ${newer ? `<a class="ui-button secondary" href="${esc(latest.url)}" target="_blank" rel="noopener noreferrer">${icon('external-link')}查看新版与下载</a>` : ''}
        <a class="ui-button secondary" href="${RELEASE.url}" target="_blank" rel="noopener noreferrer">${icon('external-link')}安装仓库</a>
        <a class="ui-button secondary" href="${RELEASE.url}/releases" target="_blank" rel="noopener noreferrer">${icon('history')}发布与回退</a></div>
      <p class="release-status ${this.error ? 'release-error' : ''}" role="status" aria-live="polite">${esc(this.error || this.message || latest?.message || '尚未检查新版本')}${this.state.error && latest ? ' · 显示上次检查结果' : ''}</p>
      ${this.state.error ? `<p class="backup-status">${esc(this.state.error)}</p>` : ''}
      ${newer ? '<p class="backup-status">更新前请等待任务完成。ZIP 安装请下载前端包手动覆盖；服务器组件需另行更新。</p>' : ''}
      ${latest?.notes ? `<pre class="backup-notes" aria-label="更新动态">${esc(latest.notes)}</pre>` : ''}
      ${this.state.checkedAt ? `<small>检查时间：${esc(new Date(this.state.checkedAt).toLocaleString('zh-CN', { hour12: false }))}</small>` : ''}`;
  }
  refresh() {
    this.onChange?.();
    const root = document.querySelector('[data-release-fold]');
    if (!root) return;
    const action = root.contains(document.activeElement) ? document.activeElement.dataset.releaseAction : null;
    root.open = this.open;
    root.innerHTML = this.body();
    paintIcons(root);
    if (action) root.querySelector(`[data-release-action="${action}"]:not(:disabled)`)?.focus({ preventScroll: true });
  }
  bind(container) {
    const root = container.querySelector('[data-release-fold]');
    if (!root) return;
    root.addEventListener('toggle', () => { if (root.isConnected) this.open = root.open; });
    root.addEventListener('click', (event) => {
      const action = event.target.closest('[data-release-action]')?.dataset.releaseAction;
      if (action) { event.stopPropagation(); void this.command(action); }
    });
  }
  async command(action) {
    if (this.busy) return;
    if (action === 'manager') { openExtensionManager(); return; }
    this.busy = true; this.error = ''; this.message = ''; this.refresh();
    try {
      if (action === 'check') {
        const results = await Promise.allSettled([checkReleaseVersion(), isInstalled()
          ? storageRequest('backup/status') : Promise.resolve({ version: '设计预览', protocol: RELEASE.storageProtocol })]);
        if (results[0].status === 'fulfilled') this.state = results[0].value;
        else throw results[0].reason;
        this.backend = results[1].status === 'fulfilled' ? results[1].value : { version: '未安装、未启用或版本较旧', protocol: 0 };
      } else if (action === 'install') {
        await this.beforeUpdate();
        this.message = '正在通过酒馆更新灵画师，请稍候…'; this.refresh();
        this.updated = await updateExtensionVersion(this.state.release?.version);
        this.message = `v${this.updated.version} 已下载，点击“刷新酒馆以生效”完成更新`;
      } else if (action === 'reload') {
        await this.beforeUpdate();
        reloadUpdatedExtension();
      }
    } catch (error) { this.error = error.message || '更新失败，请稍后重试'; }
    finally { this.busy = false; this.refresh(); }
  }
}
