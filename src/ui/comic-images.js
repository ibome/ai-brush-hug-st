import { escapeHtml as esc } from '../config.js';
import { icon, paintIcons } from '../icons.js';
import { comicImageRef } from '../comic.js';

const PAGE_SIZE = 24;
const tool = (name, label, extra = '') => `<button type="button" class="ui-icon-button" title="${label}" aria-label="${label}" ${extra}>${icon(name)}</button>`;

export class ComicImagePicker {
  constructor({ listImages, favoriteImage }) {
    this.listImages = listImages; this.favoriteImage = favoriteImage; this.revision = 0; this.urls = [];
  }
  open({ title, location, onSelect }) {
    this.close();
    Object.assign(this, { location, onSelect, rows: [], page: 1, query: '', favoriteOnly: false, selected: '', loading: false, saving: false });
    const dialog = document.createElement('dialog');
    this.dialog = dialog; dialog.className = 'comic-image-picker'; dialog.setAttribute('aria-labelledby', 'comic-image-picker-title');
    dialog.innerHTML = `<header><div><h2 id="comic-image-picker-title">选用图库图片</h2><p>${esc(title)}</p></div>${tool('x', '关闭图库选择', 'data-comic-library-close')}</header>
      <div class="comic-image-filters"><label class="ui-field"><span>图片位置</span><select data-comic-library-location aria-label="图库图片位置"><option value="browser">当前浏览器</option><option value="server">酒馆服务器</option></select></label>
      <label class="ui-field"><span>搜索图片</span><input type="search" data-comic-library-search aria-label="搜索图库图片" placeholder="名称或提示词" maxlength="200"></label>
      <label class="comic-check"><input type="checkbox" data-comic-library-favorite>仅收藏</label></div>
      <p class="comic-error" role="alert" data-comic-library-error hidden></p>
      <div class="comic-image-results" data-comic-library-results aria-live="polite"></div>
      <footer><span data-comic-library-selection>未选择图片</span><div class="comic-actions">
      ${tool('chevron-left', '上一页图库图片', 'data-comic-library-page="-1"')}<span data-comic-library-page-label></span>${tool('chevron-right', '下一页图库图片', 'data-comic-library-page="1"')}
      <button type="button" class="ui-button primary" data-comic-library-apply disabled>${icon('check')}用于当前画格</button></div></footer>`;
    document.body.append(dialog);
    dialog.querySelector('[data-comic-library-location]').value = location;
    dialog.onclick = (event) => {
      if (event.target.closest('[data-comic-library-close]')) { this.close(); return; }
      const page = event.target.closest('[data-comic-library-page]');
      if (page && !this.loading && !this.saving) { this.page += Number(page.dataset.comicLibraryPage); this.renderResults(); return; }
      const item = event.target.closest('[data-comic-library-image]');
      if (item && !this.saving) { this.selected = item.dataset.comicLibraryImage; this.renderResults(); return; }
      if (event.target.closest('[data-comic-library-apply]')) void this.apply();
    };
    dialog.oninput = (event) => {
      if (!event.target.matches('[data-comic-library-search]')) return;
      this.query = event.target.value.trim().toLocaleLowerCase(); this.page = 1; this.renderResults();
    };
    dialog.onchange = (event) => {
      if (event.target.matches('[data-comic-library-location]')) {
        this.location = event.target.value; this.selected = ''; this.page = 1; void this.load();
      } else if (event.target.matches('[data-comic-library-favorite]')) {
        this.favoriteOnly = event.target.checked; this.page = 1; this.renderResults();
      }
    };
    dialog.oncancel = (event) => { event.preventDefault(); if (!this.saving) this.close(); };
    paintIcons(dialog); dialog.showModal(); void this.load();
  }
  error(message = '') {
    const node = this.dialog?.querySelector('[data-comic-library-error]');
    if (node) { node.textContent = message; node.hidden = !message; }
  }
  async load() {
    const revision = ++this.revision, location = this.location;
    this.loading = true; this.rows = []; this.error(); this.renderResults();
    try {
      const rows = await this.listImages(location);
      if (!this.dialog || revision !== this.revision) return;
      this.rows = rows.filter((row) => comicImageRef({ id: row.id, location }))
        .sort((a, b) => b.createdAt - a.createdAt);
    } catch (error) { if (revision === this.revision) this.error(error.message || '图库读取失败'); }
    finally {
      if (revision === this.revision) { this.loading = false; this.renderResults(); }
    }
  }
  renderResults() {
    if (!this.dialog) return;
    this.clearURLs();
    const rows = this.rows.filter((row) => (!this.favoriteOnly || row.favorite)
      && (!this.query || `${row.title} ${row.snapshot?.params?.positive || row.snapshot?.config?.params?.positive || ''}`.toLocaleLowerCase().includes(this.query)));
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    this.page = Math.max(1, Math.min(pages, this.page));
    const visible = rows.slice((this.page - 1) * PAGE_SIZE, this.page * PAGE_SIZE);
    this.dialog.querySelector('[data-comic-library-results]').innerHTML = this.loading ? '<p class="comic-empty">正在读取图库…</p>'
      : visible.map((row) => {
        let src = row.thumbnailURL;
        if (!src && row.thumbnail instanceof Blob) { src = URL.createObjectURL(row.thumbnail); this.urls.push(src); }
        return `<button type="button" class="comic-image-option" data-comic-library-image="${esc(row.id)}" aria-pressed="${row.id === this.selected}" ${this.saving ? 'disabled' : ''}>
          <span class="comic-image-thumbnail">${src ? `<img src="${esc(src)}" alt="${esc(row.title)}" loading="lazy" decoding="async">` : icon('image-off')}</span>
          <span class="comic-image-name">${esc(row.title)}</span><small>${Number(row.width) || '?'} × ${Number(row.height) || '?'}${row.favorite ? ' · 已收藏' : ''}</small></button>`;
      }).join('') || '<p class="comic-empty">没有符合条件的图片</p>';
    this.dialog.querySelector('[data-comic-library-page-label]').textContent = `${this.page} / ${pages} · ${rows.length} 张`;
    this.dialog.querySelector('[data-comic-library-page="-1"]').disabled = this.loading || this.saving || this.page === 1;
    this.dialog.querySelector('[data-comic-library-page="1"]').disabled = this.loading || this.saving || this.page === pages;
    const selected = this.rows.find((row) => row.id === this.selected);
    this.dialog.querySelector('[data-comic-library-selection]').textContent = selected ? `已选：${selected.title} · 自动收藏` : '未选择图片';
    this.dialog.querySelector('[data-comic-library-apply]').disabled = !selected || this.loading || this.saving;
    for (const selector of ['[data-comic-library-close]', '[data-comic-library-location]', '[data-comic-library-search]', '[data-comic-library-favorite]']) {
      this.dialog.querySelector(selector).disabled = this.saving;
    }
    paintIcons(this.dialog);
  }
  async apply() {
    if (this.saving || this.loading || !this.selected) return;
    const revision = this.revision, dialog = this.dialog, id = this.selected, location = this.location;
    this.saving = true; this.error(); this.renderResults();
    try {
      const row = (await this.listImages(location)).find((row) => row.id === id);
      if (!row) throw new Error('图片已删除，请重新打开图库选择');
      if (revision !== this.revision || this.dialog !== dialog) return;
      await this.favoriteImage(id, location);
      if (revision !== this.revision || this.dialog !== dialog) return;
      await this.onSelect({ id, location });
      this.close();
    } catch (error) { if (revision === this.revision) this.error(error.message || '图片选用失败'); }
    finally { if (revision === this.revision) { this.saving = false; this.renderResults(); } }
  }
  clearURLs() { this.urls.forEach((url) => URL.revokeObjectURL(url)); this.urls = []; }
  close() {
    this.revision++; this.clearURLs();
    if (this.dialog) { this.dialog.close(); this.dialog.remove(); this.dialog = null; }
  }
}
