import { escapeHtml as esc } from '../config.js';
import { icon, paintIcons } from '../icons.js';
import { normalizeReaderSettings } from '../chat-reader.js';
import { exportReading, readingMessages } from '../chat-reading-export.js';
import '../styles/reader.css';

const command = (action, glyph, label, disabled = false) => `<button type="button" class="ui-button secondary" data-reader-action="${action}" ${disabled ? 'disabled' : ''}>${icon(glyph)}<span>${label}</span></button>`;
const tool = (action, glyph, label, disabled = false) => `<button type="button" class="ui-icon-button" data-reader-action="${action}" title="${label}" aria-label="${label}" ${disabled ? 'disabled' : ''}>${icon(glyph)}</button>`;
export class ReaderPanel {
  constructor(options) {
    Object.assign(this, options); this.snapshot = null; this.error = ''; this.message = '';
    this.range = null; this.page = 1; this.pageSize = 30; this.busy = false; this.attempted = false; this.epoch = 0;
  }
  html() { return `<section class="reader-page" data-reader-root aria-label="图文阅读">${this.content()}</section>`; }
  content() {
    const chat = this.chat(), snapshot = this.snapshot, settings = normalizeReaderSettings(this.settings());
    const messages = snapshot ? readingMessages(snapshot, settings) : [];
    const pages = Math.max(1, Math.ceil(messages.length / this.pageSize));
    this.page = Math.max(1, Math.min(pages, this.page));
    const start = this.range?.start ?? 1, end = this.range?.end ?? chat.count;
    return `<div class="page-heading"><div><h1>图文阅读</h1><p>${esc(snapshot?.title || chat.name)} · ${snapshot ? `${snapshot.messages.length} 条正文` : `${chat.count || 0} 条消息`}</p></div>
      <div class="heading-actions">${command('refresh', 'refresh-cw', '读取图文', this.busy || !chat.count)}</div></div>
      <div class="reader-toolbar">
        <div class="reader-range"><label>从第 <input type="number" min="1" max="${chat.count || 1}" data-reader-range="start" aria-label="起始楼层" value="${start}" ${this.busy ? 'disabled' : ''}></label>
          <label>至第 <input type="number" min="1" max="${chat.count || 1}" data-reader-range="end" aria-label="结束楼层" value="${end}" ${this.busy ? 'disabled' : ''}></label>
          ${tool('all', 'list', '选择全部楼层', this.busy)}</div>
        <div class="reader-export">${command('html', 'file-down', '导出 HTML', this.busy || !snapshot)}
          ${command('markdown', 'archive', 'Markdown ZIP', this.busy || !snapshot)}
          ${this.busy ? tool('cancel', 'x', '取消读取或导出') : ''}</div>
      </div>
      <details class="reader-settings"><summary>${icon('sliders-horizontal')}阅读设置</summary><div class="reader-settings-grid">
        ${[['fontSize', '字号', 14, 28, 1, 'px'], ['lineHeight', '行距', 1.4, 2.6, 0.1, ''], ['imageWidth', '图片宽度', 40, 100, 5, '%']].map(([key, label, min, max, step, unit]) =>
          `<label>${label}<input type="range" min="${min}" max="${max}" step="${step}" value="${settings[key]}" data-reader-setting="${key}" aria-label="阅读${label}"><output data-reader-output="${key}">${settings[key]}${unit}</output></label>`).join('')}
        <label class="reader-check"><input type="checkbox" data-reader-setting="showUser" ${settings.showUser ? 'checked' : ''}>显示用户消息</label></div>
      </details>
      <p class="reader-status" role="status" ${this.message ? '' : 'hidden'}>${esc(this.message)}</p>
      <p class="reader-error" role="alert" ${this.error ? '' : 'hidden'}>${esc(this.error)}</p>
      ${(snapshot?.warnings || []).map((warning) => `<p class="reader-warning">${esc(warning)}</p>`).join('')}
      ${snapshot ? `<div class="reader-pagination">${tool('previous', 'chevron-left', '上一页正文', this.page <= 1 || this.busy)}
        <span>第 ${this.page} / ${pages} 页 · 第 ${snapshot.start}–${snapshot.end} 条消息</span>${tool('next', 'chevron-right', '下一页正文', this.page >= pages || this.busy)}</div>
        <div class="reader-document" style="--reader-font:${settings.fontSize}px;--reader-leading:${settings.lineHeight};--reader-image:${settings.imageWidth}%">
        ${messages.slice((this.page - 1) * this.pageSize, this.page * this.pageSize).map((row) => `<article data-reader-message="${row.index}">
          <header><strong>${esc(row.name)}</strong><span>#${row.index + 1}</span></header>
          ${row.parts.map((part) => part.type === 'text' ? `<div class="reader-text">${esc(part.text)}</div>`
            : part.images.map((picture) => `<figure>
              ${picture.missing || !picture.preview ? `<div class="reader-missing">${icon('image-off')}<span>${esc(picture.missing ? picture.title : '缩略图不可用')}</span></div>`
                : `<button type="button" data-reader-image="${esc(picture.key)}" aria-label="查看配图原图"><img src="${esc(picture.preview)}" alt="${esc(picture.title)}" width="${picture.width}" height="${picture.height}" loading="lazy" decoding="async"></button>`}
              <figcaption>${esc(picture.title)}</figcaption></figure>`).join('')).join('')}
        </article>`).join('') || '<p class="reader-empty">当前范围暂无可显示正文</p>'}</div>`
      : `<div class="reader-empty">${icon('book-open')}<p>${this.busy ? '正在读取当前聊天…' : chat.count ? '尚未读取图文' : '请先打开聊天'}</p></div>`}`;
  }
  bind(host) {
    this.root = host.querySelector('[data-reader-root]');
    if (!this.root || this.root.dataset.bound) return;
    this.root.dataset.bound = 'true';
    this.root.addEventListener('input', (event) => {
      const field = event.target.dataset.readerRange;
      if (field) {
        this.range ||= { start: 1, end: this.chat().count };
        this.range[field] = Number(event.target.value); return;
      }
      const key = event.target.dataset.readerSetting;
      if (!key) return;
      const settings = normalizeReaderSettings({ ...this.settings(), [key]: key === 'showUser' ? event.target.checked : Number(event.target.value) });
      this.update(settings);
      if (key === 'showUser') { this.page = 1; this.render(); return; }
      const document = this.root.querySelector('.reader-document');
      document?.style.setProperty({ fontSize: '--reader-font', lineHeight: '--reader-leading', imageWidth: '--reader-image' }[key],
        `${settings[key]}${key === 'fontSize' ? 'px' : key === 'imageWidth' ? '%' : ''}`);
      this.root.querySelector(`[data-reader-output="${key}"]`).textContent = `${settings[key]}${key === 'fontSize' ? 'px' : key === 'imageWidth' ? '%' : ''}`;
    });
    this.root.addEventListener('click', (event) => {
      const action = event.target.closest('[data-reader-action]')?.dataset.readerAction;
      if (action) void this.click(action);
      const key = event.target.closest('[data-reader-image]')?.dataset.readerImage;
      if (key) void this.viewImage(key);
    });
    if (!this.attempted && !this.busy && this.chat().count) void this.refresh();
  }
  reset() {
    this.epoch++; this.controller?.abort(); this.closeImage();
    this.snapshot = null; this.range = null; this.error = ''; this.message = ''; this.page = 1; this.busy = false; this.attempted = false;
    this.render();
  }
  leave() { this.epoch++; this.controller?.abort(); this.busy = false; this.closeImage(); }
  expected() { return { chatKey: this.snapshot.chatKey, revision: this.snapshot.revision }; }
  async refresh() {
    if (this.busy) return;
    this.closeImage();
    const epoch = ++this.epoch; this.controller = new AbortController();
    this.busy = true; this.attempted = true; this.error = ''; this.message = ''; this.render();
    try {
      const snapshot = await this.request('reader-read', { range: this.range || undefined }, this.controller.signal);
      if (epoch !== this.epoch) return;
      this.snapshot = snapshot; this.range = { start: snapshot.start, end: snapshot.end }; this.page = 1;
      const missing = snapshot.messages.flatMap((row) => row.parts.flatMap((part) => part.images || [])).filter((row) => row.missing).length;
      this.message = missing ? `已读取 · ${missing} 处配图缺失或尚未生成` : '图文已读取';
    } catch (error) { if (epoch === this.epoch) this.error = error.message; }
    finally { if (epoch === this.epoch) { this.busy = false; this.render(); } }
  }
  async original(picture, signal) {
    const result = await this.request('reader-image', { ...this.expected(), key: picture.key }, signal);
    if (result.blob instanceof Blob) return result.blob;
    if (!/^\/(?:api\/plugins\/linghuashi-storage\/image\/|user\/images\/linghuashi\/)/.test(result.url || '')) throw new Error('原图地址无效');
    const response = await fetch(result.url, { credentials: 'same-origin', signal });
    if (!response.ok) throw new Error('原图缺失或暂时无法读取');
    return response.blob();
  }
  async click(action) {
    if (action === 'cancel') { this.controller?.abort(); return; }
    if (this.busy) return;
    if (action === 'all') { this.range = { start: 1, end: this.chat().count }; this.render(); return; }
    if (action === 'refresh') return this.refresh();
    if (action === 'next' || action === 'previous') { this.page += action === 'next' ? 1 : -1; this.render(); this.root?.scrollIntoView({ block: 'start' }); return; }
    if (!this.snapshot || !['html', 'markdown'].includes(action)) return;
    this.closeImage();
    const epoch = ++this.epoch; this.controller = new AbortController();
    const signal = this.controller.signal, snapshot = this.snapshot;
    this.busy = true; this.error = ''; this.message = '正在核对正文与配图版本…'; this.render();
    try {
      if (this.range.start !== snapshot.start || this.range.end !== snapshot.end) throw new Error('楼层范围已修改，请先点击读取图文');
      const result = await exportReading(snapshot, { format: action, settings: this.settings(), palette: this.palette(), signal,
        load: (picture) => this.original(picture, signal),
        validate: () => this.request('reader-validate', this.expected(), signal),
        progress: ({ completed, total }) => {
          this.message = `正在打包配图 ${completed} / ${total}`;
          const status = this.root?.querySelector('.reader-status');
          if (status) { status.hidden = false; status.textContent = this.message; }
        } });
      if (epoch !== this.epoch) return;
      await this.request('reader-validate', this.expected(), signal);
      signal.throwIfAborted(); this.save(result.blob, result.filename);
      this.message = result.missing.length ? `已导出 ${result.images} 张配图 · ${result.missing.length} 处缺失已标记` : `图文已导出 · ${result.images} 张配图`;
    } catch (error) { if (epoch === this.epoch) this.error = signal.aborted ? '图文导出已取消' : error.message; }
    finally { if (epoch === this.epoch) { this.busy = false; this.render(); } }
  }
  closeImage() {
    this.imageEpoch = (this.imageEpoch || 0) + 1; this.imageController?.abort();
    this.imageDialog?.remove(); this.imageDialog = null;
    if (this.imageURL) URL.revokeObjectURL(this.imageURL);
    this.imageURL = '';
  }
  async viewImage(key) {
    if (this.busy || !this.snapshot) return;
    const picture = this.snapshot.messages.flatMap((row) => row.parts.flatMap((part) => part.images || [])).find((row) => row.key === key);
    if (!picture || picture.missing) return;
    this.closeImage();
    this.imageController = new AbortController();
    const epoch = this.epoch, imageEpoch = this.imageEpoch, signal = this.imageController.signal;
    try {
      const blob = await this.original(picture, signal);
      if (epoch !== this.epoch || imageEpoch !== this.imageEpoch || signal.aborted) return;
      this.imageURL = URL.createObjectURL(blob);
      const dialog = document.createElement('dialog');
      dialog.className = 'reader-image-dialog'; dialog.setAttribute('aria-label', '聊天配图原图');
      dialog.innerHTML = `<header><span>${esc(picture.title)}</span>${tool('close-image', 'x', '关闭原图')}</header><img src="${this.imageURL}" alt="${esc(picture.title)}">`;
      dialog.addEventListener('click', (event) => { if (event.target === dialog || event.target.closest('[data-reader-action="close-image"]')) this.closeImage(); });
      dialog.addEventListener('cancel', () => this.closeImage());
      document.body.append(dialog); this.imageDialog = dialog; paintIcons(dialog); dialog.showModal();
    } catch (error) { if (!signal.aborted) { this.error = error.message; this.render(); } }
  }
  render() {
    if (!this.root?.isConnected) return;
    const open = this.root.querySelector('.reader-settings')?.open;
    this.root.innerHTML = this.content(); paintIcons(this.root);
    this.root.querySelector('.reader-settings').open = Boolean(open);
  }
}
