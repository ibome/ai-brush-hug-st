import { escapeHtml as esc } from '../config.js';
import { icon, paintIcons } from '../icons.js';
import { ASSISTANT_OPERATIONS } from '../assistant-workflow.js';
import { TaskPromptDrafts } from '../task-prompt-drafts.js';
import { defaultTaskPrompt, validateTaskPrompt, normalizeTaskPrompts, taskPromptVariables,
  TASK_PROMPT_DESCRIPTIONS, TASK_RULE_VARIABLES, TASK_PROMPT_LIMIT, TASK_PREFIX_LIMIT } from '../assistant-rules.js';

const command = (action, glyph, label, disabled = false, primary = false) =>
  `<button type="button" class="ui-button ${primary ? 'primary' : 'secondary'}" data-task-prompt-action="${action}" ${disabled ? 'disabled' : ''}>${icon(glyph)}<span>${label}</span></button>`;

export class TaskPromptPanel {
  constructor(options) {
    Object.assign(this, options); this.drafts = new Map(); this.baselines = new Map(); this.epoch = 0;
    if (this.draftKey) {
      this.draftStore = new TaskPromptDrafts({ key: this.draftKey, changed: () => this.updateStatus() });
      const flush = () => this.draftStore.flush();
      window.addEventListener('pagehide', flush);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    }
  }
  entry() {
    const count = Object.keys(this.settings().taskPrompts || {}).length;
    return `<section class="assistant-rules-entry" aria-label="任务提示词">
      <div><strong>${icon('file-json')}任务提示词</strong><span>${count ? `${count} 个任务已自定义` : '使用内置默认'}</span></div>
      <button type="button" class="ui-button secondary" data-action="assistant-task-prompts">${icon('pencil')}<span>查看 / 编辑底层提示词</span></button>
    </section>`;
  }
  saved(operation = this.operation) {
    const value = this.settings().taskPrompts?.[operation] || {};
    return { prefix: value.prefix || '', rules: value.rules ?? defaultTaskPrompt(operation) };
  }
  draft() {
    if (!this.drafts.has(this.operation)) {
      const restored = this.draftStore?.get(this.operation);
      if (restored) {
        this.drafts.set(this.operation, restored.draft);
        this.baselines.set(this.operation, JSON.stringify(restored.baseline));
      }
    }
    if (!this.drafts.has(this.operation)
      || JSON.stringify(this.drafts.get(this.operation)) === this.baselines.get(this.operation)) {
      this.drafts.set(this.operation, this.saved());
      this.baselines.set(this.operation, JSON.stringify(this.saved()));
    }
    return this.drafts.get(this.operation);
  }
  dirty() { return JSON.stringify(this.draft()) !== JSON.stringify(this.saved()); }
  open(operation = 'generate') {
    if (!ASSISTANT_OPERATIONS.some(([id]) => id === operation)) return;
    this.epoch++; this.operation = operation; this.status = ''; this.previewResult = null;
    if (!this.dialog) {
      this.returnFocus = document.activeElement;
      this.dialog = document.createElement('dialog');
      this.dialog.className = 'assistant-rules-dialog';
      this.dialog.setAttribute('aria-label', '任务提示词设置');
      this.dialog.addEventListener('click', (event) => {
        const action = event.target.closest('[data-task-prompt-action]')?.dataset.taskPromptAction;
        if (action) void this.click(action);
      });
      this.dialog.addEventListener('input', (event) => this.input(event));
      this.dialog.addEventListener('change', (event) => {
        if (event.target.matches('[data-task-prompt-operation]')) {
          this.operation = event.target.value; this.epoch++; this.previewResult = null; this.status = ''; this.render();
        }
      });
      this.dialog.addEventListener('cancel', (event) => { event.preventDefault(); this.close(); });
      document.body.append(this.dialog);
      this.render(); this.dialog.showModal();
    } else this.render();
  }
  close() {
    this.draftStore?.flush();
    this.epoch++;
    this.dialog?.close(); this.dialog?.remove(); this.dialog = null;
    if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
  }
  render() {
    if (!this.dialog) return;
    const draft = this.draft(), variables = taskPromptVariables(this.operation);
    this.dialog.innerHTML = `<header><h2>${icon('file-json')}任务提示词</h2>
      <button type="button" class="ui-icon-button" data-task-prompt-action="close" title="关闭提示词设置" aria-label="关闭提示词设置">${icon('x')}</button></header>
      <div class="assistant-rules-body">
        <label class="ui-field"><span>编辑哪个任务</span><select data-task-prompt-operation aria-label="提示词任务">${ASSISTANT_OPERATIONS.map(([id, name]) =>
          `<option value="${id}" ${id === this.operation ? 'selected' : ''}>${name}</option>`).join('')}</select></label>
        <p class="assistant-context">${esc(TASK_PROMPT_DESCRIPTIONS[this.operation])}</p>
        <label class="ui-field"><span>前置提示词（可选）</span><textarea rows="3" maxlength="${TASK_PREFIX_LIMIT}" data-task-prompt-field="prefix" aria-label="任务前置提示词" placeholder="例如：注重人物表情、镜头变化与情绪连贯。">${esc(draft.prefix)}</textarea></label>
        <label class="ui-field"><span>底层提示词</span><textarea rows="14" maxlength="${TASK_PROMPT_LIMIT}" data-task-prompt-field="rules" aria-label="任务底层提示词" spellcheck="false">${esc(draft.rules)}</textarea></label>
        <p class="assistant-context">保留 JSON 字段${variables.length ? '与下方动态标记' : ''}，以便插件读取结果。</p>
        ${variables.length ? `<details class="assistant-rule-variables"><summary>动态标记 · ${variables.length} 项</summary><dl>${variables.map((key) =>
          `<dt><code>{{${key}}}</code></dt><dd>${esc(TASK_RULE_VARIABLES[key])}</dd>`).join('')}</dl></details>` : ''}
        <div data-task-prompt-validation role="status"></div>
        ${this.previewResult ? `<section class="assistant-rule-preview" aria-label="任务请求预览"><h3>展开后的请求 · ${esc(ASSISTANT_OPERATIONS.find(([id]) => id === this.operation)[1])}</h3>
          <p class="assistant-context">当前编辑稿 · ${esc(this.previewResult.note || '')} · 未调用模型</p>
          ${this.previewResult.messages.map((row, index) => `<details ${row.role === 'system' ? 'open' : ''}>
            <summary>${index + 1} · ${esc(row.role)}</summary><pre>${esc(row.content)}</pre></details>`).join('')}</section>` : ''}
      </div>
      <footer><p data-task-prompt-status role="status"></p><div class="assistant-actions">
        ${command('reset', 'rotate-ccw', '恢复本任务默认')}
        ${command('discard', 'undo-2', '丢弃未保存草稿', !this.dirty())}
        ${command('preview', 'eye', '预览展开结果', this.previewing)}
        ${command('save', 'save', '保存本任务', false, true)}
      </div></footer>`;
    this.updateStatus(); paintIcons(this.dialog);
  }
  updateStatus() {
    if (!this.dialog) return;
    const errors = validateTaskPrompt(this.operation, this.draft()), validation = this.dialog.querySelector('[data-task-prompt-validation]');
    validation.textContent = errors.join('；'); validation.className = errors.length ? 'assistant-error' : '';
    this.dialog.querySelector('[data-task-prompt-action="save"]').disabled = Boolean(errors.length);
    this.dialog.querySelector('[data-task-prompt-action="preview"]').disabled = Boolean(errors.length) || this.previewing;
    const dirty = this.dirty(), changed = this.baselines.get(this.operation) !== JSON.stringify(this.saved());
    const stored = this.draftStore?.status;
    this.dialog.querySelector('[data-task-prompt-action="discard"]').disabled = !dirty;
    this.dialog.querySelector('[data-task-prompt-status]').textContent = [
      this.status || (dirty ? '未生效' : this.settings().taskPrompts?.[this.operation] ? '已保存自定义提示词' : '内置默认'),
      dirty ? stored === 'pending' ? '草稿待保存' : stored === 'error' ? '本设备草稿保存失败，请保留页面'
        : this.draftStore ? '草稿保存在本设备，刷新后可恢复' : '草稿保留在当前页面' : '',
      dirty && changed ? '已保存配置已变化，请对照后再保存' : '',
    ].filter(Boolean).join(' · ');
  }
  input(event) {
    const field = event.target.dataset.taskPromptField;
    if (!['rules', 'prefix'].includes(field)) return;
    this.draft()[field] = event.target.value; this.status = ''; this.epoch++;
    this.stash();
    this.previewResult = null; this.dialog.querySelector('.assistant-rule-preview')?.remove();
    this.updateStatus();
  }
  async click(action) {
    if (action === 'close') { this.close(); return; }
    this.status = '';
    try {
      if (action === 'reset') {
        this.drafts.set(this.operation, { prefix: '', rules: defaultTaskPrompt(this.operation) });
        this.stash();
        this.previewResult = null; this.epoch++; this.status = '默认内容已载入，保存后生效'; this.render(); return;
      }
      if (action === 'discard') {
        this.drafts.delete(this.operation); this.baselines.delete(this.operation);
        this.draftStore?.remove(this.operation);
        this.drafts.set(this.operation, this.saved()); this.baselines.set(this.operation, JSON.stringify(this.saved()));
        this.previewResult = null; this.epoch++; this.status = '已恢复为当前生效内容'; this.render(); return;
      }
      const errors = validateTaskPrompt(this.operation, this.draft());
      if (errors.length) throw new Error(errors[0]);
      if (action === 'save') {
        const taskPrompts = normalizeTaskPrompts({ ...this.settings().taskPrompts, [this.operation]: this.draft() });
        this.update({ taskPrompts }); this.drafts.set(this.operation, this.saved());
        this.baselines.set(this.operation, JSON.stringify(this.saved())); this.draftStore?.remove(this.operation);
        this.status = this.draftStore?.status === 'error' ? '配置已保存；本设备旧草稿未能清理' : '本任务提示词已保存'; this.updateStatus();
      }
      if (action === 'preview' && !this.previewing) {
        const epoch = ++this.epoch, operation = this.operation;
        const taskPrompts = normalizeTaskPrompts({ ...this.settings().taskPrompts, [operation]: this.draft() });
        this.previewing = true; this.updateStatus();
        try {
          const result = await this.preview(operation, taskPrompts);
          if (epoch === this.epoch && this.dialog) { this.previewResult = result; this.render(); }
        } finally { this.previewing = false; this.updateStatus(); }
      }
    } catch (error) {
      if (this.dialog) { this.status = error.message; this.updateStatus(); }
    }
  }
  stash() {
    if (this.draftStore) this.draftStore.set(this.operation, this.draft(), JSON.parse(this.baselines.get(this.operation)));
  }
}
