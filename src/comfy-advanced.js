const copy = (value) => structuredClone(value);
export const COMFY_TEMPLATES = [
  ['text', '基础文生图'], ['image', '基础图生图'], ['inpaint', '基础局部重绘'],
];
export function comfyTemplate(mode, checkpoint = '') {
  const graph = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: 'a beautiful landscape', clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: 'low quality, blurry', clip: ['1', 1] } },
    '4': { class_type: 'KSampler', inputs: { seed: -1, steps: 20, cfg: 7, sampler_name: 'euler',
      scheduler: 'normal', denoise: mode === 'text' ? 1 : 0.65, model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['5', 0] } },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['4', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'Linghuashi' } },
  };
  if (mode === 'text') graph['5'] = { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } };
  else {
    graph['8'] = { class_type: 'LoadImage', inputs: { image: 'reference.png' } };
    graph['5'] = { class_type: mode === 'inpaint' ? 'VAEEncodeForInpaint' : 'VAEEncode',
      inputs: { pixels: ['8', 0], vae: ['1', 2], ...(mode === 'inpaint' ? { mask: ['8', 1], grow_mask_by: 6 } : {}) } };
  }
  return graph;
}
export function comfyLoras(graph) {
  return Object.entries(graph).filter(([, node]) => ['LoraLoader', 'LoraLoaderModelOnly'].includes(node.class_type))
    .map(([id, node]) => ({ id, name: node.inputs.lora_name || '', model: node.inputs.strength_model ?? 1,
      clip: node.inputs.strength_clip ?? 1, modelOnly: node.class_type === 'LoraLoaderModelOnly' }));
}
export function addComfyLora(graph) {
  const result = copy(graph);
  const samplers = Object.values(result).filter((node) => ['KSampler', 'KSamplerAdvanced'].includes(node.class_type));
  if (samplers.length !== 1) throw new Error('多采样分支请在 ComfyUI 中添加 LoRA 后重新导入');
  if (comfyLoras(result).length >= 8) throw new Error('最多管理 8 个 LoRA 节点');
  const sampler = samplers[0], positive = result[sampler.inputs.positive?.[0]], negative = result[sampler.inputs.negative?.[0]];
  const clip = positive?.inputs.clip;
  if (!Array.isArray(sampler.inputs.model) || !Array.isArray(clip)
    || JSON.stringify(clip) !== JSON.stringify(negative?.inputs.clip)) throw new Error('此工作流的模型或 CLIP 分支需要手动添加 LoRA');
  let index = 1;
  while (Object.hasOwn(result, `lh-lora-${index}`)) index++;
  const id = `lh-lora-${index}`;
  result[id] = { class_type: 'LoraLoader', _meta: { title: `LoRA ${index}` },
    inputs: { model: copy(sampler.inputs.model), clip: copy(clip), lora_name: '', strength_model: 1, strength_clip: 1 } };
  sampler.inputs.model = [id, 0]; positive.inputs.clip = [id, 1]; negative.inputs.clip = [id, 1];
  return result;
}
export function removeComfyLora(graph, id) {
  const result = copy(graph), node = result[id];
  if (!node || !['LoraLoader', 'LoraLoaderModelOnly'].includes(node.class_type)) throw new Error('LoRA 节点不存在');
  for (const [otherId, other] of Object.entries(result)) {
    if (otherId === id) continue;
    for (const [key, link] of Object.entries(other.inputs)) {
      if (Array.isArray(link) && link[0] === id) {
        const upstream = link[1] === 0 ? node.inputs.model : node.inputs.clip;
        if (!Array.isArray(upstream)) throw new Error('此节点无法自动重接，请在 ComfyUI 中调整');
        other.inputs[key] = copy(upstream);
      }
    }
  }
  delete result[id];
  return result;
}
export function watchComfyProgress(job, WebSocketClass = globalThis.WebSocket) {
  if (job.plan.provider !== 'comfyui' || !WebSocketClass || job.plan.headers?.Authorization) return () => {};
  const url = new URL(`${job.plan.base}/ws`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('clientId', job.plan.body.client_id);
  let socket, activePrompt = '';
  const close = () => { try { socket?.close(); } catch {} };
  try {
    socket = new WebSocketClass(url.href);
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string' || event.data.length > 65536) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      const data = message.data;
      if (!data) return;
      if (message.type === 'executing') activePrompt = String(data.prompt_id || '');
      const expected = job.execution?.promptId;
      if (!expected || (data.prompt_id || activePrompt) !== expected) return;
      if (message.type === 'progress' && Number.isFinite(data.value) && Number.isFinite(data.max) && data.max > 0) {
        job.progress = { value: data.value, max: data.max, node: String(data.node || '') };
        job.notify?.();
      } else if (message.type === 'executing' && data.node) {
        job.progress = { value: 0, max: 0, node: String(data.node) }; job.notify?.();
      }
    };
    socket.onerror = close;
    job.controller.signal.addEventListener('abort', close, { once: true });
  } catch { close(); }
  return () => { job.controller.signal.removeEventListener('abort', close); close(); };
}
