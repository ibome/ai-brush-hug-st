import { escapeHtml as esc, downloadJson } from '../config.js';
import { icon, paintIcons } from '../icons.js';
import { createAssistantTrace } from '../assistant-diagnostics.js';
import { BUILTIN_ASSISTANT_SCHEMES, saveAssistantScheme, importAssistantSchemes, exportAssistantSchemes } from '../assistant-schemes.js';
import { assistantPlanRevision, checkAssistantPlan, fixAssistantPlan } from '../assistant-lint.js';

const button = (prefix, action, glyph, title, disabled = false) =>
  `<button type="button" class="ui-button secondary" data-${prefix}-action="${action}" ${disabled ? 'disabled' : ''}>${icon(glyph)}<span>${title}</span></button>`;
const status = { running: '进行中', success: '成功', failed: '失败', cancelled: '已取消' };
const stageNames = { context: '提取上下文', preset: '组装预设', request: '调用模型', parse: '解析结果', validate: '核对草稿', save: '保存草稿' };
const operationNames = { generate: '生成提示词', translate: '翻译', polish: '润色', illustrate: '聊天配图', profile: '创建角色档', edit: '单图编辑', comic: '漫画分镜' };
const routeNames = { native: '原生调用', 'tavern-backend': '酒馆接口', 'independent-api': '设备直连', 'independent-tavern': '独立 API · 酒馆转发' };
const modeNames = { text: '普通 JSON 回复', json: '接口 JSON 模式', tool: '工具调用' };
const errorNames = { cancelled: '已取消', timeout: '超时', authentication: '认证或秘钥异常', 'rate-limit': '请求限流',
  network: '连接异常', preset: '预设配置异常', response: '模型回复异常', changed: '原文或配置已改变', 'local-or-upstream': '本地或上游调用异常' };

function renderPartial(panel) {
  if (!panel.root?.isConnected) return;
  const open = panel.root.querySelector('details')?.open;
  if (open !== undefined) panel.open = open;
  panel.root.innerHTML = panel.content();
  const details = panel.root.querySelector('details');
  if (details && open !== undefined) details.open = open;
  paintIcons(panel.root);
}
function toolHTML(panel, attribute) {
  if (panel.root?.isConnected) panel.open = panel.root.querySelector('details')?.open ?? panel.open;
  return `<div ${attribute}>${panel.content()}</div>`;
}

