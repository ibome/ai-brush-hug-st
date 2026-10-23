import { escapeHtml as esc } from '../config.js';
import { icon, paintIcons } from '../icons.js';
import { CONTEXT_SELECTION_LIMIT } from '../assistant-context.js';

const command = (action, glyph, label, disabled = false) => `<button type="button" class="ui-button secondary" data-context-action="${action}" ${disabled ? 'disabled' : ''}>${icon(glyph)}<span>${label}</span></button>`;
export class AssistantContextPanel {
  constructor(options) { Object.assign(this, options); this.selection = null; this.context = null; this.error = ''; this.busy = false; }
  reset() { this.epoch = (this.epoch || 0) + 1; this.selection = null; this.context = null; this.usage = null; this.error = ''; this.busy = false; this.render(); }
  html() {
    if (this.root?.isConnected) this.open = this.root.querySelector('details')?.open;
    return `<div data-assistant-context-root>${this.content()}</div>`;
  }
  content() {
    const context = this.context, preview = context?.contextPreview, usage = this.usage;
    return `<details class="assistant-tool-section" ${this.open ? 'open' : ''}><summary>上下文选择与用量</summary>
      <div class="assistant-actions">${command('read', 'list-checks', this.busy ? '正在读取…' : '读取聊天上下文', this.busy || this.disabled())}
        ${command('auto', 'rotate-ccw', '恢复自动选择', this.busy || this.disabled())}
        ${command('preview', 'eye', '预览完整请求', this.busy || this.disabled())}</div>
      <p class="assistant-context">${this.selection ? '手动选择 · 仅本次聊天页面有效' : '自动选择 · 使用最近消息数设置'}</p>
      ${preview ? `<div class="assistant-context-list">${preview.catalogue.map((row) => {
        const checked = this.selection ? this.selection.messages.some((entry) => entry.index === row.index) : row.selected;
        return `<label class="assistant-context-message"><input type="checkbox" data-context-index="${row.index}" aria-label="上下文消息 ${row.index + 1}" ${checked ? 'checked' : ''} ${this.busy || this.disabled() ? 'disabled' : ''} />
          <span><strong>${row.index + 1} · ${esc(row.name || row.role)}</strong><small>${row.includedCharacters} / ${row.originalCharacters} 字符${checked && row.includedCharacters < row.originalCharacters ? ' · 已截断或未纳入' : ''}</small><span>${esc(row.excerpt)}</span></span></label>`;
      }).join('')}</div>
      <p class="assistant-context">实际聊天 ${context.messages.length} 条；当前目标回复另行完整提取（上限 32000 字符）。聊天超出上限时保留较新的内容。</p>
      ${Object.values(context.truncation || {}).some(Boolean) ? `<p class="assistant-error">额外截断：目标 ${context.truncation.target} · 角色 ${context.truncation.characters} · 世界书 ${context.truncation.world} 字符</p>` : ''}
      <details><summary>实际纳入的聊天内容</summary>${preview.included.map((row) => `<section><strong>消息 ${row.index + 1}</strong><pre>${esc(row.content)}</pre></section>`).join('') || '<p>未纳入聊天历史</p>'}</details>` : ''}
      ${usage ? `<dl class="assistant-tool-facts" aria-label="助手用量估算"><dt>估算输入</dt><dd>约 ${usage.input} Token</dd><dt>最大输出</dt><dd>${usage.outputLimit} Token</dd><dt>输入＋输出上限</dt><dd>约 ${usage.totalLimit} Token</dd><dt>聊天 / 目标 / 角色 / 世界书</dt><dd>约 ${usage.chat} / ${usage.target} / ${usage.characters} / ${usage.world} Token</dd></dl>
        <p class="assistant-context">按字符估算，实际用量以接口为准。完整请求含助手规则、角色档与所有启用预设条目；预设按酒馆顺序发送。</p>` : ''}
      <p class="assistant-error" role="alert" ${this.error ? '' : 'hidden'}>${esc(this.error)}</p>
    </details>`;
  }
  show(context, usage) { this.context = context; this.usage = usage; this.render(); }
  bind(host) {
    this.root = host.querySelector('[data-assistant-context-root]');
    if (!this.root || this.root.dataset.bound) return;
    this.root.dataset.bound = 'true';
    this.root.addEventListener('change', (event) => {
      if (!event.target.matches('[data-context-index]')) return;
      if (!this.context || this.disabled()) return;
      const chosen = this.selection?.messages || this.context.contextSelection.messages;
      const index = Number(event.target.dataset.contextIndex), candidate = this.context.contextPreview.catalogue.find((row) => row.index === index);
      if (!candidate) return;
      const rows = chosen.filter((row) => row.index !== index);
      if (event.target.checked) rows.push({ index, revision: candidate.revision });
      if (rows.length > CONTEXT_SELECTION_LIMIT) { event.target.checked = false; this.error = '最多选择 40 条消息'; this.render(); return; }
      this.selection = { chatKey: this.context.chatKey, messages: rows.sort((a, b) => a.index - b.index) };
      void this.refresh();
    });
    this.root.addEventListener('click', (event) => {
      const action = event.target.closest('[data-context-action]')?.dataset.contextAction;
      if (!action || this.busy || this.disabled()) return;
      if (action === 'auto') this.selection = null;
      if (action === 'preview') { void this.preview(); return; }
      void this.refresh();
    });
  }
  async refresh() {
    const epoch = this.epoch = (this.epoch || 0) + 1;
    this.busy = true; this.error = ''; this.render();
    try {
      const context = await this.read(this.selection);
      if (epoch !== this.epoch) return;
      this.context = context; this.usage = null;
    } catch (error) { if (epoch === this.epoch) this.error = error.message; }
    finally { if (epoch === this.epoch) { this.busy = false; this.render(); } }
  }
  render() {
    if (!this.root?.isConnected) return;
    this.open = this.root.querySelector('details')?.open ?? this.open;
    const scroll = this.root.querySelector('.assistant-context-list')?.scrollTop || 0;
    this.root.innerHTML = this.content(); paintIcons(this.root);
    this.root.querySelector('.assistant-context-list')?.scrollTo(0, scroll);
  }
}
