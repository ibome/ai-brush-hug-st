import { randomUUID } from '../crypto-compat.js';
import { changedVersionRows } from '../drawing-write-set.js';
import JSZip from 'jszip';
import { escapeHtml as esc } from '../config.js';
import { icon } from '../icons.js';
import { NOVELAI_DEFAULTS, NOVELAI_MODELS, normalizeNovelAI } from './novelai.js';
import { newComfyConfig, normalizeComfyState, parseWorkflow } from './comfyui.js';
import { OPENAI_DEFAULTS, normalizeOpenAI, openAISize, isOpenAINovelAI, usesGPTImage } from './openai.js';
import { currentAccount, currentChat, storageKey, storageRequest } from '../runtime.js';
import { normalizeCharacterScene, resolveCharacterScene } from '../character-profiles.js';
import { ServerDrawingLibrary } from '../server-storage.js';
import { cleanupPlan } from '../retention.js';
import { validBinding } from '../chat.js';
import { normalizeVersion, insertVersion, selectVersion, removeVersions, drawingGroups } from '../../server/linghuashi-storage/image-versions.mjs';
import { normalizeBackupChats } from '../../server/linghuashi-storage/backup-records.mjs';
import { REVIEW_LABELS } from '../prompt-workbench.js';
import { prepareExportImage, exportFilename } from '../image-export.js';
import { scrubBackup } from '../backup-config.js';
import { normalizeProcessing, processingTitle } from '../novelai-processing.js';
import { extensionMetadata } from '../extension-api.js';
import { SDWEBUI_DEFAULTS, normalizeSDWebUI } from '../sdwebui.js';

const DB_NAME = storageKey('linghuashi-drawings-v1');
const MAX_IMAGE = 20 * 1024 * 1024;
const MAX_ARCHIVE = 200 * 1024 * 1024;
const MAX_RECORDS = 500;
const SOURCE_TITLES = { novelai: 'NovelAI', comfyui: 'ComfyUI', openai: 'OpenAI兼容', sdwebui: 'SDWebUI', unknown: '未识别' };
const clone = (value) => JSON.parse(JSON.stringify(value));
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const providerTitle = (value) => SOURCE_TITLES[value] || SOURCE_TITLES.unknown;
const imageExtension = (type) => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' })[type] || 'png';
const requestResult = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const transactionDone = (transaction) => new Promise((resolve, reject) => {
  transaction.oncomplete = resolve;
  transaction.onabort = () => reject(transaction.error || new Error('图片存储事务未完成'));
  transaction.onerror = () => {};
});

export function normalizeSnapshot(value) {
  if (!record(value)) return null;
  const characters = value.characterScene ? { characterScene: normalizeCharacterScene(value.characterScene) } : {};
  const external = extensionMetadata(value.extensionRequest);
  if (external) characters.extensionRequest = external;
  const processing = value.provider === 'novelai' ? normalizeProcessing(value.novelaiProcessing) : null;
  if (processing) characters.novelaiProcessing = processing;
  if (value.experiment && /^[a-f0-9-]{36}$/.test(value.experiment.id)) characters.experiment = {
    id: value.experiment.id, mode: value.experiment.mode === 'explore' ? 'explore' : 'batch',
    label: String(value.experiment.label || '').slice(0, 240),
    index: Math.max(0, Math.min(31, Number(value.experiment.index) || 0)),
    createdAt: Number(value.experiment.createdAt) || 0,
  };
  if (value.provider === 'openai' && record(value.params)) {
    const normalized = normalizeOpenAI(value.params);
    const keys = Object.keys(OPENAI_DEFAULTS).filter((key) => Object.hasOwn(value.params, key));
    if (!keys.includes('negative') && typeof value.params.extra === 'string' && normalized.extra !== value.params.extra) keys.push('negative');
    if (!keys.length) return null;
    return { provider: 'openai', partial: value.partial === true, ...characters,
      params: value.partial === true ? Object.fromEntries(keys.map((key) => [key, normalized[key]])) : normalized };
  }
  if (value.provider === 'novelai' && record(value.params)) {
    const normalized = normalizeNovelAI(value.params);
    const keys = Object.keys(NOVELAI_DEFAULTS).filter((key) => Object.hasOwn(value.params, key));
    if (!keys.length) return null;
    return { provider: 'novelai', partial: value.partial === true, ...characters, params: value.partial === true ? Object.fromEntries(keys.map((key) => [key, normalized[key]])) : normalized };
  }
  if (value.provider === 'sdwebui' && record(value.params)) {
    const normalized = normalizeSDWebUI(value.params);
    const keys = [...Object.keys(SDWEBUI_DEFAULTS), 'advanced'].filter((key) => Object.hasOwn(value.params, key));
    if (!keys.length) return null;
    return { provider: 'sdwebui', partial: value.partial === true, ...characters,
      params: value.partial === true ? Object.fromEntries(keys.map((key) => [key, normalized[key]])) : normalized };
  }
  if (value.provider === 'comfyui' && record(value.config)) {
    const graph = parseWorkflow(JSON.stringify(value.config.graph));
    const state = { comfyui: { ...value.config, graph } };
    normalizeComfyState(state);
    return { provider: 'comfyui', config: state.comfyui, ...characters };
  }
  return null;
}