export class AssistantDiagnosticPanel {
  constructor(options) { Object.assign(this, options); this.traces = []; this.selected = 0; this.copyStatus = ''; }
  start(operation, settings) {
    const trace = createAssistantTrace(operation, settings, { ...this.release, changed: () => this.render() });
    this.traces.unshift(trace); this.traces.length = Math.min(8, this.traces.length); this.selected = 0; this.copyStatus = ''; this.copyText = '';
    this.render(); return trace;
  }
  html() { return toolHTML(this, 'data-assistant-diagnostic-root'); }
  content() {
    const trace = this.traces[this.selected], row = trace?.record;
    return `<details class="assistant-tool-section" ${this.open ? 'open' : ''}><summary>助手调用诊断${row ? ` · ${status[row.status]}` : ''}</summary>
      ${this.traces.length ? `<label class="ui-field"><span>最近调用</span><select data-assistant-diagnostic-run aria-label="最近助手调用">
        ${this.traces.map((item, index) => `<option value="${index}" ${index === this.selected ? 'selected' : ''}>${esc(operationNames[item.record.operation])} · ${status[item.record.status]} · ${new Date(item.record.createdAt).toLocaleTimeString()}</option>`).join('')}</select></label>
        <dl class="assistant-tool-facts"><dt>实际模型</dt><dd>${esc(row.execution.model || (row.status === 'running' ? '尚未提交' : '酒馆未提供模型标识'))}</dd>
          <dt>来源</dt><dd>${row.source === 'api' ? '独立 API' : '酒馆'} · ${routeNames[row.execution.route] || '尚未提交'} · ${modeNames[row.responseMode]}</dd>
          <dt>耗时</dt><dd>${(row.durationMs / 1000).toFixed(2)} 秒${row.errorCategory ? ` · ${errorNames[row.errorCategory] || '调用异常'}` : ''}</dd>
        </dl>
        <ol class="assistant-diagnostic-stages">${row.stages.map((item) => `<li>${stageNames[item.stage]} <span>${(item.durationMs / 1000).toFixed(2)} 秒</span></li>`).join('')}</ol>
        ${row.presetOrder.length ? `<details><summary>实际发送的预设顺序 · ${row.presetOrder.length} 条</summary><ol class="assistant-diagnostic-order">${row.presetOrder.map((item, index) =>
          `<li>${esc(trace.presetNames[index] || `条目 ${index + 1}`)} <small>${item.role} · ${item.characters} 字符</small></li>`).join('')}</ol></details>` : '<p class="assistant-context">本次尚无预设文字条目。</p>'}
        <p class="assistant-context">发送 ${row.messages.length} 条消息 · ${row.messages.reduce((sum, item) => sum + item.characters, 0)} 字符</p>` : ''}
      <div class="assistant-actions">
        ${button('diagnostic', 'copy', 'copy', '复制脱敏诊断', !row || row.status === 'running')}
        ${button('diagnostic', 'preview', 'eye', '预览当前请求')}
        ${button('diagnostic', 'failure', 'message-square', '查看失败回复', !this.hasFailure())}
        ${button('diagnostic', 'network', 'scan', '检测助手网络', this.settings().source !== 'api')}
        ${button('diagnostic', 'clear', 'trash-2', '清除诊断', !row || this.traces.some((item) => item.record.status === 'running'))}
      </div>
      <p class="assistant-context" role="status">${esc(this.copyStatus)}</p>
      ${this.copyText ? `<textarea rows="5" readonly data-diagnostic-copy aria-label="脱敏调用诊断">${esc(this.copyText)}</textarea>` : ''}
    </details>`;
  }
  bind(host) {
    this.root = host.querySelector('[data-assistant-diagnostic-root]');
    if (!this.root || this.root.dataset.bound) return;
    this.root.dataset.bound = 'true';
    this.root.addEventListener('change', (event) => {
      if (event.target.matches('[data-assistant-diagnostic-run]')) {
        this.selected = Number(event.target.value); this.copyText = ''; this.copyStatus = ''; this.render();
      }
    });
    this.root.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-diagnostic-action]')?.dataset.diagnosticAction;
      if (!action) return;
      try {
        if (action === 'preview') await this.preview();
        if (action === 'failure') this.failure();
        if (action === 'network') this.network();
        if (action === 'clear' && !this.traces.some((item) => item.record.status === 'running')) {
          this.traces = []; this.selected = 0; this.copyText = ''; this.copyStatus = ''; this.render();
        }
        if (action === 'copy') {
          const trace = this.traces[this.selected];
          if (!trace || trace.record.status === 'running') return;
          this.copyText = JSON.stringify(trace.report(), null, 2);
          try { await navigator.clipboard.writeText(this.copyText); this.copyStatus = '脱敏诊断已复制'; }
          catch { this.copyStatus = '请在下方长按复制诊断'; }
          this.render();
          if (this.copyStatus.startsWith('请')) this.root.querySelector('[data-diagnostic-copy]')?.select();
        }
      } catch { this.copyStatus = '操作未完成，请检查当前助手配置'; this.render(); }
    });
  }
  render() { renderPartial(this); }
}

