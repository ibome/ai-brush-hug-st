import { randomUUID } from './crypto-compat.js';
const number = (value, fallback, min = 0, max = 1) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const base64OK = (value) => typeof value === 'string' && value.length > 0 && value.length <= 6 * 1024 * 1024 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
const ENCODING_KEY = 'b36a8472fe418d9f80d6bb1c54e3a6e62c62936aa7bf31dae2bcf7e929f6430f';
export const ADVANCED_MODES = [['text', '文生图'], ['reference', '参考生图'], ['image', '图生图'], ['inpaint', '局部重绘'], ['upscale', '图片放大']];
export function assetReference(value) {
  if (!record(value) || !/^[a-f0-9]{64}$/.test(value.id) || !['browser', 'server'].includes(value.location)) return null;
  return { id: value.id, location: value.location, name: String(value.name || '参考素材').slice(0, 120),
    mime: ['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'].includes(value.mime) ? value.mime : 'image/png',
    width: number(value.width, 0, 0, 4096), height: number(value.height, 0, 0, 4096) };
}
export function vibeModelKey(model) {
  const keys = {
    'nai-diffusion-4-5-full': 'v4-5full', 'nai-diffusion-4-5-curated': 'v4-5curated',
    'nai-diffusion-4-full': 'v4full', 'nai-diffusion-4-curated-preview': 'v4curated',
    'nai-diffusion-3': 'v3', 'nai-diffusion-furry-3': 'v3',
  };
  return keys[model] || '';
}
export function normalizeAdvanced(value = {}) {
  if (!record(value)) value = {};
  const ids = new Set();
  const vibes = (Array.isArray(value.vibes) ? value.vibes : []).slice(0, 8).flatMap((entry) => {
    if (!record(entry) || !/^[a-f0-9-]{36}$/.test(entry.id) || ids.has(entry.id)) return [];
    ids.add(entry.id);
    const encodings = {};
    for (const [key, encoding] of Object.entries(record(entry.encodings) ? entry.encodings : {}).slice(0, 24)) {
      if (!/^(?:v3|v4(?:-5)?(?:full|curated))$/.test(key) || !record(encoding)) continue;
      const asset = assetReference(encoding.asset);
      if (asset) encodings[key] = { asset, information: number(encoding.information, 1), fileKey: /^[a-f0-9]{64}$/.test(encoding.fileKey) ? encoding.fileKey : ENCODING_KEY };
    }
    return [{ id: entry.id, name: String(entry.name || '画风参考').slice(0, 80), enabled: entry.enabled !== false,
      image: assetReference(entry.image), information: number(entry.information, 1), strength: number(entry.strength, 0.6),
      encodings }];
  });
  const references = (Array.isArray(value.references) ? value.references : []).slice(0, 4).map(assetReference).filter(Boolean);
  return { version: 1, mode: ADVANCED_MODES.some(([mode]) => mode === value.mode) ? value.mode : 'text',
    source: assetReference(value.source), mask: assetReference(value.mask),
    strength: number(value.strength, 0.65), noise: number(value.noise, 0),
    keepOutside: value.keepOutside !== false, normalizeStrength: value.normalizeStrength !== false,
    referenceKind: value.referenceKind === 'character' ? 'character' : 'vibe', vibes, references,
    character: assetReference(value.character), characterStyle: value.characterStyle === true,
    fidelity: number(value.fidelity, 0.8), referenceStrength: number(value.referenceStrength, 1),
    openAIEditEnabled: value.openAIEditEnabled === true,
    editPath: typeof value.editPath === 'string' && /^\/[A-Za-z0-9_./-]+$/.test(value.editPath)
      && !value.editPath.startsWith('//') && !value.editPath.split('/').includes('..') ? value.editPath : '/images/edits' };
}
export function advancedOf(snapshot) {
  return normalizeAdvanced(snapshot.provider === 'comfyui' ? snapshot.config?.advanced : snapshot.params?.advanced);
}
export function setAdvanced(snapshot, value) {
  if (snapshot.provider === 'comfyui') snapshot.config.advanced = normalizeAdvanced(value);
  else snapshot.params.advanced = normalizeAdvanced(value);
  return snapshot;
}
export function modelCapabilities(provider, model, advanced = {}) {
  if (provider === 'novelai') return {
    image: /^nai-diffusion-(?:3|furry-3|4(?:-|$))/.test(model),
    inpaint: /^nai-diffusion-(?:3|furry-3|4(?:-|$))/.test(model),
    vibe: Boolean(vibeModelKey(model)), character: /^nai-diffusion-4-5-(full|curated)$/.test(model),
  };
  if (provider === 'comfyui') return { image: true, inpaint: true, vibe: false, character: false };
  if (provider === 'sdwebui') return { image: true, inpaint: true, upscale: true, vibe: false, character: false };
  return { image: advanced.openAIEditEnabled === true && !/nai-diffusion/i.test(model),
    inpaint: advanced.openAIEditEnabled === true && !/nai-diffusion/i.test(model), vibe: false, character: false };
}
export function validateAdvanced(snapshot) {
  const advanced = advancedOf(snapshot), params = snapshot.params || snapshot.config.params;
  const capabilities = modelCapabilities(snapshot.provider, params.model, advanced);
  if (advanced.mode === 'text') return advanced;
  if (['image', 'inpaint', 'upscale'].includes(advanced.mode)) {
    if (!capabilities[advanced.mode]) throw new Error('当前模型或接口尚未启用此图片编辑能力');
    if (!advanced.source?.width || !advanced.source.height) throw new Error('请先上传或选择底图');
    if (snapshot.provider === 'novelai' && (params.width !== advanced.source.width || params.height !== advanced.source.height)) {
      throw new Error('图生图与局部重绘尺寸需与底图一致，请使用底图尺寸');
    }
    if (advanced.mode === 'inpaint' && (!advanced.mask || advanced.mask.width !== advanced.source.width
      || advanced.mask.height !== advanced.source.height)) throw new Error('请绘制与底图同尺寸的蒙版');
    if (snapshot.provider === 'comfyui' && !snapshot.config.mapping.image) throw new Error('工作流没有映射图片输入，请选择图生图或局部重绘模板');
    if (snapshot.provider === 'comfyui' && advanced.mode === 'inpaint'
      && !Object.values(snapshot.config.graph).some((node) => node.class_type === 'VAEEncodeForInpaint' || Object.values(node.inputs).some((input) => Array.isArray(input) && input[1] === 1
        && snapshot.config.graph[input[0]]?.class_type === 'LoadImage'))) throw new Error('工作流没有蒙版输入，请使用局部重绘模板或补齐蒙版节点');
  } else if (snapshot.provider === 'novelai') {
    if (advanced.referenceKind === 'character') {
      if (!capabilities.character) throw new Error('人物参考仅开放给 NovelAI V4.5 模型');
      if (!advanced.character) throw new Error('请上传人物参考图');
    } else {
      if (!capabilities.vibe) throw new Error('此模型尚未开放 Vibe 参考');
      const enabled = advanced.vibes.filter((entry) => entry.enabled);
      if (!enabled.length) throw new Error('请添加并启用画风参考');
      const key = vibeModelKey(params.model);
      for (const entry of enabled) {
        if (key === 'v3' ? !entry.image : !entry.encodings[key] || entry.encodings[key].information !== entry.information) {
          throw new Error(`“${entry.name}”缺少当前模型与提取量的编码，请先点击编码`);
        }
      }
    }
  } else if (snapshot.provider === 'openai') {
    if (!capabilities.image) throw new Error('请先启用接口支持图片编辑，再使用参考图');
    if (!advanced.references.length) throw new Error('请上传至少一张参考图');
  } else throw new Error('ComfyUI 参考控制需使用对应工作流，请选择图生图并映射参考图');
  return advanced;
}

