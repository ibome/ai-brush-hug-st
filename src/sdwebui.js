import { normalizeAdvanced, validateAdvanced } from './advanced-generation.js';

export const SDWEBUI_DEFAULTS = Object.freeze({
  model: '', artist: '', positive: '', negative: 'low quality, blurry, watermark',
  width: 768, height: 1024, steps: 24, cfg: 7, seed: -1, batch: 1,
  sampler: 'Euler', scheduler: 'Automatic', vae: 'Automatic', clipSkip: 1,
  restoreFaces: false, tiling: false, highres: false, hrScale: 2, hrSteps: 0,
  hrDenoise: 0.4, hrUpscaler: 'Latent', upscaler: 'Lanczos', upscaleFactor: 2,
  maskBlur: 4, inpaintFill: 1, inpaintFullRes: true, inpaintPadding: 32,
});
export const SDWEBUI_LIMITS = Object.freeze({
  width: [64, 4096, 8], height: [64, 4096, 8], steps: [1, 150, 1], cfg: [0, 30, 0.1],
  seed: [-1, 4294967295, 1], batch: [1, 8, 1], clipSkip: [1, 12, 1],
  hrScale: [1, 4, 0.1], hrSteps: [0, 150, 1], hrDenoise: [0, 1, 0.01],
  upscaleFactor: [1, 4, 0.1], maskBlur: [0, 64, 1], inpaintFill: [0, 3, 1], inpaintPadding: [0, 256, 8],
});
export function normalizeSDWebUI(value = {}) {
  const result = { ...SDWEBUI_DEFAULTS };
  for (const [key, fallback] of Object.entries(result)) {
    if (typeof fallback === 'string') result[key] = typeof value[key] === 'string'
      ? value[key].slice(0, ['positive', 'negative'].includes(key) ? 12000 : key === 'artist' ? 4000 : 500) : fallback;
    else if (typeof fallback === 'boolean') result[key] = typeof value[key] === 'boolean' ? value[key] : fallback;
    else {
      const [min, max, step] = SDWEBUI_LIMITS[key], number = value[key] === '' || value[key] == null ? fallback : Number(value[key]);
      result[key] = Number.isFinite(number) ? Number((Math.round(Math.max(min, Math.min(max, number)) / step) * step).toFixed(2)) : fallback;
    }
  }
  result.advanced = normalizeAdvanced(value.advanced);
  return result;
}
export function sdwebuiBase(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error('请输入完整的 SDWebUI 服务地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('SDWebUI 地址需为 HTTP 或 HTTPS，不包含账号、查询参数或锚点');
  }
  return url.href.replace(/\/+$/, '').replace(/\/sdapi\/v1(?:\/[a-z0-9-]+)?$/i, '');
}
export function sdwebuiHeaders(connection, secret = '') {
  if (connection.auth === 'basic') {
    if (!connection.username?.trim() || /[:\r\n]/.test(connection.username) || !secret.trim()) throw new Error('请填写 SDWebUI 账号和密码');
    const bytes = new TextEncoder().encode(`${connection.username.trim()}:${secret.trim()}`);
    return { Authorization: `Basic ${btoa(String.fromCharCode(...bytes))}` };
  }
  if (connection.auth === 'bearer') {
    if (!secret.trim()) throw new Error('请填写 SDWebUI 访问令牌');
    return { Authorization: `Bearer ${secret.trim()}` };
  }
  return {};
}
function schemaOf(document, value) {
  if (!value?.$ref) return value || {};
  const key = value.$ref.split('/').at(-1);
  return document.components?.schemas?.[key] || {};
}
export async function probeSDWebUI(endpoint, connection, secret, { signal, fetcher = fetch } = {}) {
  const base = sdwebuiBase(endpoint), headers = sdwebuiHeaders(connection, secret);
  const get = async (path, optional = false) => {
    try {
      const response = await fetcher(`${base}${path}`, { headers, signal, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' });
      if (!response.ok) {
        if ([401, 403].includes(response.status)) throw new Error('SDWebUI 鉴权失败，请检查账号密码或访问令牌');
        if (optional) { await response.body?.cancel(); return null; }
        throw new Error(`SDWebUI 接口返回 HTTP ${response.status}，请检查地址和 --api 启动参数`);
      }
      const text = await response.text();
      if (text.length > 8 * 1024 * 1024) throw new Error('SDWebUI 列表响应过大');
      return JSON.parse(text);
    } catch (error) { if (signal?.aborted || !optional || /鉴权失败/.test(error.message)) throw error; return null; }
  };
  const paths = ['/sdapi/v1/sd-models', '/sdapi/v1/samplers', '/sdapi/v1/schedulers',
    '/sdapi/v1/sd-vae', '/sdapi/v1/upscalers', '/sdapi/v1/latent-upscale-modes', '/sdapi/v1/loras', '/openapi.json'];
  const results = await Promise.all(paths.map((path, index) => get(path, index > 1)));
  const list = (value, key) => [...new Set((Array.isArray(value) ? value : []).map((row) => row?.[key])
    .filter((name) => typeof name === 'string' && name && name.length <= 500))].slice(0, 5000);
  if (!Array.isArray(results[0]) || !Array.isArray(results[1])) throw new Error('此地址没有返回 SDWebUI 原生模型／采样器列表');
  const document = results[7] || {}, operation = (kind) => schemaOf(document,
    document.paths?.[`/sdapi/v1/${kind}`]?.post?.requestBody?.content?.['application/json']?.schema);
  const textTaskId = Boolean(operation('txt2img').properties?.force_task_id);
  const imageTaskId = Boolean(operation('img2img').properties?.force_task_id);
  const progress = schemaOf(document, document.paths?.['/sdapi/v1/progress']?.get?.responses?.['200']?.content?.['application/json']?.schema);
  const internal = schemaOf(document, document.paths?.['/internal/progress']?.post?.requestBody?.content?.['application/json']?.schema);
  return {
    models: list(results[0], 'title'), samplers: list(results[1], 'name'), schedulers: list(results[2], 'name'),
    vaes: list(results[3], 'model_name'), upscalers: list(results[4], 'name'), latentUpscalers: list(results[5], 'name'),
    loras: list(results[6], 'name'), unavailable: paths.slice(2, 7).filter((_, index) => results[index + 2] === null),
    textTaskId, imageTaskId, progressMode: internal.properties?.id_task ? 'internal' : progress.properties?.current_task ? 'native' : 'none',
  };
}
export function loraPrompt(name, weight = 1) {
  if (typeof name !== 'string' || !name.trim() || name.length > 500 || /[<>:,\r\n]/.test(name)
    || !Number.isFinite(weight) || weight < -2 || weight > 2) throw new Error('LoRA 名称或权重无效');
  return `<lora:${name.trim()}:${Number(weight.toFixed(2))}>`;
}
export function buildSDWebUIRequest(snapshot) {
  const p = snapshot.params, advanced = validateAdvanced(snapshot);
  if (advanced.mode === 'upscale') {
    if (!p.upscaler.trim()) throw new Error('请选择图片放大算法');
    if (advanced.source.width * p.upscaleFactor > 8192 || advanced.source.height * p.upscaleFactor > 8192) throw new Error('放大后的单边不能超过 8192 像素');
    return { path: '/sdapi/v1/extra-single-image', body: { resize_mode: 0, upscaling_resize: p.upscaleFactor,
      upscaler_1: p.upscaler, upscaler_2: 'None', extras_upscaler_2_visibility: 0,
      gfpgan_visibility: 0, codeformer_visibility: 0, show_extras_results: true } };
  }
  const prompt = [p.artist.trim(), p.positive.trim()].filter(Boolean).join(', ');
  if (!prompt) throw new Error('请填写生图提示词');
  if (p.width % 8 || p.height % 8) throw new Error('SDWebUI 宽高需为 8 的倍数');
  if (advanced.mode === 'text' && p.highres && (p.width * p.hrScale > 4096 || p.height * p.hrScale > 4096)) throw new Error('高清修复后的单边不能超过 4096 像素');
  const overrides = { CLIP_stop_at_last_layers: p.clipSkip };
  if (p.model.trim()) overrides.sd_model_checkpoint = p.model.trim();
  if (p.vae.trim()) overrides.sd_vae = p.vae.trim();
  const body = { prompt, negative_prompt: p.negative, width: p.width, height: p.height,
    steps: p.steps, cfg_scale: p.cfg, seed: p.seed, batch_size: p.batch, n_iter: 1,
    sampler_name: p.sampler, ...(p.scheduler && p.scheduler !== 'Automatic' ? { scheduler: p.scheduler } : {}),
    restore_faces: p.restoreFaces, tiling: p.tiling, override_settings: overrides, override_settings_restore_afterwards: true,
    send_images: true, save_images: false, do_not_save_grid: true };
  if (advanced.mode === 'text') {
    body.enable_hr = p.highres;
    if (p.highres) Object.assign(body, { hr_scale: p.hrScale, hr_upscaler: p.hrUpscaler,
      hr_second_pass_steps: p.hrSteps, denoising_strength: p.hrDenoise });
  } else {
    Object.assign(body, { denoising_strength: advanced.strength, include_init_images: false, resize_mode: 0 });
    if (advanced.mode === 'inpaint') Object.assign(body, { mask_blur: p.maskBlur, inpainting_fill: p.inpaintFill,
      inpaint_full_res: p.inpaintFullRes, inpaint_full_res_padding: p.inpaintPadding, inpainting_mask_invert: 0 });
  }
  return { path: advanced.mode === 'text' ? '/sdapi/v1/txt2img' : '/sdapi/v1/img2img', body };
}
export function sdwebuiImages(bytes) {
  let response;
  try { response = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('SDWebUI 未返回图片 JSON'); }
  const images = Array.isArray(response.images) ? response.images : typeof response.image === 'string' ? [response.image] : [];
  let info = {};
  try { info = typeof response.info === 'string' ? JSON.parse(response.info) : response.info || {}; } catch { /* Infotext may be plain text on older forks. */ }
  const offset = Number.isInteger(info.index_of_first_image) && info.index_of_first_image >= 0 ? info.index_of_first_image : 0;
  if (!images.length || images.length > 33 || offset >= images.length) throw new Error('SDWebUI 没有返回可用图片或图片数量超限');
  const result = images.slice(offset);
  if (result.length > 32) throw new Error('SDWebUI 返回图片数量超限');
  return result.map((image, index) => {
    if (typeof image !== 'string') throw new Error('SDWebUI 图片数据无效');
    const data = image.replace(/^data:image\/(?:png|jpeg|webp);base64,/, '');
    if (!data || data.length > 28 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('SDWebUI 图片 Base64 无效或过大');
    return { base64: data, seed: info.all_seeds?.[index] ?? (result.length === 1 ? info.seed : undefined),
      model: typeof info.sd_model_name === 'string' ? info.sd_model_name.slice(0, 500) : undefined };
  });
}

// Shared WebUI interrupt endpoints cannot atomically target one caller's task.
export function watchSDWebUIProgress(job, fetcher = fetch) {
  const plan = job.plan;
  if (plan.provider !== 'sdwebui' || !plan.sdTaskIdSupported || plan.sdProgressMode === 'none') return () => {};
  let stopped = false, timer, pending;
  const id = `task(linghuashi-${job.id})`;
  const poll = async () => {
    if (stopped || job.controller.signal.aborted) return;
    pending = new AbortController();
    const abort = () => pending?.abort();
    job.controller.signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 4000);
    try {
      const internal = plan.sdProgressMode === 'internal';
      const response = await fetcher(`${plan.base}${internal ? '/internal/progress' : '/sdapi/v1/progress?skip_current_image=true'}`, {
        method: internal ? 'POST' : 'GET', headers: { ...plan.headers, ...(internal ? { 'Content-Type': 'application/json' } : {}) },
        ...(internal ? { body: JSON.stringify({ id_task: id, id_live_preview: -1, live_preview: false }) } : {}),
        signal: pending.signal, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
      });
      if (!response.ok) { stopped = true; return; }
      const value = await response.json();
      const owned = internal ? value.active === true && (value.id_task === undefined || value.id_task === id) : value.current_task === id;
      if (!stopped && !job.controller.signal.aborted && owned && Number.isFinite(value.progress) && value.progress >= 0 && value.progress <= 1) {
        job.phase = 'generating';
        job.progress = { value: value.progress * 100, max: 100, node: 'SDWebUI' };
        job.notify?.();
      }
    } catch { /* A progress endpoint failure must not duplicate or fail the generation request. */ }
    finally {
      clearTimeout(timeout); job.controller.signal.removeEventListener('abort', abort);
      if (!stopped && !job.controller.signal.aborted) timer = setTimeout(poll, 1200);
    }
  };
  timer = setTimeout(poll, 1200);
  return () => { stopped = true; clearTimeout(timer); pending?.abort(); };
}
