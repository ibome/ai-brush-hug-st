import { randomUUID } from '../crypto-compat.js';
import { escapeHtml as esc, downloadJson } from '../config.js';
import { icon, paintIcons } from '../icons.js';
import { BUILTIN_TAGS } from '../data/prompt-tags.js';
import { allTags, searchTags, saveTag, importTags, normalizeTagLibrary, tagTargets, appendTags,
  applyPromptDrafts, setPromptText, allTagTemplates, saveTagTemplate } from '../tag-library.js';
import { tagDetails } from '../tag-details.js';
import { GROUP_COLORS, cardLayout, restoreCardLayout, resolveMaterialCard, resolveMaterialText, cardReference } from '../material-cards.js';
import { parsePrompt, serializePrompt, appendPromptParts, deduplicatePrompt, emphasisFormat, adjustPromptWeight,
  promptLeaves, findPromptItem, updatePromptItem, movePromptItem, groupPromptItems, ungroupPromptItem,
  moveBetweenPrompts, numericPromptGroups, promptIdentity } from '../prompt-composer.js';
import { selectedPromptItems, copyPromptItems, copyPromptSelection, preserveGroupLabels, removePromptItems, movePromptTo, setPromptWeight, groupPromptSelection } from '../visual-prompt.js';
import { visualEditorHtml, visualPreviewHtml } from './prompt-editor.js';

const command = (name, label, action, extra = '') => `<button type="button" class="ui-button secondary" data-tag-action="${action}" ${extra}>${icon(name)}<span>${label}</span></button>`;
const tool = (name, label, attribute, pressed = '') => `<button type="button" class="ui-icon-button" ${attribute} title="${label}" aria-label="${label}" ${pressed}>${icon(name)}</button>`;
const field = (label, input) => `<label class="ui-field"><span>${label}</span>${input}</label>`;
const PAGE_SIZE = 60;

export class TagLibraryPanel {
  constructor({ getLibrary, setLibrary, getContext, getPreview, insert, notify }) {
    Object.assign(this, { getLibrary, setLibrary, getContext, getPreview, insert, notify });
    this.ui = { search: '', category: '', view: 'all', page: 1, target: 'positive', draft: null, mode: 'quick', templateDraft: null };
    this.compositions = new Map();
    this.histories = new Map();
    this.redos = new Map();
    this.selections = new Map();
    this.expanded = new Set();
    this.dialog = null;
    this.bound = new WeakSet();
  }

  context() { return this.dialog ? this.picker.getContext() : this.getContext(); }
  isVisual() { return Boolean(this.dialog && this.picker?.visual); }

  html() {
    return `<div class="page-heading"><div><h1>中文标签库</h1><p data-tag-count>${BUILTIN_TAGS.length} 个内置标签 · ${this.getLibrary().custom.length} 个自定义标签</p></div></div>
      <section class="tag-library" data-tag-root>${this.content()}</section>`;
  }

  content() {
    if (this.isVisual()) return visualEditorHtml(this);
    const ui = this.ui, library = this.getLibrary(), context = this.context();
    const entries = searchTags(library, ui), pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
    ui.page = Math.min(pages, Math.max(1, ui.page));
    const targets = tagTargets(context);
    if (!targets.some((target) => target.id === ui.target && target.enabled)) {
      ui.target = targets.find((target) => target.enabled)?.id || 'positive';
    }
    const categories = [...new Set(allTags(library).map((tag) => tag.category))];
    const value = context.params?.[ui.target] || '';
    return `<div class="tag-toolbar">
      <label class="search-input">${icon('search')}<input type="search" data-tag-search aria-label="搜索中文标签" placeholder="中文、英文、别名" maxlength="200" value="${esc(ui.search)}" /></label>
      <select data-tag-category aria-label="标签分类"><option value="">全部分类</option>${categories.map((category) => `<option ${category === ui.category ? 'selected' : ''}>${esc(category)}</option>`).join('')}</select>
      ${command('plus', '自定义标签', 'new')}${command('upload', '导入', 'import')}${command('download', '导出', 'export')}
    </div>
    <div class="tag-filters"><div class="tag-views" role="group" aria-label="标签范围">${[['all', '全部'], ['favorites', '收藏'], ['recent', '最近使用'], ['custom', '自定义']].map(([id, title]) =>
      `<button type="button" data-tag-view="${id}" aria-pressed="${ui.view === id}">${title}</button>`).join('')}</div>
      ${field('插入到', `<select data-tag-target aria-label="标签插入位置">${targets.map((target) => `<option value="${target.id}" ${ui.target === target.id ? 'selected' : ''} ${target.enabled ? '' : 'disabled'}>${target.title}${target.enabled ? '' : '（不可用）'}</option>`).join('')}</select>`)}
    </div>
    <div class="tag-mode" role="group" aria-label="标签操作模式">${[['quick', '直接追加'], ['compose', '组合编辑']].map(([id, title]) =>
      `<button type="button" data-tag-mode="${id}" aria-pressed="${ui.mode === id}">${title}</button>`).join('')}</div>
    ${ui.draft ? this.editor() : ''}
    ${ui.groupDraft ? `<form class="tag-group-editor tag-editor"><div class="tag-editor-fields">
      ${field('分组名称', `<input name="name" maxlength="40" required value="${esc(ui.groupDraft.name)}" />`)}
      ${field('分组颜色', `<select name="color">${GROUP_COLORS.map((color, index) => `<option value="${color}" ${ui.groupDraft.color === color ? 'selected' : ''}>${['跟随主题', '蓝色', '绿色', '玫红', '金色'][index]}</option>`).join('')}</select>`)}
      </div><div class="tag-editor-actions"><button class="ui-button primary" type="submit">${icon('check')}保存分组</button>${command('x', '取消', 'cancel-group')}</div></form>` : ''}
    ${ui.detail ? this.detailHtml() : ''}
    ${this.templates()}
    <div class="tag-workspace ${ui.mode === 'compose' ? 'is-composing' : ''}">
    ${ui.mode === 'compose' ? this.composerHtml() : ''}
    <div class="tag-catalog">
    <div class="tag-results-heading"><span>${entries.length} 个结果</span><span>${esc(({ novelai: 'NovelAI', openai: 'OpenAI兼容', comfyui: 'ComfyUI', sdwebui: 'SDWebUI' })[context.provider])}${this.dialog ? ` · ${esc(this.picker.label || '当前参数')}` : ''}</span></div>
    <div class="tag-grid">${entries.slice((ui.page - 1) * PAGE_SIZE, ui.page * PAGE_SIZE).map((tag) => {
      const source = ui.mode === 'compose' ? this.composition().text : value;
      const included = appendPromptParts(source, tag.en) === source;
      const favorite = library.favorites.includes(tag.id);
      return `<div class="tag-item"><button type="button" data-tag-insert="${esc(tag.id)}" title="${esc(tag.aliases.join(' / ') || tag.en)}" aria-pressed="${included}" ${targets.find((target) => target.id === ui.target)?.enabled ? '' : 'disabled'}>
        <strong>${esc(tag.name)}${included ? icon('check') : ''}</strong><small lang="en">${esc(tag.en)}</small></button><div class="tag-item-tools">
        ${tool('star', favorite ? '取消收藏' : '收藏标签', `data-tag-favorite="${esc(tag.id)}"`, `aria-pressed="${favorite}"`)}
        ${tool('eye', `查看${tag.name}详情`, `data-tag-detail="${esc(tag.id)}"`)}
        ${['positive', 'negative'].map((target) => tool(target === 'positive' ? 'plus' : 'minus', `将${tag.name}加入${target === 'positive' ? '正向' : '负面'}`,
          `data-tag-insert="${esc(tag.id)}" data-tag-to="${target}" ${targets.find((row) => row.id === target)?.enabled ? '' : 'disabled'}`)).join('')}
        ${tag.id.startsWith('custom-') ? tool('pencil', '编辑标签', `data-tag-edit="${esc(tag.id)}"`) : ''}
      </div></div>`;
    }).join('') || '<p class="tag-empty">暂无匹配标签</p>'}</div>
    <div class="tag-pagination">${command('chevron-left', '上一页', 'previous', ui.page <= 1 ? 'disabled' : '')}<span>${ui.page} / ${pages}</span>${command('chevron-right', '下一页', 'next', ui.page >= pages ? 'disabled' : '')}</div>
    </div></div>
    ${ui.mode === 'quick' ? field(`当前${targets.find((target) => target.id === ui.target)?.title || '提示词'}`, `<textarea class="tag-current" rows="3" readonly aria-label="当前标签目标提示词">${esc(value)}</textarea>`) : ''}
    <div class="tag-status" role="status" aria-live="polite">${esc(this.status || '')}</div>`;
  }