export class AssistantSchemePanel {
  constructor(options) { Object.assign(this, options); this.selected = this.active() || 'builtin-daily'; this.name = ''; this.error = ''; this.busy = false; this.open = true; }
  html() { return toolHTML(this, 'data-assistant-scheme-root'); }
  content() {
    const rows = [...BUILTIN_ASSISTANT_SCHEMES, ...this.library()], row = rows.find((item) => item.id === this.selected);
    const builtin = BUILTIN_ASSISTANT_SCHEMES.includes(row);
    const settings = row?.settings;
    return `<details class="assistant-tool-section" ${this.open ? 'open' : ''}><summary>助手方案库</summary>
      <label class="ui-field"><span>方案</span><select data-scheme-select aria-label="助手方案" ${this.busy ? 'disabled' : ''}>
        <optgroup label="内置方案">${BUILTIN_ASSISTANT_SCHEMES.map((item) => `<option value="${item.id}" ${this.selected === item.id ? 'selected' : ''}>${item.name}</option>`).join('')}</optgroup>
        <optgroup label="我的方案">${this.library().map((item) => `<option value="${item.id}" ${this.selected === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</optgroup>
      </select></label>
      ${settings ? `<p class="assistant-context">${builtin ? '保留当前接口、秘钥和酒馆预设' : `${settings.source === 'api' ? '独立 API' : '跟随酒馆'} · ${esc(settings.source === 'api' ? settings.model || '未选模型' : settings.tavernModel || '酒馆当前模型')} · 自动生图${settings.autoImage ? '开启' : '关闭'}`} · ${settings.illustrationCount} 个画面 · 每画面 ${settings.count} 张${!builtin && settings.source === 'api' && !settings.keyRef ? ' · 载入后需填写秘钥' : ''}</p>` : ''}
      <div class="assistant-actions">${button('scheme', 'load', 'folder-open', '载入方案', this.busy || !row)}
        ${button('scheme', 'update', 'save', '更新方案', this.busy || builtin || !row)}
        ${button('scheme', 'delete', 'trash-2', '删除方案', this.busy || builtin || !row)}</div>
      <label class="ui-field"><span>方案名称</span><input data-scheme-name aria-label="助手方案名称" maxlength="60" value="${esc(this.name)}" ${this.busy ? 'disabled' : ''} /></label>
      <div class="assistant-actions">${button('scheme', 'save', 'plus', '另存为方案', this.busy)}
        ${button('scheme', 'export', 'download', '导出方案库', this.busy || !this.library().length)}
        ${button('scheme', 'import', 'upload', '导入方案库', this.busy)}</div>
      <input type="file" data-scheme-file accept="application/json,.json" hidden />
      <p class="assistant-error" role="alert" ${this.error ? '' : 'hidden'}>${esc(this.error)}</p>
      <p class="assistant-context" role="status">${esc(this.message || '')}</p>
    </details>`;
  }
  bind(host) {
    this.root = host.querySelector('[data-assistant-scheme-root]');
    if (!this.root || this.root.dataset.bound) return;
    this.root.dataset.bound = 'true';
    this.root.addEventListener('input', (event) => {
      if (event.target.matches('[data-scheme-name]')) this.name = event.target.value;
    });
    this.root.addEventListener('change', (event) => {
      if (event.target.matches('[data-scheme-select]')) {
        this.selected = event.target.value; this.error = ''; this.message = ''; this.render();
      }
      if (event.target.matches('[data-scheme-file]')) void this.importFile(event.target.files[0]);
    });
    this.root.addEventListener('click', (event) => {
      const action = event.target.closest('[data-scheme-action]')?.dataset.schemeAction;
      if (action) void this.click(action);
    });
  }
  async importFile(file) {
    if (!file || this.busy) return;
    this.busy = true; this.error = ''; this.render();
    try {
      if (file.size > 400000) throw new Error('方案文件超过 400 KB');
      const next = importAssistantSchemes(this.library(), JSON.parse(await file.text()));
      this.updateLibrary(next, this.active()); this.message = '方案已导入；共享文件不含秘钥，请在载入后核对接口';
    } catch (error) { this.error = error instanceof SyntaxError ? '方案文件不是有效 JSON' : error.message; }
    finally { this.busy = false; this.render(); }
  }
  async click(action) {
    if (this.busy) return;
    if (action === 'import') { this.root.querySelector('[data-scheme-file]').click(); return; }
    if (action === 'export') { downloadJson('灵画师-助手方案.json', exportAssistantSchemes(this.library())); return; }
    this.busy = true; this.error = ''; this.message = ''; this.render();
    try {
      if (action === 'load') { await this.load(this.selected); this.message = '方案已载入'; }
      if (action === 'save' || action === 'update') {
        const row = this.library().find((item) => item.id === this.selected);
        const name = action === 'update' ? row?.name : this.name.trim();
        if (!name) throw new Error('请填写方案名称');
        const settings = await this.capture();
        const result = saveAssistantScheme(this.library(), { id: action === 'update' ? row?.id : undefined, name, settings });
        this.updateLibrary(result.library, result.id); this.selected = result.id; this.message = '完整助手配置已保存'; this.name = '';
      }
      if (action === 'delete') {
        const next = this.library().filter((item) => item.id !== this.selected);
        this.updateLibrary(next, this.active() === this.selected ? '' : this.active());
        this.selected = next[0]?.id || 'builtin-daily'; this.message = '方案已删除';
      }
    } catch (error) { this.error = error.message; }
    finally { this.busy = false; this.render(); }
  }
  render() { renderPartial(this); }
}

export class AssistantLintPanel {
  constructor(options) { Object.assign(this, options); this.issues = null; this.revision = ''; this.busy = false; this.error = ''; this.open = true; }
  html() { return toolHTML(this, 'data-assistant-lint-root'); }
  content() {
    const { plan, index } = this.current();
    const stale = this.issues && (this.revision !== assistantPlanRevision(plan) || index !== this.index);
    return `<details class="assistant-tool-section" ${this.open ? 'open' : ''}><summary>提示词检查</summary>
      <div class="assistant-actions">${button('lint', 'check', 'scan', '检查当前画面', !plan || this.busy)}
        ${button('lint', 'undo', 'undo-2', '撤销上次修正', this.busy || !this.undo || this.undo.after !== assistantPlanRevision(plan))}</div>
      ${stale ? '<p class="assistant-context">草稿已改变，请重新检查。</p>' : this.issues ? this.issues.length
        ? `<ul class="assistant-lint-issues">${this.issues.map((row) => `<li><span>${esc(row.message)}</span>${row.fix
          ? button('lint', row.id, row.fix === 'clear-anchor' ? 'x' : 'wand-sparkles', row.fix === 'deduplicate' ? '去除重复标签' : row.fix === 'clear-anchor' ? '清除定位句' : '补回角色条目', this.busy) : ''}</li>`).join('')}</ul>`
        : '<p class="assistant-context" role="status">未发现可识别的问题。</p>' : ''}
      <p class="assistant-error" role="alert" ${this.error ? '' : 'hidden'}>${esc(this.error)}</p>
    </details>`;
  }
  bind(host) {
    this.root = host.querySelector('[data-assistant-lint-root]');
    if (!this.root || this.root.dataset.bound) return;
    this.root.dataset.bound = 'true';
    this.root.addEventListener('click', (event) => {
      const action = event.target.closest('[data-lint-action]')?.dataset.lintAction;
      if (action) void this.click(action);
    });
  }
  async click(action) {
    if (this.busy) return;
    this.error = '';
    try {
      if (action === 'check') {
        this.busy = true; this.render();
        const before = this.current(), revision = assistantPlanRevision(before.plan);
        const target = await this.target();
        const now = this.current();
        if (revision !== assistantPlanRevision(now.plan) || before.index !== now.index) throw new Error('草稿已改变，请重新检查');
        this.index = now.index; this.revision = revision; this.source = target;
        this.issues = checkAssistantPlan(now.plan, { target, shotIndex: now.index });
      } else if (action === 'undo') {
        const { plan } = this.current();
        if (!this.undo || this.undo.after !== assistantPlanRevision(plan)) throw new Error('草稿已改变，无法撤销');
        this.apply(this.undo.before); this.undo = null; this.issues = null;
      } else {
        const { plan, index } = this.current();
        if (index !== this.index) throw new Error('画面已切换，请重新检查');
        const next = fixAssistantPlan(plan, action, { target: this.source, shotIndex: index, revision: this.revision });
        this.apply(next);
        this.undo = { before: plan, after: assistantPlanRevision(next) };
        this.revision = assistantPlanRevision(next);
        this.issues = checkAssistantPlan(next, { target: this.source, shotIndex: index });
      }
    } catch (error) { this.error = error.message; }
    finally { this.busy = false; this.render(); }
  }
  render() { renderPartial(this); }
}
