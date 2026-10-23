import JSZip from 'jszip';
import { comicProjectFile, importComicProject, comicRefKey, COMIC_LIMITS } from './comic.js';

const MAX_BYTES = 64 * 1024 * 1024;
const mimeExtensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export async function comicProjectPack(project, blobs, signal) {
  const payload = comicProjectFile(project), zip = new JSZip(), images = [];
  let total = 0;
  for (const panel of payload.project.panels) {
    const key = comicRefKey(panel.image);
    if (!key) continue;
    panel.versions = [panel.image];
    if (images.some((row) => row.key === key)) continue;
    const blob = blobs.get(key), extension = mimeExtensions[blob?.type];
    if (!extension || !blob.size || blob.size > 20 * 1024 * 1024) throw new Error('项目配图缺失、格式无效或超过 20 MB');
    total += blob.size;
    if (total > MAX_BYTES) throw new Error('项目配图超过 64 MB，请拆分项目');
    signal?.throwIfAborted();
    const file = `images/${String(images.length + 1).padStart(3, '0')}.${extension}`;
    images.push({ key, file, mime: blob.type });
    zip.file(file, await blob.arrayBuffer());
  }
  for (const entry of payload.project.characterScene?.entries || []) entry.profile.reference = null;
  zip.file('project.json', JSON.stringify({ format: 'linghuashi-comic-pack', version: 1, payload, images }));
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

function readEntry(entry, limit) {
  return new Promise((resolve, reject) => {
    let total = 0, failed = false;
    const chunks = [], stream = entry.internalStream('uint8array');
    stream.on('data', (bytes) => {
      if (failed) return;
      total += bytes.length;
      if (total > limit) { failed = true; stream.pause(); reject(new Error('漫画包解压内容超过限制')); return; }
      chunks.push(bytes);
    }).on('error', reject).on('end', () => {
      if (failed) return;
      const result = new Uint8Array(total);
      let offset = 0;
      for (const bytes of chunks) { result.set(bytes, offset); offset += bytes.length; }
      resolve(result);
    });
    stream.resume();
  });
}
export { readEntry as readComicPackEntry };

export async function readComicProjectPack(file, signal) {
  if (!file.size || file.size > MAX_BYTES + COMIC_LIMITS.bytes) throw new Error('漫画包超过 64 MB');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(zip.files);
  if (entries.length > 32 || entries.some((row) => row.unsafeOriginalName && row.unsafeOriginalName !== row.name)) throw new Error('漫画包文件列表无效');
  const manifest = zip.file('project.json');
  if (!manifest) throw new Error('缺少漫画项目配置');
  const value = JSON.parse(new TextDecoder().decode(await readEntry(manifest, COMIC_LIMITS.bytes + 20000)));
  if (value.format !== 'linghuashi-comic-pack' || value.version !== 1 || !Array.isArray(value.images)
    || value.images.length > COMIC_LIMITS.panels) throw new Error('不是受支持的漫画项目包');
  const project = importComicProject(value.payload), blobs = new Map(), names = new Set();
  let total = 0;
  for (const row of value.images) {
    signal?.throwIfAborted();
    if (!row || typeof row.key !== 'string' || blobs.has(row.key) || names.has(row.file)
      || !/^images\/\d{3}\.(?:png|jpg|webp)$/.test(row.file) || !mimeExtensions[row.mime]) throw new Error('漫画包图片记录无效');
    const entry = zip.file(row.file);
    if (!entry) throw new Error('漫画包配图文件缺失');
    const bytes = await readEntry(entry, Math.min(20 * 1024 * 1024, MAX_BYTES - total));
    total += bytes.length;
    names.add(row.file); blobs.set(row.key, new Blob([bytes], { type: row.mime }));
  }
  if (project.panels.some((panel) => panel.image && !blobs.has(comicRefKey(panel.image)))) throw new Error('漫画包没有包含所引用的配图');
  return { project, blobs };
}
