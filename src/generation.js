import { randomUUID } from './crypto-compat.js';
import { rememberGenerationFailure } from './debug-errors.js';
import JSZip from 'jszip';
import { sdwebuiImages, watchSDWebUIProgress } from './sdwebui.js';
import { canRecoverGeneration, INVALID_IMAGE_RESPONSE } from './generation-recovery.js';

const MAX_IMAGE = 20 * 1024 * 1024;
const MAX_RESPONSE = 200 * 1024 * 1024;
const ACTIVE = new Set(['queued', 'running']);
const abortError = () => new DOMException('任务已取消', 'AbortError');

export class GenerationError extends Error {
  constructor(message, { status = 0, cooldown = 0, code = '' } = {}) {
    super(message);
    this.name = 'GenerationError';
    this.status = status;
    this.cooldown = cooldown;
    this.code = code;
  }
}

const invalidImageResponse = (message) => new GenerationError(
  `接口未返回可用图片：${message}。请检查接口地址和返回格式，修正后重新生成`,
  { code: INVALID_IMAGE_RESPONSE },
);

export function imageType(bytes) {
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  throw new GenerationError('服务返回的文件不是 PNG、JPG 或 WebP 图片');
}

export async function readLimited(response, limit = MAX_RESPONSE) {
  const declared = Number(response.headers.get('content-length'));
  if (declared > limit) throw new GenerationError('服务响应过大，请减少生成张数或图片尺寸');
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new GenerationError('服务响应过大，请减少生成张数或图片尺寸');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason || abortError()); return; }
    const cancel = () => { clearTimeout(timer); reject(signal.reason || abortError()); };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancel);
      resolve();
    }, ms);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

function statusError(response, processing = false) {
  const messages = {
    400: '生图参数被服务拒绝，请检查模型、尺寸和工作流',
    401: '秘钥未通过鉴权，请重新填写',
    402: '接口余额或 Anlas 不足，请检查账户额度',
    403: '当前秘钥没有生图权限',
    404: '生图接口或模型不存在，请检查接口路径',
    413: '请求过大，请减少工作流或提示词长度',
    422: '生图参数格式不被服务支持，请检查模型、采样器和其他参数',
    429: '请求频率或额度受限，请等待后重试',
  };
  if (processing) Object.assign(messages, {
    400: '图片处理参数被接口拒绝，请检查处理尺寸、模型和接口支持范围',
    403: '当前秘钥没有此图片处理权限',
    404: '此接口未提供对应图片处理功能，请改用支持此能力的 NovelAI 接口',
  });
  const retry = response.headers.get('retry-after');
  const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? (Date.parse(retry) - Date.now()) / 1000 : 30;
  return new GenerationError(messages[response.status] || `生图服务返回 HTTP ${response.status}`, {
    status: response.status,
    cooldown: response.status === 429 ? Math.min(3600, Math.max(1, seconds || 30)) * 1000 : 0,
  });
}

