import JSZip from 'jszip';
import { normalizeReaderSettings, READER_LIMITS } from './chat-reader.js';

export const escapeReading = (value) => String(value ?? '').replace(/[&<>"']/g,
  (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export const readingMessages = (snapshot, settings) => snapshot.messages.filter((row) => settings.showUser || row.role !== 'user');
export const readingFilename = (title) => String(title || '聊天图文').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 70) || '聊天图文';
const markdown = (value) => String(value || '').replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char])
  .replace(/[\\`*_{}[\]()#+.!|~-]/g, '\\$&').replace(/\r?\n/g, '  \n');
const imageRows = (messages) => messages.flatMap((row) => row.parts.flatMap((part) => part.images || []));
export function readingPalette(value = {}) {
  const fallback = { bg: '#fbfcff', text: '#2b374e', muted: '#5f6d85', border: '#d4deed', accent: '#2e5fe8' };
  return Object.fromEntries(Object.entries(fallback).map(([key, color]) => [key,
    /^(?:#[a-f0-9]{3,8}|rgba?\([\d.,% /]+\))$/i.test(value[key] || '') ? value[key] : color]));
}
export function readingHTML(snapshot, settings, assets, palette) {
  const options = normalizeReaderSettings(settings), colors = readingPalette(palette), esc = escapeReading;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${esc(snapshot.title)} · 灵画师图文</title><style>
*{box-sizing:border-box}html{background:${colors.bg};color:${colors.text};font-family:system-ui,"Microsoft YaHei",sans-serif;letter-spacing:0}
body{margin:0 auto;max-width:920px;padding:28px 20px}header{border-bottom:1px solid ${colors.border};padding-bottom:18px}
h1{font-size:24px;margin:0 0 10px;overflow-wrap:anywhere}header p,.byline,figcaption,.warning{font-size:13px;color:${colors.muted};overflow-wrap:anywhere}
article{padding:24px 0;border-bottom:1px solid ${colors.border};break-inside:auto}.byline{display:flex;gap:12px;margin-bottom:12px}
.byline strong{color:${colors.accent}}.body{font-size:${options.fontSize}px;line-height:${options.lineHeight};overflow-wrap:anywhere}
.text{white-space:pre-wrap}figure{width:${options.imageWidth}%;margin:22px auto;break-inside:avoid}img{display:block;width:100%;height:auto;max-height:1000px;object-fit:contain}
figcaption{text-align:center;margin-top:8px}.missing{border:1px dashed ${colors.border};padding:20px;text-align:center;font-size:14px;color:${colors.muted}}
footer{font-size:12px;color:${colors.muted};padding:24px 0}@media(max-width:480px){body{padding:20px 14px}h1{font-size:20px}}@media print{html{background:white;color:black}body{max-width:none;padding:0}article{border-color:#ddd}}
</style></head><body><header><h1>${esc(snapshot.title)}</h1><p>第 ${snapshot.start}–${snapshot.end} 条消息 · ${readingMessages(snapshot, options).length} 条正文</p>
${(snapshot.warnings || []).map((warning) => `<p class="warning">${esc(warning)}</p>`).join('')}</header>
${readingMessages(snapshot, options).map((row) => `<article><div class="byline"><strong>${esc(row.name)}</strong><span>#${row.index + 1}</span></div><div class="body">${row.parts.map((part) =>
    part.type === 'text' ? `<div class="text">${esc(part.text)}</div>` : part.images.map((picture) => {
      const asset = assets.get(picture.key);
      return `<figure>${asset?.data ? `<img src="${asset.data}" alt="${esc(picture.title)}" width="${picture.width}" height="${picture.height}">`
        : `<div class="missing">${esc(picture.missing ? picture.title : '原图缺失或暂时无法读取')}</div>`}<figcaption>${esc(picture.title)}</figcaption></figure>`;
    }).join('')).join('')}</div></article>`).join('')}
<footer>由灵画师导出 · 当前回复分支</footer></body></html>`;
}
async function raster(blob) {
  if (!(blob instanceof Blob) || !blob.size || blob.size > 20 * 1024 * 1024) throw new Error('原图无效或超过 20 MB');
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  return [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) ? ['png', 'image/png']
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? ['jpg', 'image/jpeg']
      : String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP' ? ['webp', 'image/webp']
        : Promise.reject(new Error('原图不是 PNG、JPG 或 WebP 图片'));
}
async function dataURL(blob, mime) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let value = '';
  for (let offset = 0; offset < bytes.length; offset += 16384) value += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  return `data:${mime};base64,${btoa(value)}`;
}
export async function exportReading(snapshot, { format, settings, palette, load, validate, signal, progress = () => {} }) {
  if (!['html', 'markdown'].includes(format)) throw new Error('不支持的图文导出格式');
  const options = normalizeReaderSettings(settings), messages = readingMessages(snapshot, options);
  if (!messages.length) throw new Error('当前范围没有可导出的正文');
  signal?.throwIfAborted(); await validate();
  const pictures = [...new Map(imageRows(messages).map((picture) => [picture.key, picture])).values()];
  const assets = new Map(), missing = [], zip = format === 'markdown' ? new JSZip() : null;
  let bytes = new TextEncoder().encode(messages.map((row) => row.parts.filter((part) => part.type === 'text').map((part) => part.text).join('')).join('')).length;
  if (pictures.reduce((sum, row) => sum + (row.bytes || 0), bytes) > READER_LIMITS.exportBytes) throw new Error('所选原图与正文超过 64 MB，请缩小楼层范围后导出');
  for (const [index, picture] of pictures.entries()) {
    signal?.throwIfAborted(); progress({ completed: index, total: pictures.length });
    if (!picture.missing) {
      try {
        const blob = await load(picture, signal), [extension, mime] = await raster(blob);
        bytes += blob.size;
        if (bytes > READER_LIMITS.exportBytes) throw Object.assign(new Error('导出内容超过 64 MB，请缩小楼层范围'), { readerLimit: true });
        const filename = `images/${String(index + 1).padStart(3, '0')}.${extension}`;
        if (zip) { zip.file(filename, await blob.arrayBuffer()); assets.set(picture.key, { filename }); }
        else assets.set(picture.key, { data: await dataURL(blob, mime) });
      } catch (error) {
        signal?.throwIfAborted();
        if (error.readerLimit || error.name === 'AbortError') throw error;
      }
    }
    if (!assets.has(picture.key)) missing.push({ title: picture.title, message: picture.index === undefined ? null : picture.index + 1 });
  }
  signal?.throwIfAborted(); await validate(); signal?.throwIfAborted();
  let blob;
  if (zip) {
    const lines = [`# ${markdown(snapshot.title)}`, '', `第 ${snapshot.start}–${snapshot.end} 条消息`, ''];
    for (const row of messages) {
      lines.push(`## ${markdown(row.name)} · #${row.index + 1}`, '');
      for (const part of row.parts) {
        if (part.type === 'text') lines.push(markdown(part.text), '');
        else for (const picture of part.images) {
          const asset = assets.get(picture.key);
          lines.push(asset ? `![${markdown(picture.title)}](${asset.filename})`
            : `> 配图缺失：${markdown(picture.title)}`, '');
        }
      }
    }
    zip.file('阅读.md', lines.join('\n'));
    zip.file('图文清单.json', JSON.stringify({ format: 'linghuashi-reading', version: 1, title: snapshot.title,
      start: snapshot.start, end: snapshot.end, messages: messages.length, images: assets.size, missing, warnings: snapshot.warnings || [] }, null, 2));
    blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  } else blob = new Blob([readingHTML(snapshot, options, assets, palette)], { type: 'text/html;charset=utf-8' });
  signal?.throwIfAborted();
  progress({ completed: pictures.length, total: pictures.length });
  return { blob, missing, images: assets.size, filename: `${readingFilename(snapshot.title)}-图文.${zip ? 'zip' : 'html'}` };
}
