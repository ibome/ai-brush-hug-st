import { escapeHtml as esc } from '../config.js';
import { icon } from '../icons.js';
const command = (name, title, action, extra = '') => `<button type="button" class="ui-button secondary" data-action="${action}" ${extra}>${icon(name)}<span>${title}</span></button>`;
const field = (label, content) => `<label class="ui-field"><span>${label}</span>${content}</label>`;
const targets = { all: '通用', novelai: 'NovelAI', openai: 'OpenAI兼容', comfyui: 'ComfyUI', sdwebui: 'SDWebUI' };

export function renderArtistDirectory(state, ui) {
  const query = ui.search.trim().toLocaleLowerCase();
  const entries = state.artistLibrary.filter((entry) => (!ui.favoriteOnly || entry.favorite)
    && (!ui.category || entry.category === ui.category)
    && [entry.name, entry.category, entry.artist].join(' ').toLocaleLowerCase().includes(query));
  return entries.length ? entries.map((entry) => `<button type="button" data-artist-select="${esc(entry.id)}" aria-pressed="${ui.draft?.id === entry.id}">
      ${entry.preview ? `<img src="${entry.preview}" alt="" width="64" height="64" loading="lazy" />` : `<span class="artist-preview-empty">${icon('palette')}</span>`}<span><strong>${esc(entry.name)} ${entry.favorite ? '★' : ''}</strong><small>${esc(entry.category || targets[entry.target])}</small></span>${icon('chevron-right')}</button>`).join('') : '<p class="artist-empty">暂无匹配的画师串</p>';
}

export function renderArtists(state, ui) {
  const categories = [...new Set(state.artistLibrary.map((entry) => entry.category).filter(Boolean))];
  const value = ui.draft;
  return `<div class="page-heading"><div><h1>画师串库</h1><p>${state.artistLibrary.length} 个画风配方</p></div><div class="heading-actions">${command('plus', '新建', 'artist-new')}${command('copy-plus', '保存当前画风', 'artist-capture')}</div></div>
    <div class="artist-toolbar"><label class="search-input">${icon('search')}<input type="search" data-artist-search placeholder="搜索名称、分类、画师" aria-label="搜索画师串" value="${esc(ui.search)}" /></label>
      <select data-artist-category aria-label="分类筛选"><option value="">全部分类</option>${categories.map((name) => `<option ${name === ui.category ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>
      <label class="artist-check"><input type="checkbox" data-artist-favorites ${ui.favoriteOnly ? 'checked' : ''} />仅收藏</label>
      ${command('upload', '导入', 'artist-import')}${command('download', '导出', 'artist-export')}</div>
    <div class="artist-workspace"><section class="artist-directory" aria-label="画师串列表">${renderArtistDirectory(state, ui)}</section>
    <section class="artist-editor" aria-label="画师串编辑">${value ? `
      <div class="artist-form-grid">${field('名称', `<input data-artist-field="name" maxlength="40" value="${esc(value.name)}" />`)}${field('分类', `<input data-artist-field="category" maxlength="40" value="${esc(value.category)}" />`)}</div>
      <div class="artist-form-grid">${field('适用模式', `<select data-artist-field="target">${Object.entries(targets).map(([id, title]) => `<option value="${id}" ${value.target === id ? 'selected' : ''}>${title}</option>`).join('')}</select>`)}<label class="artist-check"><input type="checkbox" data-artist-field="favorite" ${value.favorite ? 'checked' : ''} />收藏</label></div>
      ${field('画师串／风格描述', `<textarea rows="4" data-artist-field="artist" maxlength="4000" spellcheck="false">${esc(value.artist)}</textarea>`)}
      ${field('关联质量词', `<textarea rows="2" data-artist-field="quality" maxlength="4000" spellcheck="false">${esc(value.quality)}</textarea>`)}
      ${field('关联负面词', `<textarea rows="2" data-artist-field="negative" maxlength="12000" spellcheck="false">${esc(value.negative)}</textarea>`)}
      <div class="artist-preview-row">${value.preview ? `<img src="${value.preview}" width="96" height="96" alt="画风预览" />` : `<span class="artist-preview-empty">${icon('image')}</span>`}${command('image-plus', '上传预览图', 'artist-preview')}${command('trash-2', '移除预览图', 'artist-preview-clear', !value.preview ? 'disabled' : '')}</div>
      <div class="artist-editor-actions">${command('save', ui.dirty ? '保存修改' : '保存', 'artist-save')}${command('copy-plus', '复制', 'artist-copy')}${command('trash-2', '删除', 'artist-delete', state.artistLibrary.some((entry) => entry.id === value.id) ? '' : 'disabled')}</div>
      <div class="artist-apply-options">${field('画师串载入方式', `<select data-artist-mode><option value="replace" ${ui.mode === 'replace' ? 'selected' : ''}>替换画师串</option><option value="append" ${ui.mode === 'append' ? 'selected' : ''}>追加画师串</option></select>`)}
        <label class="artist-check"><input type="checkbox" data-artist-quality ${ui.quality ? 'checked' : ''} />同时追加质量词</label><label class="artist-check"><input type="checkbox" data-artist-negative ${ui.negative ? 'checked' : ''} />同时追加负面词</label>
        <button type="button" class="ui-button primary" data-action="artist-apply">${icon('wand-sparkles')}<span>载入 ${targets[state.provider]}</span></button></div>
      ` : '<p class="artist-empty">选择画师串或新建配方</p>'}</section></div>`;
}

export function renderArtistQuickPick(state) {
  const available = state.artistLibrary.filter((entry) => entry.target === 'all' || entry.target === state.provider);
  return `<div class="artist-quick"><label class="ui-field"><span>画师串库</span><select data-artist-quick><option value="">选择画风</option>${available.map((entry) => `<option value="${esc(entry.id)}">${esc(entry.name)}</option>`).join('')}</select></label>
    <button type="button" class="ui-icon-button" data-action="artist-quick-apply" title="载入画师串" aria-label="载入画师串">${icon('folder-open')}</button><button type="button" class="ui-icon-button" data-page="styles" title="管理画师串库" aria-label="管理画师串库">${icon('palette')}</button></div>`;
}
