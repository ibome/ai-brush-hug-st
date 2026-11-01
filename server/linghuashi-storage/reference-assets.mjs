import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { REFERENCE_ACTIONS } from './reference-actions.mjs';

export { REFERENCE_ACTIONS };
export const ASSET_LIMIT = 4 * 1024 * 1024;
export const ASSET_CHUNK = 512 * 1024;
const MAX_TOTAL = 128 * 1024 * 1024;
const validId = (id) => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

export function createReferenceAssets(directory) {
  const metaFile = (id) => path.join(directory, `${id}.json`);
  const dataFile = (id) => path.join(directory, `${id}.bin`);
  async function list() {
    const names = await fs.readdir(directory);
    const rows = [];
    for (const name of names.filter((name) => /^[a-f0-9]{64}\.json$/.test(name))) {
      const row = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'));
      rows.push(row);
    }
    return rows;
  }
  async function dispatch(action, body = {}) {
    if (action === 'reference/list') {
      const rows = await list();
      return { rows, bytes: rows.reduce((sum, row) => sum + row.size, 0), maxBytes: MAX_TOTAL };
    }
    if (!validId(body.id)) throw fail('参考素材标识无效');
    if (action === 'reference/get') {
      const offset = body.offset ?? 0;
      if (!Number.isSafeInteger(offset) || offset < 0) throw fail('素材偏移无效');
      let row, bytes;
      try {
        row = JSON.parse(await fs.readFile(metaFile(body.id), 'utf8'));
        if (offset >= row.size) throw fail('素材偏移超出范围');
        const handle = await fs.open(dataFile(body.id), 'r');
        try {
          bytes = Buffer.alloc(Math.min(ASSET_CHUNK, row.size - offset));
          const result = await handle.read(bytes, 0, bytes.length, offset);
          bytes = bytes.subarray(0, result.bytesRead);
        } finally { await handle.close(); }
      } catch (error) {
        if (error.code === 'ENOENT') throw fail('参考素材不存在，请重新上传', 404);
        throw error;
      }
      if (!bytes.length) throw fail('参考素材文件不完整', 500);
      return { row, data: bytes.toString('base64') };
    }
    if (action !== 'reference/put') throw fail('未知素材操作', 404);
    const { offset, total, data } = body;
    if (!Number.isSafeInteger(total) || total < 1 || total > ASSET_LIMIT
      || !Number.isSafeInteger(offset) || offset < 0 || typeof data !== 'string'
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length > Math.ceil(ASSET_CHUNK / 3) * 4) {
      throw fail('参考素材数据无效或超过 4 MB');
    }
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || bytes.length > ASSET_CHUNK || offset + bytes.length > total) throw fail('素材块大小无效');
    try {
      const row = JSON.parse(await fs.readFile(metaFile(body.id), 'utf8'));
      if (row.size !== total) throw fail('同一素材内容不一致', 409);
      return { row, complete: true, offset: row.size };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const partial = path.join(directory, `${body.id}.part`);
    const previous = await fs.stat(partial).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    const length = previous?.size || 0;
    if (offset > length) throw fail('素材块不连续', 409);
    if (!previous) {
      const files = await fs.readdir(directory);
      if (files.length >= 384) throw fail('参考素材空间已满，请备份后整理素材', 409);
      let usage = 0;
      for (const file of files.filter((name) => /\.(bin|part)$/.test(name))) usage += (await fs.stat(path.join(directory, file))).size;
      if (usage + total > MAX_TOTAL) throw fail('参考素材超过 128 MB 容量', 409);
    }
    const handle = await fs.open(partial, previous ? 'r+' : 'wx', 0o600);
    try {
      if (offset < length) {
        const prior = Buffer.alloc(bytes.length);
        const read = await handle.read(prior, 0, prior.length, offset);
        if (read.bytesRead !== bytes.length || !bytes.equals(prior)) throw fail('重传素材内容不一致', 409);
      } else {
        let written = 0;
        while (written < bytes.length) {
          const result = await handle.write(bytes, written, bytes.length - written, offset + written);
          if (!result.bytesWritten) throw fail('素材无法写入', 500);
          written += result.bytesWritten;
        }
        await handle.sync();
      }
    } finally { await handle.close(); }
    const size = Math.max(length, offset + bytes.length);
    if (size !== total) return { complete: false, offset: size };
    const complete = await fs.readFile(partial);
    if (digest(complete) !== body.id) throw fail('素材校验失败，请重新上传', 409);
    const mime = body.mime;
    if (!['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'].includes(mime)) throw fail('素材格式不支持');
    const png = complete.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = complete[0] === 255 && complete[1] === 216 && complete[2] === 255;
    const webp = complete.toString('ascii', 0, 4) === 'RIFF' && complete.toString('ascii', 8, 12) === 'WEBP';
    if (mime.startsWith('image/') && !({ 'image/png': png, 'image/jpeg': jpeg, 'image/webp': webp })[mime]) throw fail('图片内容与格式不一致');
    const row = { id: body.id, size, mime, name: String(body.name || '参考素材').slice(0, 120),
      width: Math.max(0, Math.min(4096, Math.round(Number(body.width) || 0))),
      height: Math.max(0, Math.min(4096, Math.round(Number(body.height) || 0))), createdAt: Date.now() };
    await fs.rename(partial, dataFile(body.id));
    const temporary = `${metaFile(body.id)}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(row), { mode: 0o600 });
    await fs.rename(temporary, metaFile(body.id));
    return { row, complete: true, offset: size };
  }
  return { dispatch };
}