async function request(job, url, options, fetcher) {
  const response = await fetcher(url, {
    credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store',
    signal: job.controller.signal, ...options,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw statusError(response, Boolean(job.plan.snapshot?.novelaiProcessing));
  }
  return response;
}

async function jsonResponse(response) {
  try { return JSON.parse(new TextDecoder().decode(await readLimited(response))); }
  catch (error) {
    if (error instanceof GenerationError) throw error;
    throw new GenerationError('服务未返回有效 JSON，不能确认生成结果');
  }
}

export function buildNovelAIRequest(params, characterPrompts = []) {
  const input = [params.artist.trim(), params.positive.trim()].filter(Boolean).join(', ');
  if (!input) throw new GenerationError('请填写生图提示词');
  const v3 = /^(nai-diffusion-3|nai-diffusion-furry-3)$/.test(params.model);
  const parameters = {
    params_version: /nai-diffusion-5/.test(params.model) ? 4 : 3,
    width: params.width, height: params.height, steps: params.steps,
    scale: params.scale, seed: params.seed, sampler: params.sampler,
    n_samples: params.nSamples, negative_prompt: params.negative,
    ucPreset: Number(params.ucPreset), qualityToggle: params.qualityTags,
    cfg_rescale: params.cfgRescale, noise_schedule: params.noiseSchedule,
    dynamic_thresholding: false, legacy: false, legacy_uc: false,
    add_original_image: true, controlnet_strength: 1,
    reference_image_multiple: [], reference_information_extracted_multiple: [],
    reference_strength_multiple: [],
  };
  if (v3) Object.assign(parameters, { sm: params.sm, sm_dyn: params.smDyn });
  else {
    const characters = characterPrompts.slice(0, 6);
    const coords = characters.some((entry) => entry.position !== 'auto');
    const center = (entry) => {
      const x = /left/.test(entry.position) ? 0.2 : /right/.test(entry.position) ? 0.8 : 0.5;
      const y = /top/.test(entry.position) ? 0.2 : /bottom/.test(entry.position) ? 0.8 : 0.5;
      return { x, y };
    };
    parameters.v4_prompt = {
      caption: { base_caption: input, char_captions: characters.map((entry) => ({
        char_caption: entry.positive, centers: [center(entry)],
      })) }, use_coords: coords, use_order: true,
    };
    parameters.v4_negative_prompt = {
      caption: { base_caption: params.negative, char_captions: characters.map((entry) => ({
        char_caption: entry.negative, centers: [center(entry)],
      })) }, legacy_uc: false,
    };
    parameters.characterPrompts = characters.map((entry) => ({
      prompt: entry.positive, uc: entry.negative, center: center(entry), enabled: true,
    }));
    parameters.reference_image_multiple_cached = [];
    parameters.use_coords = coords;
    if (params.variety) parameters.skip_cfg_above_sigma = 19 * Math.sqrt(params.width * params.height / (832 * 1216));
  }
  if (params.sampler === 'k_euler_ancestral') {
    parameters.deliberate_euler_ancestral_bug = false;
    parameters.prefer_brownian = true;
  }
  return { input, model: params.model, action: 'generate', parameters };
}

export async function submitGeneration(job, fetcher = fetch) {
  if (job.execution) return;
  job.failurePhase = 'preparing';
  const plan = job.plan;
  let payload = job.preparePayload ? await job.preparePayload() : plan.body;
  if (plan.provider === 'sdwebui' && plan.sdTaskIdSupported) payload = { ...payload, force_task_id: `task(linghuashi-${job.id})` };
  job.controller.signal.throwIfAborted();
  job.failurePhase = 'task-state';
  await job.checkpoint?.({ stage: 'submitting' });
  job.controller.signal.throwIfAborted();
  const multipart = typeof FormData !== 'undefined' && payload instanceof FormData;
  const stopProgress = watchSDWebUIProgress(job, fetcher);
  let response;
  try {
    job.failurePhase = 'submitting';
    response = await request(job, plan.url, {
      method: 'POST', headers: { ...(!multipart ? { 'Content-Type': 'application/json' } : {}), ...plan.headers },
      body: multipart ? payload : JSON.stringify(payload),
    }, fetcher);
  } finally { stopProgress(); }
  job.failurePhase = 'retrieving';
  if (plan.provider === 'comfyui') {
    const body = await jsonResponse(response);
    if (typeof body.prompt_id !== 'string' || !body.prompt_id
      || body.node_errors && Object.keys(body.node_errors).length) {
      throw new GenerationError('工作流未被完整接受，请检查节点和参数');
    }
    job.execution = { promptId: body.prompt_id };
  } else {
    // Retain the accepted response for a download/storage retry without another billable POST.
    job.execution = { bytes: await readLimited(response) };
  }
  job.failurePhase = 'response-cache';
  await job.persistExecution?.();
}

async function comfyResults(job, fetcher) {
  const plan = job.plan;
  if (!job.execution.outputs) {
    for (;;) {
      job.controller.signal.throwIfAborted();
      const response = await request(job, `${plan.base}/history/${encodeURIComponent(job.execution.promptId)}`,
        { headers: plan.headers }, fetcher);
      const history = await jsonResponse(response);
      const item = history[job.execution.promptId];
      if (item?.status?.status_str === 'error'
        || item?.status?.messages?.some(([type]) => type === 'execution_error' || type === 'execution_interrupted')) {
        throw new GenerationError('ComfyUI 工作流执行失败或被中断，请检查服务日志和节点参数');
      }
      if (item?.status?.completed === true || item?.outputs && !item?.status) {
        const outputs = plan.outputNode ? [item.outputs?.[plan.outputNode]] : Object.values(item.outputs || {});
        const files = outputs.flatMap((output) => output?.images || [])
          .filter((image) => typeof image.filename === 'string' && image.filename
            && (image.type === undefined || image.type === 'output' || image.type === 'temp'));
        if (!files.length) throw new GenerationError('工作流已完成，但所选输出节点没有图片');
        if (files.length > 32) throw new GenerationError('工作流返回图片过多，请选择一个输出节点');
        job.execution.outputs = files.map((image) => ({
          url: `${plan.base}/view?${new URLSearchParams({
            filename: image.filename, subfolder: image.subfolder || '', type: image.type || 'output',
          })}`,
          authenticated: true,
        }));
        break;
      }
      await wait(1200, job.controller.signal);
    }
  }
  return job.execution.outputs;
}

function jsonImages(body) {
  if (Array.isArray(body?.images) && body.images.length && body.images.length <= 32) {
    return body.images.map((item) => {
      if (typeof item?.image !== 'string' || !item.image) throw new GenerationError('NovelAI 图片响应缺少 image');
      return { base64: item.image, seed: item.seed };
    });
  }
  if (!Array.isArray(body?.data) || !body.data.length || body.data.length > 32) {
    throw new GenerationError('接口没有返回可用图片；不支持异步任务式图片响应');
  }
  return body.data.map((item) => {
    if (typeof item.b64_json === 'string' && item.b64_json) return { base64: item.b64_json, seed: item.seed };
    if (typeof item.url === 'string' && item.url) return { url: item.url, seed: item.seed };
    throw new GenerationError('图片响应缺少 b64_json 或 url');
  });
}

export async function imageDescriptors(bytes) {
  if (bytes[0] === 80 && bytes[1] === 75) {
    const zip = await JSZip.loadAsync(bytes);
    const files = Object.values(zip.files).filter((file) => !file.dir && /\.(png|jpe?g|webp)$/i.test(file.name));
    if (!files.length || files.length > 32) throw new GenerationError('NovelAI ZIP 中没有图片或图片数量超限');
    let total = 0;
    const descriptors = [];
    for (const file of files) {
      // JSZip exposes the declared expansion size before decompressing a member.
      const size = file._data?.uncompressedSize;
      if (!Number.isFinite(size) || size > MAX_IMAGE || (total += size) > MAX_RESPONSE) {
        throw new GenerationError('NovelAI ZIP 解压后的图片过大');
      }
      const data = await file.async('uint8array');
      imageType(data);
      descriptors.push({ bytes: data, filename: file.name.split('/').at(-1).slice(0, 160) });
    }
    return descriptors;
  }
  try { return [{ bytes, type: imageType(bytes) }]; } catch {}
  let body;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new GenerationError('服务返回的内容不是图片、ZIP 或图片 JSON'); }
  return jsonImages(body);
}

