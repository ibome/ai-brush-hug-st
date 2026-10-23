import JSZip from 'jszip';
import { sha256Hex } from './crypto-compat.js';
import { comicRefKey, comicProjectFile, COMIC_LIMITS } from './comic.js';
import { validateComicSeriesFile, COMIC_CHAPTER_BUNDLE_BYTES } from './comic-chapters.js';
import { inspectComicAssets, checkComicImage } from './comic-assets.js';
import { readComicPackEntry, readComicProjectPack } from './comic-project-pack.js';

export const COMIC_SERIES_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_IMAGE = 20 * 1024 * 1024;
const MAX_MANIFEST = COMIC_CHAPTER_BUNDLE_BYTES + 1024 * 1024;
const MAX_IMAGES = COMIC_LIMITS.chapters * COMIC_LIMITS.panels;
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const validKey = (value) => typeof value === 'string' && /^(?:browser|server):[A-Za-z0-9_-]{1,100}$/.test(value);
const size = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

function seriesRefs(payload) {
  const refs = new Map(), labels = new Map();
  let panels = 0, references = 0, unpictured = 0;
  for (const project of payload.projects) for (const [index, panel] of project.panels.entries()) {
    panels++;
    const key = comicRefKey(panel.image);
    if (!key) { unpictured++; continue; }
    references++; refs.set(key, panel.image);
    if (!labels.has(key)) labels.set(key, { projectId: project.id, panelId: panel.id,
      label: `第 ${project.chapter} 章 · 第 ${index + 1} 格` });
  }
  return { refs, labels, panels, references, unpictured };
}
export async function inspectComicSeriesPack(payload, listImages, signal, checkImage = checkComicImage) {
  validateComicSeriesFile(payload);
  const summary = seriesRefs(payload), issues = [];
  const { rows, states } = await inspectComicAssets({ panels: payload.projects.flatMap((project) => project.panels) }, listImages, checkImage, signal);
  let imageBytes = 0, unknownSizes = 0;
  for (const [key, ref] of summary.refs) {
    const state = states.get(key), label = summary.labels.get(key), row = rows.get(key);
    if (state?.status !== 'available') {
      issues.push({ ...label, code: state?.status || 'unreachable', message: `${label.label}：${state?.detail || '原图无法读取'}` });
      continue;
    }
    const bytes = row?.blob instanceof Blob ? row.blob.size : Number(row?.bytes);
    if (!Number.isFinite(bytes) || bytes <= 0) unknownSizes++;
    else {
      imageBytes += bytes;
      if (bytes > MAX_IMAGE) issues.push({ ...label, code: 'size', message: `${label.label}：单张原图超过 20 MB` });
    }
  }
  if (imageBytes > COMIC_SERIES_IMAGE_BYTES) issues.push({ code: 'size', message: '原图预计超过 64 MB，请分章节备份' });
  return { chapters: payload.projects.length, panels: summary.panels, images: summary.refs.size,
    reused: summary.references - summary.refs.size, unpictured: summary.unpictured,
    estimatedBytes: imageBytes + size(payload), unknownSizes, issues, rows };
}
export async function comicSeriesPack(payload, blobs, signal, progress = () => {}) {
  validateComicSeriesFile(payload);
  const portable = { format: payload.format, version: payload.version, title: String(payload.title || '漫画系列').slice(0, 100),
    projects: payload.projects.map((project) => comicProjectFile(project).project) };
  for (const project of portable.projects) {
    for (const panel of project.panels) panel.versions = panel.image ? [panel.image] : [];
    for (const entry of project.characterScene?.entries || []) entry.profile.reference = null;
    project.referenceProfileId = '';
  }
  const zip = new JSZip(), images = [], files = new Map();
  let total = 0;
  for (const [key] of seriesRefs(portable).refs) {
    signal?.throwIfAborted();
    const blob = blobs.get(key), extension = extensions[blob?.type];
    if (!extension || !blob.size || blob.size > MAX_IMAGE) throw new Error('系列配图缺失、格式无效或超过 20 MB');
    const bytes = await blob.arrayBuffer(), hash = await sha256Hex(bytes), identity = `${hash}:${blob.type}`;
    let file = files.get(identity);
    if (!file) {
      total += blob.size;
      if (total > COMIC_SERIES_IMAGE_BYTES) throw new Error('系列原图超过 64 MB，请分章节备份');
      file = `images/${String(files.size + 1).padStart(4, '0')}.${extension}`;
      files.set(identity, file); zip.file(file, bytes);
    }
    images.push({ key, file, mime: blob.type, bytes: blob.size, sha256: hash });
    progress(`正在打包系列配图 ${images.length} / ${blobs.size}`);
  }
  const manifest = { format: 'linghuashi-comic-series-pack', version: 1, payload: portable, images };
  if (size(manifest) > MAX_MANIFEST) throw new Error('系列配置过大，请分章节备份');
  zip.file('series.json', JSON.stringify(manifest));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, () => signal?.throwIfAborted());
  signal?.throwIfAborted();
  return { blob, imageFiles: files.size, imageReferences: images.length };
}
export async function readComicArchive(file, signal) {
  signal?.throwIfAborted();
  if (!file.size || file.size > COMIC_SERIES_IMAGE_BYTES + MAX_MANIFEST + 1024 * 1024) throw new Error('漫画包超过容量限制，请分章节导入');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const manifest = zip.file('series.json');
  if (!manifest) return readComicProjectPack(file, signal);
  const entries = Object.values(zip.files);
  if (entries.length > MAX_IMAGES + 2 || entries.some((entry) => entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name)) {
    throw new Error('系列包文件列表无效');
  }
  const value = JSON.parse(new TextDecoder().decode(await readComicPackEntry(manifest, MAX_MANIFEST)));
  if (value.format !== 'linghuashi-comic-series-pack' || value.version !== 1 || !Array.isArray(value.images) || value.images.length > MAX_IMAGES) {
    throw new Error('不是受支持的漫画系列包');
  }
  validateComicSeriesFile(value.payload);
  const expected = seriesRefs(value.payload).refs, blobs = new Map(), files = new Map();
  let total = 0;
  for (const row of value.images) {
    signal?.throwIfAborted();
    if (!row || !validKey(row.key) || !expected.has(row.key) || blobs.has(row.key)
      || !/^images\/\d{4}\.(?:png|jpg|webp)$/.test(row.file) || !extensions[row.mime]
      || !row.file.endsWith(`.${extensions[row.mime]}`) || !/^[a-f0-9]{64}$/.test(row.sha256)
      || !Number.isInteger(row.bytes) || row.bytes <= 0 || row.bytes > MAX_IMAGE) throw new Error('系列包图片记录无效');
    let loaded = files.get(row.file);
    if (!loaded) {
      const entry = zip.file(row.file);
      if (!entry) throw new Error('系列包配图文件缺失');
      const bytes = await readComicPackEntry(entry, Math.min(MAX_IMAGE, COMIC_SERIES_IMAGE_BYTES - total));
      total += bytes.length;
      loaded = { hash: await sha256Hex(bytes), blob: new Blob([bytes], { type: row.mime }) };
      files.set(row.file, loaded);
    }
    if (loaded.blob.size !== row.bytes || loaded.hash !== row.sha256 || loaded.blob.type !== row.mime) throw new Error('系列配图校验失败，文件可能已损坏');
    blobs.set(row.key, loaded.blob);
  }
  if ([...expected.keys()].some((key) => !blobs.has(key))) throw new Error('系列包没有包含所引用的配图');
  if (entries.some((entry) => entry.dir ? entry.name !== 'images/' : entry.name !== 'series.json' && !files.has(entry.name))) throw new Error('系列包包含未登记文件');
  return { series: value.payload, blobs, imageFiles: files.size };
}