export function parseVibeFile(text) {
  if (typeof text !== 'string' || text.length > 24 * 1024 * 1024) throw new Error('Vibe 文件需小于 24 MB');
  let value;
  try {
    value = JSON.parse(text, (key, entry) => {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('文件字段无效');
      return entry;
    });
  } catch { throw new Error('Vibe 文件不是有效 JSON'); }
  if (value?.identifier !== 'novelai-vibe-transfer' || !record(value.encodings)) throw new Error('请选择 NovelAI 的 .naiv4vibe 文件');
  const encodings = [];
  for (const [modelKey, group] of Object.entries(value.encodings)) {
    if (!/^(?:v3|v4(?:-5)?(?:full|curated))$/.test(modelKey) || !record(group)) continue;
    for (const [fileKey, entry] of Object.entries(group)) {
      if (record(entry) && base64OK(entry.encoding)) encodings.push({ modelKey, fileKey,
        data: entry.encoding, information: number(entry.params?.information_extracted, 1) });
    }
  }
  if (!encodings.length || encodings.length > 24) throw new Error('文件没有可用编码，或编码数量超限');
  let image = typeof value.image === 'string' ? value.image.replace(/^data:image\/(?:png|jpeg|webp);base64,/, '') : '';
  if (!base64OK(image)) image = '';
  return { name: String(value.name || '导入的画风参考').slice(0, 80), image, encodings,
    strength: number(value.importInfo?.strength, 0.6) };
}
export function exportVibeFile(entry, data) {
  const encodings = {};
  for (const [key, encoding] of Object.entries(entry.encodings)) {
    if (!base64OK(data[key])) continue;
    encodings[key] = { [encoding.fileKey || ENCODING_KEY]: {
      encoding: data[key], params: { information_extracted: encoding.information },
    } };
  }
  if (!Object.keys(encodings).length) throw new Error('请先编码参考图再导出');
  return { identifier: 'novelai-vibe-transfer', version: 1, type: 'image', name: entry.name,
    image: data.image || '', thumbnail: '', id: entry.id, encodings, createdAt: Date.now(),
    importInfo: { strength: entry.strength, information_extracted: entry.information, model: Object.keys(encodings)[0] } };
}