export async function downloadResults(job, fetcher = fetch) {
  if (job.images) return job.images;
  let descriptors;
  if (job.plan.provider === 'comfyui') descriptors = await comfyResults(job, fetcher);
  else {
    try {
      descriptors = job.plan.provider === 'sdwebui' ? sdwebuiImages(job.execution.bytes) : await imageDescriptors(job.execution.bytes);
    } catch (error) {
      throw invalidImageResponse(error instanceof GenerationError ? error.message : '图片响应格式无效');
    }
  }
  job.phase = 'downloading';
  job.notify?.();
  const images = [];
  let total = 0;
  for (const descriptor of descriptors) {
    job.controller.signal.throwIfAborted();
    let bytes = descriptor.bytes;
    if (descriptor.base64) {
      descriptor.base64 = descriptor.base64.replace(/^data:image\/(?:png|jpeg|webp);base64,/, '');
      if (descriptor.base64.length > MAX_IMAGE * 1.4) throw invalidImageResponse('单张图片超过 20 MB');
      try { bytes = Uint8Array.from(atob(descriptor.base64), (char) => char.charCodeAt(0)); }
      catch { throw invalidImageResponse('图片 Base64 内容无效'); }
    } else if (descriptor.url) {
      let url;
      try { url = new URL(descriptor.url); } catch { throw invalidImageResponse('服务返回的图片地址无效'); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
        throw invalidImageResponse('服务返回的图片地址不可使用');
      }
      // Signed/CDN image URLs never receive the API key.
      const response = await request(job, url.href, {
        headers: descriptor.authenticated ? job.plan.headers : {},
      }, fetcher);
      bytes = await readLimited(response, MAX_IMAGE);
    }
    if (!bytes?.length || bytes.length > MAX_IMAGE || (total += bytes.length) > MAX_RESPONSE) {
      throw new GenerationError('生成图片为空或超过存储大小限制');
    }
    let type;
    try { type = imageType(bytes); }
    catch (error) {
      if (descriptor.url) throw error;
      throw invalidImageResponse(error.message);
    }
    images.push({ blob: new Blob([bytes], { type }), seed: descriptor.seed, model: descriptor.model,
      ...(descriptor.filename ? { filename: descriptor.filename } : {}) });
  }
  job.images = images;
  return images;
}

