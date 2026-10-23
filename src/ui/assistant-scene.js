import { escapeHtml as esc } from '../config.js';
import { icon, paintIcons } from '../icons.js';
import { SCENE_LOCK_FIELDS } from '../assistant-scene.js';
import { compareAssistantDrafts } from '../assistant-history.js';

const button = (action, glyph, label, disabled = false) => `<button type="button" class="ui-button secondary" data-scene-action="${action}" ${disabled ? 'disabled' : ''}>${icon(glyph)}<span>${label}</span></button>`;
export class AssistantScenePanel {
  constructor(options) {
    Object.assign(this, options);
    this.disabled = () => this.applying || options.disabled();
    this.instruction = ''; this.locks = ['anchor']; this.error = '';
  }
  html() {
    if (this.root?.isConnected) this.open = this.root.querySelector('details')?.open;
    return `<div data-assistant-scene-root>${this.content()}</div>`;
  }
  stale() { return this.proposal && this.proposal.revision !== this.revision(); }
  content() {
    const current = this.current();
    if (!current.plan) return '';
    const stale = this.stale(), proposal = this.proposal;
    const changes = proposal && !stale ? compareAssistantDrafts(current.plan, proposal.plan).filter((row) => row.index === current.index) : [];
    return `<details class="assistant-tool-section" ${this.open ? 'open' : ''}><summary>单画面重分析 · 画面 ${current.index + 1}</summary>
      <label class="ui-field"><span>本次修改要求</span><textarea data-scene-instruction aria-label="单画面修改要求" rows="2" maxlength="4000">${esc(this.instruction)}</textarea></label>
      <div class="assistant-scene-locks" role="group" aria-label="保留画面字段">${SCENE_LOCK_FIELDS.map(([key, label]) =>
        `<label><input type="checkbox" data-scene-lock="${key}" ${this.locks.includes(key) ? 'checked' : ''} ${this.disabled() ? 'disabled' : ''} /><span>保留${label}</span></label>`).join('')}</div>
      <div class="assistant-actions">${button('run', 'refresh-cw', '重新分析此画面', this.disabled())}
        ${proposal ? button('adopt', 'check', '采用此画面修改', this.disabled() || stale) + button('discard', 'x', '放弃修改', this.disabled()) : ''}</div>
      ${stale ? '<p class="assistant-error">草稿、上下文或模型设置已变化，请重新分析此画面。</p>' : ''}
      ${proposal && !stale ? `<div aria-label="单画面修改预览">${changes.length ? changes.map((row) => `<section class="assistant-draft-change"><strong>${esc(row.field)}</strong><div class="assistant-draft-columns"><div><span>当前</span><pre>${esc(row.before)}</pre></div><div><span>修改后</span><pre>${esc(row.after)}</pre></div></div></section>`).join('') : '<p class="assistant-context">没有字段变化。</p>'}</div>` : ''}
      <p class="assistant-error" role="alert" ${this.error ? '' : 'hidden'}>${esc(this.error)}</p>
    </details>`;
  }
  bind(host) {
    this.root = host.querySelector('[data-assistant-scene-root]');
    if (!this.root || this.root.dataset.bound) return;
    this.root.dataset.bound = 'true';
    this.root.addEventListener('input', (event) => {
      if (event.target.matches('[data-scene-instruction]')) this.instruction = event.target.value;
    });
    this.root.addEventListener('change', (event) => {
      const key = event.target.dataset.sceneLock;
      if (!key || this.disabled()) return;
      this.locks = event.target.checked ? [...new Set([...this.locks, key])] : this.locks.filter((value) => value !== key);
      this.proposal = null; this.render();
    });
    this.root.addEventListener('click', (event) => {
      const action = event.target.closest('[data-scene-action]')?.dataset.sceneAction;
      if (action) void this.click(action);
    });
  }
  async click(action) {
    if (this.disabled()) return;
    this.error = '';
    try {
      if (action === 'discard') this.proposal = null;
      if (action === 'run') {
        const revision = this.revision();
        const result = await this.analyze(this.instruction, [...this.locks]);
        if (revision !== this.revision()) throw new Error('草稿或设置已变化，请重新分析此画面');
        this.proposal = { ...result, revision };
      }
      if (action === 'adopt') {
        if (!this.proposal || this.stale()) throw new Error('草稿或设置已变化，请重新分析此画面');
        this.applying = true; this.render();
        try { await this.adopt(this.proposal); this.proposal = null; }
        finally { this.applying = false; }
      }
    } catch (error) { this.error = error.message; }
    this.render();
  }
  render() {
    if (!this.root?.isConnected) return;
    this.open = this.root.querySelector('details')?.open ?? this.open;
    this.root.innerHTML = this.content(); paintIcons(this.root);
  }
}
