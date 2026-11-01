import { escapeHtml as esc } from '../config.js';
import { icon } from '../icons.js';
import { tagTargets, searchTags, allTagTemplates } from '../tag-library.js';
import { findPromptItem, numericPromptGroups } from '../prompt-composer.js';
import { selectedPromptItems } from '../visual-prompt.js';

const names = { positive: '正向提示词', negative: '负面提示词', artist: '画师／风格' };
const tool = (glyph, label, action, extra = '') => `<button type="button" class="ui-icon-button" data-tag-action="${action}" title="${label}" aria-label="${label}" ${extra}>${icon(glyph)}</button>`;
const command = (glyph, label, action, extra = '') => `<button type="button" class="ui-button secondary" data-tag-action="${action}" ${extra}>${icon(glyph)}<span>${label}</span></button>`;

export function visualEditorHtml(panel) {
  const ui = panel.ui, context = panel.context(), targets = tagTargets(context);
  if (!targets.some((row) => row.id === ui.target && row.enabled)) ui.target = targets.find((row) => row.enabled)?.id || 'positive';
  const target = ui.target, draft = panel.composition(target), pending = draft.text !== draft.parsedText;
  const selected = selectedPromptItems(draft.items, panel.selections.get(target) || []), active = findPromptItem(draft.items, ui.activeItem)?.item;
  const groups = [];
  const collect = (items, depth = 0) => { for (const item of items) if (item.kind === 'group') {
    groups.push({ id: item.id, name: `${'　'.repeat(depth)}${item.name}` }); collect(item.children, depth + 1);
  } };
  collect(draft.items);
  const numeric = !pending && active && ['novelai', 'sd'].includes(draft.format) && active.syntax !== 'opaque'
    && ['plain', draft.format].includes(active.syntax) && (draft.format !== 'novelai' || numericPromptGroups(context));
  const adjustable = !pending && active && ['novelai', 'sd'].includes(draft.format)
    && ['plain', draft.format].includes(active.syntax) && !(active.numeric && draft.format === 'novelai' && !numericPromptGroups(context));
  const sourceView = ui.visualView === 'source';
  const entries = searchTags(panel.getLibrary(), ui).slice(0, 60);
  return `<div class="visual-editor-toolbar">
    <div class="visual-targets" role="tablist" aria-label="提示词字段">${targets.map((row) => `<button type="button" role="tab" data-visual-target="${row.id}" aria-selected="${row.id === target}" ${row.enabled ? '' : 'disabled'}>${names[row.id]}</button>`).join('')}</div>
    <div class="visual-view" role="group" aria-label="编辑方式">${[['visual', '可视化'], ['source', '原文']].map(([id, label]) => `<button type="button" data-visual-view="${id}" aria-pressed="${(ui.visualView || 'visual') === id}">${label}</button>`).join('')}</div>
    <div class="visual-global-tools">${tool('undo-2', '撤销', 'undo')}${tool('redo-2', '重做', 'redo')}${tool('list-filter', '标签库', 'visual-library', `aria-pressed="${Boolean(ui.visualLibrary)}"`)}${tool('eye', '提交前提示词预览', 'visual-preview', `aria-pressed="${ui.visualPreview !== false}"`)}</div>
  </div>
  <div class="visual-editor-layout ${ui.visualLibrary ? 'has-library' : ''} ${ui.visualPreview !== false ? 'has-preview' : ''}">
    ${ui.visualLibrary ? `<aside class="visual-library"><label class="search-input">${icon('search')}<input type="search" data-tag-search placeholder="中文、英文、别名" aria-label="搜索中文标签" maxlength="200" value="${esc(ui.search || '')}" /></label>
      <div class="visual-library-tags">${entries.map((tag) => `<button type="button" data-tag-insert="${tag.id}" title="${esc(tag.en)}">${esc(tag.name)}</button>`).join('') || '<p>暂无匹配标签</p>'}</div>
      <details class="visual-materials"><summary>素材卡</summary>${allTagTemplates(panel.getLibrary()).filter((card) => card[target]).map((card) => `<button type="button" data-template-add="${card.id}" title="${esc(card.category)}">${icon('plus')}${esc(card.name)}</button>`).join('')}</details></aside>` : ''}
    <section class="visual-editor-canvas" data-composer-target="${target}" aria-label="${names[target]}编辑">
      <div class="visual-canvas-tools"><label><input type="checkbox" data-visual-select-all ${draft.items.length && selected.length === draft.items.length ? 'checked' : ''} ${pending || sourceView ? 'disabled' : ''} />全选</label><span>${draft.items.length} 项${selected.length ? ` · 已选 ${selected.length}` : ''}</span>
        ${tool('copy', '复制所选或整栏', 'visual-copy')}${tool('clipboard-paste', '粘贴提示词', 'visual-paste')}
        ${tool('folder-open', '将勾选标签组成一组', 'group', pending || sourceView || selected.length < 2 || draft.format === 'plain' ? 'disabled' : '')}
        ${tool('trash-2', '删除所选', 'selected-delete', pending || sourceView || !selected.length ? 'disabled' : '')}
        ${tool('save', '将所选存为素材卡', 'visual-save-selection', pending || sourceView || !selected.length ? 'disabled' : '')}
        ${tool('list-filter', '去除重复标签', 'deduplicate')}
        ${tool('rotate-ccw', '重新读取当前提示词', 'reload-composition')}
      </div>
      ${context.provider === 'comfyui' ? `<label class="visual-format">权重格式<select data-composer-format aria-label="标签权重格式">${[['plain', '普通文本'], ['novelai', 'NovelAI'], ['sd', 'SD / ComfyUI节点']].map(([id, name]) => `<option value="${id}" ${draft.format === id ? 'selected' : ''}>${name}</option>`).join('')}</select></label>` : ''}
      ${(ui.visualView || 'visual') === 'source' ? `<textarea class="visual-source" data-composer-source aria-label="${names[target]}原文" maxlength="${context.limits?.[target] || (target === 'artist' ? 4000 : context.provider === 'openai' ? 32000 : 12000)}" spellcheck="false" rows="14">${esc(draft.text)}</textarea>` :
        `<ol class="tag-composer-items visual-token-list" aria-label="${names[target]}标签" data-visual-drop-root>${panel.composerItems(draft.items.slice(0, draft.visibleItems || 200), target, pending, 0, { remaining: 400 })}</ol>
          ${draft.items.length > (draft.visibleItems || 200) ? command('chevron-down', '显示更多', 'more-items') : ''}
          <form class="visual-add-form"><input data-visual-add aria-label="添加提示词" placeholder="添加英文标签或整段提示词" maxlength="32000" /><button type="submit" class="ui-icon-button" title="添加提示词" aria-label="添加提示词">${icon('plus')}</button></form>`}
      <p class="tag-composer-note" role="status">${esc(pending ? '原文已修改，切换可视化后解析' : draft.warnings.join('；'))}</p>
      ${ui.clipboard ? `<form class="visual-clipboard-form"><label>${ui.clipboard.mode === 'copy' ? '复制内容' : '粘贴内容'}<textarea rows="4" aria-label="${ui.clipboard.mode === 'copy' ? '复制内容' : '粘贴内容'}" ${ui.clipboard.mode === 'copy' ? 'readonly' : ''}>${esc(ui.clipboard.text)}</textarea></label>${ui.clipboard.mode === 'paste' ? '<button type="submit" class="ui-button secondary">加入当前栏</button>' : ''}${tool('x', '关闭', 'visual-clipboard-close')}</form>` : ''}
      ${!pending && (ui.visualView || 'visual') === 'visual' && selected.length ? `<div class="visual-selection-tools">${tool('arrow-up', '批量上移', 'selected-up')}${tool('arrow-down', '批量下移', 'selected-down')}
        ${tool('minus', '批量减弱', 'selected-weaker', draft.format === 'plain' ? 'disabled' : '')}${tool('plus', '批量增强', 'selected-stronger', draft.format === 'plain' ? 'disabled' : '')}
        ${targets.filter((row) => row.enabled && row.id !== target).map((row) => command('arrow-left-right', `移至${names[row.id]}`, 'visual-transfer', `data-visual-to="${row.id}"`)).join('')}
        <label>移入分组<select data-visual-group-move aria-label="将所选移入分组"><option value="">选择位置</option><option value="root">最外层</option>${groups.map((row) => `<option value="${row.id}">${esc(row.name)}</option>`).join('')}</select></label></div>` : ''}
      ${!pending && (ui.visualView || 'visual') === 'visual' && active ? `<section class="visual-token-inspector" aria-label="标签属性"><strong>${esc(active.name)}</strong><code>${esc(active.raw)}</code><div>
        <label>权重<input type="number" data-visual-weight="${active.id}" aria-label="标签精确权重" min="${draft.format === 'sd' ? 0 : -10}" max="10" step="0.1" value="${Number(active.weight.toFixed(2))}" ${numeric ? '' : 'disabled'} /></label>${tool('check', '应用精确权重', 'visual-weight-set', numeric ? '' : 'disabled')}
        ${tool('minus', '减弱标签', 'visual-weight-down', adjustable ? '' : 'disabled')}${tool('plus', '增强标签', 'visual-weight-up', adjustable ? '' : 'disabled')}
        ${active.kind === 'group' ? `<button type="button" class="ui-icon-button" data-composer-label="${active.id}" title="编辑分组名称与颜色" aria-label="编辑分组名称与颜色">${icon('pencil')}</button><button type="button" class="ui-icon-button" data-composer-ungroup="${active.id}" title="解散组并保留权重" aria-label="解散组并保留权重">${icon('replace')}</button>` : ''}
        <button type="button" class="ui-icon-button" data-composer-remove="${active.id}" title="移除标签" aria-label="移除标签">${icon('x')}</button>
      </div></section>` : ''}
      ${ui.groupDraft ? `<form class="tag-group-editor visual-group-editor"><label>分组名称<input name="name" maxlength="40" required value="${esc(ui.groupDraft.name)}" /></label><label>颜色<select name="color">${['default', 'blue', 'green', 'rose', 'gold'].map((color, index) => `<option value="${color}" ${ui.groupDraft.color === color ? 'selected' : ''}>${['跟随主题', '蓝色', '绿色', '玫红', '金色'][index]}</option>`).join('')}</select></label><button type="submit" class="ui-icon-button" title="保存分组" aria-label="保存分组">${icon('check')}</button>${tool('x', '取消', 'cancel-group')}</form>` : ''}
      ${ui.templateDraft ? panel.templateEditor() : ''}
    </section>
    ${ui.visualPreview !== false ? `<aside class="visual-final-preview" aria-label="提交前提示词预览">${visualPreviewHtml(panel)}</aside>` : ''}
  </div><div class="tag-status" role="status" aria-live="polite">${esc(panel.status || '')}</div>`;
}

export function visualPreviewHtml(panel) {
  const heading = esc(panel.picker?.previewTitle || '提交前提示词');
  try {
    const blocks = panel.previewCompositions();
    return `<h3>${heading}</h3>${blocks.map((row) => `<label><span>${esc(row.title)}</span><textarea readonly rows="5">${esc(row.text)}</textarea></label>`).join('') || '<p>提示词为空</p>'}`;
  } catch (error) { return `<h3>${heading}</h3><p role="alert">${esc(error.message)}</p>`; }
}