export async function cancelComfyPending(job, fetcher = fetch) {
  if (job.plan.provider !== 'comfyui' || !job.execution?.promptId) return;
  // Delete only this queued prompt. The global /interrupt endpoint could stop another user's task.
  const signal = AbortSignal.timeout(5000);
  await fetcher(`${job.plan.base}/queue`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...job.plan.headers },
    body: JSON.stringify({ delete: [job.execution.promptId] }),
    credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal,
  }).catch(() => {});
}

export class GenerationQueue {
  constructor({ settings, run, changed = () => {}, cancel = () => {}, persistence }) {
    this.settings = settings;
    this.run = run;
    this.changed = changed;
    this.cancelRemote = cancel;
    this.persistence = persistence;
    this.jobs = [];
    this.running = 0;
    this.nextStart = 0;
    this.timer = null;
    this.pausedBatches = new Set();
  }

  add(plan, options = {}) {
    if (this.jobs.filter((job) => ACTIVE.has(job.status)).length >= 32) {
      throw new GenerationError('最多保留 32 个等待或运行任务');
    }
    this.jobs = this.jobs.filter((job, index) => ACTIVE.has(job.status) || index >= this.jobs.length - 49);
    const job = {
      id: options.id || randomUUID(), plan, status: 'queued', phase: 'waiting',
      createdAt: Date.now(), attempts: 0, stage: 'waiting', controller: new AbortController(),
    };
    job.notify = () => this.changed();
    this.jobs.push(job);
    this.changed();
    if (!options.defer) this.pump();
    return job;
  }

  restore(rows) {
    let changed = false;
    for (const row of rows) {
      const existing = this.jobs.find((job) => job.id === row.id);
      if (existing && !existing.remote && (existing.executing || ['queued', 'running'].includes(existing.status))) continue;
      const value = { ...row, plan: structuredClone(row.plan), execution: row.execution || (existing?.execution?.bytes ? existing.execution : undefined),
        remote: row.status === 'running' };
      if (existing && Object.entries(value).every(([key, next]) =>
        existing[key] === next || JSON.stringify(existing[key]) === JSON.stringify(next))) continue;
      value.controller = new AbortController();
      value.notify = () => this.changed();
      if (existing) Object.assign(existing, value);
      else this.jobs.push(value);
      changed = true;
    }
    const ids = new Set(rows.map((row) => row.id));
    const previousLength = this.jobs.length;
    this.jobs = this.jobs.filter((job) => ids.has(job.id) || (!job.remote && ACTIVE.has(job.status)));
    changed ||= previousLength !== this.jobs.length;
    if (changed) this.changed();
    return changed;
  }

  cancel(id) {
    const job = this.jobs.find((item) => item.id === id);
    if (!job || (!ACTIVE.has(job.status) && !['paused', 'uncertain', 'failed'].includes(job.status)) || job.phase === 'saving') return;
    if (this.persistence) {
      void this.persistence.cancel(id).then(() => {
        if (job.remote) job.error = '已请求取消，等待执行页面结束';
        this.changed();
      }).catch(() => { job.error = '取消状态未能保存，请刷新记录后重试'; this.changed(); });
    }
    if (job.remote) return;
    job.status = 'cancelled';
    job.finishedAt = Date.now();
    job.controller.abort(abortError());
    this.cancelRemote(job);
    this.changed();
    this.pump();
  }

  cancelAll() {
    for (const job of this.jobs) if (ACTIVE.has(job.status)) this.cancel(job.id);
  }

  retry(id) {
    const job = this.jobs.find((item) => item.id === id);
    if (!job || !canRecoverGeneration(job)) return;
    job.status = 'queued'; job.phase = 'waiting'; job.error = '';
    job.controller = new AbortController();
    this.changed(); this.pump();
  }

  pauseBatch(id) {
    this.pausedBatches.add(id);
    for (const job of this.jobs) if (job.plan.snapshot?.experiment?.id === id && job.status === 'queued') {
      job.status = 'paused'; job.phase = 'waiting'; job.error = '';
    }
    this.changed();
  }

