import { randomUUID, sha256Hex, requireBackupCrypto } from './crypto-compat.js';
import JSZip from 'jszip';
import { RELEASE } from './release.js';
import { backupSize, cloneBackup, scrubBackup, normalizeBackupConfig, portableCredentials, referencedAssets } from './backup-config.js';
import { assetBase64, assetBytes, normalizeAsset } from './reference-assets.js';
import { normalizeBackupChats } from '../server/linghuashi-storage/backup-records.mjs';
import { inspectRecovery } from './recovery-drafts.js';
import { normalizeComicChapterBundle } from './comic-chapters.js';

export const BACKUP_LIMIT = 200 * 1024 * 1024;
const MAX_MANIFEST = 16 * 1024 * 1024;
const MAGIC = new TextEncoder().encode('LHBK1');
const sameBytes = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
export const backupHash = sha256Hex;
export const backupIdentity = (account, origin) => backupHash(new TextEncoder().encode(`${origin}\n${account}`));

function readEntry(entry, limit) {
  return new Promise((resolve, reject) => {
    let total = 0, failed = false;
    const chunks = [], stream = entry.internalStream('uint8array');
    stream.on('data', (bytes) => {
      if (failed) return;
      total += bytes.length;
      if (total > limit) { failed = true; stream.pause(); reject(new Error('备份文件解压后超过限制')); return; }
      chunks.push(bytes);
    });
    stream.on('error', reject);
    stream.on('end', () => {
      if (failed) return;
      const bytes = new Uint8Array(total); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      resolve(bytes);
    });
    stream.resume();
  });
}

async function passwordKey(password, salt, iterations) {
  requireBackupCrypto();
  if (typeof password !== 'string' || password.length < 8 || password.length > 1024) throw new Error('备份密码需为 8 至 1024 个字符');
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptBackup(bytes, password) {
  requireBackupCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), iterations = 600000;
  const header = new TextEncoder().encode(JSON.stringify({ algorithm: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations,
    salt: assetBase64(salt), iv: assetBase64(iv) }));
  const prefix = new Uint8Array(MAGIC.length + 4 + header.length);
  prefix.set(MAGIC); new DataView(prefix.buffer).setUint32(MAGIC.length, header.length); prefix.set(header, MAGIC.length + 4);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: prefix }, await passwordKey(password, salt, iterations), bytes);
  return new Blob([prefix, encrypted], { type: 'application/octet-stream' });
}

export function isEncryptedBackup(bytes) { return sameBytes(bytes.subarray(0, MAGIC.length), MAGIC); }

export async function decryptBackup(bytes, password) {
  requireBackupCrypto();
  if (!isEncryptedBackup(bytes) || bytes.length < MAGIC.length + 4) throw new Error('加密备份格式无效');
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(MAGIC.length);
  const offset = MAGIC.length + 4 + length;
  if (length > 2048 || offset + 16 > bytes.length) throw new Error('加密备份头无效');
  const info = JSON.parse(new TextDecoder().decode(bytes.subarray(MAGIC.length + 4, offset)));
  if (info.algorithm !== 'AES-256-GCM' || info.kdf !== 'PBKDF2-SHA256' || info.iterations !== 600000) throw new Error('加密算法或版本不受支持');
  const salt = assetBytes(info.salt), iv = assetBytes(info.iv);
  if (salt.length !== 16 || iv.length !== 12) throw new Error('加密备份头无效');
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: bytes.subarray(0, offset) },
      await passwordKey(password, salt, info.iterations), bytes.subarray(offset)));
  } catch (error) {
    if (error.name === 'OperationError') throw new Error('密码不正确或备份文件已损坏');
    throw error;
  }
}

export function archiveTasks(rows) {
  return (rows || []).slice(0, 500).map((row) => scrubBackup({
    id: row.id, status: ['completed', 'failed', 'cancelled'].includes(row.status) ? row.status : 'paused',
    createdAt: row.createdAt, updatedAt: row.updatedAt, phase: row.phase || '', stage: row.stage || '',
    error: row.error || '', imageCount: row.imageCount || 0, savedIds: row.savedIds || [],
    snapshot: row.plan?.snapshot || row.snapshot || null,
  }, { refs: true }));
}

