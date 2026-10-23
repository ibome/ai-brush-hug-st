import { escapeHtml as esc } from '../config.js';
import { icon, paintIcons } from '../icons.js';
import { selectedAssistantPresetEntries } from '../assistant-presets.js';
import { estimateTokens } from '../assistant-context.js';

const button = (action, glyph, label, disabled = false) => `<button type="button" class="ui-button secondary" data-assistant-preset-action="${action}" ${disabled ? 'disabled' : ''}>${icon(glyph)}<span>${label}</span></button>`;

export class AssistantPresetPanel {
  constructor(options) {
    Object.assign(this, options);
    this.ui = { directory: { presets: [], current: null }, preset: null, loading: false, loaded: false, error: '' };
    this.epoch = 0;
  }

  html() { return `<div data-assistant-preset-root>${this.content()}</div>`; }

  content() {
    const settings = this.settings(), ui = this.ui;
    const active = settings.presetMode !== 'none';
    return `<div class="settings-band-heading"><h2>${icon('book-open')}酒馆提示词预设</h2></div>
      <label class="ui-field"><span>预设来源</span><select data-assistant-preset-mode aria-label="助手预设来源">
        ${[['none', '仅助手内置规则'], ['current', '跟随当前酒馆预设'], ['named', '指定酒馆预设']].map(([id, name]) =>
          `<option value="${id}" ${settings.presetMode === id ? 'selected' : ''}>${name}</option>`).join('')}
      </select></label>
      ${settings.presetMode === 'named' ? `<label class="ui-field"><span>酒馆预设</span><select data-assistant-preset-id aria-label="助手指定预设">
        <option value="">请选择预设</option>${ui.directory.presets.map((item) =>
          `<option value="${esc(item.id)}" ${settings.presetId === item.id ? 'selected' : ''}>${esc(item.kind)} · ${esc(item.name)}</option>`).join('')}
        ${settings.presetId && !ui.directory.presets.some((item) => item.id === settings.presetId)
          ? `<option value="${esc(settings.presetId)}" selected>原预设不可用，请重新选择</option>` : ''}
      </select></label>` : ''}
      ${settings.presetMode === 'current' ? `<p class="assistant-context">当前：${esc(ui.directory.current?.name || '未读取')}</p>` : ''}
      <div class="assistant-actions">
        ${button('refresh', 'refresh-cw', '读取预设', ui.loading)}
        ${button('preview', 'eye', '预览请求', ui.loading)}
        ${settings.presetMode === 'named' ? button('defaults', 'rotate-ccw', '恢复原勾选', ui.loading || !ui.preset) : ''}
      </div>
      <p class="assistant-context" data-assistant-preset-status role="status">${ui.loading ? '正在读取预设…' : this.summary()}</p>
      <p class="assistant-error" data-assistant-preset-error role="alert" ${ui.error ? '' : 'hidden'}>${esc(ui.error)}</p>
      ${active && ui.preset ? `<details class="assistant-preset-details" open><summary>预设条目 · ${esc(ui.preset.name)} · ${(ui.preset.rows || ui.preset.entries).length} 条</summary>
        <div class="assistant-preset-entries" data-assistant-preset-list="native">${this.entries()}</div></details>
        ${ui.preset.unlistedRows?.length ? `<details class="assistant-preset-details" data-assistant-preset-unlisted><summary>未加入酒馆列表 · ${ui.preset.unlistedRows.length} 条</summary>
          <div class="assistant-preset-entries" data-assistant-preset-list="unlisted">${this.entries(ui.preset.unlistedRows)}</div></details>` : ''}
        ${ui.preset.warnings.map((warning) => `<p class="assistant-context">${esc(warning)}</p>`).join('')}
        <p class="assistant-context" data-assistant-preset-macros>${esc(this.macroWarning())}</p>` : ''}`;
  }