export function captureSnapshot(state) {
  const chat = currentChat();
  const characterScene = state.characterSceneOverride ? clone(state.characterSceneOverride) : resolveCharacterScene(state.characterProfiles, chat.key, chat.avatars);
  if (state.characterSceneOverrideProvider && state.characterSceneOverrideProvider !== state.provider && characterScene) delete characterScene.applied;
  if (state.provider === 'openai') return normalizeSnapshot({ provider: 'openai', params: state.openai, characterScene });
  if (state.provider === 'sdwebui') return normalizeSnapshot({ provider: 'sdwebui', params: state.sdwebui, characterScene });
  return normalizeSnapshot(state.provider === 'comfyui'
    ? { provider: 'comfyui', config: clone(state.comfyui), characterScene }
    : { provider: 'novelai', params: state.novelai, characterScene });
}

export function restoreSnapshot(state, snapshot) {
  const value = normalizeSnapshot(snapshot);
  if (!value) throw new Error('这张图片没有可导入的生图参数');
  if (value.provider === 'novelai') state.novelai = normalizeNovelAI(value.partial ? { ...state.novelai, ...value.params } : value.params);
  else if (value.provider === 'openai') state.openai = normalizeOpenAI(value.partial ? { ...state.openai, ...value.params } : value.params);
  else if (value.provider === 'sdwebui') state.sdwebui = normalizeSDWebUI(value.partial ? { ...state.sdwebui, ...value.params } : value.params);
  else state.comfyui = clone(value.config);
  state.provider = value.provider;
  state.characterSceneOverride = value.characterScene?.entries?.length ? clone(value.characterScene) : null;
  state.characterSceneOverrideProvider = state.characterSceneOverride ? value.provider : '';
  return value.partial ? `已覆盖图片中记录的 ${providerTitle(value.provider)} 参数，未记录的项已保留` : `已覆盖当前 ${providerTitle(value.provider)} 参数`;
}

export function dateKey(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function filterDrawings(items, filters, grouped = true) {
  const search = (filters.search || '').trim().toLocaleLowerCase();
  return (grouped ? drawingGroups(items) : items).filter((item) => {
    const date = dateKey(item.createdAt);
    return (filters.source === 'all' || item.source === filters.source)
      && (!filters.start || date >= filters.start) && (!filters.end || date <= filters.end)
      && (!filters.favoriteOnly || item.favorite || item.groupFavorite)
      && (!filters.chatKey || item.chatBinding?.chatKey === filters.chatKey)
      && (!filters.rating || (item.rating || 'unrated') === filters.rating)
      && (!search || `${item.title} ${item.snapshot?.params?.positive || item.snapshot?.config?.params?.positive || ''}`.toLocaleLowerCase().includes(search));
  }).sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id));
}

export function drawingPage(items, page, size = 24) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.max(1, Math.min(pages, Math.round(page) || 1));
  return { page: current, pages, items: items.slice((current - 1) * size, current * size) };
}