  composition(target = this.ui.target) {
    const context = this.context(), key = `${context.provider}:${context.params?.model || ''}:${target}`;
    if (!this.compositions.has(key)) {
      const value = context.params?.[target] || '';
      this.compositions.set(key, { baseline: value, text: value, parsedText: value,
        ...parsePrompt(value, allTags(this.getLibrary())), format: emphasisFormat(context), history: [] });
    }
    const draft = this.compositions.get(key), value = context.params?.[target] || '';
    if (draft.text === draft.baseline && draft.baseline !== value) {
      Object.assign(draft, { baseline: value, text: value, parsedText: value }, parsePrompt(value, allTags(this.getLibrary())));
    }
    return draft;
  }

  composerTargets() { return this.isVisual() ? tagTargets(this.context()).filter((row) => row.enabled).map((row) => row.id)
    : this.ui.target === 'artist' ? ['artist'] : ['positive', 'negative']; }

  previewCompositions() {
    const edits = Object.fromEntries(this.composerTargets().map((target) => {
      const text = resolveMaterialText(this.composition(target).text, allTagTemplates(this.getLibrary()), target,
        { limit: this.context().limits?.[target] || (target === 'artist' ? 4000 : this.context().provider === 'openai' ? 32000 : 12000) });
      setPromptText(this.context(), text, target);
      return [target, text];
    }));
    const preview = this.picker?.getPreview || (!this.dialog ? this.getPreview : null);
    return preview ? preview(edits) : this.composerTargets().filter((target) => edits[target]).map((target) =>
      ({ title: ({ positive: '正向提示词', negative: '负面提示词', artist: '画师／风格' })[target], text: edits[target] }));
  }

  updateVisualPreview(root) {
    const preview = root.querySelector('.visual-final-preview');
    if (preview) preview.innerHTML = visualPreviewHtml(this);
  }

  appendVisualText(text) {
    if (!String(text || '').trim()) return;
    const target = this.ui.target, value = appendPromptParts(this.composition(target).text, text);
    setPromptText(this.context(), value, target);
    this.changeComposition(value, { target }); this.ui.rawEditing = false;
  }

  composerHtml() {
    const targets = this.composerTargets(), pair = targets.length === 2;
    const available = tagTargets(this.context()).filter((row) => row.enabled).map((row) => row.id);
    const positive = promptLeaves(this.composition('positive').items), negative = promptLeaves(this.composition('negative').items);
    const conflicts = positive.filter((item) => item.syntax !== 'opaque' && negative.some((other) => other.syntax !== 'opaque'
      && promptIdentity(other.en) === promptIdentity(item.en)));
    return `<div class="tag-composers ${pair ? 'is-paired' : ''}">
      ${pair ? `<div class="tag-pair-actions">${command('check-check', '应用正负组合', 'apply-pair', available.includes('positive') && available.includes('negative') ? '' : 'disabled')}
        ${conflicts.length ? `<span class="tag-conflicts" role="status">正负重复：${esc([...new Set(conflicts.map((item) => item.name))].slice(0, 6).join('、'))}</span>` : ''}</div>` : ''}
      ${targets.map((target) => this.composerColumn(target)).join('')}</div>`;
  }

  composerColumn(target) {
    const draft = this.composition(target), pending = draft.text !== draft.parsedText;
    const available = tagTargets(this.context()).some((row) => row.id === target && row.enabled);
    const title = ({ positive: '正向', negative: '负面', artist: '风格' })[target];
    if (!available) return `<section class="tag-composer is-disabled" data-composer-target="${target}" aria-label="${title}提示词组合">
      <h2>${target === 'negative' ? '不想要' : '想要'}</h2><p>${this.context().provider === 'comfyui' ? `未映射${title}提示词节点` : '当前模型不支持独立负面提示词'}</p></section>`;
    const selected = this.selections.get(target) || new Set();
    return `<section class="tag-composer ${target === this.ui.target ? 'is-active' : ''}" data-composer-target="${target}" aria-label="${title}提示词组合">
      <div class="tag-composer-heading"><h2>${({ positive: '想要', negative: '不想要', artist: '风格组合' })[target]}</h2>
        ${tool('plus', `设为当前${title}添加位置`, `data-tag-select-target="${target}"`, `aria-pressed="${target === this.ui.target}"`)}
        <span>${draft.items.length} 项${draft.text !== draft.baseline ? ' · 未应用' : ''}</span></div>
      <div class="tag-composer-tools">${command('scan-text', '解析', 'parse')}${tool('undo-2', '撤销组合修改', 'data-tag-action="undo"')}
        ${tool('redo-2', '重做组合修改', 'data-tag-action="redo"')}
        ${tool('list-filter', '去除重复标签', 'data-tag-action="deduplicate"')}${tool('rotate-ccw', '重新读取当前提示词', 'data-tag-action="reload-composition"')}
        ${tool('eraser', '清空组合草稿', 'data-tag-action="clear-composition"')}
        ${tool('folder-open', '将勾选标签组成一组', `data-tag-action="group" ${pending || selected.size < 2 || draft.format === 'plain' ? 'disabled' : ''}`)}</div>
      ${selected.size ? `<div class="tag-selection-tools"><span>已选 ${selected.size} 项</span>
        ${tool('arrow-up', '批量上移', 'data-tag-action="selected-up"')}${tool('arrow-down', '批量下移', 'data-tag-action="selected-down"')}
        ${tool('minus', '批量减弱', 'data-tag-action="selected-weaker"')}${tool('plus', '批量增强', 'data-tag-action="selected-stronger"')}
        ${target !== 'artist' ? tool('arrow-left-right', '批量移到另一栏', 'data-tag-action="selected-transfer"') : ''}
        ${tool('x', '取消勾选', 'data-tag-action="selected-clear"')}</div>` : ''}
      ${field('权重格式', `<select data-composer-format aria-label="${title}标签权重格式" ${this.context().provider !== 'comfyui' ? 'disabled' : ''}>
        ${[['plain', '普通文本'], ['novelai', 'NovelAI'], ['sd', 'SD / ComfyUI节点']].map(([id, title]) =>
          `<option value="${id}" ${id === draft.format ? 'selected' : ''}>${title}</option>`).join('')}</select>`)}
      <ol class="tag-composer-items" aria-label="${title}已选标签">${this.composerItems(draft.items.slice(0, draft.visibleItems || 200), target, pending, 0, { remaining: 400 })}</ol>
      ${draft.items.length > (draft.visibleItems || 200) ? command('chevron-down', `显示更多（${draft.visibleItems || 200} / ${draft.items.length}）`, 'more-items') : ''}
      ${field('提示词原文', `<textarea data-composer-source aria-label="${title}组合提示词原文" rows="4" maxlength="${this.context().limits?.[target] || (target === 'artist' ? 4000 : this.context().provider === 'openai' ? 32000 : 12000)}" spellcheck="false">${esc(draft.text)}</textarea>`)}
      <p class="tag-composer-note" role="status">${esc(pending ? '原文已修改，待解析' : draft.warnings.join('；'))}</p>
      <div class="tag-composer-actions">${command('check', `应用${title}组合`, 'apply-composition')}
        ${command('save', '存为模板', 'save-template')}</div>
    </section>`;
  }