  selection() {
    try { return selectedAssistantPresetEntries(this.ui.preset, this.settings()); }
    catch { return []; }
  }

  summary() {
    if (this.settings().presetMode === 'none') return '使用助手内置规则';
    if (!this.ui.preset) return '尚未读取预设';
    const entries = this.selection();
    return `${this.settings().presetMode === 'current' ? '酒馆已开启' : '已勾选'} ${entries.length} 条文字 · ${entries.reduce((sum, item) => sum + item.content.length, 0)} 字符`;
  }

  macroWarning() {
    const macros = [...new Set(this.selection().flatMap((entry) => entry.unresolved))];
    return macros.length ? `未展开宏：${macros.slice(0, 12).join('、')}${macros.length > 12 ? '…' : ''}。将作为普通文本发送，不执行变量写入或脚本。` : '';
  }

  entries(rows = this.ui.preset.rows || this.ui.preset.entries) {
    const selected = new Set(this.selection().map((entry) => entry.id));
    const following = this.settings().presetMode === 'current';
    const byId = new Map(this.ui.preset.entries.map((entry) => [entry.id, entry]));
    return rows.map((row) => {
      const entry = byId.get(row.id);
      if (!entry) {
        const status = { marker: '占位条目 · 由助手上下文提供', empty: '空白条目 · 不发送',
          unsupported: '消息类型不支持 · 不发送' }[row.kind] || '不发送';
        return `<div class="assistant-preset-entry" data-assistant-preset-row="${esc(row.id)}">
          <label><input type="checkbox" ${row.enabled ? 'checked' : ''} disabled />
            <span><strong>${esc(row.name)}</strong><small>${status}${row.enabled ? '' : ' · 原预设未启用'}</small></span></label></div>`;
      }
      return `<div class="assistant-preset-entry" data-assistant-preset-row="${esc(entry.id)}">
      <label><input type="checkbox" data-assistant-preset-entry="${esc(entry.id)}" ${selected.has(entry.id) ? 'checked' : ''} ${following ? 'disabled' : ''} />
        <span><strong>${esc(entry.name)}</strong><small>${esc(entry.role)} · ${entry.content.length} 字符${entry.enabled ? '' : ' · 原预设未启用'}</small></span></label>
      <details><summary>查看内容</summary><pre>${esc(entry.content)}</pre></details></div>`;
    }).join('');
  }

  bind(host) {
    this.root = host.querySelector('[data-assistant-preset-root]');
    if (!this.root || this.root.dataset.bound) return;
    this.root.dataset.bound = 'true';
    this.root.addEventListener('change', (event) => { void this.change(event); });
    this.root.addEventListener('click', (event) => {
      const action = event.target.closest('[data-assistant-preset-action]')?.dataset.assistantPresetAction;
      if (action) void this.click(action);
    });
    if (!this.ui.loaded && !this.ui.loading && this.available()) void this.refresh();
  }

  render() {
    if (!this.root?.isConnected) return;
    const scrolls = new Map([...this.root.querySelectorAll('[data-assistant-preset-list]')].map((list) =>
      [list.dataset.assistantPresetList, list.scrollTop]));
    const unlistedOpen = this.root.querySelector('[data-assistant-preset-unlisted]')?.open;
    const expanded = new Set([...this.root.querySelectorAll('.assistant-preset-entry')].filter((row) =>
      row.querySelector('details')?.open).map((row) => row.querySelector('input').dataset.assistantPresetEntry));
    const control = document.activeElement;
    const restore = control?.matches('[data-assistant-preset-mode]') ? '[data-assistant-preset-mode]'
      : control?.matches('[data-assistant-preset-id]') ? '[data-assistant-preset-id]' : null;
    this.root.innerHTML = this.content();
    const unlisted = this.root.querySelector('[data-assistant-preset-unlisted]');
    if (unlisted) unlisted.open = Boolean(unlistedOpen);
    for (const list of this.root.querySelectorAll('[data-assistant-preset-list]')) {
      list.scrollTo(0, scrolls.get(list.dataset.assistantPresetList) || 0);
    }
    for (const row of this.root.querySelectorAll('.assistant-preset-entry')) {
      if (expanded.has(row.querySelector('input').dataset.assistantPresetEntry)) row.querySelector('details').open = true;
    }
    if (restore) this.root.querySelector(restore)?.focus({ preventScroll: true });
    paintIcons(this.root);
  }

