import { icon, paintIcons } from '../icons.js';
import { RESET_SCOPES } from '../settings-reset.js';

export class SettingsResetPanel {
  constructor({ apply, notify }) { Object.assign(this, { apply, notify }); this.busy = false; }
  open() {
    if (this.dialog) return;
    this.returnFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'nai-preset-dialog settings-reset-dialog';
    dialog.setAttribute('aria-labelledby', 'settings-reset-title');
    dialog.innerHTML = `<header><h2 id="settings-reset-title">${icon('rotate-ccw')}重置设置</h2>
      <button type="button" class="ui-icon-button" data-reset-cancel title="取消重置" aria-label="取消重置">${icon('x')}</button></header>
      <p class="settings-reset-retained">${icon('circle-check')}接口地址、秘钥、鉴权配置和已选模型始终保留，已通过的鉴权不用重新设置。</p>
      <fieldset class="settings-reset-scopes"><legend>选择要恢复默认的内容</legend>${RESET_SCOPES.map((scope) =>
        `<label><input type="checkbox" data-reset-scope="${scope.id}" ${scope.checked ? 'checked' : ''} /><span><strong>${scope.title}</strong><small>${scope.detail}</small></span></label>`).join('')}</fieldset>
      <p>主题、图片存储位置、已有图片、任务记录，以及保存的预设、画师串、角色档案和漫画项目都会保留。需要留存当前设置，可先取消并导出配置备份。</p>
      <p class="nai-dialog-error" data-reset-error role="status" aria-live="polite"></p>
      <footer><button type="button" class="ui-button secondary" data-reset-cancel>取消</button>
        <button type="button" class="ui-button primary" data-reset-confirm>${icon('rotate-ccw')}<span>确认重置所选设置</span></button></footer>`;
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); this.close(); });
    dialog.addEventListener('change', () => {
      dialog.querySelector('[data-reset-confirm]').disabled = !dialog.querySelector('[data-reset-scope]:checked');
      dialog.querySelector('[data-reset-error]').textContent = '';
    });
    dialog.addEventListener('click', (event) => {
      if (event.target.closest('[data-reset-cancel]')) this.close();
      if (event.target.closest('[data-reset-confirm]')) void this.submit();
    });
    this.dialog = dialog; document.body.append(dialog); paintIcons(dialog); dialog.showModal();
  }
  close() {
    if (this.busy) return;
    this.dialog?.close(); this.dialog?.remove(); this.dialog = null;
    if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
  }
  async submit() {
    if (this.busy) return;
    const dialog = this.dialog;
    const scopes = [...dialog.querySelectorAll('[data-reset-scope]:checked')].map((node) => node.dataset.resetScope);
    if (!scopes.length) return;
    this.busy = true;
    dialog.querySelectorAll('input, button').forEach((node) => { node.disabled = true; });
    dialog.querySelector('[data-reset-error]').textContent = '正在保存并重置所选设置…';
    try {
      const message = await this.apply(scopes);
      this.busy = false; this.close(); this.notify(message);
    } catch (error) {
      dialog.querySelector('[data-reset-error]').textContent = error.message;
      dialog.querySelectorAll('input, button').forEach((node) => { node.disabled = false; });
    } finally { this.busy = false; }
  }
}