  composerItems(items, target, pending, depth = 0, budget = { remaining: 400 }) {
    const draft = this.composition(target), selected = this.selections.get(target) || new Set();
    const other = target === 'positive' ? 'negative' : 'positive';
    const canTransfer = target !== 'artist' && tagTargets(this.context()).some((row) => row.id === other && row.enabled);
    const rows = [];
    for (const [index, item] of items.entries()) {
      if (budget.remaining-- <= 0) {
        rows.push('<li class="tag-empty">更多内容可在提示词原文中编辑</li>'); break;
      }
      const group = item.kind === 'group', open = this.expanded.has(item.id);
      const weighted = ['novelai', 'sd'].includes(draft.format) && ['plain', draft.format].includes(item.syntax)
        && !(item.numeric && draft.format === 'novelai' && !numericPromptGroups(this.context()));
      if (this.isVisual()) {
        rows.push(`<li draggable="${!pending}" data-composer-item="${item.id}" data-group-color="${GROUP_COLORS.includes(item.color) ? item.color : 'default'}" class="visual-token ${group ? 'is-group' : ''} ${this.ui.activeItem === item.id ? 'is-inspected' : ''}">
          <div class="visual-token-label"><input type="checkbox" data-composer-select="${item.id}" aria-label="选择${esc(item.name)}" ${selected.has(item.id) ? 'checked' : ''} ${pending ? 'disabled' : ''} />
          ${group ? tool(open ? 'chevron-down' : 'chevron-right', open ? '折叠标签组' : '展开标签组', `data-composer-expand="${item.id}"`) : ''}
          <button type="button" data-visual-active="${item.id}" title="${esc(item.raw)}"><span>${esc(item.name)}</span>${item.weight !== 1 ? `<small>${Number(item.weight.toFixed(2))}</small>` : ''}</button></div>
          ${group && open ? `<ol class="tag-group-children visual-group-drop" data-visual-drop-group="${item.id}">${this.composerItems(item.children, target, pending, depth + 1, budget)}</ol>` : ''}
        </li>`);
        continue;
      }
      rows.push(`<li draggable="${!pending}" data-composer-item="${item.id}" data-group-color="${GROUP_COLORS.includes(item.color) ? item.color : 'default'}" class="${group ? 'is-group' : item.tagId ? '' : 'is-unknown'}">
        <div class="tag-composer-name">
        ${depth === 0 ? `<input type="checkbox" data-composer-select="${item.id}" aria-label="选择${esc(item.name)}组成一组" ${pending ? 'disabled' : ''} ${selected.has(item.id) ? 'checked' : ''} />` : ''}
        ${group ? tool(open ? 'chevron-down' : 'chevron-right', open ? '折叠标签组' : '展开标签组', `data-composer-expand="${item.id}"`) : ''}
        <div><strong>${esc(item.name)}${group ? ` · ${item.children.length} 项` : ''}</strong><small>${esc(group ? item.children.slice(0, 3).map((child) => child.name).join('、') : item.raw)}</small></div></div>
        <div class="tag-composer-item-tools">
          ${tool('arrow-up', '上移标签', `data-composer-move="${item.id}" data-direction="-1" ${pending || index === 0 ? 'disabled' : ''}`)}
          ${tool('arrow-down', '下移标签', `data-composer-move="${item.id}" data-direction="1" ${pending || index === items.length - 1 ? 'disabled' : ''}`)}
          ${tool('minus', group ? '减弱整组' : '减弱标签', `data-composer-weight="${item.id}" data-direction="-1" ${pending || !weighted ? 'disabled' : ''}`)}
          <span class="tag-composer-weight" title="标签强调程度">${item.syntax === 'opaque' ? '原文' : Number(item.weight.toFixed(2))}</span>
          ${tool('plus', group ? '增强整组' : '增强标签', `data-composer-weight="${item.id}" data-direction="1" ${pending || !weighted ? 'disabled' : ''}`)}
          ${canTransfer ? tool('arrow-left-right', `移到${other === 'negative' ? '负面' : '正向'}组合`, `data-composer-transfer="${item.id}" ${pending ? 'disabled' : ''}`) : ''}
          ${group ? tool('replace', '解散组并保留权重', `data-composer-ungroup="${item.id}" ${pending ? 'disabled' : ''}`) : ''}
          ${group ? tool('pencil', '编辑分组名称与颜色', `data-composer-label="${item.id}" ${pending ? 'disabled' : ''}`) : ''}
          ${item.tagId ? tool('eye', `查看${item.name}详情`, `data-tag-detail="${esc(item.tagId)}"`) : ''}
          ${tool('x', '移除标签', `data-composer-remove="${item.id}" ${pending ? 'disabled' : ''}`)}
        </div>
        ${group && open ? `<ol class="tag-group-children">${this.composerItems(item.children, target, pending, depth + 1, budget)}</ol>` : ''}
      </li>`);
    }
    return rows.join('') || '<li class="tag-empty">组合为空</li>';
  }

  detailHtml() {
    const tag = allTags(this.getLibrary()).find((row) => row.id === this.ui.detail);
    if (!tag) { this.ui.detail = ''; return ''; }
    const details = tagDetails(tag), targets = tagTargets(this.context());
    return `<section class="tag-details" aria-label="标签详情"><div class="tag-details-heading"><div>
      <h2>${esc(tag.name)}</h2><small lang="en">${esc(tag.en)}</small></div>${tool('x', '关闭标签详情', 'data-tag-action="close-detail"')}</div>
      <div class="tag-details-content"><div><span class="tag-details-category">${esc(tag.category)} · ${details.descriptionType}</span>
        <p>${esc(details.description)}</p>
        ${tag.aliases.length ? `<div class="tag-aliases"><span>别名</span>${tag.aliases.map((alias) => `<button type="button" data-tag-search-term="${esc(alias)}">${esc(alias)}</button>`).join('')}</div>` : ''}
        <div class="tag-detail-actions">${['positive', 'negative'].map((target) => command(target === 'positive' ? 'plus' : 'minus',
          `加入${target === 'positive' ? '正向' : '负面'}`, 'detail-insert', `data-tag-insert="${esc(tag.id)}" data-tag-to="${target}" ${targets.find((row) => row.id === target)?.enabled ? '' : 'disabled'}`)).join('')}
          ${details.source ? `<a href="${esc(details.source)}" target="_blank" rel="noopener noreferrer">${icon('external-link')}资料来源</a>` : ''}
          ${details.wiki ? `<a href="${esc(details.wiki)}" target="_blank" rel="noopener noreferrer">${icon('external-link')}标签 Wiki</a>` : ''}</div></div>
        ${details.preview ? `<figure class="tag-detail-preview">${this.ui.detailPreview ? `<img src="${esc(details.preview)}" alt="${esc(tag.name)}示例" width="192" height="192" loading="lazy" decoding="async" /><figcaption>${details.previewLabel}</figcaption>`
          : command('image', '查看示例图', 'show-detail-preview')}</figure>` : ''}</div></section>`;
  }

  templates() {
    const ui = this.ui, all = allTagTemplates(this.getLibrary()), query = (ui.cardSearch || '').toLowerCase();
    const entries = all.filter((row) => (!ui.cardFavorites || row.favorite) && `${row.name} ${row.category} ${row.positive} ${row.artist}`.toLowerCase().includes(query));
    return `<details class="tag-templates" ${ui.templateDraft ? 'open' : ''}><summary>素材卡与组合模板 <span>${all.length}</span></summary>
      <div class="tag-card-toolbar"><input type="search" data-card-search aria-label="搜索素材卡" placeholder="名称、分类、提示词" maxlength="200" value="${esc(ui.cardSearch || '')}" />
        <label><input type="checkbox" data-card-favorites ${ui.cardFavorites ? 'checked' : ''} />仅收藏</label>${command('plus', '新建素材卡', 'new-template')}</div>
      ${ui.templateDraft ? this.templateEditor() : ''}
      <div class="tag-template-grid">${entries.map((entry) => {
        const available = Boolean(entry[ui.target]);
        return `<div class="tag-template"><div><strong>${esc(entry.name)}</strong><small>${esc(entry.category)}</small></div>
          <div class="tag-template-tools">${tool('plus', `追加${entry.name}到组合`, `data-template-add="${entry.id}" ${available ? '' : 'disabled'}`)}
          ${tool('folder-open', `载入${entry.name}到组合`, `data-template-load="${entry.id}" ${available ? '' : 'disabled'}`)}
          ${tool('eye', `预览${entry.name}展开内容`, `data-template-preview="${entry.id}"`)}
          ${entry.id.startsWith('template-') ? tool('star', `收藏${entry.name}`, `data-template-favorite="${entry.id}"`, `aria-pressed="${Boolean(entry.favorite)}"`) : ''}
          ${entry.id.startsWith('template-') ? tool('pencil', `编辑${entry.name}`, `data-template-edit="${entry.id}"`) : ''}</div></div>`;
      }).join('')}</div>${ui.cardPreview ? `<div class="tag-card-preview"><strong>${esc(ui.cardPreview.name)}</strong>${['positive', 'negative', 'artist'].filter((key) => ui.cardPreview[key]).map((key) =>
        field(({ positive: '正向展开', negative: '负面展开', artist: '风格展开' })[key], `<textarea rows="2" readonly>${esc(ui.cardPreview[key])}</textarea>`)).join('')}</div>` : ''}</details>`;
  }

