import { escapeHtml as esc, downloadJson } from '../config.js';
import { icon, paintIcons } from '../icons.js';
import { ASSISTANT_OPERATIONS, DEFAULT_TASK_MESSAGES, validateTaskMessages,
  importTaskTemplates, exportTaskTemplates, TASK_TEMPLATE_FILE_LIMIT } from '../assistant-workflow.js';
import { STATE_FIELDS } from '../assistant-state.js';

const tool = (action, glyph, label, index = '', disabled = false) =>
  `<button type="button" class="ui-icon-button" data-workflow-action="${action}" data-index="${index}" title="${label}" aria-label="${label}" ${disabled ? 'disabled' : ''}>${icon(glyph)}</button>`;
const command = (action, glyph, label, disabled = false) =>
  `<button type="button" class="ui-button secondary" data-workflow-action="${action}" ${disabled ? 'disabled' : ''}>${icon(glyph)}<span>${label}</span></button>`;
const keyOf = (row) => row.profileId || row.name;

export class AssistantWorkflowPanel {
  constructor(options) {
    Object.assign(this, options);
    this.operation = 'illustrate'; this.state = null; this.error = ''; this.busy = false;
    this.edit = null; this.importPreview = null; this.message = ''; this.generation = 0;
  }
  html() { return `<div data-assistant-workflow-root>${this.content()}</div>`; }
  rows() { return this.settings().taskMessages?.[this.operation] || DEFAULT_TASK_MESSAGES; }
  resetState() {
    this.generation++; this.state = null; this.edit = null; this.error = ''; this.message = '';
    this.render();
  }
  validation() { return validateTaskMessages(this.rows()); }
  updateValidation() {
    const node = this.root?.querySelector('[data-template-validation]');
    if (!node) return;
    const errors = this.validation();
    node.textContent = errors.length ? errors.join('；') : '模板校验通过';
    node.classList.toggle('assistant-error', Boolean(errors.length));
  }
  stateHTML(row, index) {
    const key = keyOf(row), editing = this.edit?.key === key;
    return `<section class="assistant-state-row" data-state-index="${index}">
      <div class="assistant-state-heading"><strong>${esc(row.name || row.profileId)}</strong><span class="assistant-task-tools">
        ${tool('state-edit-start', 'pencil', '校正角色状态', index, this.busy || !this.state.writable || Boolean(this.edit))}
        ${tool('state-remove', 'trash-2', '移除角色状态', index, this.busy || !this.state.writable || Boolean(this.edit))}
      </span></div>
      ${editing ? `<div class="assistant-grid">${STATE_FIELDS.map(([field, label, limit]) =>
        `<label class="ui-field"><span>${label}</span><textarea rows="3" maxlength="${limit}" data-state-field="${field}" aria-label="校正${label}">${esc(this.edit.values[field])}</textarea></label>`).join('')}</div>
        <div class="assistant-actions">${command('state-edit-save', 'check', '保存状态校正', this.busy)}${command('state-edit-cancel', 'x', '取消校正', this.busy)}</div>`
      : `<dl>${STATE_FIELDS.filter(([field]) => row[field]).map(([field, label]) => {
        const source = this.state.sources?.[key]?.[field];
        return `<dt>${label}</dt><dd>${esc(row[field])}
          ${source ? `<small>${source.kind === 'manual' ? '手动校正' : '原文依据'} · 第 ${source.index + 1} 条消息</small>
          ${source.evidence ? `<blockquote>${esc(source.evidence)}</blockquote>` : ''}` : ''}
        </dd>`;
      }).join('')}</dl>`}
    </section>`;
  }
  content() {
    const rows = this.rows(), errors = this.validation();
    return `<details class="assistant-task-templates"><summary>任务消息模板</summary>
      <label class="ui-field"><span>任务</span><select data-workflow-task aria-label="任务消息类型">
        ${ASSISTANT_OPERATIONS.map(([id, name]) => `<option value="${id}" ${this.operation === id ? 'selected' : ''}>${name}</option>`).join('')}
      </select></label>
      <div class="assistant-actions">${command('rules', 'pencil', '编辑本任务底层提示词')}</div>
      <div class="assistant-task-message-list">${rows.map((row, index) =>
        `<div class="assistant-task-message"><div class="assistant-task-toolbar"><span>${index + 1}</span>
          <select data-workflow-role="${index}" aria-label="任务消息 ${index + 1} 类型">
            ${['system', 'user', 'assistant'].map((role) => `<option ${row.role === role ? 'selected' : ''}>${role}</option>`).join('')}
          </select><span class="assistant-task-tools">
            ${tool('up', 'arrow-up', '上移消息', index, index === 0)}
            ${tool('down', 'arrow-down', '下移消息', index, index === rows.length - 1)}
            ${tool('remove', 'trash-2', '删除消息', index, rows.length <= 2)}
          </span></div>
          <textarea rows="3" data-workflow-content="${index}" maxlength="8000" aria-label="任务消息 ${index + 1} 内容">${esc(row.content)}</textarea>
        </div>`).join('')}</div>
      <p data-template-validation class="${errors.length ? 'assistant-error' : 'assistant-context'}" role="status">${esc(errors.length ? errors.join('；') : '模板校验通过')}</p>
      <div class="assistant-actions">${tool('add', 'plus', '添加消息', '', rows.length >= 16)}${tool('reset', 'rotate-ccw', '恢复本任务默认消息')}
        ${tool('template-export', 'download', '导出任务模板', '', this.busy)}
        ${tool('template-import', 'upload', '导入任务模板', '', this.busy)}</div>
      <input type="file" accept=".json,application/json" data-workflow-file hidden>
      ${this.importPreview ? `<div class="assistant-template-preview"><strong>待合并的任务模板</strong>
        ${Object.entries(this.importPreview.tasks).map(([key, messages]) =>
          `<details><summary>${esc(ASSISTANT_OPERATIONS.find(([id]) => id === key)[1])} · ${messages.length} 条消息${this.settings().taskMessages?.[key] ? ' · 将替换已有模板' : ''}</summary>
            ${messages.map((row, index) => `<p>${index + 1} · ${esc(row.role)}</p><pre>${esc(row.content)}</pre>`).join('')}</details>`).join('')}
        <div class="assistant-actions">${command('template-apply', 'check', '应用导入模板', this.busy)}${command('template-cancel', 'x', '取消导入', this.busy)}</div></div>` : ''}
    </details>
    <details class="assistant-task-templates"><summary>当前聊天的角色状态</summary>
      <div class="assistant-actions">
        ${command('state-read', 'refresh-cw', '读取状态', this.busy || Boolean(this.edit))}
        ${command('state-clear', 'trash-2', '清除状态', this.busy || Boolean(this.edit) || !this.state?.characters?.length)}
        ${command('state-undo', 'undo-2', '撤销上次状态修改', this.busy || Boolean(this.edit) || !this.state?.canUndo)}
      </div>
      ${this.state ? this.state.characters.map((row, index) => this.stateHTML(row, index)).join('')
        || '<p class="assistant-context">当前聊天暂无已记录状态</p>' : ''}
    </details>
    <p class="assistant-context" role="status" ${this.message ? '' : 'hidden'}>${esc(this.message)}</p>
    <p class="assistant-error" role="alert" ${this.error ? '' : 'hidden'}>${esc(this.error)}</p>`;
  }
  bind(host) {
    this.root = host.querySelector('[data-assistant-workflow-root]');
    if (!this.root || this.root.dataset.bound) return;
    this.root.dataset.bound = 'true';
    this.root.addEventListener('input', (event) => {
      if (event.target.dataset.stateField !== undefined && this.edit) {
        this.edit.values[event.target.dataset.stateField] = event.target.value; return;
      }
      if (event.target.dataset.workflowContent === undefined) return;
      const rows = structuredClone(this.rows());
      rows[Number(event.target.dataset.workflowContent)].content = event.target.value;
      this.save(rows, true); this.updateValidation();
    });
    this.root.addEventListener('change', (event) => {
      if (event.target.matches('[data-workflow-task]')) {
        this.operation = event.target.value; this.render();
      } else if (event.target.dataset.workflowRole !== undefined) {
        const rows = structuredClone(this.rows());
        rows[Number(event.target.dataset.workflowRole)].role = event.target.value;
        this.save(rows); this.updateValidation();
      } else if (event.target.matches('[data-workflow-file]')) void this.importFile(event.target.files[0]);
    });
    this.root.addEventListener('click', (event) => {
      const button = event.target.closest('[data-workflow-action]');
      if (button) void this.click(button.dataset.workflowAction, Number(button.dataset.index));
    });
  }
  save(rows, continuous = false) {
    this.update({ taskMessages: { ...this.settings().taskMessages, [this.operation]: rows } }, continuous);
  }
  render() {
    if (!this.root?.isConnected) return;
    const open = [...this.root.querySelectorAll(':scope > details')].map((row) => row.open);
    this.root.innerHTML = this.content();
    this.root.querySelectorAll(':scope > details').forEach((row, index) => { row.open = open[index]; });
    paintIcons(this.root);
  }
  async importFile(file) {
    if (!file || this.busy) return;
    this.busy = true; this.error = ''; this.message = ''; this.importPreview = null; this.render();
    try {
      if (file.size > TASK_TEMPLATE_FILE_LIMIT) throw new Error('模板文件超过 400 KB');
      const tasks = importTaskTemplates(JSON.parse(await file.text()));
      importTaskTemplates({ format: 'linghuashi-task-messages', version: 1, tasks: { ...this.settings().taskMessages, ...tasks } });
      this.importPreview = { tasks, revision: JSON.stringify(this.settings().taskMessages) };
    } catch (error) { this.error = error instanceof SyntaxError ? '模板文件不是有效 JSON' : error.message; }
    finally { this.busy = false; this.render(); }
  }
  async stateAction(action, index) {
    if (this.busy) return;
    this.error = ''; this.message = '';
    if (action === 'state-edit-cancel') { this.edit = null; this.render(); return; }
    if (this.isBusy?.()) { this.error = '当前任务尚未完成，请稍后修改角色状态'; this.render(); return; }
    if (action === 'state-edit-start') {
      const row = this.state?.characters[index];
      if (row) this.edit = { key: keyOf(row), values: Object.fromEntries(STATE_FIELDS.map(([field]) => [field, row[field] || ''])) };
      this.render(); return;
    }
    const generation = this.generation;
    this.busy = true; this.render();
    try {
      let state;
      const expected = { chatKey: this.state?.chatKey, revision: this.state?.revision };
      if (action === 'state-edit-save' && this.edit) {
        state = await this.request('state-edit', { ...expected, ...this.edit });
      } else if (action === 'state-remove') {
        state = await this.request('state-remove', { ...expected, key: keyOf(this.state.characters[index]) });
      } else if (action === 'state-undo') {
        state = await this.request('state-undo', expected);
      } else if (action === 'state-read' || action === 'state-clear') {
        if (action === 'state-clear') await this.request('state-clear', expected);
        state = await this.request('state-read', {});
      } else return;
      if (generation !== this.generation) return;
      this.state = state; this.edit = null;
      if (action !== 'state-read') this.message = action === 'state-undo' ? '已撤销上次状态修改' : '当前聊天角色状态已保存';
    } catch (error) {
      if (generation === this.generation) {
        this.error = error.message;
        if (!/保存失败/.test(error.message)) this.edit = null;
      }
    } finally { this.busy = false; this.render(); }
  }
  async click(action, index) {
    if (action.startsWith('state-')) return this.stateAction(action, index);
    if (this.busy) return;
    this.error = ''; this.message = '';
    try {
      if (action === 'rules') { this.editRules?.(this.operation); return; }
      if (action === 'template-import') { this.root.querySelector('[data-workflow-file]').click(); return; }
      if (action === 'template-export') { downloadJson('灵画师-任务消息模板.json', exportTaskTemplates(this.settings().taskMessages)); return; }
      if (action === 'template-cancel') { this.importPreview = null; this.render(); return; }
      if (action === 'template-apply') {
        if (!this.importPreview) return;
        if (JSON.stringify(this.settings().taskMessages) !== this.importPreview.revision) throw new Error('任务模板已变化，请重新导入并核对');
        const taskMessages = importTaskTemplates({ format: 'linghuashi-task-messages', version: 1,
          tasks: { ...this.settings().taskMessages, ...this.importPreview.tasks } });
        this.update({ taskMessages }); this.importPreview = null; this.message = '任务消息模板已合并'; this.render(); return;
      }
      const rows = structuredClone(this.rows());
      if (action === 'add' && rows.length < 16) rows.push({ role: 'user', content: '' });
      else if (action === 'remove' && rows.length > 2) rows.splice(index, 1);
      else if (action === 'up' && index > 0) [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]];
      else if (action === 'down' && index < rows.length - 1) [rows[index + 1], rows[index]] = [rows[index], rows[index + 1]];
      else if (action === 'reset') {
        const taskMessages = { ...this.settings().taskMessages };
        delete taskMessages[this.operation]; this.update({ taskMessages }); this.render(); return;
      } else return;
      this.save(rows); this.render();
    } catch (error) { this.error = error.message; this.render(); }
  }
}