export function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1048576) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1048576).toFixed(1)} MB`;
}

function mimeFromBytes(bytes) {
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  throw new Error('仅支持 PNG、JPG 和 WebP 图片');
}

async function imagePreview(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width * bitmap.height > 40000000) throw new Error('图片超过 4000 万像素，请缩小后导入');
    const canvas = document.createElement('canvas');
    const ratio = Math.min(1, 360 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const thumbnail = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.8));
    return { width: bitmap.width, height: bitmap.height, thumbnail: thumbnail || blob };
  } finally { bitmap.close(); }
}

async function inflateText(bytes) {
  if (typeof DecompressionStream !== 'function') return '';
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > 1024 * 1024) { await reader.cancel(); return ''; }
      chunks.push(result.value);
    }
    return new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
  } catch { await reader.cancel().catch(() => {}); return ''; }
}

async function pngText(bytes) {
  const text = {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let total = 0;
  let entries = 0;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset);
    if (offset + 12 + length > bytes.length) break;
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (['tEXt', 'iTXt', 'zTXt'].includes(type) && length < 1024 * 1024 && total < 2 * 1024 * 1024 && entries < 50) {
      entries++;
      total += length;
      const data = bytes.subarray(offset + 8, offset + 8 + length);
      const separator = data.indexOf(0);
      if (separator > 0) {
        const key = new TextDecoder('latin1').decode(data.subarray(0, separator));
        let value = '';
        if (type === 'tEXt') value = new TextDecoder().decode(data.subarray(separator + 1));
        else if (type === 'zTXt' && data[separator + 1] === 0) value = await inflateText(data.subarray(separator + 2));
        else if (type === 'iTXt') {
          const languageEnd = data.indexOf(0, separator + 3);
          const translatedEnd = data.indexOf(0, languageEnd + 1);
          if (languageEnd >= 0 && translatedEnd >= 0) value = data[separator + 1] === 1
            ? await inflateText(data.subarray(translatedEnd + 1)) : new TextDecoder().decode(data.subarray(translatedEnd + 1));
        }
        if (['prompt', 'Software', 'Comment', 'Description', 'Source', 'linghuashi'].includes(key)) text[key] = value;
      }
    }
    offset += length + 12;
  }
  return text;
}

async function snapshotFromPNG(bytes) {
  const text = await pngText(bytes);
  try {
    if (text.linghuashi) return { snapshot: normalizeSnapshot(JSON.parse(text.linghuashi)), warning: '' };
    if (text.prompt) return { snapshot: { provider: 'comfyui', config: newComfyConfig(parseWorkflow(text.prompt), 'PNG 工作流') }, warning: '' };
    if (/novelai/i.test(text.Software || '') && text.Comment) {
      const metadata = JSON.parse(text.Comment);
      const aliases = { prompt: 'positive', uc: 'negative', width: 'width', height: 'height', steps: 'steps', scale: 'scale', seed: 'seed', sampler: 'sampler', noise_schedule: 'noiseSchedule', cfg_rescale: 'cfgRescale', n_samples: 'nSamples', sm: 'sm', sm_dyn: 'smDyn', qualityToggle: 'qualityTags' };
      const params = {};
      for (const [source, target] of Object.entries(aliases)) if (Object.hasOwn(metadata, source)) params[target] = metadata[source];
      if (!params.positive && text.Description) params.positive = text.Description;
      if (NOVELAI_MODELS.some((model) => model.id === metadata.model)) params.model = metadata.model;
      if (Object.hasOwn(params, 'seed') && !Number.isSafeInteger(params.seed)) throw new Error('种子超出可精确读取范围');
      return { snapshot: normalizeSnapshot({ provider: 'novelai', partial: true, params }), warning: '' };
    }
  } catch (error) {
    return { snapshot: null, warning: `图片已导入，参数未读取：${error.message}` };
  }
  return { snapshot: null, warning: '' };
}

export async function makeDrawing(blob, values = {}) {
  if (!blob.size || blob.size > MAX_IMAGE) throw new Error('单张图片需在 20 MB 以内');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mime = mimeFromBytes(bytes);
  const image = blob.type === mime ? blob : new Blob([blob], { type: mime });
  const preview = await imagePreview(image);
  const metadata = values.snapshot === undefined && mime === 'image/png' ? await snapshotFromPNG(bytes) : { snapshot: normalizeSnapshot(values.snapshot), warning: '' };
  if (values.snapshot && mime === 'image/png' && metadata.snapshot?.provider === 'novelai') {
    const embedded = await snapshotFromPNG(bytes);
    const seed = embedded.snapshot?.params?.seed;
    if (Number.isSafeInteger(seed) && seed >= 0) metadata.snapshot.params.seed = seed;
  }
  const createdAt = Number(values.createdAt);
  const id = typeof values.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(values.id) ? values.id : randomUUID();
  return {
    id,
    title: (typeof values.title === 'string' ? values.title.trim() : '未命名图片').slice(0, 100) || '未命名图片',
    createdAt: Number.isFinite(createdAt) && createdAt > 0 && Number.isFinite(new Date(createdAt).getTime()) ? createdAt : Date.now(),
    source: metadata.snapshot?.provider || 'unknown', snapshot: metadata.snapshot,
    favorite: values.favorite === true, demo: values.demo === true,
    batchId: typeof values.batchId === 'string' ? values.batchId.slice(0, 80) : '',
    chatBinding: validBinding(values.chatBinding) ? clone(values.chatBinding) : null,
    version: normalizeVersion(values.version, id), versionCurrent: values.versionCurrent !== false,
    blob: image, ...preview, warning: metadata.warning,
  };
}

export class DrawingLibrary {
  constructor({ mode = () => 'browser' } = {}) {
    this.mode = mode;
    this.server = new ServerDrawingLibrary(storageRequest, currentAccount());
  }

  async open() {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('drawings', { keyPath: 'id' });
      request.result.createObjectStore('meta', { keyPath: 'key' });
    };
    this.db = await requestResult(request);
    this.db.onversionchange = () => this.db.close();
  }

  async list(mode = this.mode(), refresh = false) {
    if (mode === 'server') return this.server.list(refresh);
    const transaction = this.db.transaction('drawings', 'readonly');
    return requestResult(transaction.objectStore('drawings').getAll());
  }

  async seed(rows) {
    const read = this.db.transaction('meta', 'readonly');
    const seeded = await requestResult(read.objectStore('meta').get('seeded'));
    if (seeded) return;
    const transaction = this.db.transaction(['drawings', 'meta'], 'readwrite');
    const done = transactionDone(transaction);
    const meta = transaction.objectStore('meta');
    const gate = meta.get('seeded');
    gate.onsuccess = () => {
      if (!gate.result) {
        rows.forEach((item) => transaction.objectStore('drawings').put(item));
        meta.put({ key: 'seeded', value: true });
      }
    };
    await done;
  }

  async hasSeed() {
    return Boolean(await requestResult(this.db.transaction('meta', 'readonly').objectStore('meta').get('seeded')));
  }

  async add(rows, mode = this.mode(), options = {}) {
    if (mode === 'server') return this.server.add(rows, options);
    const transaction = this.db.transaction('drawings', 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore('drawings');
    const read = store.getAll();
    let exceeded = false, failure;
    read.onsuccess = () => {
      let next = read.result;
      const added = rows.filter((row) => !next.some((item) => item.id === row.id));
      if (next.length + added.length > MAX_RECORDS) { exceeded = true; transaction.abort(); return; }
      try {
        for (const row of added) next = insertVersion(next, row);
        changedVersionRows(read.result, next).forEach((row) => store.put(row));
      } catch (error) { failure = error; transaction.abort(); }
    };
    await done.catch((error) => {
      if (exceeded) throw new Error('最多保存 500 张图片，请先导出并清理一些图片');
      throw failure || error;
    });
  }

  async remove(ids, allowReferenced = false) {
    if (this.mode() === 'server') return this.server.remove(ids, allowReferenced);
    const transaction = this.db.transaction('drawings', 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore('drawings');
    const request = store.getAll();
    let failure;
    request.onsuccess = () => {
      try {
        ids.forEach((id) => store.delete(id));
        changedVersionRows(request.result, removeVersions(request.result, ids)).forEach((row) => store.put(row));
      } catch (error) { failure = error; transaction.abort(); }
    };
    await done.catch((error) => { throw failure || error; });
  }

  async setFavorite(id, favorite, mode = this.mode()) {
    if (mode === 'server') return this.server.setFavorite(id, favorite);
    const transaction = this.db.transaction('drawings', 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore('drawings');
    const request = store.get(id);
    request.onsuccess = () => { if (request.result) store.put({ ...request.result, favorite }); };
    await done;
  }

  async selectVersion(id) {
    if (this.mode() === 'server') return this.server.selectVersion(id);
    const transaction = this.db.transaction('drawings', 'readwrite'), done = transactionDone(transaction);
    const store = transaction.objectStore('drawings'), read = store.getAll();
    let failure;
    read.onsuccess = () => {
      try { changedVersionRows(read.result, selectVersion(read.result, id)).forEach((row) => store.put(row)); }
      catch (error) { failure = error; transaction.abort(); }
    };
    await done.catch((error) => { throw failure || error; });
  }

  async cleanup(settings, lastCleanup) {
    if (this.mode() === 'server') return this.server.cleanup();
    const transaction = this.db.transaction('drawings', 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore('drawings');
    const request = store.getAll();
    let plan = { ids: [], due: false }, failure;
    request.onsuccess = () => {
      try {
        plan = cleanupPlan(request.result, settings, lastCleanup);
        if (!plan.ids.length) return;
        for (const id of plan.ids) store.delete(id);
        changedVersionRows(request.result, removeVersions(request.result, plan.ids)).forEach((row) => store.put(row));
      } catch (error) { failure = error; transaction.abort(); }
    };
    await done.catch((error) => { throw failure || error; });
    return plan;
  }

  async materialize(item, signal) { return this.server.materialize(item, signal); }
  async syncPolicy(settings) { return this.server.policy(settings); }
  async backupChats(mode = this.mode()) {
    if (mode === 'server') return (await this.server.request('backup/chats')).rows;
    const values = await requestResult(this.db.transaction('meta').objectStore('meta').getAll());
    return values.filter((row) => row.key?.startsWith('chat-slot:')).map(({ key, ...row }) => row);
  }
  async restoreChats(values, mode = this.mode()) {
    if (mode === 'server') return this.server.request('backup/chats-merge', { rows: values });
    const rows = normalizeBackupChats(values, new Set((await this.list('browser')).map((row) => row.id)));
    const transaction = this.db.transaction('meta', 'readwrite'), done = transactionDone(transaction), store = transaction.objectStore('meta');
    for (const row of rows) {
      const key = `chat-slot:${row.binding.id}`, read = store.get(key);
      read.onsuccess = () => { if (!read.result) store.put({ ...row, key }); };
    }
    await done;
  }
}

export function hydrateDrawings(rows, previous = []) {
  const old = new Map(previous.map((row) => [row.id, row]));
  return rows.map((item) => {
    const existing = old.get(item.id);
    const same = existing && existing.storageLocation === item.storageLocation && existing.createdAt === item.createdAt
      && existing.blob.size === item.blob.size && existing.thumbnail.size === item.thumbnail.size
      && existing.blob.type === item.blob.type;
    return { ...item, src: item.srcURL || (same && existing.src) || URL.createObjectURL(item.blob),
      thumbSrc: item.thumbnailURL || (same && existing.thumbSrc) || URL.createObjectURL(item.thumbnail),
      size: `${item.width} × ${item.height}`, time: new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false }) };
  });
}

export function revokeDrawings(rows, retained = []) {
  const used = new Set(retained.flatMap((row) => [row.src, row.thumbSrc]));
  rows.forEach((item) => {
    if (item.src?.startsWith('blob:') && !used.has(item.src)) URL.revokeObjectURL(item.src);
    if (item.thumbSrc?.startsWith('blob:') && !used.has(item.thumbSrc)) URL.revokeObjectURL(item.thumbSrc);
  });
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function drawingFilename(item, index = 0) {
  const title = item.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 70);
  return `${String(index + 1).padStart(3, '0')}-${title}.${imageExtension(item.blob.type)}`;
}

export async function exportDrawings(items, withParameters = true, options = {}) {
  if (!items.length) throw new Error('没有可导出的图片');
  const zip = new JSZip();
  const manifest = { format: 'linghuashi-drawings', version: 1, exportedAt: new Date().toISOString(), images: [] };
  let total = 0;
  for (const [index, item] of items.entries()) {
    const image = await prepareExportImage(item.blob, options.metadata || 'keep', scrubBackup(item.snapshot, { refs: true, sharing: true }));
    total += image.size;
    if (total > MAX_ARCHIVE) throw new Error('单个导出包超过 200 MB，请分批多选导出');
    const file = `images/${exportFilename(item, index, options.naming)}`;
    zip.file(file, await image.arrayBuffer());
    if (withParameters) manifest.images.push({ file, id: item.id, title: item.title, createdAt: item.createdAt, source: item.source, favorite: item.favorite, demo: item.demo, snapshot: item.snapshot, batchId: item.batchId, chatBinding: item.chatBinding, version: item.version, versionCurrent: item.versionCurrent, rating: item.rating || 'unrated' });
  }
  if (withParameters) zip.file('linghuashi.json', JSON.stringify(manifest, null, 2));
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

export async function importArchive(file) {
  if (file.size > MAX_ARCHIVE) throw new Error('导入包需小于 200 MB');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const manifestFile = zip.file('linghuashi.json');
  if (!manifestFile) throw new Error('需要包含 linghuashi.json 的灵画师导出包');
  if (manifestFile._data?.uncompressedSize > 4 * 1024 * 1024) throw new Error('参数清单过大');
  const manifest = JSON.parse(await manifestFile.async('string'));
  if (manifest.format !== 'linghuashi-drawings' || manifest.version !== 1 || !Array.isArray(manifest.images) || manifest.images.length > MAX_RECORDS) throw new Error('导出包格式或版本不受支持');
  const rows = [];
  let total = 0;
  for (const item of manifest.images) {
    if (!record(item) || typeof item.file !== 'string' || !/^images\/[^/\\]+$/.test(item.file)) throw new Error('导出包中的图片路径不正确');
    const entry = zip.file(item.file);
    if (!entry || entry._data?.uncompressedSize > MAX_IMAGE) throw new Error('导出包图片缺失或超过 20 MB');
    total += entry._data?.uncompressedSize || 0;
    if (total > MAX_ARCHIVE) throw new Error('解压后的图片总量超过 200 MB');
    const blob = await entry.async('blob');
    const row = await makeDrawing(blob, item);
    if (REVIEW_LABELS.some(([value]) => value === item.rating)) row.rating = item.rating;
    rows.push(row);
  }
  return rows;
}

const command = (name, title, action, attrs = '', className = '') => `<button type="button" class="ui-button secondary ${className}" data-action="${action}" ${attrs}>${icon(name)}<span>${title}</span></button>`;
const iconCommand = (name, title, action, attrs = '') => `<button type="button" class="ui-icon-button" title="${title}" aria-label="${title}" data-action="${action}" ${attrs}>${icon(name)}</button>`;
const options = (items, selected) => items.map(([value, title]) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(title)}</option>`).join('');
const field = (title, body, className = '') => `<label class="ui-field ${className}"><span>${title}</span>${body}</label>`;