  templateEditor() {
    const entry = this.ui.templateDraft;
    return `<form class="tag-template-editor"><div class="tag-editor-fields">
      ${field('组合名称', `<input name="name" required maxlength="80" value="${esc(entry.name)}" />`)}
      ${field('组合分类', `<input name="category" maxlength="40" value="${esc(entry.category)}" />`)}
      ${field('适用模型（可选）', `<input name="model" maxlength="120" value="${esc(entry.model || '')}" />`)}
      ${field('插入素材引用', `<select data-card-reference><option value="">选择素材卡</option>${allTagTemplates(this.getLibrary()).filter((row) => row.id !== entry.id).map((row) =>
        `<option value="${esc(row.id)}">${esc(row.category)} · ${esc(row.name)}</option>`).join('')}</select>`)}
      ${field('正向提示词', `<textarea name="positive" rows="3" maxlength="12000">${esc(entry.positive)}</textarea>`)}
      ${field('负面提示词', `<textarea name="negative" rows="3" maxlength="12000">${esc(entry.negative)}</textarea>`)}
      ${field('风格描述', `<textarea name="artist" rows="2" maxlength="4000">${esc(entry.artist)}</textarea>`)}
      </div><div class="tag-editor-actions"><button type="submit" class="ui-button primary">${icon('save')}<span>保存组合模板</span></button>
        ${command('x', '取消', 'cancel-template')}${this.getLibrary().templates.some((row) => row.id === entry.id) ? command('trash-2', '删除模板', 'delete-template') : ''}</div></form>`;
  }

  history() {
    const context = this.context(), key = `${context.provider}:${context.params?.model || ''}`;
    if (!this.histories.has(key)) this.histories.set(key, []);
    return this.histories.get(key);
  }

  snapshotComposition(targets) {
    return Object.fromEntries(targets.map((target) => {
      const draft = this.composition(target);
      return [target, { text: draft.text, parsedText: draft.parsedText, items: structuredClone(draft.items),
        warnings: [...draft.warnings], format: draft.format }];
    }));
  }

  redoHistory() {
    const context = this.context(), key = `${context.provider}:${context.params?.model || ''}`;
    if (!this.redos.has(key)) this.redos.set(key, []);
    return this.redos.get(key);
  }

  rememberComposition(targets) {
    const before = this.snapshotComposition(targets);
    this.redoHistory().length = 0;
    const history = this.history();
    history.push(before);
    if (history.length > 30) history.shift();
  }

  undoComposition() {
    if (this.isVisual()) this.ui.rawEditing = false;
    const previous = this.history().pop();
    if (previous) this.redoHistory().push(this.snapshotComposition(Object.keys(previous)));
    for (const [target, before] of Object.entries(previous || {})) {
      Object.assign(this.composition(target), before); this.selections.delete(target);
    }
  }

  redoComposition() {
    if (this.isVisual()) this.ui.rawEditing = false;
    const next = this.redoHistory().pop();
    if (!next) return;
    this.history().push(this.snapshotComposition(Object.keys(next)));
    for (const [target, after] of Object.entries(next)) {
      Object.assign(this.composition(target), after); this.selections.delete(target);
    }
  }

  selectedOperation(target, action) {
    const draft = this.composition(target), ids = this.selections.get(target) || new Set();
    if (!ids.size || draft.text !== draft.parsedText) throw new Error('请先解析并勾选标签');
    let items = structuredClone(draft.items);
    if (action === 'delete') { this.commitItems(target, removePromptItems(items, ids)); return; }
    if (action === 'transfer') {
      const other = target === 'positive' ? 'negative' : 'positive', destination = this.composition(other);
      if (target === 'artist' || !tagTargets(this.context()).some((row) => row.id === other && row.enabled)
        || destination.text !== destination.parsedText) throw new Error('请先检查另一栏是否可用且已解析');
      let to = structuredClone(destination.items);
      for (const id of ids) { const next = moveBetweenPrompts(items, to, id, allTags(this.getLibrary())); items = next.from; to = next.to; }
      this.rememberComposition([target, other]);
      this.commitItems(target, items, false); this.commitItems(other, to, false); return;
    }
    if (action === 'up' || action === 'down') {
      const direction = action === 'up' ? -1 : 1;
      const flat = (rows) => rows.flatMap((item) => [item.id, ...(item.kind === 'group' ? flat(item.children) : [])]);
      const order = direction < 0 ? flat(items) : flat(items).reverse();
      for (const id of order.filter((id) => ids.has(id))) {
        const found = findPromptItem(items, id), other = found?.siblings[found.index + direction];
        if (other && !ids.has(other.id)) items = movePromptItem(items, id, direction);
      }
    } else {
      for (const { id } of selectedPromptItems(items, ids)) items = updatePromptItem(items, id, (item) => {
        if (item.numeric && !numericPromptGroups(this.context()) && draft.format === 'novelai') throw new Error('此模型不支持数值分组权重');
        return [adjustPromptWeight({ ...item, numericAllowed: numericPromptGroups(this.context()) }, action === 'stronger' ? 1 : -1, draft.format)];
      });
    }
    this.commitItems(target, items);
    this.selections.set(target, ids);
  }

  changeComposition(value, { target = this.ui.target, remember = true, items } = {}) {
    if (this.isVisual()) this.ui.rawEditing = false;
    const draft = this.composition(target);
    if (remember && (draft.text !== value || draft.parsedText !== value || items)) this.rememberComposition([target]);
    const parsed = parsePrompt(value, allTags(this.getLibrary()));
    if (this.isVisual() && !items) parsed.items = preserveGroupLabels(draft.items, parsed.items);
    Object.assign(draft, { text: value, parsedText: value }, parsed, items ? { items } : {});
    this.selections.delete(target);
  }

  commitItems(target, items, remember = true) {
    this.changeComposition(serializePrompt(items), { target, items, remember });
  }

  transferSelection(target, other) {
    if (!tagTargets(this.context()).some((row) => row.id === other && row.enabled)) throw new Error('目标提示词栏不可用');
    const source = this.composition(target), destination = this.composition(other), ids = this.selections.get(target) || [];
    if ([source, destination].some((draft) => draft.text !== draft.parsedText)) throw new Error('请先解析已修改的原文');
    let from = structuredClone(source.items), to = structuredClone(destination.items);
    for (const item of selectedPromptItems(source.items, ids)) {
      const moved = moveBetweenPrompts(from, to, item.id, allTags(this.getLibrary())); from = moved.from; to = moved.to;
    }
    setPromptText(this.context(), serializePrompt(to), other);
    this.rememberComposition([target, other]); this.commitItems(target, from, false); this.commitItems(other, to, false);
  }

  transferItem(target, id) {
    const other = target === 'positive' ? 'negative' : 'positive';
    if (target === 'artist' || !tagTargets(this.context()).some((row) => row.id === other && row.enabled)) {
      throw new Error('另一栏在当前模型或工作流中不可用');
    }
    const source = this.composition(target), destination = this.composition(other);
    if ([source, destination].some((draft) => draft.text !== draft.parsedText)) throw new Error('请先解析两栏已修改的原文');
    const next = moveBetweenPrompts(source.items, destination.items, id, allTags(this.getLibrary()));
    this.rememberComposition([target, other]);
    this.commitItems(target, next.from, false); this.commitItems(other, next.to, false);
    this.status = `已移到${other === 'negative' ? '负面' : '正向'}组合草稿`;
  }

  applyCompositions(targets) {
    for (const target of targets) {
      const draft = this.composition(target);
      const resolved = resolveMaterialText(draft.text, allTagTemplates(this.getLibrary()), target,
        { limit: this.context().limits?.[target] || (target === 'artist' ? 4000 : this.context().provider === 'openai' ? 32000 : 12000) });
      if (resolved !== draft.text) this.changeComposition(resolved, { target });
    }
    const drafts = Object.fromEntries(targets.map((target) => [target, this.composition(target)]));
    const params = applyPromptDrafts(this.context(), drafts, targets);
    (this.dialog ? this.picker.insert : this.insert)(params, targets.length === 1 ? targets[0] : targets);
    const ids = [];
    for (const target of targets) {
      const draft = drafts[target];
      draft.baseline = draft.text;
      this.changeComposition(draft.text, { target, remember: false, items: draft.text === draft.parsedText ? draft.items : undefined });
      ids.push(...promptLeaves(draft.items).map((item) => item.tagId).filter(Boolean));
    }
    const library = this.getLibrary();
    this.status = targets.length > 1 ? '正负组合已应用' : '组合已应用';
    try { this.setLibrary({ ...library, recent: [...new Set([...ids, ...library.recent])].slice(0, 40) }); }
    catch (error) { this.status += `；最近使用保存失败：${error.message}`; }
  }