export async function createBackup({ state, sections, layout = null, kind = 'config', includeKeys = false, password = '',
  identity = '', assets, drawings = [], chats = [], tasks = [], drafts = null, comicChapters = [], readKey, progress = () => {} }) {
  if (!['config', 'full', 'share'].includes(kind)) throw new Error('备份类型无效');
  if (kind === 'share' && includeKeys) throw new Error('分享包不能包含秘钥');
  if (includeKeys && (password.length < 8 || password.length > 1024)) throw new Error('备份密码需为 8 至 1024 个字符');
  const config = normalizeBackupConfig(state, sections);
  if (kind === 'share') {
    delete config.connections; delete config.connectionProfiles; delete config.connectionProfileIds;
    delete config.presetBindings;
    if (config.characterProfiles) { config.characterProfiles.chats = []; config.characterProfiles.selection = []; }
    for (const key of ['novelaiPresets', 'openaiPresets', 'comfyPresets', 'sdwebuiPresets']) for (const item of config[key] || []) {
      delete item.connection; item.connectionProfileId = '';
    }
  }
  const secrets = await portableCredentials(config, readKey, includeKeys);
  const zip = new JSZip(), manifest = { format: 'linghuashi-backup', schemaVersion: 1,
    pluginVersion: RELEASE.version, exportedAt: new Date().toISOString(), kind, identity: kind === 'share' ? '' : identity,
    sections, layout: kind === 'share' ? null : layout, config: scrubBackup(config, { sharing: kind === 'share' }), files: [], images: [],
    chats: kind === 'full' ? scrubBackup(chats, { refs: true }) : [],
    tasks: kind === 'full' ? archiveTasks(tasks) : [] };
  if (config.comicLibrary) manifest.comicChapters = scrubBackup(normalizeComicChapterBundle(comicChapters, config.comicLibrary), { refs: true, sharing: kind === 'share' });
  if (drafts && kind !== 'share') manifest.drafts = inspectRecovery(drafts);
  let total = 0, count = 0;
  const add = async (path, blob, metadata) => {
    total += blob.size;
    if (!blob.size || total > BACKUP_LIMIT) throw new Error('备份超过 200 MB，请先分批导出图库');
    const bytes = new Uint8Array(await blob.arrayBuffer()), hash = await backupHash(bytes);
    zip.file(path, bytes, { createFolders: false });
    manifest.files.push({ path, size: bytes.length, sha256: hash, ...metadata });
    progress(`正在整理 ${++count} 个文件`);
  };
  for (const [index, row] of drawings.entries()) {
    const { blob, thumbnail, src, thumbSrc, srcURL, thumbnailURL, storageLocation, warning, ...metadata } = row;
    const file = `images/${index}.bin`;
    await add(file, blob, { kind: 'image', mime: blob.type });
    manifest.images.push({ ...scrubBackup(metadata, { refs: true }), file });
  }
  const references = referencedAssets({ config: manifest.config, images: manifest.images, tasks: manifest.tasks, comicChapters: manifest.comicChapters });
  const used = new Set();
  for (const asset of references) {
    if (used.has(asset.id)) continue;
    const blob = await assets.get(asset);
    await add(`assets/${asset.id}.bin`, blob, { kind: 'asset', asset });
    used.add(asset.id);
  }
  if (includeKeys) zip.file('secrets.json', JSON.stringify(secrets));
  if (backupSize(manifest) > MAX_MANIFEST || total + backupSize(manifest) > BACKUP_LIMIT) throw new Error('备份清单或总容量超过限制');
  zip.file('linghuashi-backup.json', JSON.stringify(manifest));
  progress('正在打包');
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
  if (bytes.length > BACKUP_LIMIT) throw new Error('备份包超过 200 MB');
  return includeKeys ? encryptBackup(bytes, password) : new Blob([bytes], { type: 'application/zip' });
}

