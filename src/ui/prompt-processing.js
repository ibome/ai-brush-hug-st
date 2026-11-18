import { escapeHtml as esc, downloadJson } from '../config.js';
import { icon, paintIcons } from '../icons.js';
import { FIELD_SCHEMES, FIELD_TEMPLATES, validateFieldSettings } from '../multi-character-fields.js';
import { normalizePromptProcessing, saveTriggerRule, importTriggerRules, exportTriggerRules, TRIGGER_SOURCES, TRIGGER_TARGETS } from '../prompt-triggers.js';
import '../styles/prompt-processing.css';

const field = (label, body) => `<label class="ui-field"><span>${label}</span>${body}</label>`;
const command = (glyph, label, action) => `<button type="button" class="ui-button secondary" data-processing-action="${action}">${icon(glyph)}<span>${label}</span></button>`;
const options = (rows, value) => rows.map(([id, title]) => `<option value="${id}" ${id === value ? 'selected' : ''}>${esc(title)}</option>`).join('');
const toggle = (key, title, checked) => `<label class="processing-toggle"><input type="checkbox" data-processing-toggle="${key}" ${checked ? 'checked' : ''} /><span>${esc(title)}</span></label>`;

export class PromptProcessingPanel {
  constructor({ getSettings, setSettings, preview, render, notify }) {
    Object.assign(this, { getSettings, setSettings, preview, render, notify });
    this.ui = { fields: null, draft: null, error: '', result: null };
  }
  html() {
    const settings = normalizePromptProcessing(this.getSettings()), fields = this.ui.fields || settings.fields;
    const templates = fields.scheme === 'custom' ? fields.custom : FIELD_TEMPLATES[fields.scheme] || FIELD_TEMPLATES.classic;
    const draft = this.ui.draft || { aliases: [], replacement: '', target: 'all', source: 'custom' };
    return `<div class="page-heading"><div><h1>提示词处理</h1></div><span data-workspace-save role="status"></span></div>
      <div data-processing-root>
        <section class="settings-band">
          <div class="settings-band-heading"><h2>${icon('scan-text')}多角色字段格式</h2></div>
          ${field('字段方案', `<select data-processing-scheme>${options(FIELD_SCHEMES, fields.scheme)}</select>`)}
          <div class="processing-fields">${[
            ['scene', '公共场景字段头'], ['positive', '人物正向字段头'], ['negative', '人物负面字段头'], ['globalNegative', '全局负面字段头'],
          ].map(([key, title]) => field(title, `<input data-processing-field="${key}" value="${esc(templates[key])}" maxlength="160" spellcheck="false" ${fields.scheme === 'custom' ? '' : 'readonly'} />`)).join('')}</div>
          ${command('save', '保存字段方案', 'fields-save')}
        </section>
        <section class="settings-band">
          <div class="settings-band-heading"><h2>${icon('replace')}触发词替换</h2></div>
          ${toggle('enabled', '生图前自动替换触发词', settings.enabled)}
          <div class="processing-sources">${TRIGGER_SOURCES.map(([key, title]) => toggle(`source:${key}`, title, settings.sources[key])).join('')}</div>
          <div class="processing-rule-form">
            ${field('触发词（多个别名用 | 分隔）', `<input data-processing-rule="aliases" value="${esc(draft.aliases.join(' | '))}" maxlength="1300" placeholder="爱丽丝 | alice" autocomplete="off" />`)}
            ${field('替换内容', `<textarea rows="3" data-processing-rule="replacement" maxlength="4000" placeholder="blonde hair, blue eyes, white dress" spellcheck="false">${esc(draft.replacement)}</textarea>`)}
            ${field('应用范围', `<select data-processing-rule="target">${options(TRIGGER_TARGETS, draft.target)}</select>`)}
            <div class="processing-actions">${command('save', draft.id ? '保存规则' : '添加规则', 'rule-save')}${draft.id ? command('x', '取消编辑', 'rule-cancel') : ''}
              ${command('upload', '导入 JSON', 'import')}${command('download', '导出 JSON', 'export')}
            </div>
          </div>
          <div class="processing-rules">${settings.rules.map((rule) => `<div class="processing-rule" data-processing-id="${esc(rule.id)}">
            <label class="processing-toggle"><input type="checkbox" data-processing-rule-enabled="${esc(rule.id)}" ${rule.enabled ? 'checked' : ''} /><span>${esc(rule.aliases.join(' | '))}</span></label>
            <span class="processing-rule-source">${rule.source === 'json' ? 'JSON' : '自定义'} · ${esc(TRIGGER_TARGETS.find(([id]) => id === rule.target)?.[1])}</span>
            <p>${esc(rule.replacement)}</p><div>
              <button type="button" class="ui-icon-button" data-processing-edit="${esc(rule.id)}" aria-label="编辑规则" title="编辑规则">${icon('pencil')}</button>
              <button type="button" class="ui-icon-button" data-processing-delete="${esc(rule.id)}" aria-label="删除规则" title="删除规则">${icon('trash-2')}</button>
            </div></div>`).join('')}</div>
          <input type="file" data-processing-file accept=".json,application/json" hidden />
        </section>
        <section class="settings-band">
          <div class="settings-band-heading"><h2>${icon('scan-eye')}当前生图参数</h2></div>
          ${command('scan-eye', '预览替换结果', 'preview')}
          <p role="status" data-processing-error>${esc(this.ui.error)}</p>
          <div data-processing-preview>${renderPromptReplacements(this.ui.result)}</div>
        </section>
      </div>`;
  }
  bind(container) {
    const root = container.querySelector('[data-processing-root]');
    if (!root) return;
    root.addEventListener('input', (event) => {
      const input = event.target;
      if (input.dataset.processingField) {
        this.ui.fields ||= structuredClone(normalizePromptProcessing(this.getSettings()).fields);
        this.ui.fields.custom[input.dataset.processingField] = input.value;
      }
      if (input.dataset.processingRule) {
        this.ui.draft ||= { aliases: [], replacement: '', target: 'all', source: 'custom' };
        this.ui.draft[input.dataset.processingRule] = input.dataset.processingRule === 'aliases' ? input.value.split('|').map((row) => row.trim()).filter(Boolean) : input.value;
      }
    });
    const commit = (settings) => {
      this.setSettings(settings); this.ui.error = ''; this.ui.result = null;
      root.querySelector('[data-processing-preview]').replaceChildren();
      root.querySelector('[data-processing-error]').textContent = '';
    };
    root.addEventListener('change', (event) => {
      const input = event.target, settings = normalizePromptProcessing(this.getSettings());
      try {
        if (input.matches('[data-processing-scheme]')) {
          this.ui.fields ||= structuredClone(settings.fields);
          this.ui.fields.scheme = input.value;
          this.ui.result = null;
          this.render();
        } else if (input.dataset.processingToggle) {
          if (input.dataset.processingToggle === 'enabled') settings.enabled = input.checked;
          else settings.sources[input.dataset.processingToggle.slice(7)] = input.checked;
          commit(settings);
        } else if (input.dataset.processingRuleEnabled) {
          settings.rules.find((rule) => rule.id === input.dataset.processingRuleEnabled).enabled = input.checked;
          commit(settings);
        }
      } catch (error) { this.showError(root, error); }
    });
    root.addEventListener('click', async (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      const settings = normalizePromptProcessing(this.getSettings());
      try {
        if (button.dataset.processingEdit) {
          this.ui.draft = structuredClone(settings.rules.find((rule) => rule.id === button.dataset.processingEdit));
          this.render(); return;
        }
        if (button.dataset.processingDelete) {
          settings.rules = settings.rules.filter((rule) => rule.id !== button.dataset.processingDelete);
          if (this.ui.draft?.id === button.dataset.processingDelete) this.ui.draft = null;
          commit(settings); this.render(); return;
        }
        switch (button.dataset.processingAction) {
          case 'fields-save':
            settings.fields = validateFieldSettings(this.ui.fields || settings.fields);
            commit(settings); this.ui.fields = null; this.notify('字段方案已保存'); this.render(); break;
          case 'rule-save':
            commit(saveTriggerRule(settings, this.ui.draft || {}));
            this.ui.draft = null; this.notify('触发词规则已保存'); this.render(); break;
          case 'rule-cancel': this.ui.draft = null; this.render(); break;
          case 'import': root.querySelector('[data-processing-file]').click(); break;
          case 'export': downloadJson('灵画师-触发词.json', exportTriggerRules(settings)); break;
          case 'preview':
            this.ui.result = this.preview();
            this.ui.error = '';
            root.querySelector('[data-processing-error]').textContent = '';
            root.querySelector('[data-processing-preview]').innerHTML = renderPromptReplacements(this.ui.result);
            paintIcons(root); break;
        }
      } catch (error) { this.showError(root, error); }
    });
    root.querySelector('[data-processing-file]').addEventListener('change', async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        if (file.size > 200000) throw new Error('触发词文件超过 200 KB');
        commit(importTriggerRules(this.getSettings(), JSON.parse(await file.text())));
        this.notify('触发词已导入'); this.render();
      } catch (error) { this.showError(root, error); }
      finally { event.target.value = ''; }
    });
  }
  showError(root, error) {
    this.ui.error = error.message;
    root.querySelector('[data-processing-error]').textContent = error.message;
  }
}