  editor() {
    const draft = this.ui.draft;
    return `<form class="tag-editor"><div class="tag-editor-fields">
      ${field('中文名称', `<input name="name" required maxlength="80" value="${esc(draft.name)}" />`)}
      ${field('英文提示词', `<input name="en" required maxlength="200" spellcheck="false" value="${esc(draft.en)}" />`)}
      ${field('分类', `<input name="category" maxlength="40" value="${esc(draft.category)}" />`)}
      ${field('搜索别名（逗号分隔）', `<input name="aliases" maxlength="650" value="${esc(draft.aliases.join(', '))}" />`)}
      ${field('标签释义', `<textarea name="description" rows="3" maxlength="1000">${esc(draft.description || '')}</textarea>`)}
      ${field('资料来源（可选）', `<input name="source" type="url" maxlength="1000" placeholder="https://" value="${esc(draft.source || '')}" />`)}
      </div>${draft.preview ? `<img class="tag-custom-preview" src="${esc(draft.preview)}" alt="自定义标签示例" width="96" height="96" />` : ''}
      <div class="tag-editor-actions"><button type="submit" class="ui-button primary">${icon('save')}<span>保存标签</span></button>
      ${command('image-plus', '选择示例图', 'custom-preview')}${draft.preview ? command('x', '移除示例图', 'clear-custom-preview') : ''}
      ${command('x', '取消', 'cancel')}${this.getLibrary().custom.some((tag) => tag.id === draft.id) ? command('trash-2', '删除', 'delete') : ''}</div></form>`;
  }

