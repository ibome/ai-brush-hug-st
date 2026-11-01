import { assetReference, normalizeAdvanced, modelCapabilities } from './advanced-generation.js';
import { normalizeNovelAI } from './ui/novelai.js';
import { buildNovelAIRequest } from './generation.js';
import { normalizeEndpoint } from './ui/connection.js';

export const PROCESSING_KINDS = [['upscale', '高清放大'], ['enhance', '细节增强'], ['director', '导演工具']];
export const DIRECTOR_TOOLS = [['bg-removal', '去除背景'], ['lineart', '线稿'], ['sketch', '草稿'],
  ['colorize', '上色'], ['emotion', '修改表情'], ['declutter', '清理杂物']];
export const PROCESSING_EMOTIONS = [['neutral', '自然'], ['happy', '开心'], ['sad', '难过'], ['angry', '生气'],
  ['scared', '害怕'], ['surprised', '惊讶'], ['tired', '疲惫'], ['excited', '兴奋'], ['nervous', '紧张'],
  ['thinking', '思考'], ['confused', '困惑'], ['shy', '害羞'], ['disgusted', '嫌弃'], ['smug', '得意'],
  ['bored', '无聊'], ['laughing', '大笑'], ['irritated', '烦躁'], ['embarrassed', '窘迫'],
  ['worried', '担心'], ['love', '喜爱'], ['determined', '坚定'], ['hurt', '受伤'], ['playful', '俏皮']];
export const ENHANCE_PRESETS = [['light', '轻微', 0.2, 0], ['medium', '适中', 0.35, 0.1], ['strong', '明显', 0.5, 0.2]];
export const PROCESSING_MAX_PIXELS = 1536 * 2048;
const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const size = (value) => Number.isInteger(value) && value >= 64 && value <= 2048;
const member = (rows, value) => rows.some(([id]) => id === value);
const text = (value, limit = 12000) => typeof value === 'string' ? value.slice(0, limit) : '';

export function normalizeProcessing(value) {
  if (!value || !member(PROCESSING_KINDS, value.kind) || !size(value.width) || !size(value.height)
    || value.width * value.height > PROCESSING_MAX_PIXELS) return null;
  const source = assetReference(value.source);
  if (!source || source.width !== value.width || source.height !== value.height) return null;
  return { version: 1, kind: value.kind, source,
    width: value.width, height: value.height,
    inputWidth: finite(value.inputWidth, 1, 40000000) ? Math.round(value.inputWidth) : value.width,
    inputHeight: finite(value.inputHeight, 1, 40000000) ? Math.round(value.inputHeight) : value.height,
    tool: member(DIRECTOR_TOOLS, value.tool) ? value.tool : 'bg-removal',
    emotion: member(PROCESSING_EMOTIONS, value.emotion) ? value.emotion : 'neutral',
    defry: Number.isInteger(value.defry) && finite(value.defry, 0, 5) ? value.defry : 0,
    prompt: text(value.prompt), strength: finite(value.strength, 0, 1) ? value.strength : 0.2,
    noise: finite(value.noise, 0, 1) ? value.noise : 0, keepBubbles: value.keepBubbles === true,
    allowThirdParty: value.allowThirdParty === true,
    variant: text(value.variant, 120) };
}

export function processingTitle(value) {
  if (!value) return '';
  return value.kind === 'director' ? DIRECTOR_TOOLS.find(([id]) => id === value.tool)?.[1] || '导演工具'
    : PROCESSING_KINDS.find(([id]) => id === value.kind)?.[1] || '图片增强';
}

export function defaultProcessingSize(width, height) {
  const ratio = Math.min(1, 2048 / Math.max(width, height), Math.sqrt((PROCESSING_MAX_PIXELS - 2000) / (width * height)));
  let w = Math.max(64, Math.floor(width * ratio / 64) * 64), h = Math.max(64, Math.floor(height * ratio / 64) * 64);
  if (w * h > PROCESSING_MAX_PIXELS) h -= 64;
  return { width: w, height: h };
}

export function processingDraft(item, current) {
  const original = item.snapshot;
  const params = original?.params || original?.config?.params || {};
  const novelai = original?.provider === 'novelai' ? params : {
    ...current, artist: '', positive: params.positive || '', negative: params.negative || '',
  };
  return { kind: 'upscale', tool: 'bg-removal', emotion: 'neutral', defry: 0, prompt: '', strength: 0.2,
    noise: 0, keepBubbles: false, allowThirdParty: false, ...defaultProcessingSize(item.width, item.height),
    ...(original?.provider === 'novelai' && original.characterScene ? { characterScene: structuredClone(original.characterScene) } : {}),
    params: normalizeNovelAI({ ...novelai,
      model: modelCapabilities('novelai', novelai.model).image ? novelai.model : 'nai-diffusion-4-5-full',
      artist: novelai.artist || '', positive: novelai.positive || '', negative: novelai.negative || '',
      advanced: normalizeAdvanced(), nSamples: 1 }) };
}

