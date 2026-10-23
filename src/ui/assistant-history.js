import { escapeHtml as esc } from '../config.js';
import { icon, paintIcons } from '../icons.js';
import { illustrationPlans } from '../assistant-workflow.js';
import { DRAFT_OPERATIONS, assistantWorkspaceRevision, compareAssistantDrafts, recoverAssistantDraft } from '../assistant-history.js';

const button = (prefix, action, glyph, title, disabled = false) =>
  `<button type="button" class="ui-button secondary" data-${prefix}-action="${action}" ${disabled ? 'disabled' : ''}>${icon(glyph)}<span>${title}</span></button>`;
function partial(panel) {
  if (!panel.root?.isConnected) return;
  panel.open = panel.root.querySelector('details')?.open ?? panel.open;
  panel.root.innerHTML = panel.content();
  paintIcons(panel.root);
}
function html(panel, attribute) {
  if (panel.root?.isConnected) panel.open = panel.root.querySelector('details')?.open ?? panel.open;
  return `<div ${attribute}>${panel.content()}</div>`;
}
const title = (row) => row.label || row.plan.scene || DRAFT_OPERATIONS[row.operation];
const previewText = (value) => esc(value.length > 8000 ? `${value.slice(0, 8000)}\n（预览前 8000 字符）` : value || '（空）');

export class AssistantHistoryPanel {
  constructor(options) { Object.assign(this, options); this.selected = ''; this.name = ''; this.message = ''; this.error = ''; }
  html() { return html(this, 'data-assistant-history-root'); }
  content() {
    const rows = this.library();
    if (!rows.some((row) => row.id === this.selected)) this.selected = rows[0]?.id || '';
    const selected = rows.find((row) => row.id === this.selected), current = this.current();
    const stale = this.compare && this.comparedRevision !== assistantWorkspaceRevision(current);
    const changes = this.compare && selected && !stale ? this.changes : null;
    return `<details class="assistant-tool-section" ${this.open ? 'open' : ''}><summary>草稿历史 · ${rows.length} / 12</summary>
      <label class="ui-field"><span>版本名称（可选）</span><input data-history-name aria-label="草稿版本名称" maxlength="60" value="${esc(this.name)}" /></label>
      <div class="assistant-actions">${button('history', 'save', 'save', '保存当前版本', !current.plan || this.disabled())}</div>
      ${rows.length ? `<label class="ui-field"><span>历史版本</span><select data-history-select aria-label="助手历史版本">
        ${rows.map((row) => `<option value="${row.id}" ${row.id === this.selected ? 'selected' : ''}>${esc(new Date(row.createdAt).toLocaleString())} · ${esc(title(row).slice(0, 80))}</option>`).join('')}
      </select></label>
      <p class="assistant-context">${esc(DRAFT_OPERATIONS[selected.operation])} · ${illustrationPlans(selected.plan).length} 个画面</p>
      <div class="assistant-actions">${button('history', 'compare', 'columns-2', this.compare ? '收起版本对比' : '对比当前草稿', !current.plan)}
        ${button('history', 'restore', 'undo-2', '恢复为独立草稿', this.disabled())}
        ${button('history', 'delete', 'trash-2', '删除此版本', this.disabled())}</div>` : ''}
      ${stale ? `<p class="assistant-context">当前草稿已改变。</p>${button('history', 'refresh', 'refresh-cw', '刷新版本对比')}` : ''}
      ${changes ? `<div class="assistant-draft-comparison" aria-label="草稿版本对比">${changes.length
        ? `<p class="assistant-context">${changes.length} 处字段变化</p>${changes.map((row) => `<section class="assistant-draft-change"><strong>${row.index < 0 ? '' : `画面 ${row.index + 1} · `}${row.field}</strong>
          <div class="assistant-draft-columns"><div><span>历史版本</span><pre>${previewText(row.before)}</pre></div><div><span>当前草稿</span><pre>${previewText(row.after)}</pre></div></div></section>`).join('')}`
        : '<p class="assistant-context">画面与角色内容相同。</p>'}</div>` : ''}
      <p class="assistant-error" role="alert" ${this.error ? '' : 'hidden'}>${esc(this.error)}</p>
      <p class="assistant-context" role="status">${esc(this.message || this.notice())}</p>
    </details>`;
  }
  bind(host) {
    this.root = host.querySelector('[data-assistant-history-root]');
    if (!this.root || this.root.dataset.bound) return;
    this.root.dataset.bound = 'true';
    this.root.addEventListener('input', (event) => {
      if (event.target.matches('[data-history-name]')) this.name = event.target.value;
    });
    this.root.addEventListener('change', (event) => {
      if (event.target.matches('[data-history-select]')) {
        this.selected = event.target.value; this.error = ''; this.message = ''; this.compare = false; this.render();
      }
    });
    this.root.addEventListener('click', (event) => {
      const action = event.target.closest('[data-history-action]')?.dataset.historyAction;
      if (!action) return;
      this.error = ''; this.message = '';
      try {
        if (action === 'compare') this.compare = !this.compare;
        if (action === 'compare' && this.compare || action === 'refresh') {
          const row = this.library().find((item) => item.id === this.selected);
          if (!row) throw new Error('历史版本已改变');
          this.compare = true; this.changes = compareAssistantDrafts(row.plan, this.current().plan);
          this.comparedRevision = assistantWorkspaceRevision(this.current());
        }
        if (!['compare', 'refresh'].includes(action)) {
          if (this.disabled()) throw new Error('文字任务进行中，请稍后操作草稿历史');
          const row = this.library().find((item) => item.id === this.selected);
          if (action === 'save') { this.save(this.name); this.selected = this.library()[0]?.id || ''; this.name = ''; this.message = '当前版本已保存'; }
          if (action === 'restore') {
            if (!row) throw new Error('历史版本已改变');
            this.restore(row);
            this.message = this.notice() ? `已恢复为独立草稿；${this.notice()}` : '已恢复为独立草稿；恢复前的内容已保留在历史中';
          }
          if (action === 'delete') { this.update(this.library().filter((item) => item.id !== this.selected)); this.message = '版本已删除'; }
        }
      } catch (error) { this.error = error.message; }
      this.render();
    });
  }
  render() { partial(this); }
}