export function renderDrawingManager(items, ui) {
  const filtered = filterDrawings(items, ui.filters);
  const page = drawingPage(filtered, ui.page, ui.pageSize);
  const selected = ui.selection.size;
  const busy = ui.busy || ui.loading;
  const totalBytes = items.reduce((sum, item) => sum + item.blob.size + item.thumbnail.size, 0);
  const chats = [...new Map(items.filter((item) => item.chatBinding).map((item) => {
    const bound = item.chatBinding;
    let fallback = bound.chatKey;
    try { const parts = JSON.parse(bound.chatKey); fallback = `${parts[1]} · ${parts[2]}`; } catch {}
    return [bound.chatKey, [bound.chatKey, bound.characterName ? `${bound.characterName} · ${bound.chatName || '聊天配图'}` : fallback]];
  })).values()];
  return `<section class="drawing-manager">
    <div class="page-heading"><div><h1>绘图管理</h1><p>${items.length} 张图片 · ${items.filter((item) => item.favorite).length} 张收藏 · ${ui.storageLocation === 'server' ? '酒馆服务器' : '浏览器'} ${formatBytes(totalBytes)}</p></div>${command('upload', '导入', 'drawing-import', busy ? 'disabled' : '')}</div>
    ${ui.index ? `<div class="cache-footer"><span data-gallery-index-status role="status">${esc(galleryIndexStatus(ui.index))}</span>
      ${command('database', '重新核对图库参数', 'drawing-reindex', busy ? 'disabled' : '')}</div>` : ''}
    <form class="drawing-filters" data-drawing-filters>
      ${field('来源模式', `<select name="source">${options([['all', '全部来源'], ['novelai', 'NovelAI'], ['comfyui', 'ComfyUI'], ['openai', 'OpenAI兼容'], ['sdwebui', 'SDWebUI'], ['unknown', '未识别来源']], ui.filters.source)}</select>`)}
      <div class="drawing-date-range">${field('开始日期', `<input type="date" name="start" value="${esc(ui.filters.start)}" />`)}${field('结束日期', `<input type="date" name="end" value="${esc(ui.filters.end)}" />`)}</div>
      <div class="drawing-filter-actions"><button type="submit" class="ui-button primary">${icon('list-filter')}<span>筛选</span></button>${iconCommand('rotate-ccw', '重置筛选', 'drawing-reset-filters')}</div>
      <label class="search-input drawing-search">${icon('search')}<input name="search" placeholder="搜索名称或提示词" value="${esc(ui.filters.search)}" /></label>
      <label class="drawing-favorite-only"><input type="checkbox" name="favoriteOnly" ${ui.filters.favoriteOnly ? 'checked' : ''} />${icon('star')}仅收藏</label>
      ${chats.length ? field('聊天归档', `<select name="chatKey">${options([['', '全部图片'], ...chats], ui.filters.chatKey || '')}</select>`) : ''}
      ${field('筛图分类', `<select name="rating">${options([['', '全部分类'], ...REVIEW_LABELS], ui.filters.rating || '')}</select>`)}
    </form>
    <div class="drawing-toolbar">
      <span class="drawing-summary">${ui.loading ? '正在读取图片…' : `${filtered.length} 个图组 · 第 ${page.page} / ${page.pages} 页`}${selected ? ` · 已选 ${selected} 组` : ''}${ui.busy ? ' · 正在处理…' : ''}</span>
      <div class="drawing-commands">${iconCommand('refresh-cw', '刷新图片', 'drawing-refresh', busy ? 'disabled' : '')}
        ${command('scan-eye', '快速筛图', 'drawing-review', busy || !filtered.length ? 'disabled' : '')}
        ${command('check-check', ui.multiselect ? '结束多选' : '多选', 'drawing-multiselect', `aria-pressed="${ui.multiselect}"`)}
        ${command('archive', selected ? '导出所选' : '导出', 'drawing-export', busy || !(selected || filtered.length) ? 'disabled' : '')}
        ${command('arrow-down-to-line', selected ? '下载所选' : '下载全部', 'drawing-download-all', busy || !(selected || filtered.length) ? 'disabled' : '')}
        ${command('trash-2', selected ? '删除所选图组' : '删除本页图组', 'drawing-delete', busy || !(selected || page.items.length) ? 'disabled' : '', 'drawing-delete')}
      </div>
    </div>
    <div class="drawing-export-options">${field('导出文件名', `<select data-drawing-export="naming">${options([['index-title', '序号 + 名称'], ['index-seed', '序号 + 种子'], ['index-model', '序号 + 模型']], ui.exportOptions?.naming || 'index-title')}</select>`)}
      ${field('PNG 元数据', `<select data-drawing-export="metadata">${options([['keep', '保留原有'], ['remove', '移除文本与 EXIF'], ['embed', '写入灵画师参数']], ui.exportOptions?.metadata || 'keep')}</select>`)}</div>
    ${ui.multiselect ? `<div class="drawing-selection-bar"><label><input type="checkbox" data-drawing-select-page ${page.items.length && page.items.every((item) => ui.selection.has(item.id)) ? 'checked' : ''} ${!page.items.length ? 'disabled' : ''} />全选本页</label><span>已选 ${selected} 个图组</span>${command('x', '取消选择', 'drawing-clear-selection')}</div>` : ''}
    ${ui.error ? `<p class="drawing-error" role="alert">${esc(ui.error)}</p>` : ''}
    <div class="drawing-grid">${page.items.length ? page.items.map((item, index) => `<article class="drawing-tile ${ui.selection.has(item.id) ? 'is-selected' : ''}">
      ${ui.multiselect ? `<label class="drawing-select"><input type="checkbox" data-drawing-select="${item.id}" aria-label="选择${esc(item.title)}" ${ui.selection.has(item.id) ? 'checked' : ''} /></label>` : ''}
      <button type="button" class="drawing-image" data-action="viewer" data-image="${item.id}" aria-label="放大${esc(item.title)}"><img src="${item.thumbSrc}" alt="${esc(item.title)}" loading="lazy" /><span class="drawing-source source-${item.source}">${item.source === 'novelai' ? 'NAI' : item.source === 'comfyui' ? 'ComfyUI' : item.source === 'openai' ? 'OpenAI' : item.source === 'sdwebui' ? 'SDWebUI' : '图片'}</span>${item.demo ? '<span class="drawing-demo">示例</span>' : ''}<span class="drawing-image-info"><span>#${(page.page - 1) * ui.pageSize + index + 1}</span><span>${item.width} × ${item.height}</span></span></button>
      <div class="drawing-tile-body"><strong title="${esc(item.title)}">${esc(item.title)}</strong><div><time>${dateKey(item.createdAt)}</time>${iconCommand('star', item.favorite ? '取消收藏' : '收藏图片', 'favorite', `data-image="${item.id}" aria-pressed="${item.favorite}"`)}</div><div class="drawing-version-count"><span class="drawing-param-state">${item.snapshot ? item.snapshot.partial ? '部分参数' : '含生图参数' : '无参数记录'}</span><button type="button" data-action="viewer" data-image="${item.id}" title="查看历史版本">${icon('history')}<span>${item.versionCount} 版</span></button></div><span class="drawing-review-label">${REVIEW_LABELS.find(([value]) => value === (item.rating || 'unrated'))?.[1] || '未分类'}</span></div>
    </article>`).join('') : `<div class="drawing-empty">${icon('images')}<strong>${ui.loading ? '正在载入' : '暂无匹配图片'}</strong>${!ui.loading ? command('upload', '导入图片', 'drawing-import') : ''}</div>`}</div>
    <footer class="drawing-pagination"><label>每页<select data-drawing-page-size>${options([['12', '12'], ['24', '24'], ['48', '48']], String(ui.pageSize))}</select>张</label><div>${iconCommand('chevron-left', '上一页', 'drawing-prev-page', page.page === 1 ? 'disabled' : '')}<span>${page.page} / ${page.pages}</span>${iconCommand('chevron-right', '下一页', 'drawing-next-page', page.page === page.pages ? 'disabled' : '')}</div></footer>
  </section>`;
}