  bind(container) {
    const root = container.matches?.('[data-tag-root]') ? container : container.querySelector('[data-tag-root]');
    if (!root || this.bound.has(root)) return;
    this.bound.add(root);
    root.addEventListener('error', (event) => {
      if (event.target.matches?.('.tag-detail-preview img')) {
        event.target.replaceWith(document.createTextNode('示例图暂时无法显示'));
      }
    }, true);
    root.addEventListener('click', async (event) => {
      event.stopPropagation();
      const button = event.target.closest('button');
      if (!button || button.disabled) return;
      const target = button.dataset.tagTo || button.closest('[data-composer-target]')?.dataset.composerTarget || this.ui.target;
      try {
        if (button.dataset.visualTarget || button.dataset.visualView) {
          const old = this.composition();
          if (old.text !== old.parsedText) this.changeComposition(old.text, { remember: false });
          this.ui.rawEditing = false;
          if (button.dataset.visualTarget) { this.ui.target = button.dataset.visualTarget; this.ui.activeItem = ''; }
          if (button.dataset.visualView) this.ui.visualView = button.dataset.visualView;
        } else if (button.dataset.visualActive) {
          this.ui.activeItem = button.dataset.visualActive;
        } else if (button.dataset.tagInsert) {
          const tag = allTags(this.getLibrary()).find((row) => row.id === button.dataset.tagInsert);
          if (!tag) throw new Error('该标签已删除');
          let changed;
          if (this.ui.mode === 'compose') {
            const before = this.composition(target).text, next = appendPromptParts(before, tag.en);
            this.changeComposition(next, { target }); changed = before !== next;
          } else {
            const context = this.context(), params = appendTags(context, [tag], target);
            changed = params[target] !== context.params?.[target];
            (this.dialog ? this.picker.insert : this.insert)(params, target);
            this.composition(target);
          }
          const library = this.getLibrary();
          this.setLibrary({ ...library, recent: [tag.id, ...library.recent.filter((id) => id !== tag.id)].slice(0, 40) });
          this.status = changed ? `已追加：${tag.name}` : `已包含：${tag.name}`;
        } else if (button.dataset.tagFavorite) {
          const library = this.getLibrary(), id = button.dataset.tagFavorite;
          this.setLibrary({ ...library, favorites: library.favorites.includes(id) ? library.favorites.filter((value) => value !== id) : [...library.favorites, id].slice(-1000) });
        } else if (button.dataset.tagEdit) {
          this.ui.draft = structuredClone(this.getLibrary().custom.find((row) => row.id === button.dataset.tagEdit));
        } else if (button.dataset.tagDetail) {
          this.ui.detail = button.dataset.tagDetail; this.ui.detailPreview = false;
        } else if (button.dataset.tagSearchTerm) {
          this.ui.search = button.dataset.tagSearchTerm; this.ui.page = 1;
        } else if (button.dataset.tagSelectTarget) {
          this.ui.target = button.dataset.tagSelectTarget;
        } else if (button.dataset.tagView) {
          this.ui.view = button.dataset.tagView; this.ui.page = 1;
        } else if (button.dataset.tagMode) {
          this.ui.mode = button.dataset.tagMode;
        } else if (button.dataset.templateAdd || button.dataset.templateLoad) {
          const entry = allTagTemplates(this.getLibrary()).find((row) => row.id === (button.dataset.templateAdd || button.dataset.templateLoad));
          const resolved = resolveMaterialCard(entry, allTagTemplates(this.getLibrary()));
          if (entry.model && entry.model !== this.context().params?.model) this.notify(`此素材标记的模型为 ${entry.model}，当前模型不同`);
          this.ui.mode = 'compose';
          const value = button.dataset.templateAdd ? appendPromptParts(this.composition().text, resolved[this.ui.target]) : resolved[this.ui.target];
          let items = !button.dataset.templateAdd && resolved[this.ui.target] === entry[this.ui.target]
            ? restoreCardLayout(parsePrompt(value, allTags(this.getLibrary())).items, entry.layout?.[this.ui.target]) : undefined;
          if (button.dataset.templateAdd && this.isVisual() && resolved[this.ui.target] === entry[this.ui.target]) {
            const cardItems = restoreCardLayout(parsePrompt(resolved[this.ui.target], allTags(this.getLibrary())).items, entry.layout?.[this.ui.target]);
            items = preserveGroupLabels([...this.composition().items, ...cardItems], parsePrompt(value, allTags(this.getLibrary())).items);
          }
          this.changeComposition(value, { items });
          this.status = `组合草稿：${entry.name}`;
        } else if (button.dataset.templatePreview) {
          this.ui.cardPreview = resolveMaterialCard(allTagTemplates(this.getLibrary()).find((row) => row.id === button.dataset.templatePreview), allTagTemplates(this.getLibrary()));
        } else if (button.dataset.templateFavorite) {
          const library = this.getLibrary();
          this.setLibrary({ ...library, templates: library.templates.map((row) => row.id === button.dataset.templateFavorite ? { ...row, favorite: !row.favorite } : row) });
        } else if (button.dataset.templateEdit) {
          this.ui.templateDraft = structuredClone(this.getLibrary().templates.find((row) => row.id === button.dataset.templateEdit));
        } else if (button.dataset.composerExpand) {
          const id = button.dataset.composerExpand;
          if (this.expanded.has(id)) this.expanded.delete(id); else this.expanded.add(id);
        } else if (button.dataset.composerTransfer) {
          this.transferItem(target, button.dataset.composerTransfer);
        } else if (button.dataset.composerLabel) {
          const id = button.dataset.composerLabel, draft = this.composition(target), item = findPromptItem(draft.items, id)?.item;
          this.ui.groupDraft = { target, id, name: item.name, color: item.color || 'default' };
        } else if (button.dataset.composerRemove || button.dataset.composerMove || button.dataset.composerWeight || button.dataset.composerUngroup) {
          const draft = this.composition(target);
          if (draft.text !== draft.parsedText) throw new Error('请先解析已修改的原文');
          const id = button.dataset.composerRemove || button.dataset.composerMove || button.dataset.composerWeight || button.dataset.composerUngroup;
          let items;
          if (button.dataset.composerMove) items = movePromptItem(draft.items, id, Number(button.dataset.direction));
          else items = updatePromptItem(draft.items, id, (item) => button.dataset.composerRemove ? []
            : button.dataset.composerUngroup ? ungroupPromptItem(item, allTags(this.getLibrary()))
              : [adjustPromptWeight({ ...item, numericAllowed: numericPromptGroups(this.context()) }, Number(button.dataset.direction), draft.format)]);
          this.commitItems(target, items);
        } else {
          switch (button.dataset.tagAction) {
            case 'new': this.ui.draft = { id: `custom-${randomUUID()}`, name: '', en: '', category: '自定义', aliases: [] }; break;
            case 'cancel': this.ui.draft = null; break;
            case 'delete': {
              if (!window.confirm(`删除“${this.ui.draft.name}”？`)) return;
              this.setLibrary(normalizeTagLibrary({ ...this.getLibrary(), custom: this.getLibrary().custom.filter((tag) => tag.id !== this.ui.draft.id) }));
              this.ui.draft = null; break;
            }
            case 'previous': this.ui.page--; break;
            case 'next': this.ui.page++; break;
            case 'parse': {
              const draft = this.composition(target);
              this.changeComposition(draft.text, { target }); this.status = '原文已解析，未知词与分组已保留'; break;
            }
            case 'undo': this.undoComposition(); break;
            case 'redo': this.redoComposition(); break;
            case 'selected-up': case 'selected-down': case 'selected-weaker': case 'selected-stronger': case 'selected-transfer':
              this.selectedOperation(target, button.dataset.tagAction.slice(9)); break;
            case 'selected-clear': this.selections.delete(target); break;
            case 'selected-delete': this.selectedOperation(target, 'delete'); this.ui.activeItem = ''; break;
            case 'visual-library': this.ui.visualLibrary = !this.ui.visualLibrary; break;
            case 'visual-preview': this.ui.visualPreview = this.ui.visualPreview === false; break;
            case 'visual-transfer': this.transferSelection(target, button.dataset.visualTo); break;
            case 'visual-copy': {
              const draft = this.composition(target), ids = this.selections.get(target), scope = this.ui;
              const text = ids?.size && draft.text === draft.parsedText ? copyPromptItems(draft.items, ids) : draft.text;
              try { await navigator.clipboard.writeText(text); if (this.ui !== scope || !root.isConnected) return; this.status = '提示词已复制'; }
              catch { if (this.ui !== scope || !root.isConnected) return; this.ui.clipboard = { mode: 'copy', text }; }
              break;
            }
            case 'visual-paste': {
              const scope = this.ui;
              try { const text = await navigator.clipboard.readText(); if (this.ui !== scope || !root.isConnected) return; this.appendVisualText(text); }
              catch { if (this.ui !== scope || !root.isConnected) return; this.ui.clipboard = { mode: 'paste', text: '' }; }
              break;
            }
            case 'visual-clipboard-close': this.ui.clipboard = null; break;
            case 'visual-weight-set': {
              const input = root.querySelector('[data-visual-weight]'), draft = this.composition(target);
              if (!input || draft.text !== draft.parsedText) throw new Error('请先切换可视化解析原文');
              this.commitItems(target, updatePromptItem(draft.items, input.dataset.visualWeight, (item) =>
                [setPromptWeight(item, input.value, draft.format, { numeric: numericPromptGroups(this.context()) })])); break;
            }
            case 'visual-weight-up': case 'visual-weight-down': {
              const draft = this.composition(target);
              if (draft.text !== draft.parsedText) throw new Error('请先切换可视化解析原文');
              if (findPromptItem(draft.items, this.ui.activeItem)?.item.numeric && draft.format === 'novelai'
                && !numericPromptGroups(this.context())) throw new Error('此模型不支持数值分组权重');
              this.commitItems(target, updatePromptItem(draft.items, this.ui.activeItem, (item) =>
                [adjustPromptWeight({ ...item, numericAllowed: numericPromptGroups(this.context()) },
                  button.dataset.tagAction.endsWith('up') ? 1 : -1, draft.format)])); break;
            }
            case 'visual-save-selection': {
              const draft = this.composition(target), ids = this.selections.get(target) || [];
              if (draft.text !== draft.parsedText) throw new Error('请先切换可视化解析原文');
              const chosen = copyPromptSelection(draft.items, ids);
              this.ui.templateDraft = { id: `template-${randomUUID()}`, name: '', category: '我的素材',
                positive: '', negative: '', artist: '', [target]: serializePrompt(chosen),
                layout: { [target]: cardLayout(chosen) } }; break;
            }
            case 'cancel-group': this.ui.groupDraft = null; break;
            case 'new-template':
              this.ui.templateDraft = { id: `template-${randomUUID()}`, name: '', category: '我的素材', positive: '', negative: '', artist: '' }; break;
            case 'group': {
              const draft = this.composition(target);
              const items = (this.isVisual() ? groupPromptSelection : groupPromptItems)(draft.items, [...(this.selections.get(target) || [])], draft.format, { numeric: numericPromptGroups(this.context()) });
              this.commitItems(target, items); this.status = '标签组已建立'; break;
            }
            case 'more-items': this.composition(target).visibleItems = (this.composition(target).visibleItems || 200) + 200; break;
            case 'deduplicate': {
              const draft = this.composition(target);
              this.commitItems(target, deduplicatePrompt(parsePrompt(draft.text, allTags(this.getLibrary())).items)); break;
            }
            case 'reload-composition': {
              const draft = this.composition(target); draft.baseline = this.context().params?.[target] || '';
              this.changeComposition(draft.baseline, { target }); break;
            }
            case 'clear-composition': this.changeComposition('', { target }); break;
            case 'apply-composition': this.applyCompositions([target]); break;
            case 'apply-pair': this.applyCompositions(['positive', 'negative']); break;
            case 'save-template': {
              this.ui.templateDraft = { id: `template-${randomUUID()}`, name: '', category: '我的组合',
                positive: '', negative: '', artist: '',
                layout: Object.fromEntries(this.composerTargets().map((field) => [field, cardLayout(this.composition(field).items)])),
                ...Object.fromEntries(this.composerTargets().filter((field) => tagTargets(this.context()).some((row) => row.id === field && row.enabled))
                  .map((field) => [field, this.composition(field).text])) }; break;
            }
            case 'close-detail': this.ui.detail = ''; this.ui.detailPreview = false; break;
            case 'show-detail-preview': this.ui.detailPreview = true; break;
            case 'custom-preview': this.choosePreview(root); return;
            case 'clear-custom-preview': delete this.ui.draft.preview; break;
            case 'cancel-template': this.ui.templateDraft = null; break;
            case 'delete-template':
              if (!window.confirm(`删除组合模板“${this.ui.templateDraft.name}”？`)) return;
              {
                const library = { ...this.getLibrary(), templates: this.getLibrary().templates.filter((row) => row.id !== this.ui.templateDraft.id) };
                for (const entry of allTagTemplates(library)) resolveMaterialCard(entry, allTagTemplates(library));
                this.setLibrary(library);
              }
              this.ui.templateDraft = null; break;
            case 'export': downloadJson('linghuashi-tags.json', { format: 'linghuashi-tags', version: 2, library: this.getLibrary() }); return;
            case 'import': this.chooseImport(root); return;
            default: return;
          }
        }
        this.refresh(root);
        if (button.dataset.tagAction === 'save-template') root.querySelector('.tag-template-editor input')?.focus();
        if (button.dataset.tagDetail) root.querySelector('.tag-details')?.scrollIntoView({ block: 'nearest' });
      } catch (error) { this.status = error.message; this.refresh(root); }
    });
    root.addEventListener('input', (event) => {
      event.stopPropagation();
      if (event.target.matches('[data-tag-search]')) {
        this.ui.search = event.target.value; this.ui.page = 1;
        // Keep the input node and IME composition intact while refreshing results.
        if (!event.isComposing) this.refresh(root, true);
      } else if (event.target.matches('[data-card-search]')) {
        this.ui.cardSearch = event.target.value;
        if (!event.isComposing) this.refresh(root, true);
      } else if (event.target.matches('[data-composer-source]')) {
        const panel = event.target.closest('[data-composer-target]'), target = panel.dataset.composerTarget;
        if (this.isVisual() && !this.ui.rawEditing) { this.rememberComposition([target]); this.ui.rawEditing = true; }
        this.composition(target).text = event.target.value;
        panel.querySelector('.tag-composer-note').textContent = '原文已修改，待解析';
        panel.querySelectorAll('[data-composer-move], [data-composer-weight], [data-composer-remove], [data-composer-transfer], [data-composer-ungroup], [data-composer-select], [data-visual-select-all], [data-tag-action="group"], [data-tag-action="selected-delete"], [data-tag-action="visual-save-selection"]').forEach((node) => { node.disabled = true; });
        panel.querySelectorAll('[data-composer-item]').forEach((node) => { node.draggable = false; });
        if (this.isVisual() && !event.isComposing) this.updateVisualPreview(root);
      } else if (event.target.closest('.tag-template-editor')) this.readTemplateDraft(event.target.form);
      else if (event.target.closest('.tag-editor')) this.readDraft(event.target.form);
    });
    root.addEventListener('compositionend', (event) => {
      if (event.target.matches('[data-tag-search]')) {
        this.ui.search = event.target.value; this.ui.page = 1; this.refresh(root, true);
      }
      if (event.target.matches('[data-card-search]')) { this.ui.cardSearch = event.target.value; this.refresh(root, true); }
      if (this.isVisual() && event.target.matches('[data-composer-source]')) this.updateVisualPreview(root);
    });
    root.addEventListener('change', (event) => {
      event.stopPropagation();
      if (event.target.matches('[data-tag-category]')) { this.ui.category = event.target.value; this.ui.page = 1; }
      else if (event.target.matches('[data-tag-target]')) this.ui.target = event.target.value;
      else if (event.target.matches('[data-card-favorites]')) this.ui.cardFavorites = event.target.checked;
      else if (event.target.matches('[data-card-reference]') && event.target.value) {
        const card = allTagTemplates(this.getLibrary()).find((row) => row.id === event.target.value);
        try {
          const token = cardReference(card);
          for (const key of ['positive', 'negative', 'artist']) if (card[key]) this.ui.templateDraft[key] = appendPromptParts(this.ui.templateDraft[key], token);
        } catch (error) { this.status = error.message; }
      }
      else if (event.target.matches('[data-composer-format]')) {
        const target = event.target.closest('[data-composer-target]').dataset.composerTarget;
        this.rememberComposition([target]); this.composition(target).format = event.target.value;
      } else if (event.target.matches('[data-composer-select]')) {
        const target = event.target.closest('[data-composer-target]').dataset.composerTarget;
        const selected = this.selections.get(target) || new Set(), id = event.target.dataset.composerSelect;
        if (event.target.checked) selected.add(id); else selected.delete(id);
        this.selections.set(target, selected);
      }
      else if (event.target.matches('[data-visual-select-all]')) {
        const target = this.ui.target;
        this.selections.set(target, new Set(event.target.checked ? this.composition(target).items.map((item) => item.id) : []));
      }
      else if (event.target.matches('[data-visual-group-move]') && event.target.value) {
        try {
          const target = this.ui.target, draft = this.composition(target), ids = this.selections.get(target) || [];
          if (draft.text !== draft.parsedText) throw new Error('请先切换可视化解析原文');
          let items = structuredClone(draft.items);
          for (const item of selectedPromptItems(draft.items, ids)) items = movePromptTo(items, item.id,
            { parentId: event.target.value === 'root' ? '' : event.target.value }, allTags(this.getLibrary()));
          this.commitItems(target, items);
        } catch (error) { this.status = error.message; }
      }
      else return;
      this.refresh(root);
    });
    root.addEventListener('submit', (event) => {
      event.preventDefault(); event.stopPropagation();
      try {
        if (event.target.matches('.visual-add-form')) {
          this.appendVisualText(event.target.querySelector('[data-visual-add]').value);
        } else if (event.target.matches('.visual-clipboard-form')) {
          if (this.ui.clipboard?.mode === 'paste') this.appendVisualText(event.target.querySelector('textarea').value);
          this.ui.clipboard = null;
        } else if (event.target.matches('.tag-template-editor')) {
          this.readTemplateDraft(event.target); this.setLibrary(saveTagTemplate(this.getLibrary(), this.ui.templateDraft));
          this.ui.templateDraft = null; this.status = '组合模板已保存';
        } else if (event.target.matches('.tag-group-editor')) {
          const data = new FormData(event.target), group = this.ui.groupDraft;
          this.commitItems(group.target, updatePromptItem(this.composition(group.target).items, group.id,
            (item) => [{ ...item, name: String(data.get('name') || '标签组').slice(0, 40), color: String(data.get('color')) }]));
          this.ui.groupDraft = null; this.status = '分组标记已保存';
        } else {
          this.readDraft(event.target);
          this.setLibrary(saveTag(this.getLibrary(), this.ui.draft));
          this.ui.draft = null; this.status = '标签已保存';
        }
      } catch (error) { this.status = error.message; }
      this.refresh(root);
    });
    root.addEventListener('dragstart', (event) => {
      const row = event.target.closest('[data-composer-item]');
      const target = row?.closest('[data-composer-target]')?.dataset.composerTarget;
      if (!row || this.composition(target).text !== this.composition(target).parsedText) { event.preventDefault(); return; }
      this.dragged = { target, id: row.dataset.composerItem };
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', this.dragged.id);
    });
    root.addEventListener('dragover', (event) => { if (this.dragged && event.target.closest('[data-composer-target]')) event.preventDefault(); });
    root.addEventListener('drop', (event) => {
      const row = event.target.closest('[data-composer-item]'), panel = event.target.closest('[data-composer-target]');
      if (!this.dragged || !panel) return;
      event.preventDefault(); event.stopPropagation();
      try {
        const target = panel.dataset.composerTarget, draft = this.composition(target);
        if (draft.text !== draft.parsedText) throw new Error('请先解析已修改的原文');
        if (this.isVisual()) {
          const group = event.target.closest('[data-visual-drop-group]')?.dataset.visualDropGroup || '';
          const before = row && row.dataset.composerItem !== group ? row.dataset.composerItem : '';
          let parentId = group;
          if (before) {
            const locate = (items, parent = '') => {
              for (const item of items) {
                if (item.id === before) return parent;
                if (item.kind === 'group' && findPromptItem(item.children, before)) return locate(item.children, item.id);
              }
              return '';
            };
            parentId = locate(draft.items);
          }
          if (target !== this.dragged.target) this.transferItem(this.dragged.target, this.dragged.id);
          else this.commitItems(target, movePromptTo(draft.items, this.dragged.id, { parentId, beforeId: before }, allTags(this.getLibrary())));
        } else if (target !== this.dragged.target) this.transferItem(this.dragged.target, this.dragged.id);
        else if (row) {
          const items = structuredClone(draft.items), from = findPromptItem(items, this.dragged.id), to = findPromptItem(items, row.dataset.composerItem);
          if (from && to && from.siblings === to.siblings && from.index !== to.index) {
            from.siblings.splice(to.index, 0, from.siblings.splice(from.index, 1)[0]);
            this.commitItems(target, updatePromptItem(items, this.dragged.id, (item) => [item]));
          }
        }
      } catch (error) { this.status = error.message; }
      this.dragged = null; this.refresh(root);
    });
    root.addEventListener('dragend', () => { this.dragged = null; });
  }