export function validateProcessingDraft(draft, item) {
  if (!member(PROCESSING_KINDS, draft.kind)) throw new Error('请选择图片处理方式');
  const dimensions = draft.kind === 'upscale' ? item : draft;
  if (!size(dimensions.width) || !size(dimensions.height) || dimensions.width * dimensions.height > PROCESSING_MAX_PIXELS) {
    throw new Error('处理尺寸需为 64 至 2048 像素，且不超过 1536 × 2048 总像素；放大需先选用较小原图');
  }
  if (draft.kind !== 'upscale' && (draft.width % 64 || draft.height % 64)) throw new Error('处理宽高需为 64 的倍数');
  if (draft.kind === 'enhance') {
    if (!modelCapabilities('novelai', draft.params.model).image) throw new Error('此模型的细节增强尚未接入，请选择 NAI 3、4 或 4.5');
    if (![draft.strength, draft.noise].every((value) => finite(value, 0, 1))) throw new Error('增强强度和噪声需为 0 至 1');
    if (![draft.params.artist, draft.params.positive].some((value) => value?.trim())) throw new Error('请填写增强提示词');
  }
  if (draft.kind === 'director' && (!member(DIRECTOR_TOOLS, draft.tool)
    || !member(PROCESSING_EMOTIONS, draft.emotion) || !Number.isInteger(draft.defry) || !finite(draft.defry, 0, 5))) {
    throw new Error('导演工具参数无效');
  }
  return { width: dimensions.width, height: dimensions.height };
}

export function processingSnapshot(draft, asset, item) {
  const dimensions = validateProcessingDraft(draft, item);
  const processing = normalizeProcessing({ ...draft, ...dimensions, source: asset,
    inputWidth: item.width, inputHeight: item.height, variant: '' });
  if (!processing) throw new Error('处理底图尺寸不一致，请重新准备');
  const params = normalizeNovelAI({ ...draft.params, ...dimensions, nSamples: 1, advanced: normalizeAdvanced() });
  // Processing has its own operation and must never inherit an old inpaint mask or character injection.
  return { provider: 'novelai', params, novelaiProcessing: processing,
    ...(draft.kind === 'enhance' && draft.characterScene ? { characterScene: structuredClone(draft.characterScene) } : {}) };
}

export function buildProcessingRequest(snapshot) {
  const value = normalizeProcessing(snapshot.novelaiProcessing);
  if (!value || snapshot.provider !== 'novelai') throw new Error('图片处理记录无效，请重新打开原图');
  validateProcessingDraft({ ...value, params: snapshot.params }, value);
  if (value.kind === 'upscale') {
    return { path: '/ai/upscale', body: { model: 'nai-diffusion-5-curated', declared_blur_sigma: 0 } };
  }
  if (value.kind === 'director') {
    const body = { req_type: value.tool === 'declutter' && value.keepBubbles ? 'declutter-keep-bubbles' : value.tool,
      width: value.width, height: value.height };
    if (value.tool === 'colorize' || value.tool === 'emotion') {
      body.defry = value.defry;
      body.prompt = value.tool === 'emotion' ? `${value.emotion};;${value.prompt}` : value.prompt;
    }
    return { path: '/ai/augment-image', body };
  }
  const body = buildNovelAIRequest({ ...snapshot.params, width: value.width, height: value.height, nSamples: 1 },
    snapshot.characterScene?.characterPrompts);
  body.action = 'img2img';
  Object.assign(body.parameters, { strength: value.strength, noise: value.noise,
    extra_noise_seed: body.parameters.seed, add_original_image: false, sm: false, sm_dyn: false });
  return { path: '/ai/generate-image', body };
}

export function processingEndpoint(service, value) {
  if (!value || service.kind !== 'resolved') throw new Error('图片增强接口尚未识别');
  const endpoint = normalizeEndpoint(service.endpoint);
  const official = endpoint === 'https://image.novelai.net';
  if (!official && !value.allowThirdParty) throw new Error('第三方图片增强能力尚未验证，请先勾选尝试当前第三方接口');
  return endpoint;
}

export async function prepareProcessingSource(blob, dimensions) {
  if (!(blob instanceof Blob) || !blob.size || blob.size > 20 * 1024 * 1024) throw new Error('请选择 20 MB 以内的图片');
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width * bitmap.height > 40000000) throw new Error('原图超过 4000 万像素，请先缩小');
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width; canvas.height = dimensions.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png || png.size > 4 * 1024 * 1024) throw new Error('处理底图超过 4 MB，请缩小处理尺寸');
    return { blob: png, width: canvas.width, height: canvas.height };
  } finally { bitmap.close(); }
}

export function processingVariant(value, index, count, filename = '') {
  if (value?.kind === 'director' && value.tool === 'bg-removal') {
    const labels = [['masked', '蒙版抠图'], ['generated', '生成补全'], ['blend', '混合结果']];
    const named = labels.find(([name]) => new RegExp(`(?:^|[_/.-])${name}(?:[_/.-]|$)`, 'i').test(filename));
    if (named) return named[1];
    if (count === 3) return labels[index]?.[1] || `结果 ${index + 1}`;
  }
  return count > 1 ? `结果 ${index + 1}` : '';
}