export function galleryIndexStatus(index) {
  if (!index) return '';
  return [index.available ? `本设备参数索引 · 本次复用 ${index.cached || 0} 张` : '参数缓存不可用，仍可读取服务器图片',
    index.pending ? `剩余 ${index.pending} 张分批核对` : '已核对',
    index.errors ? `${index.errors} 张暂无法核对，保留上次记录` : ''].filter(Boolean).join(' · ');
}

export function renderDrawingViewer(item, position, total, ui) {
  const versions = ui.versions || [item];
  const versionIndex = versions.findIndex((row) => row.id === item.id);
  const selected = ui.currentId === item.id;
  const compare = versions.find((row) => row.id === ui.compareId);
  const params = item.snapshot?.params || item.snapshot?.config?.params;
  const rows = params && item.source === 'openai' ? [
    ['来源', providerTitle(item.source)], ['模型', params.model || '未记录'],
    ['尺寸', params.size ? openAISize(normalizeOpenAI(params)).replace('x', ' × ').replace('auto', '自动') : '未记录'],
    ['图像质量', params.quality || '未记录'], ['生成张数', params.n ?? '未记录'],
    ...(usesGPTImage(normalizeOpenAI(params)) ? [
      ['输出格式', params.outputFormat?.toUpperCase() || '未记录'],
      ['背景', ({ auto: '自动', opaque: '不透明', transparent: '透明' })[params.background] || '未记录'],
    ] : [['返回格式', ({ auto: '服务默认', url: '图片 URL', b64_json: 'Base64' })[params.responseFormat] || '未记录']]),
  ] : params ? [
    ['来源', providerTitle(item.source)], ['模型 / 工作流', params.model || params.checkpoint || item.snapshot.config?.name || '未记录'],
    ['尺寸', `${params.width ?? '—'} × ${params.height ?? '—'}`], ['步数 / CFG', `${params.steps ?? '—'} / ${params.scale ?? params.cfg ?? '—'}`],
    ['种子', params.seed ?? '未记录'], ['采样器', params.sampler || '未记录'], ['调度器', params.noiseSchedule || params.scheduler || '未记录'],
  ] : [['来源', providerTitle(item.source)], ['图片尺寸', `${item.width} × ${item.height}`], ['文件大小', formatBytes(item.blob.size)]];
  const processing = item.snapshot?.novelaiProcessing;
  if (processing) {
    if (processing.kind !== 'enhance') rows.splice(0, rows.length, ['来源', providerTitle(item.source)],
      ['处理输入', `${processing.width} × ${processing.height}`]);
    rows.unshift(['图片处理', `${processingTitle(processing)}${processing.variant ? ` · ${processing.variant}` : ''}`],
      ['处理原图', `${processing.inputWidth} × ${processing.inputHeight}`], ['实际结果', `${item.width} × ${item.height}`]);
    if (processing.kind === 'upscale') rows.push(['放大模型', 'nai-diffusion-5-curated']);
    if (processing.kind === 'enhance') rows.push(['强度 / 噪声', `${processing.strength} / ${processing.noise}`]);
    if (processing.kind === 'director' && ['colorize', 'emotion'].includes(processing.tool)) {
      rows.push(['Defry', processing.defry], ['处理提示词', processing.prompt || '未填写']);
      if (processing.tool === 'emotion') rows.push(['表情', processing.emotion]);
    }
  }
  return `<dialog class="drawing-viewer ${ui.details ? 'show-details' : ''} ${ui.zoom ? 'actual-size' : ''}" data-image-id="${esc(item.id)}" aria-label="查看图片：${esc(item.title)}">
    <header><div><strong>${esc(item.title)}</strong><span>${position + 1} / ${total}${item.demo ? ' · 示例图片' : ''}</span></div><div>
      ${iconCommand(ui.zoom ? 'maximize-2' : 'zoom-in', ui.zoom ? '适应窗口' : '原始尺寸', 'viewer-zoom')}
      ${iconCommand('panel-right', '图片参数', 'viewer-details', `aria-pressed="${ui.details}"`)}
      ${iconCommand('star', item.favorite ? '取消收藏' : '收藏图片', 'favorite', `data-image="${item.id}" aria-pressed="${item.favorite}"`)}
      ${iconCommand('arrow-down-to-line', '下载图片', 'download', `data-image="${item.id}"`)}
      ${iconCommand('x', '关闭大图', 'close-viewer')}</div></header>
    <div class="drawing-version-bar drawing-review-tools" aria-label="筛图标记">${REVIEW_LABELS.map(([value, label], index) =>
      command(['circle', 'gem', 'check', 'x'][index], label, 'viewer-review', `data-rating="${value}" aria-pressed="${(item.rating || 'unrated') === value}"`)).join('')}
      ${iconCommand('undo-2', '撤销上一次筛图标记', 'viewer-review-undo', ui.reviewHistory?.length ? '' : 'disabled')}
      ${ui.review ? '<span>快速筛图</span>' : ''}</div>
    <div class="drawing-version-bar"><div>${iconCommand('chevron-left', '上一个版本', 'version-prev', versionIndex <= 0 ? 'disabled' : '')}<select data-viewer-version aria-label="历史版本">${versions.map((row) => `<option value="${row.id}" ${row.id === item.id ? 'selected' : ''}>版本 ${normalizeVersion(row.version, row.id).number}${row.id === ui.currentId ? ' · 当前' : ''}</option>`).join('')}</select>${iconCommand('chevron-right', '下一个版本', 'version-next', versionIndex >= versions.length - 1 ? 'disabled' : '')}</div>
      <div>${command('pencil', '编辑这张图', 'viewer-edit', item.snapshot ? '' : 'disabled')}
      ${command('wand-sparkles', '图片增强', 'viewer-enhance')}
      ${command('scan-eye', '本地反推 / 超分', 'viewer-local-tools')}
      ${command('image-plus', '作为底图', 'viewer-source')}${command('palette', '作为参考图', 'viewer-reference')}
      ${command('check', selected ? '当前版本' : '设为当前版本', 'version-select', selected ? 'disabled' : '')}
      ${iconCommand('columns-2', '比较版本', 'version-compare', `aria-pressed="${Boolean(ui.compare)}" ${versions.length < 2 ? 'disabled' : ''}`)}
      ${iconCommand('copy', '复制种子', 'version-copy-seed', ui.seed === null ? 'disabled' : '')}
      ${iconCommand('trash-2', '删除这个版本', 'version-delete')}</div>
      ${ui.compare ? `<label class="version-compare-choice">对比<select data-viewer-compare aria-label="对比版本">${versions.filter((row) => row.id !== item.id).map((row) => `<option value="${row.id}" ${row.id === compare?.id ? 'selected' : ''}>版本 ${normalizeVersion(row.version, row.id).number}</option>`).join('')}</select></label>` : ''}
    </div>
    <div class="drawing-viewer-body"><div class="drawing-stage">${iconCommand('chevron-left', '上一张图片', 'viewer-prev', total <= 1 ? 'disabled' : '')}<div class="drawing-full-image ${ui.compare && compare ? 'drawing-compare' : ''}"><figure><img src="${item.src}" alt="${esc(item.title)}" />${ui.compare ? `<figcaption>版本 ${normalizeVersion(item.version, item.id).number}</figcaption>` : ''}</figure>${ui.compare && compare ? `<figure><img src="${compare.src}" alt="对比：${esc(compare.title)}" /><figcaption>版本 ${normalizeVersion(compare.version, compare.id).number}</figcaption></figure>` : ''}</div>${iconCommand('chevron-right', '下一张图片', 'viewer-next', total <= 1 ? 'disabled' : '')}</div>
      <aside class="drawing-details"><div class="drawing-details-heading"><h2>生图参数</h2><span class="drawing-source source-${item.source}">${providerTitle(item.source)}</span></div>
        <dl>${rows.map(([title, value]) => `<div><dt>${title}</dt><dd>${esc(String(value))}</dd></div>`).join('')}</dl>
        <div class="drawing-prompt"><h3>历史版本 · ${versions.length} 个</h3><div class="version-thumbnails">${versions.map((row) => `<button type="button" data-action="version-view" data-image="${row.id}" aria-pressed="${row.id === item.id}" title="${esc(row.time)}"><img src="${row.thumbSrc}" alt="版本 ${normalizeVersion(row.version, row.id).number}" loading="lazy" /><span>版本 ${normalizeVersion(row.version, row.id).number}${row.id === ui.currentId ? ' · 当前' : ''}</span></button>`).join('')}</div>${item.version?.note ? `<p>${esc(item.version.note)}</p>` : ''}${item.version?.parentId ? `<p>基于版本 ${normalizeVersion(versions.find((row) => row.id === item.version.parentId)?.version, '').number}${versions.some((row) => row.id === item.version.parentId) ? '' : ' · 来源已删除'}</p>` : ''}${command('trash-2', '删除整个图组', 'version-delete-group')}</div>
        ${params?.artist ? `<div class="drawing-prompt"><h3>画师串</h3><p>${esc(params.artist)}</p></div>` : ''}
        ${params ? `<div class="drawing-prompt"><h3>正向提示词</h3><p>${esc(params.positive || '未记录')}</p></div>${item.source !== 'openai' || isOpenAINovelAI(params.model) ? `<div class="drawing-prompt"><h3>负面提示词</h3><p>${esc(Object.hasOwn(params, 'negative') ? params.negative || '未填写' : '未记录')}</p></div>` : ''}` : '<p class="drawing-note">图片中没有可读取的生图参数。</p>'}
        ${item.snapshot?.characterScene?.entries?.length ? `<div class="drawing-prompt"><h3>角色档案快照</h3>${item.snapshot.characterScene.entries.map((entry) =>
          `<p><strong>${esc(entry.profile.name)}</strong> · ${esc(entry.profile.outfits.find((outfit) => outfit.id === entry.outfitId)?.name || '无服装')}</p>
          <p>${esc(item.snapshot.characterScene.characterPrompts?.find((prompt) => prompt.id === entry.profileId)?.positive || entry.profile.tags)}</p>
          ${item.snapshot.characterScene.characterPrompts?.find((prompt) => prompt.id === entry.profileId)?.negative ? `<p>负面：${esc(item.snapshot.characterScene.characterPrompts.find((prompt) => prompt.id === entry.profileId).negative)}</p>` : ''}`).join('')}
          ${command('history', '恢复角色档案', 'viewer-restore-profiles')}</div>` : ''}
        ${item.snapshot?.partial ? '<p class="drawing-note">仅覆盖图片中记录的参数，其余设置保留。</p>' : ''}
        ${item.demo ? '<p class="drawing-note">示例图片的参数用于界面演示。</p>' : ''}
        ${command('replace', item.snapshot ? `导入并覆盖 ${providerTitle(item.source)} 参数` : '无可导入参数', 'viewer-restore', item.snapshot ? '' : 'disabled', 'drawing-restore')}
      </aside>
    </div>
    <footer><span>${item.width} × ${item.height} · ${formatBytes(item.blob.size)} · ${esc(item.time)}</span>${ui.details ? '' : command('replace', `导入${item.snapshot ? `并覆盖 ${providerTitle(item.source)}` : ''}参数`, 'viewer-restore', item.snapshot ? '' : 'disabled', 'drawing-restore')}</footer>
  </dialog>`;
}