export class AssistantRecoveryPanel {
  constructor(options) { Object.assign(this, options); this.clear(); }
  clear() { this.text = ''; this.context = null; this.editing = false; this.preview = null; this.error = ''; this.base = ''; }
  setFailure(raw, context) { this.clear(); this.text = raw; this.context = structuredClone(context); }
  html() { return html(this, 'data-assistant-recovery-root'); }
  content() {
    return `${this.editing ? `<label class="ui-field"><span>待修复的模型回复</span><textarea data-recovery-text aria-label="待修复的模型回复" rows="8" maxlength="100000" spellcheck="false">${esc(this.text)}</textarea></label>
      <div class="assistant-actions">${button('recovery', 'parse', 'scan', '解析修复内容', this.disabled())}
        ${button('recovery', 'reset', 'rotate-ccw', '还原失败回复', this.disabled())}</div>` : button('recovery', 'edit', 'pencil', '手动修复回复', this.disabled() || !this.context)}
      ${this.preview ? `<div class="assistant-recovery-preview" aria-label="修复草稿预览">${illustrationPlans(this.preview).map((shot, index) =>
        `<section><strong>画面 ${index + 1} · ${esc(shot.scene)}</strong><p class="assistant-context">${shot.shouldDraw ? '可生成' : '无需配图'} · ${shot.aspect}</p><pre>${previewText(shot.positive)}</pre>
          ${shot.negative ? `<p class="assistant-context">负面提示词</p><pre>${previewText(shot.negative)}</pre>` : ''}
          ${shot.characters?.length ? `<p class="assistant-context">角色条目 ${shot.characters.length} 个</p>` : ''}</section>`).join('')}
        ${button('recovery', 'adopt', 'check', '采用修复草稿', this.disabled())}</div>` : ''}
      <p class="assistant-error" role="alert" ${this.error ? '' : 'hidden'}>${esc(this.error)}</p>`;
  }
  bind(host) {
    this.root = host.querySelector('[data-assistant-recovery-root]');
    if (!this.root || this.root.dataset.bound) return;
    this.root.dataset.bound = 'true';
    this.root.addEventListener('input', (event) => {
      if (!event.target.matches('[data-recovery-text]')) return;
      this.text = event.target.value; this.preview = null; this.error = '';
      this.root.querySelector('.assistant-recovery-preview')?.remove();
      const error = this.root.querySelector('.assistant-error'); if (error) error.hidden = true;
    });
    this.root.addEventListener('click', (event) => {
      const action = event.target.closest('[data-recovery-action]')?.dataset.recoveryAction;
      if (!action) return;
      this.error = '';
      try {
        if (this.disabled()) throw new Error('文字任务进行中，请稍后修复回复');
        if (action === 'edit') this.editing = true;
        if (action === 'reset') { this.text = this.original(); this.preview = null; }
        if (action === 'parse') {
          this.preview = null;
          this.preview = recoverAssistantDraft(this.text, this.context);
          this.base = assistantWorkspaceRevision(this.current());
        }
        if (action === 'adopt') {
          if (!this.preview || this.base !== assistantWorkspaceRevision(this.current())) throw new Error('工作草稿已改变，请重新解析修复内容');
          this.apply(this.preview, this.context); this.clear();
        }
      } catch (error) { this.error = error.message; }
      this.render();
    });
  }
  render() { partial(this); }
}