export async function applyNovelAIAdvanced(body, snapshot, readBase64) {
  const advanced = validateAdvanced(snapshot);
  const result = structuredClone(body), parameters = result.parameters;
  if (['image', 'inpaint'].includes(advanced.mode)) {
    result.action = advanced.mode === 'inpaint' ? 'infill' : 'img2img';
    if (advanced.mode === 'inpaint') result.model += '-inpainting';
    parameters.image = await readBase64(advanced.source);
    parameters.strength = advanced.strength;
    parameters.noise = advanced.noise;
    parameters.extra_noise_seed = parameters.seed;
    parameters.add_original_image = false;
    parameters.sm = false; parameters.sm_dyn = false;
    if (advanced.mode === 'inpaint') {
      parameters.mask = await readBase64(advanced.mask);
      parameters.inpaintImg2ImgStrength = advanced.strength;
    }
  } else if (advanced.mode === 'reference') {
    if (advanced.referenceKind === 'character') {
      parameters.director_reference_images_cached = [{ cache_secret_key: randomUUID(), data: await readBase64(advanced.character) }];
      parameters.director_reference_descriptions = [{ caption: {
        base_caption: advanced.characterStyle ? 'character&style' : 'character', char_captions: [],
      }, use_coords: false, use_order: true }];
      parameters.director_reference_information_extracted = [1];
      parameters.director_reference_strength_values = [advanced.referenceStrength];
      parameters.director_reference_secondary_strength_values = [1 - advanced.fidelity];
    } else {
      const entries = advanced.vibes.filter((entry) => entry.enabled), key = vibeModelKey(result.model);
      const sum = entries.reduce((total, entry) => total + entry.strength, 0);
      const scale = advanced.normalizeStrength && sum > 1 ? 1 / sum : 1;
      parameters.normalize_reference_strength_multiple = advanced.normalizeStrength;
      parameters.reference_strength_multiple = entries.map((entry) => entry.strength * scale);
      parameters.reference_information_extracted_multiple = entries.map((entry) => entry.information);
      if (key === 'v3') {
        parameters.reference_image_multiple = await Promise.all(entries.map((entry) => readBase64(entry.image)));
        parameters.reference_information_extracted_multiple = entries.map((entry) => entry.information);
      } else parameters.reference_image_multiple_cached = await Promise.all(entries.map(async (entry) => ({
        cache_secret_key: randomUUID(), data: await readBase64(entry.encodings[key].asset),
      })));
    }
  }
  return result;
}

export async function encodeVibe({ endpoint, key, model, image, information = 1, signal, fetcher = fetch }) {
  try {
    const response = await fetcher(`${endpoint.replace(/\/+$/, '')}/ai/encode-vibe`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.trim()}` },
      body: JSON.stringify({ model, image, information_extracted: information }),
      credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal,
    });
    if (!response.ok) {
      const reason = [404, 405].includes(response.status)
        ? '此接口不支持 Vibe 编码，可导入已编码文件或切换接口'
        : response.status === 401 ? 'Vibe 编码鉴权未通过，请核对当前服务的秘钥'
          : response.status === 403 ? 'Vibe 编码被拒绝，请核对编码权限、出口 IP 或服务限制'
            : response.status === 429 ? 'Vibe 编码受到频率或额度限制，请核对余额并稍后重试'
              : response.status >= 500 ? 'Vibe 编码服务暂时异常，请稍后重试或联系服务提供方'
                : 'Vibe 编码被拒绝，请检查模型、权限与额度';
      throw new Error(`${reason}（HTTP ${response.status}）`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 100 || bytes.length > 4 * 1024 * 1024 || /json|text\/|html/i.test(response.headers.get('content-type') || '')) throw new Error('接口未返回有效的 Vibe 编码，请向服务提供方确认编码支持');
    return new Blob([bytes], { type: 'application/octet-stream' });
  } catch (error) {
    if (signal?.reason?.name === 'TimeoutError' || error?.name === 'TimeoutError') {
      throw new Error('Vibe 编码请求超时，请检查当前设备网络或稍后重试；服务可能已处理本次请求，请勿连续点击');
    }
    if (signal?.aborted || error?.name === 'AbortError') throw new Error('Vibe 编码请求已取消');
    if (error instanceof TypeError) throw new Error('Vibe 编码请求未取得可读取响应，请检查当前设备代理、跨域和编码接口支持；普通生图成功不代表编码接口可用');
    throw error;
  }
}