  async refresh() {
    const epoch = ++this.epoch, settings = structuredClone(this.settings());
    this.ui.loading = true; this.ui.error = ''; this.ui.preset = null; this.render();
    try {
      const directory = await this.request('presets');
      if (epoch !== this.epoch) return;
      this.ui.directory = directory;
      const preset = settings.presetMode === 'none' ? null : await this.request('preset', { settings });
      if (epoch !== this.epoch) return;
      this.ui.preset = preset;
      selectedAssistantPresetEntries(this.ui.preset, settings);
    } catch (error) { if (epoch === this.epoch) this.ui.error = error.message; }
    finally { if (epoch === this.epoch) { this.ui.loading = false; this.ui.loaded = true; this.render(); } }
  }

  async change(event) {
    const input = event.target;
    if (input.matches('[data-assistant-preset-mode]')) {
      this.update({ presetMode: input.value }); await this.refresh();
    } else if (input.matches('[data-assistant-preset-id]')) {
      this.update({ presetId: input.value }); await this.refresh();
    } else if (input.matches('[data-assistant-preset-entry]') && this.ui.preset) {
      if (this.settings().presetMode === 'current') return;
      const entries = [...this.root.querySelectorAll('[data-assistant-preset-entry]:checked')].map((node) => node.dataset.assistantPresetEntry);
      this.update({ presetSelection: { id: this.ui.preset.id, entries } });
      this.root.querySelector('[data-assistant-preset-status]').textContent = this.summary();
      this.root.querySelector('[data-assistant-preset-macros]').textContent = this.macroWarning();
      this.ui.error = '';
      this.root.querySelector('[data-assistant-preset-error]').hidden = true;
    }
  }

  async click(action) {
    if (this.ui.loading) return;
    if (action === 'refresh') { await this.refresh(); return; }
    if (action === 'defaults') {
      if (this.settings().presetMode !== 'named') return;
      this.update({ presetSelection: null }); this.ui.error = ''; this.render(); return;
    }
    if (action === 'preview') {
      this.ui.loading = true; this.ui.error = ''; this.render();
      try { this.openPreview(await this.preview()); }
      catch (error) { this.ui.error = error.message; }
      finally { this.ui.loading = false; this.render(); }
    }
  }

  openPreview(messages) {
    this.dialog?.close(); this.dialog?.remove();
    const dialog = document.createElement('dialog');
    this.dialog = dialog;
    dialog.className = 'assistant-preset-preview';
    dialog.setAttribute('aria-label', '助手请求预览');
    dialog.innerHTML = `<header><h2>助手请求预览</h2><button type="button" class="ui-icon-button" title="关闭预览" aria-label="关闭预览">${icon('x')}</button></header>
      <div class="assistant-preset-preview-body">${messages.map((item, index) =>
        `<section><h3>${index + 1} · ${esc(item.role)}</h3><pre>${esc(item.content)}</pre></section>`).join('')}</div>
      <footer>${messages.length} 条消息 · ${messages.reduce((sum, item) => sum + item.content.length, 0)} 字符 · 估算输入约 ${messages.reduce((sum, item) => sum + estimateTokens(item.content) + 4, 3)} Token · 未调用模型</footer>`;
    dialog.querySelector('button').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { dialog.remove(); if (this.dialog === dialog) this.dialog = null; }, { once: true });
    document.body.append(dialog); paintIcons(dialog); dialog.showModal();
  }
}
