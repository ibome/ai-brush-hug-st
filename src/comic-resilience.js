export const COMIC_PREVIEW_BYTES = 16 * 1024 * 1024;
export const COMIC_THUMBNAIL_BYTES = 8 * 1024 * 1024;
export function cacheComicPreview(cache, key, blob, budget = COMIC_PREVIEW_BYTES) {
  if (!(blob instanceof Blob) || blob.size > Math.min(budget, COMIC_THUMBNAIL_BYTES)) return false;
  cache.delete(key);
  let size = [...cache.values()].reduce((sum, row) => sum + row.size, 0);
  for (const [oldKey, oldBlob] of cache) {
    if (size + blob.size <= budget) break;
    cache.delete(oldKey); size -= oldBlob.size;
  }
  cache.set(key, blob);
  return true;
}
export async function readComicThumbnail(row, { signal, request = fetch, timeout = 12000 } = {}) {
  signal?.throwIfAborted();
  if (row?.thumbnail instanceof Blob) {
    if (row.thumbnail.size > COMIC_THUMBNAIL_BYTES) throw new Error('预览图片过大');
    return row.thumbnail;
  }
  if (!row?.thumbnailURL) throw new Error('暂无可读取的预览图片');
  const controller = new AbortController(), cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, timeout);
  try {
    const response = await request(row.thumbnailURL, { credentials: 'same-origin', signal: controller.signal });
    if (!response.ok || !/^image\//i.test(response.headers.get('content-type') || '')) throw new Error('预览图片暂时无法读取');
    if (Number(response.headers.get('content-length')) > COMIC_THUMBNAIL_BYTES) throw new Error('预览图片过大');
    const reader = response.body?.getReader();
    let blob;
    if (reader) {
      const chunks = []; let bytes = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > COMIC_THUMBNAIL_BYTES) throw new Error('预览图片过大');
          chunks.push(value);
        }
        blob = new Blob(chunks, { type: response.headers.get('content-type') });
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } else blob = await response.blob();
    if (!blob.size || blob.size > COMIC_THUMBNAIL_BYTES) throw new Error('预览图片为空或过大');
    return blob;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