  readTemplateDraft(form) {
    if (!this.ui.templateDraft || !form) return;
    const data = new FormData(form);
    for (const key of ['positive', 'negative', 'artist']) {
      if (String(data.get(key) || '') !== this.ui.templateDraft[key] && this.ui.templateDraft.layout) delete this.ui.templateDraft.layout[key];
    }
    for (const key of ['name', 'category', 'positive', 'negative', 'artist', 'model']) this.ui.templateDraft[key] = String(data.get(key) || '');
  }

  readDraft(form) {
    if (!this.ui.draft || !form) return;
    const data = new FormData(form);
    Object.assign(this.ui.draft, { name: data.get('name'), en: data.get('en'), category: data.get('category'),
      description: String(data.get('description') || ''), source: String(data.get('source') || ''),
      aliases: String(data.get('aliases') || '').split(/[,，]/).map((value) => value.trim()).filter(Boolean) });
  }

  refresh(root, keepSearch = false) {
    const count = document.querySelector('[data-tag-count]');
    if (count) count.textContent = `${BUILTIN_TAGS.length} 个内置标签 · ${this.getLibrary().custom.length} 个自定义标签`;
    const scroll = this.dialog?.querySelector('.tag-picker-body');
    const top = scroll?.scrollTop;
    const templateOpen = root.querySelector('.tag-templates')?.open;
    const cardInput = root.querySelector('[data-card-search]'), cardFocused = document.activeElement === cardInput;
    const cardSelection = cardFocused ? cardInput.selectionStart : 0;
    const listTops = [...root.querySelectorAll('[data-composer-target]')].map((panel) =>
      [panel.dataset.composerTarget, panel.querySelector('.tag-composer-items')?.scrollTop || 0]);
    const composersTop = root.querySelector('.tag-composers')?.scrollTop || 0;
    const search = this.isVisual() && keepSearch ? root.querySelector('[data-tag-search]') : null;
    const searchFocused = document.activeElement === search;
    const toolbar = keepSearch && !this.isVisual() ? root.querySelector('.tag-toolbar') : null;
    if (toolbar) {
      const template = document.createElement('template');
      template.innerHTML = this.content();
      template.content.querySelector('.tag-toolbar').remove();
      [...root.children].filter((node) => node !== toolbar).forEach((node) => node.remove());
      root.append(template.content);
    } else root.innerHTML = this.content();
    if (search) {
      const replacement = root.querySelector('[data-tag-search]');
      replacement?.replaceWith(search);
      if (searchFocused) search.focus();
    }
    if (scroll) scroll.scrollTop = top;
    if (templateOpen && root.querySelector('.tag-templates')) root.querySelector('.tag-templates').open = true;
    if (cardFocused) { const input = root.querySelector('[data-card-search]'); input.focus(); try { input.setSelectionRange(cardSelection, cardSelection); } catch {} }
    for (const [target, top] of listTops) {
      const list = root.querySelector(`[data-composer-target="${target}"] .tag-composer-items`);
      if (list) list.scrollTop = top;
    }
    const composers = root.querySelector('.tag-composers');
    if (composers) composers.scrollTop = composersTop;
    paintIcons();
  }

