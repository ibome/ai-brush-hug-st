import { escapeHtml as esc, downloadJson } from '../config.js';
import { icon, paintIcons } from '../icons.js';
import { RECOVERY_KINDS, RECOVERY_LIMIT, recoveryBundle, inspectRecovery, mergeRecoveryInbox } from '../recovery-drafts.js';
import { BackupStore } from '../backup-store.js';

const command = (action, label, glyph, extra = '') => `<button type="button" class="ui-button secondary" data-recovery-action="${action}" ${extra}>${icon(glyph)}<span>${label}</span></button>`;
export class RecoveryDraftPanel {
  constructor(options) {
    Object.assign(this, options);
    this.store = new BackupStore(); this.inbox = []; this.selected = new Set(); this.excluded = new Set();
    this.open = false; this.status = ''; this.busy = false;
    this.ready = this.store.get('recovery-inbox').then((rows) => {
      this.inbox = recoveryBundle(rows || []).rows;
      if (this.inbox.length && document.querySelector('[data-recovery-root]')) this.render();
    }).catch(() => { this.status = '草稿收件箱读取失败，可先导出当前草稿'; });
  }
  rows() {
    const live = this.collect();
    return [...live.map((row) => ({ ...row, local: true })), ...this.inbox];
  }
  selectedRows() { return recoveryBundle(this.rows().filter((row) => !this.excluded.has(row.id))).rows; }
  async receive(bundle) {
    await this.ready;
    const next = mergeRecoveryInbox(this.inbox, inspectRecovery(bundle).rows);
    await this.store.put('recovery-inbox', next); this.inbox = next;
    this.open = true; this.status = '草稿已放入待恢复列表，点击“恢复编辑”后再检查内容。';
  }
  html() {
    const rows = this.rows();
    return `<details class="settings-band recovery-band" data-recovery-root ${this.open ? 'open' : ''}>
      <summary>${icon('notebook-pen')}草稿与恢复 <span>${rows.length} 项</span>${icon('chevron-down')}</summary>
      <p class="storage-scope">本设备、当前账号 · 可随配置备份迁移。草稿包含提示词或剧情正文；图片与参考素材需另外备份。</p>
      <fieldset ${this.busy ? 'disabled' : ''}><div class="backup-actions">${command('export', '导出所选草稿', 'download')}
        ${command('choose', '导入草稿包', 'upload')}</div>
      <input type="file" data-recovery-file accept=".json,application/json" hidden>
      <div class="recovery-list">${rows.map((row) => `<div class="recovery-row">
        <label class="backup-check"><input type="checkbox" data-recovery-select="${esc(row.id)}" ${this.excluded.has(row.id) ? '' : 'checked'}><span><strong>${esc(row.title)}</strong>
          <small>${RECOVERY_KINDS[row.kind]} · ${row.local ? '本地工作稿' : '待恢复'}${row.updatedAt ? ` · ${new Date(row.updatedAt).toLocaleString()}` : ''}</small></span></label>
        <div class="backup-actions">${command('restore', row.local ? '继续编辑' : '恢复编辑', 'folder-open', `data-recovery-id="${esc(row.id)}"`)}
          ${!row.local ? command('delete', '移除', 'trash-2', `data-recovery-id="${esc(row.id)}"`) : ''}</div>
        <details data-recovery-preview="${esc(row.id)}"><summary>内容预览</summary><pre></pre></details>
      </div>`).join('') || '<p class="assistant-context">暂无待恢复草稿</p>'}</div></fieldset>
      <p role="status">${esc(this.status)}</p></details>`;
  }
  bind(container) {
    const root = container.querySelector('[data-recovery-root]');
    if (!root) return;
    root.addEventListener('toggle', () => { this.open = root.open; });
    for (const details of root.querySelectorAll('[data-recovery-preview]')) details.addEventListener('toggle', () => {
      if (!details.open) return;
      const row = this.rows().find((row) => row.id === details.dataset.recoveryPreview);
      details.querySelector('pre').textContent = row ? JSON.stringify(row.data, null, 2).slice(0, 20000) : '草稿已变化，请重新打开。';
    });
    root.addEventListener('change', (event) => {
      const id = event.target.dataset.recoverySelect;
      if (id) event.target.checked ? this.excluded.delete(id) : this.excluded.add(id);
      if (event.target.matches('[data-recovery-file]') && event.target.files[0]) void this.run(async () => {
        const file = event.target.files[0];
        if (file.size > RECOVERY_LIMIT) throw new Error('草稿包需小于 6 MB');
        const pack = inspectRecovery(JSON.parse(await file.text()));
        this.preview = pack;
        this.status = `已读取 ${pack.rows.length} 项，确认后放入待恢复列表。`;
      });
    });
    if (this.preview) root.insertAdjacentHTML('beforeend', `<section class="recovery-import-preview"><h3>导入草稿预览</h3>
      <ul>${this.preview.rows.map((row) => `<li>${esc(row.title)} · ${RECOVERY_KINDS[row.kind]}</li>`).join('')}</ul>
      ${command('import', '确认导入待恢复列表', 'check')}${command('cancel', '取消', 'x')}</section>`);
    paintIcons(root);
    root.addEventListener('click', (event) => {
      const button = event.target.closest('[data-recovery-action]');
      if (!button) return;
      event.stopPropagation();
      const action = button.dataset.recoveryAction;
      if (action === 'choose') { root.querySelector('[data-recovery-file]').click(); return; }
      void this.run(async () => {
        if (action === 'cancel') { this.preview = null; this.status = ''; }
        if (action === 'import') { await this.receive(this.preview); this.preview = null; }
        if (action === 'export') {
          await this.flush();
          const bundle = recoveryBundle(this.selectedRows());
          if (!bundle.rows.length) throw new Error('请至少选择一项草稿');
          downloadJson('linghuashi-recovery-drafts.json', bundle); this.status = `已导出 ${bundle.rows.length} 项草稿`;
        }
        const row = this.rows().find((row) => row.id === button.dataset.recoveryId);
        if (action === 'restore' && row) {
          if (this.active()) throw new Error('请等待当前任务结束后恢复编辑');
          if (!row.local) {
            // Keep a copy of displaced working drafts before opening an imported one.
            const checkpoints = this.collect().filter((item) => item.kind === row.kind);
            const next = mergeRecoveryInbox(this.inbox, checkpoints);
            await this.store.put('recovery-inbox', next); this.inbox = next;
          }
          await this.restore(row); this.status = '已恢复为编辑稿，尚未提交任务。';
        }
        if (action === 'delete' && row && !row.local) {
          const next = this.inbox.filter((item) => item.id !== row.id);
          await this.store.put('recovery-inbox', next); this.inbox = next; this.status = '已移除待恢复副本';
        }
      });
    });
  }
  async run(work) {
    if (this.busy) return;
    this.busy = true;
    try { await this.ready; await work(); }
    catch (error) { this.status = error.message || '草稿操作失败'; }
    finally { this.busy = false; this.render(); }
  }
}
