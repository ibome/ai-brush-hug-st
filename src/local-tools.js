import { validKeyRef } from './connections.js';

export const LOCAL_MODELS = [
  ['wd-vit-v3', 'WD ViT v3 · 动漫标签反推', 'tags'],
  ['fsrcnn-x2', 'FSRCNN · 2× 超分', 'upscale'],
  ['fsrcnn-x4', 'FSRCNN · 4× 超分', 'upscale'],
];

export function localImageMime(bytes) {
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71
    && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  throw new Error('该文件不是支持的 PNG、JPG 或 WebP 图片');
}

export function localToolsBase(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error('请填写本地组件的完整 HTTP 或 HTTPS 地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('组件地址仅支持 HTTP/HTTPS，不可包含账号、参数或片段');
  }
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '') + '/';
  return url.href;
}

export function normalizeLocalTools(value = {}) {
  return {
    endpoint: typeof value?.endpoint === 'string' ? value.endpoint.slice(0, 2000) : 'http://127.0.0.1:8765',
    keyRef: validKeyRef(value?.keyRef) ? value.keyRef : '',
  };
}

export function localTaskOptions(model, { threshold = 0.35, characterThreshold = 0.85 } = {}) {
  const entry = LOCAL_MODELS.find(([id]) => id === model);
  if (!entry) throw new Error('请选择支持的本地模型');
  if (![threshold, characterThreshold].every((value) => Number.isFinite(Number(value)) && Number(value) >= 0.05 && Number(value) <= 0.95)) {
    throw new Error('标签阈值应在 0.05–0.95 之间');
  }
  return { model, kind: entry[2], threshold: Number(threshold), characterThreshold: Number(characterThreshold) };
}

export function localOutputSize(width, height, model) {
  if (![width, height].every((value) => Number.isInteger(value) && value > 0) || !LOCAL_MODELS.some(([id]) => id === model)) {
    throw new Error('图片尺寸或模型无效');
  }
  if (width * height > 16000000 || Math.max(width, height) > 8192) throw new Error('原图需小于 1600 万像素，单边不超过 8192');
  const scale = model === 'fsrcnn-x4' ? 4 : model === 'fsrcnn-x2' ? 2 : 1;
  if (scale > 1 && (width * height * scale * scale > 24000000 || Math.max(width, height) * scale > 8192)) {
    throw new Error('超分结果超过 2400 万像素或单边 8192，请改用 2× 或缩小原图');
  }
  return { width: width * scale, height: height * scale, scale };
}

export function localTagsText(result, characters = false) {
  const rows = [...(Array.isArray(result?.tags) ? result.tags : []),
    ...(characters && Array.isArray(result?.characters) ? result.characters : [])];
  return [...new Set(rows.slice(0, 240).filter((row) => typeof row?.tag === 'string' && row.tag.length <= 200
    && Number.isFinite(row.score)).map((row) => row.tag.trim()).filter(Boolean))].join(', ').slice(0, 12000);
}

function networkError(error) {
  return Object.assign(error?.name === 'AbortError' ? new Error('本地任务已取消')
    : new Error('无法访问本地组件，请检查组件是否启动、允许访问的酒馆地址、HTTPS/HTTP 限制和手机填写的主机地址'),
  { category: error?.name === 'AbortError' ? 'cancelled' : 'network' });
}

export function localToolsClient({ endpoint, key, request = fetch }) {
  const base = localToolsBase(endpoint);
  if (!key?.trim()) throw new Error('请填写本地组件访问令牌');
  async function call(path, { method = 'GET', body, signal, binary = false } = {}) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (signal?.aborted) throw new Error('本地任务已取消');
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      let response;
      try {
        response = await request(new URL(`v1/${path}`, base), {
          method, headers: { Authorization: `Bearer ${key.trim()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined, signal: controller.signal,
          credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        });
      } catch (error) {
        const failed = networkError(error);
        if (controller.signal.aborted && !signal?.aborted) { failed.message = '本地组件响应超时，请检查启动窗口和网络'; failed.category = 'timeout'; }
        throw failed;
      }
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw Object.assign(new Error(response.status === 401 ? '组件访问令牌不正确，请重新保存'
          : response.status === 403 ? '组件尚未允许当前酒馆地址，请在启动参数中添加 --allow-origin'
          : String(detail.error || `组件返回 HTTP ${response.status}`).slice(0, 300)),
        { status: response.status, category: response.status === 401 ? 'auth' : response.status === 403 ? 'origin' : 'http' });
      }
      return binary ? response.blob() : response.json();
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
  return {
    async status(signal) {
      const value = await call('status', { signal });
      if (value?.type !== 'linghuashi-local-tools' || value.protocol !== 1 || !Array.isArray(value.models)) {
        throw Object.assign(new Error('该地址不是兼容的灵画师本地组件'), { category: 'protocol' });
      }
      return value;
    },
    call,
    async run(body, { signal, progress = () => {} } = {}) {
      let task;
      try {
        task = await call('jobs', { method: 'POST', body, signal });
        if (!/^[a-f0-9]{32}$/.test(task?.id)) throw new Error('组件任务编号无效');
        const started = Date.now();
        while (true) {
          if (signal?.aborted) throw new Error('本地任务已取消');
          progress(task);
          if (task.status === 'completed') break;
          if (['failed', 'cancelled'].includes(task.status)) throw new Error(task.error || '本地任务已取消');
          if (!['queued', 'running'].includes(task.status)) throw new Error('组件任务状态无效');
          if (Date.now() - started > 15 * 60 * 1000) throw new Error('本地任务等待超时，请检查组件');
          await new Promise((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(new Error('本地任务已取消')); };
            const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 700);
            signal?.addEventListener('abort', abort, { once: true });
          });
          task = await call(`jobs/${task.id}`, { signal });
        }
        return body.kind === 'download' ? null
          : await call(`jobs/${task.id}/result`, { signal, binary: body.kind === 'upscale' });
      } finally {
        if (/^[a-f0-9]{32}$/.test(task?.id)) {
          await call(`jobs/${task.id}`, { method: 'DELETE' }).catch(() => {});
        }
      }
    },
  };
}