  choosePreview(root) {
    if (this.previewBusy || !this.ui.draft) return;
    const draft = this.ui.draft, scope = this.ui, input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      this.previewBusy = true;
      try {
        if (file.size > 8 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
          throw new Error('请选择小于 8 MB 的 PNG、JPG 或 WebP');
        }
        const bitmap = await createImageBitmap(file);
        try {
          if (bitmap.width * bitmap.height > 40000000) throw new Error('图片像素过大，请先缩小');
          const scale = Math.min(1, 192 / Math.max(bitmap.width, bitmap.height)), canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(bitmap.width * scale));
          canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const preview = canvas.toDataURL('image/webp', .7);
          if (preview.length > 60000) throw new Error('示例压缩后仍过大，请换一张图片');
          if (this.ui !== scope || this.ui.draft !== draft || !root.isConnected) return;
          draft.preview = preview;
          this.status = '示例图已压缩，保存标签后生效'; this.refresh(root);
        } finally { bitmap.close(); }
      } catch (error) {
        if (this.ui === scope && this.ui.draft === draft && root.isConnected) {
          this.status = error.message; this.refresh(root);
        }
      } finally { this.previewBusy = false; }
    }, { once: true });
    input.click();
  }

  chooseImport(root) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      try {
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 300000) throw new Error('标签文件不能超过 300 KB');
        this.setLibrary(importTags(this.getLibrary(), JSON.parse(await file.text())));
        this.status = '标签已合并导入'; this.refresh(root);
      } catch (error) { this.status = error.message; this.refresh(root); }
    }, { once: true });
    input.click();
  }

  open(picker) {
    this.close();
    this.pageScope = { compositions: this.compositions, histories: this.histories, redos: this.redos, selections: this.selections,
      expanded: this.expanded, ui: this.ui, status: this.status };
    this.compositions = new Map();
    this.histories = new Map(); this.redos = new Map(); this.selections = new Map(); this.expanded = new Set();
    this.ui = { ...this.ui, target: picker.target || 'positive', draft: null, templateDraft: null, groupDraft: null, detail: '', detailPreview: false };
    if (picker.visual) Object.assign(this.ui, { mode: 'compose', visualView: 'visual', visualPreview: true,
      visualLibrary: false, activeItem: '', rawEditing: false, clipboard: null, search: '', category: '', view: 'all' });
    this.picker = picker; this.status = '';
    const dialog = document.createElement('dialog');
    this.dialog = dialog; dialog.className = `tag-picker${picker.visual ? ' visual-prompt-editor' : ''}`;
    dialog.setAttribute('aria-labelledby', 'tag-picker-title');
    dialog.innerHTML = `<header><div><h2 id="tag-picker-title">${picker.visual ? '可视化提示词编辑' : '中文标签库'}</h2>${picker.visual && picker.label ? `<small>${esc(picker.label)}</small>` : ''}</div>${tool('x', '关闭编辑窗口', 'data-tag-close')}</header>
      <div class="tag-picker-body"><section class="tag-library" data-tag-root>${this.content()}</section></div>
      ${picker.visual ? `<footer class="visual-editor-footer"><span>${esc(({ novelai: 'NovelAI', openai: 'OpenAI兼容', comfyui: 'ComfyUI', sdwebui: 'SDWebUI' })[this.context().provider])}</span><div><button type="button" class="ui-button secondary" data-visual-cancel>取消</button><button type="button" class="ui-button primary" data-visual-apply>${icon('check')}应用</button></div></footer>` : ''}`;
    document.body.append(dialog); this.bind(dialog);
    dialog.querySelector('[data-tag-close]').addEventListener('click', () => this.close());
    dialog.querySelector('[data-visual-cancel]')?.addEventListener('click', () => this.close());
    dialog.querySelector('[data-visual-apply]')?.addEventListener('click', () => {
      try {
        const targets = this.composerTargets().filter((target) => this.composition(target).text !== this.composition(target).baseline);
        if (targets.length) { this.applyCompositions(targets); this.notify?.('提示词已应用'); }
        this.close();
      } catch (error) { this.status = error.message; this.refresh(dialog.querySelector('[data-tag-root]')); }
    });
    dialog.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); this.close(); }
    });
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); this.close(); });
    dialog.addEventListener('click', (event) => { if (event.target === dialog) this.close(); });
    paintIcons(); dialog.showModal(); dialog.querySelector(picker.visual ? '[data-visual-target][aria-selected="true"]' : '[data-tag-search]')?.focus();
  }

  close() {
    if (!this.dialog) return;
    const picker = this.picker;
    this.dialog.close(); this.dialog.remove(); this.dialog = null; this.picker = null;
    Object.assign(this, this.pageScope); this.pageScope = null; this.dragged = null;
    picker?.closed?.();
  }
}

export function attachPromptTagButtons(container, open) {
  container.querySelectorAll('textarea[data-nai], textarea[data-openai], textarea[data-comfy], textarea[data-sdwebui], textarea[data-image-edit-role], textarea[data-profile-field], textarea[data-profile-outfit], textarea[data-artist-field]').forEach((input) => {
    const local = input.dataset.profileField || input.dataset.artistField || (input.dataset.profileOutfit ? 'prompt' : '');
    const target = input.dataset.nai || input.dataset.openai || input.dataset.comfy || input.dataset.sdwebui || input.dataset.roleField
      || ({ tags: 'positive', prompt: 'positive', quality: 'positive', negative: 'negative', artist: 'artist' })[local];
    if (!['positive', 'negative', 'artist'].includes(target) || input.disabled || input.closest('[hidden]')) return;
    const label = input.closest('.ui-field')?.querySelector(':scope > span');
    if (!label || label.querySelector('[data-prompt-tags]')) return;
    label.classList.add('prompt-tags-label');
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'prompt-tags-button'; button.dataset.promptTags = target;
    button.title = `从中文标签库添加${({ positive: '正向提示词', negative: '负面提示词', artist: '风格描述' })[target]}`;
    button.setAttribute('aria-label', button.title);
    button.innerHTML = `${icon('list-filter')}<span>标签库</span>`;
    button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); open(target, input); });
    const actions = document.createElement('span'); actions.className = 'prompt-field-actions';
    actions.append(button);
    const visual = document.createElement('button');
    visual.type = 'button'; visual.className = 'prompt-tags-button'; visual.dataset.promptVisual = target;
    visual.title = '可视化编辑提示词'; visual.setAttribute('aria-label', `可视化编辑${({ positive: '正向提示词', negative: '负面提示词', artist: '风格描述' })[target]}`);
    visual.innerHTML = `${icon('panels-top-left')}<span>可视化编辑</span>`;
    visual.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); open(target, input, true); });
    actions.append(visual); label.append(actions);
    paintIcons(actions);
  });
}