export function renderPromptReplacements(result) {
  if (!result) return '';
  const replacements = result.replacements || result.promptReplacements || {};
  const fieldTitle = (value) => ({ positive: '正向词', negative: '负面词', artist: '画师串' }[value] || value);
  return `<div class="prompt-replacement-preview">
    <p>${result.replacementEnabled === false ? '触发词替换已关闭' : `本次命中 ${replacements.hits?.length || 0} 处`}</p>
    ${(replacements.warnings || []).map((warning) => `<p role="status">${esc(warning)}</p>`).join('')}
    ${(replacements.hits || []).length ? `<dl>${replacements.hits.map((row) => `<div><dt>${esc(row.trigger)}<small>${esc(fieldTitle(row.field))} · ${esc(TRIGGER_SOURCES.find(([key]) => key === row.source)?.[1] || row.source)}</small></dt><dd>${esc(row.replacement)}</dd></div>`).join('')}</dl>` : ''}
    ${typeof result.positive === 'string' ? field('实际正向提示词', `<textarea rows="4" readonly>${esc(result.positive)}</textarea>`) : ''}
    ${typeof result.negative === 'string' ? field('实际负面提示词', `<textarea rows="3" readonly>${esc(result.negative)}</textarea>`) : ''}
    ${(result.characters || []).map((role) => `<details><summary>${esc(role.name)}</summary><p>${esc(role.positive)}</p><p>${esc(role.negative)}</p></details>`).join('')}
  </div>`;
}
