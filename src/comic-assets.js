import { comicRefKey } from './comic.js';

export async function checkComicImage(row, { request = fetch, signal } = {}) {
  if (row.blob instanceof Blob) return { status: row.blob.size ? 'available' : 'missing',
    detail: row.blob.size ? '原图可读取' : '浏览器原图为空' };
  if (!row.srcURL) return { status: 'unreachable', detail: '未取得原图地址，请重新读取图库' };
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 8000);
  try {
    signal?.throwIfAborted();
    let response = await request(row.srcURL, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
    if ([405, 501].includes(response.status)) {
      response = await request(row.srcURL, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      await response.body?.cancel();
    }
    if ([404, 410].includes(response.status)) return { status: 'missing', detail: '原图文件未找到，可恢复备份或选择其他图片' };
    if (!response.ok) return { status: 'unreachable', detail: `原图暂时无法读取（HTTP ${response.status}），请检查登录或存储服务` };
    const type = response.headers.get('content-type') || '';
    if (!/^(?:image\/|application\/octet-stream)/i.test(type)) return { status: 'unreachable', detail: '原图地址未返回图片，请检查登录或存储服务' };
    return { status: 'available', detail: '原图可读取' };
  } catch {
    signal?.throwIfAborted();
    return { status: 'unreachable', detail: '原图连接失败或超时，可稍后重新检测' };
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
  }
}

export async function inspectComicAssets(project, listImages, checkImage = checkComicImage, signal) {
  const refs = [...new Map(project.panels.filter((panel) => panel.image)
    .map((panel) => [comicRefKey(panel.image), panel.image])).values()];
  const rows = new Map(), states = new Map();
  for (const location of new Set(refs.map((ref) => ref.location))) {
    signal?.throwIfAborted();
    try {
      for (const row of await listImages(location)) rows.set(`${location}:${row.id}`, row);
      for (const ref of refs.filter((ref) => ref.location === location)) {
        const key = comicRefKey(ref);
        if (!rows.has(key)) states.set(key, { status: 'missing', detail: location === 'browser'
          ? '当前浏览器找不到这张图片，请恢复本设备备份或重新选图' : '酒馆图库找不到这张图片，请恢复备份或重新选图' });
      }
    } catch {
      signal?.throwIfAborted();
      for (const ref of refs.filter((ref) => ref.location === location)) states.set(comicRefKey(ref), {
        status: 'unreachable', detail: `${location === 'server' ? '酒馆图库' : '浏览器存储'}暂时无法读取，可重新检测`,
      });
    }
  }
  const pending = refs.filter((ref) => !states.has(comicRefKey(ref)));
  const worker = async () => {
    while (pending.length) {
      const ref = pending.shift(), key = comicRefKey(ref);
      signal?.throwIfAborted();
      try { states.set(key, await checkImage(rows.get(key), { signal })); }
      catch { signal?.throwIfAborted(); states.set(key, { status: 'unreachable', detail: '原图检测失败，可重新检测' }); }
    }
  };
  await Promise.all([worker(), worker()]);
  return { rows, states };
}

export function comicMissingPanelIds(project, states) {
  return (project?.panels || []).filter((panel) => !panel.image || states.get(comicRefKey(panel.image))?.status === 'missing').map((panel) => panel.id);
}
