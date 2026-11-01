import { advancedOf, validateAdvanced, applyNovelAIAdvanced } from './advanced-generation.js';
import { assetBase64 } from './reference-assets.js';
import { normalizeProcessing, buildProcessingRequest } from './novelai-processing.js';

async function imageCanvas(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close();
  return canvas;
}
async function png(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('图片编码失败');
  return blob;
}
export async function prepareCharacterReference(blob) {
  const image = await imageCanvas(blob), ratio = image.width / image.height;
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = ratio > 1.1 ? [1536, 1024] : ratio < 0.9 ? [1024, 1536] : [1472, 1472];
  const context = canvas.getContext('2d'), scale = Math.min(canvas.width / image.width, canvas.height / image.height);
  const width = image.width * scale, height = image.height * scale;
  context.fillStyle = '#000000'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  return png(canvas);
}
export async function transparentEditMask(maskBlob) {
  const canvas = await imageCanvas(maskBlob), context = canvas.getContext('2d');
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const selected = pixels.data[index] >= 128 && pixels.data[index + 3] >= 128;
    pixels.data[index] = 255; pixels.data[index + 1] = 255; pixels.data[index + 2] = 255;
    pixels.data[index + 3] = selected ? 0 : 255;
  }
  context.putImageData(pixels, 0, 0);
  return png(canvas);
}
export async function maskedComfySource(sourceBlob, maskBlob) {
  const canvas = await imageCanvas(sourceBlob), context = canvas.getContext('2d');
  const mask = await imageCanvas(maskBlob);
  if (canvas.width !== mask.width || canvas.height !== mask.height) throw new Error('底图和蒙版尺寸不一致');
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = mask.getContext('2d').getImageData(0, 0, mask.width, mask.height).data;
  for (let index = 0; index < image.data.length; index += 4) image.data[index + 3] = pixels[index] >= 128 ? 0 : 255;
  context.putImageData(image, 0, 0);
  return png(canvas);
}
export async function compositeUnmasked(resultBlob, sourceBlob, maskBlob) {
  const canvas = await imageCanvas(sourceBlob), context = canvas.getContext('2d');
  const generated = await imageCanvas(resultBlob), mask = await imageCanvas(maskBlob);
  const resized = document.createElement('canvas');
  resized.width = canvas.width; resized.height = canvas.height;
  resized.getContext('2d').drawImage(generated, 0, 0, canvas.width, canvas.height);
  const output = context.getImageData(0, 0, canvas.width, canvas.height);
  const next = resized.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const chosen = mask.getContext('2d').getImageData(0, 0, mask.width, mask.height).data;
  for (let index = 0; index < output.data.length; index += 4) {
    if (chosen[index] >= 128 && chosen[index + 3] >= 128) output.data.set(next.subarray(index, index + 4), index);
  }
  context.putImageData(output, 0, 0);
  return png(canvas);
}

export async function prepareAdvancedPayload(job, assets, fetcher = fetch) {
  const plan = job.plan;
  if (plan.snapshot.novelaiProcessing) {
    const processing = normalizeProcessing(plan.snapshot.novelaiProcessing);
    if (!processing) throw new Error('处理底图记录无效，请重新打开原图');
    const body = buildProcessingRequest(plan.snapshot).body;
    job.controller.signal.throwIfAborted();
    const blob = await assets.get(processing.source);
    job.controller.signal.throwIfAborted();
    const image = assetBase64(new Uint8Array(await blob.arrayBuffer()));
    if (processing.kind === 'enhance') body.parameters.image = image;
    else body.image = image;
    return body;
  }
  const advanced = validateAdvanced(plan.snapshot);
  if (advanced.mode === 'text') return plan.body;
  job.phase = 'preparing'; job.notify?.();
  const read = async (asset) => {
    job.controller.signal.throwIfAborted();
    const blob = await assets.get(asset);
    job.controller.signal.throwIfAborted();
    return blob;
  };
  if (plan.provider === 'novelai') return applyNovelAIAdvanced(plan.body, plan.snapshot,
    async (asset) => {
      let blob = await read(asset);
      if (advanced.mode === 'reference' && advanced.referenceKind === 'character') blob = await prepareCharacterReference(blob);
      return assetBase64(new Uint8Array(await blob.arrayBuffer()));
    });
  if (plan.provider === 'openai') {
    const form = new FormData();
    for (const [key, value] of Object.entries(plan.body)) {
      if (key === 'response_format' && /^gpt-image-/.test(plan.model)) continue;
      form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    const references = advanced.mode === 'reference' ? advanced.references : [advanced.source];
    for (const [index, asset] of references.entries()) {
      form.append(references.length > 1 ? 'image[]' : 'image', await read(asset), `reference-${index}.png`);
    }
    if (advanced.mode === 'inpaint') form.append('mask', await transparentEditMask(await read(advanced.mask)), 'mask.png');
    return form;
  }
  if (plan.provider === 'sdwebui') {
    const body = structuredClone(plan.body);
    const source = assetBase64(new Uint8Array(await (await read(advanced.source)).arrayBuffer()));
    if (advanced.mode === 'upscale') body.image = source;
    else {
      body.init_images = [source];
      if (advanced.mode === 'inpaint') body.mask = assetBase64(new Uint8Array(await (await read(advanced.mask)).arrayBuffer()));
    }
    return body;
  }
  const body = structuredClone(plan.body), config = plan.snapshot.config;
  let source = await read(advanced.source);
  if (advanced.mode === 'inpaint') source = await maskedComfySource(source, await read(advanced.mask));
  const upload = new FormData();
  upload.append('image', source, `linghuashi-${job.id}.png`);
  upload.append('type', 'input'); upload.append('overwrite', 'false');
  const response = await fetcher(`${plan.base}/upload/image`, { method: 'POST', body: upload, headers: plan.headers,
    signal: job.controller.signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error(`ComfyUI 参考图上传失败（HTTP ${response.status}）`);
  const uploaded = await response.json();
  if (typeof uploaded.name !== 'string' || !uploaded.name || uploaded.name.includes('..')
    || /[\\\r\n]/.test(uploaded.name) || uploaded.type && uploaded.type !== 'input') throw new Error('ComfyUI 返回的图片文件名无效');
  const subfolder = String(uploaded.subfolder || '');
  if (subfolder.split('/').includes('..') || /[\\\r\n]/.test(subfolder)) throw new Error('ComfyUI 返回的图片目录无效');
  const target = config.mapping.image;
  body.prompt[target.node].inputs[target.input] = [subfolder, uploaded.name].filter(Boolean).join('/');
  if (config.mapping.denoise) {
    const mapping = config.mapping.denoise;
    body.prompt[mapping.node].inputs[mapping.input] = advanced.strength;
  }
  return body;
}

export async function finishAdvancedImages(job, images, assets) {
  if (job.plan.snapshot.novelaiProcessing) return images;
  const advanced = advancedOf(job.plan.snapshot);
  if (advanced.mode !== 'inpaint' || !advanced.keepOutside) return images;
  const source = await assets.get(advanced.source), mask = await assets.get(advanced.mask);
  const result = [];
  for (const image of images) {
    job.controller.signal.throwIfAborted();
    result.push({ ...image, blob: await compositeUnmasked(image.blob, source, mask) });
  }
  return result;
}
