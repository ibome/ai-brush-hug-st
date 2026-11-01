const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const encoder = new TextEncoder();
function chunks(bytes) {
  if (PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) throw new Error('PNG 文件头无效');
  const rows = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error('PNG 数据不完整');
    const length = view.getUint32(offset), end = offset + 12 + length;
    if (end > bytes.length) throw new Error('PNG 数据不完整');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    rows.push({ type, bytes: bytes.subarray(offset, end) }); offset = end;
    if (type === 'IEND') break;
  }
  if (rows[0]?.type !== 'IHDR' || rows.at(-1)?.type !== 'IEND') throw new Error('PNG 缺少必要数据块');
  return rows;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export async function prepareExportImage(blob, mode = 'keep', snapshot) {
  if (!['keep', 'remove', 'embed'].includes(mode)) throw new Error('图片元数据选项无效');
  if (mode === 'keep' || blob.type !== 'image/png') return blob;
  const bytes = new Uint8Array(await blob.arrayBuffer()), rows = chunks(bytes);
  const removed = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf']);
  const retained = rows.filter((row) => !removed.has(row.type));
  if (mode === 'embed' && snapshot) {
    const payload = encoder.encode(`linghuashi\0\0\0\0\0${JSON.stringify(snapshot)}`);
    if (payload.length >= 1024 * 1024) throw new Error('PNG 参数元数据超过 1 MB，请选择保留原有并使用 ZIP 参数清单');
    const chunk = new Uint8Array(payload.length + 12), view = new DataView(chunk.buffer);
    view.setUint32(0, payload.length);
    chunk.set(encoder.encode('iTXt'), 4); chunk.set(payload, 8);
    view.setUint32(chunk.length - 4, crc32(chunk.subarray(4, -4)));
    retained.splice(retained.length - 1, 0, { type: 'iTXt', bytes: chunk });
  }
  return new Blob([new Uint8Array(PNG_SIGNATURE), ...retained.map((row) => row.bytes)], { type: 'image/png' });
}
export function exportFilename(item, index, pattern = 'index-title') {
  const safe = (value) => String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 65) || 'image';
  const params = item.snapshot?.params || item.snapshot?.config?.params || {};
  const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' })[item.blob.type] || 'png';
  const prefix = String(index + 1).padStart(3, '0');
  return `${prefix}-${pattern === 'index-seed' ? `seed-${safe(params.seed ?? (() => { try { return JSON.parse(params.extra || '{}').seed; } catch { return 'unknown'; } })() ?? 'unknown')}`
    : pattern === 'index-model' ? safe(params.model || params.checkpoint || item.source) : safe(item.title)}.${ext}`;
}
