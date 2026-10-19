import { escapeHtml as esc } from '../config.js';
import { icon, paintIcons } from '../icons.js';
import { RELEASE } from '../release.js';
import { isInstalled, storageRequest } from '../runtime.js';
import { hostEnvironment } from '../host-compat.js';
import '../styles/components.css';

export const storageComponentURL = `${RELEASE.url}/releases/download/v${RELEASE.version}/linghuashi-storage-v${RELEASE.version}.zip`;

export class ComponentsPanel {
  constructor() { this.status = null; this.busy = false; this.steps = false; }
  html() { return `<section class="components-page" data-components-root aria-label="扩展组件">${this.body()}</section>`; }
  body() {
    const state = this.status, installed = state?.enhanced === 'installed';
    const local = hostEnvironment().kind === 'tauritavern';
    const unsupported = local || state?.enhanced === 'unsupported';
    const label = this.busy ? '正在检测…' : !isInstalled() ? '设计预览'
      : !state ? '待检测' : installed ? `已安装 · ${state.version}` : ({
        missing: '未安装 · 可选', denied: '当前账号未授权', error: '检测失败', unsupported: '当前客户端不支持',
      })[state.enhanced] || '待检测';
    return `<div class="page-heading"><div><h1>扩展组件</h1><p>按需添加增强能力</p></div>
      <button type="button" class="ui-button secondary" data-component-action="refresh" ${this.busy || !isInstalled() ? 'disabled' : ''}>${icon('refresh-cw')}<span>检测组件</span></button></div>
      <div class="component-list">
        <article class="component-entry"><div class="component-symbol">${icon('hard-drive')}</div><div class="component-copy">
          <div class="component-title"><h2>${local ? '本机图片存储' : '账号图片存储'}</h2><span class="component-status">内置 · 直接可用</span></div>
          <p>${local ? '原图、缩略图、参数和参考素材保存在 TauriTavern 当前数据目录，支持收藏、聊天配图与历史版本。' : '原图、缩略图、参数和参考素材保存在当前酒馆账号目录，支持收藏、聊天配图与历史版本。'}</p>
          <p class="component-detail">原图：<code>user/images/linghuashi/</code><br>参数与素材：<code>user/files/linghuashi-*</code></p>
          <div class="component-actions"><button type="button" class="ui-button secondary" data-page="settings">${icon('settings-2')}<span>图片存储设置</span></button></div>
        </div></article>
        <article class="component-entry"><div class="component-symbol">${icon('server')}</div><div class="component-copy">
          <div class="component-title"><h2>服务器增强组件</h2><span class="component-status ${installed ? 'is-installed' : ''}" role="status">${unsupported ? '当前客户端不支持' : esc(label)}</span></div>
          <p>提供跨设备任务恢复、服务器执行锁和关闭页面后的定时清理。普通存图无需安装。</p>
          <p class="component-detail">${unsupported
            ? 'TauriTavern 不运行 Node 服务端组件。图片可使用内置存储，任务在当前设备恢复。'
            : installed
            ? state.protocol === RELEASE.storageProtocol ? '存储协议兼容，已有服务器图片继续保留。' : '组件协议较旧，请下载配套组件更新。'
            : '未安装时，任务记录保留在当前浏览器；图片与参数仍保存到酒馆账号。'}</p>
          ${state?.error ? `<p class="component-error" role="alert">${esc(state.error)}</p>` : ''}
          ${unsupported ? '' : `<div class="component-actions"><a class="ui-button secondary" href="${storageComponentURL}" download rel="noopener noreferrer">${icon('download')}<span>${installed ? '下载组件更新包' : '下载组件'}</span></a>
            <button type="button" class="ui-button secondary" data-component-action="steps" aria-expanded="${this.steps}">${icon('folder-open')}<span>安装步骤</span></button>
            <a class="ui-button secondary" href="${RELEASE.url}/blob/main/docs/components.md" target="_blank" rel="noopener noreferrer">${icon('external-link')}<span>完整教程</span></a></div>`}
          ${!unsupported && this.steps ? `<div class="component-install"><h3>由酒馆服务器管理员安装</h3><ol>
            <li>下载并解压组件包，将 <code>linghuashi-storage</code> 文件夹放入酒馆的 <code>plugins/</code> 目录。</li>
            <li>在酒馆 <code>config.yaml</code> 中启用 <code>enableServerPlugins: true</code>，然后重启酒馆。</li>
            <li>回到这里点击“检测组件”，显示“已安装”即可。原有浏览器任务仍可继续处理。</li>
          </ol><p>服务器组件无法通过酒馆的前端“安装扩展”入口安装；普通账号可把下载包交给管理员。</p></div>` : ''}
        </div></article>
        <article class="component-entry"><div class="component-symbol">${icon('panels-top-left')}</div><div class="component-copy">
          <div class="component-title"><h2>浏览器图片存储</h2><span class="component-status">内置 · 无需下载</span></div>
          <p>图片保存在此浏览器中，适合仅在当前设备使用。可随时从图片存储设置复制到酒馆账号。</p>
        </div></article>
      </div>`;
  }
  refresh() {
    const root = document.querySelector('[data-components-root]');
    if (!root) return;
    root.innerHTML = this.body(); paintIcons(root);
  }
  async check(force = false) {
    if (this.busy || !isInstalled()) return;
    this.busy = true; this.refresh();
    try { this.status = await storageRequest('components/status', { refresh: force }); }
    catch (error) { this.status = { enhanced: 'error', error: error.message }; }
    finally { this.busy = false; this.refresh(); }
  }
  bind(container) {
    const root = container.querySelector('[data-components-root]');
    if (!root) return;
    root.addEventListener('click', (event) => {
      const action = event.target.closest('[data-component-action]')?.dataset.componentAction;
      if (action === 'refresh') void this.check(true);
      if (action === 'steps') { this.steps = !this.steps; this.refresh(); }
    });
    if (!this.status) void this.check();
  }
}