export async function inspectBackup(file, password = '') {
  if (!file.size || file.size > BACKUP_LIMIT + 4096) throw new Error('备份文件需小于 200 MB');
  let bytes = new Uint8Array(await file.arrayBuffer());
  const encrypted = isEncryptedBackup(bytes);
  if (encrypted) bytes = await decryptBackup(bytes, password);
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false });
  const entries = Object.values(zip.files);
  if (entries.length > 1200) throw new Error('备份包文件数量过多');
  let total = 0;
  for (const entry of entries) {
    if (entry.dir || entry.name !== entry.unsafeOriginalName && entry.unsafeOriginalName
      || !/^(?:linghuashi-backup\.json|secrets\.json|images\/\d+\.bin|assets\/[a-f0-9]{64}\.bin)$/.test(entry.name)) throw new Error('备份包包含不受支持的路径');
    total += entry._data?.uncompressedSize || 0;
    if (total > BACKUP_LIMIT) throw new Error('备份解压后超过 200 MB');
  }
  const entry = zip.file('linghuashi-backup.json');
  if (!entry || entry._data?.uncompressedSize > MAX_MANIFEST) throw new Error('缺少有效备份清单');
  const manifest = JSON.parse(new TextDecoder().decode(await readEntry(entry, MAX_MANIFEST)));
  if (manifest.format !== 'linghuashi-backup' || manifest.schemaVersion !== 1
    || !['config', 'full', 'share'].includes(manifest.kind) || !Array.isArray(manifest.sections)
    || !Array.isArray(manifest.files) || manifest.files.length > 1000
    || !Array.isArray(manifest.images) || manifest.images.length > 500
    || !Array.isArray(manifest.chats) || manifest.chats.length > 3000
    || !Array.isArray(manifest.tasks) || manifest.tasks.length > 500) throw new Error('备份格式、版本或数量不受支持');
  manifest.config = normalizeBackupConfig(manifest.config, manifest.sections);
  if (manifest.config.comicLibrary) manifest.comicChapters = normalizeComicChapterBundle(manifest.comicChapters, manifest.config.comicLibrary);
  if (manifest.drafts) {
    if (manifest.kind === 'share') throw new Error('分享包不能包含个人草稿');
    manifest.drafts = inspectRecovery(manifest.drafts);
  }
  const contents = new Map(), seen = new Set();
  for (const item of manifest.files) {
    if (!item || !Number.isSafeInteger(item.size) || item.size < 1 || !/^[a-f0-9]{64}$/.test(item.sha256)
      || seen.has(item.path) || !['image', 'asset'].includes(item.kind)) throw new Error('备份文件清单无效');
    seen.add(item.path);
    if (item.kind === 'image' ? !/^images\/\d+\.bin$/.test(item.path) || item.size > 20 * 1024 * 1024
      : !/^assets\/[a-f0-9]{64}\.bin$/.test(item.path) || item.size > 4 * 1024 * 1024
        || !normalizeAsset(item.asset) || item.asset.id !== item.sha256 || item.path !== `assets/${item.asset.id}.bin`) throw new Error('图片或素材清单无效');
    const fileEntry = zip.file(item.path);
    if (!fileEntry || fileEntry._data?.uncompressedSize !== item.size) throw new Error('备份文件缺失或大小不一致');
    const fileBytes = await readEntry(fileEntry, item.size);
    if (await backupHash(fileBytes) !== item.sha256) throw new Error('备份文件校验失败');
    contents.set(item.path, new Blob([fileBytes], { type: item.kind === 'asset' ? item.asset.mime : item.mime }));
  }
  for (const image of manifest.images) {
    if (!/^images\/\d+\.bin$/.test(image.file) || !contents.has(image.file)
      || !/^[A-Za-z0-9_-]{1,80}$/.test(image.id)) throw new Error('图片记录无效');
  }
  if (new Set(manifest.images.map((row) => row.id)).size !== manifest.images.length) throw new Error('图片记录 ID 重复');
  const assets = new Set(manifest.files.filter((item) => item.kind === 'asset').map((item) => item.asset.id));
  if (referencedAssets({ config: manifest.config, images: manifest.images, tasks: manifest.tasks, comicChapters: manifest.comicChapters }).some((item) => !assets.has(item.id))) throw new Error('备份缺少配置引用的参考素材');
  if (entries.some((item) => !['linghuashi-backup.json', 'secrets.json'].includes(item.name) && !seen.has(item.name))) throw new Error('备份有未列入清单的文件');
  const secretEntry = zip.file('secrets.json');
  if (secretEntry && (!encrypted || manifest.kind === 'share' || secretEntry._data?.uncompressedSize > 1024 * 1024)) throw new Error('秘钥必须位于个人加密备份中');
  const secrets = secretEntry ? JSON.parse(new TextDecoder().decode(await readEntry(secretEntry, 1024 * 1024))) : [];
  if (!Array.isArray(secrets) || secrets.length > 300) throw new Error('秘钥清单无效');
  if (manifest.kind !== 'full' && (manifest.images.length || manifest.chats.length || manifest.tasks.length)) throw new Error('备份类型与内容不一致');
  normalizeBackupChats(manifest.chats, new Set(manifest.images.map((row) => row.id)));
  if (backupSize(manifest.tasks) > 8000000) throw new Error('任务记录超过 8 MB');
  const taskIds = new Set();
  for (const row of manifest.tasks) {
    if (!row || !/^[A-Za-z0-9_-]{1,80}$/.test(row.id) || taskIds.has(row.id)
      || !['completed', 'failed', 'cancelled', 'paused'].includes(row.status)
      || !Array.isArray(row.savedIds) || row.savedIds.length > 500) throw new Error('任务归档格式无效');
    taskIds.add(row.id);
  }
  return { manifest, contents, secrets, encrypted, size: file.size };
}

export function remapBackupImages(rows, existing, preserveChat) {
  const ids = new Set(existing.map((row) => row.id)), mapping = new Map();
  for (const row of rows) mapping.set(row.id, ids.has(row.id) ? randomUUID() : row.id);
  return { mapping, rows: rows.map((row) => ({ ...row, id: mapping.get(row.id),
    chatBinding: preserveChat ? row.chatBinding : null,
    version: { ...row.version, groupId: mapping.get(row.version.groupId) || row.version.groupId,
      parentId: mapping.get(row.version.parentId) || row.version.parentId },
  })) };
}