  resumeBatch(id) {
    const paused = this.jobs.filter((job) => job.plan.snapshot?.experiment?.id === id && job.status === 'paused' && job.stage === 'waiting' && !job.execution);
    if (paused.length + this.jobs.filter((job) => ACTIVE.has(job.status)).length > 32) throw new GenerationError('继续后超过 32 个等待或运行任务');
    this.pausedBatches.delete(id);
    for (const job of paused) { job.status = 'queued'; job.controller = new AbortController(); job.error = ''; }
    this.changed(); this.pump();
  }

  pump() {
    clearTimeout(this.timer);
    const settings = this.settings();
    if (settings.enabled === false) return;
    const limit = settings.generationMode === 'parallel' ? settings.concurrency : 1;
    if (this.running >= limit || !this.jobs.some((job) => job.status === 'queued')) return;
    const delay = this.nextStart - Date.now();
    if (delay > 0) { this.timer = setTimeout(() => this.pump(), delay); return; }
    while (this.running < limit) {
      const job = this.jobs.find((item) => item.status === 'queued');
      if (!job) break;
      this.execute(job);
    }
  }

  async execute(job) {
    job.executing = true;
    this.running++;
    job.status = 'running'; job.phase = job.execution ? 'retrieving' : 'submitting';
    job.startedAt = Date.now(); job.attempts++;
    this.changed();
    let timeout;
    let failure;
    let busy = false;
    const startTimeout = () => setTimeout(() => job.controller.abort(new GenerationError(
      job.execution ? '取图超时，可尝试继续取图' : '请求超时，服务可能仍在生成，请先检查服务任务记录',
    )), job.plan.timeout * 1000);
    try {
      if (this.persistence) {
        job.failurePhase = 'task-state';
        const claim = await this.persistence.claim(job);
        if (claim.busy) {
          busy = true; job.status = this.pausedBatches.has(job.plan.snapshot?.experiment?.id) ? 'paused' : 'queued';
          job.phase = 'waiting'; return;
        }
        timeout = startTimeout();
        job.failurePhase = 'response-cache';
        await this.persistence.hydrate(job);
      } else timeout = startTimeout();
      await this.run(job);
      job.controller.signal.throwIfAborted();
      job.status = 'completed'; job.phase = 'done';
    } catch (error) {
      failure = job.controller.signal.aborted ? job.controller.signal.reason : error;
      if (job.status !== 'cancelled') {
        job.status = 'failed';
        const reason = failure;
        job.diagnostic = rememberGenerationFailure(reason, job, reason instanceof GenerationError);
        job.error = job.diagnostic.message;
        job.httpStatus = reason?.status || 0;
        if (reason?.cooldown) this.nextStart = Math.max(this.nextStart, Date.now() + reason.cooldown);
      }
    } finally {
      clearTimeout(timeout);
      if (this.persistence && job.durable) {
        try { await this.persistence.finish(job, failure); }
        catch (error) {
          rememberGenerationFailure(error, { ...job, failurePhase: 'task-state' });
          clearInterval(job.heartbeat);
          delete job.durable;
          job.error = job.saved ? '图片已保存，任务状态待同步，请刷新记录' : '任务状态待同步，请刷新记录后核对';
          if (job.status !== 'completed') job.status = job.execution ? 'paused' : 'uncertain';
        }
      }
      this.running--;
      job.executing = false;
      job.finishedAt = Date.now();
      if (job.status === 'completed' || job.status === 'cancelled') {
        delete job.images; delete job.execution; delete job.rows;
        delete job.plan.headers; delete job.plan.body; delete job.plan.identity;
      }
      if (this.settings().generationMode === 'queue') {
        this.nextStart = Math.max(this.nextStart, Date.now() + this.settings().queueInterval * 1000);
      }
      this.changed();
      if (busy) this.timer = setTimeout(() => this.pump(), 1200);
      else this.pump();
    }
  }

  records() {
    return this.jobs.map((job) => ({
      id: job.id, provider: job.plan.provider, model: job.plan.model,
      status: job.status, phase: job.phase, attempts: job.attempts,
      createdAt: job.createdAt, duration: job.finishedAt && job.startedAt ? job.finishedAt - job.startedAt : null,
      images: job.imageCount || 0, error: job.error || '',
      httpStatus: job.httpStatus || 0,
    }));
  }
}
