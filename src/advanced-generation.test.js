import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAdvanced, validateAdvanced, applyNovelAIAdvanced, parseVibeFile, exportVibeFile,
  vibeModelKey, modelCapabilities, encodeVibe } from './advanced-generation.js';
import { comfyTemplate, addComfyLora, removeComfyLora, comfyLoras, watchComfyProgress } from './comfy-advanced.js';

const asset = (suffix = 'a') => ({ id: suffix.repeat(64), location: 'server', name: 'fixture', width: 512, height: 512, mime: 'image/png' });
const base = () => ({ input: 'a quiet garden', model: 'nai-diffusion-4-5-full', action: 'generate',
  parameters: { seed: 42, width: 512, height: 512, sm: true, sm_dyn: true, reference_image_multiple: [],
    reference_strength_multiple: [], reference_image_multiple_cached: [] } });
const snapshot = (advanced, model = 'nai-diffusion-4-5-full') => ({ provider: 'novelai',
  params: { model, width: 512, height: 512, advanced } });
const vibe = () => ({ id: '88fe3a4a-29e0-4f67-bcab-100cad406186', name: 'watercolor', image: asset(),
  information: 0.8, strength: 0.7, encodings: { 'v4-5full': { asset: asset('b'), information: 0.8 } } });
test('advanced settings discard unsafe asset paths and excessive references without storing image data', () => {
  const normalized = normalizeAdvanced({ source: { ...asset(), id: '../../secret' }, strength: 30,
    references: Array.from({ length: 20 }, () => asset()), arbitrary: 'secret', vibes: [vibe(), vibe()] });
  assert.equal(normalized.source, null);
  assert.equal(normalized.strength, 1);
  assert.equal(normalized.references.length, 4);
  assert.equal(normalized.vibes.length, 1);
  assert.equal(JSON.stringify(normalized).includes('secret'), false);
});
test('text generation preserves existing body and does not load any reference', async () => {
  const request = base();
  const result = await applyNovelAIAdvanced(request, snapshot({ mode: 'text', source: asset() }),
    () => assert.fail('unexpected asset load'));
  assert.deepEqual(result, request);
});
test('image generation uses real source bytes and disables incompatible SMEA', async () => {
  const result = await applyNovelAIAdvanced(base(), snapshot({ mode: 'image', source: asset(), strength: 0.35 }), async () => 'source-data');
  assert.equal(result.action, 'img2img'); assert.equal(result.parameters.image, 'source-data');
  assert.equal(result.parameters.strength, 0.35); assert.equal(result.parameters.sm, false);
  assert.equal(result.model, 'nai-diffusion-4-5-full');
});
test('inpainting sends distinct image and mask with the correct inpainting model', async () => {
  const result = await applyNovelAIAdvanced(base(), snapshot({ mode: 'inpaint', source: asset(), mask: asset('b') }),
    async (ref) => ref.id.startsWith('b') ? 'mask-data' : 'source-data');
  assert.equal(result.action, 'infill'); assert.equal(result.model, 'nai-diffusion-4-5-full-inpainting');
  assert.equal(result.parameters.mask, 'mask-data'); assert.equal(result.parameters.image, 'source-data');
});
test('missing source, missing mask and mismatched dimensions fail before a paid request', () => {
  assert.throws(() => validateAdvanced(snapshot({ mode: 'image' })), /底图/);
  assert.throws(() => validateAdvanced(snapshot({ mode: 'inpaint', source: asset() })), /蒙版/);
  const value = snapshot({ mode: 'image', source: asset() }); value.params.width = 1024;
  assert.throws(() => validateAdvanced(value), /尺寸/);
});
test('Vibe encoding matches both model and extraction amount, never silently omits an enabled reference', () => {
  const entry = vibe(); entry.information = 0.5;
  assert.throws(() => validateAdvanced(snapshot({ mode: 'reference', vibes: [entry] })), /编码/);
  assert.throws(() => validateAdvanced(snapshot({ mode: 'reference', vibes: [vibe()] }, 'nai-diffusion-4-5-curated')), /编码/);
});
test('multiple Vibes normalize total strength and use frozen cached encodings', async () => {
  const second = { ...vibe(), id: '89fe3a4a-29e0-4f67-bcab-100cad406186' };
  const result = await applyNovelAIAdvanced(base(), snapshot({ mode: 'reference', vibes: [vibe(), second] }), async () => 'encoded');
  assert.deepEqual(result.parameters.reference_strength_multiple, [0.5, 0.5]);
  assert.equal(result.parameters.reference_image_multiple_cached.length, 2);
  assert.match(result.parameters.reference_image_multiple_cached[0].cache_secret_key, /^[a-f0-9-]{36}$/);
  assert.deepEqual(result.parameters.reference_information_extracted_multiple, [0.8, 0.8]);
});
test('NAI3 uses raw image references and does not require a V4 encoding', async () => {
  const request = base(); request.model = 'nai-diffusion-3';
  const entry = vibe(); entry.encodings = {};
  const result = await applyNovelAIAdvanced(request, snapshot({ mode: 'reference', vibes: [entry] }, request.model), async () => 'raw-image');
  assert.deepEqual(result.parameters.reference_image_multiple, ['raw-image']);
  assert.deepEqual(result.parameters.reference_information_extracted_multiple, [0.8]);
});
test('character reference and Vibe are mutually exclusive at request time', async () => {
  const result = await applyNovelAIAdvanced(base(), snapshot({ mode: 'reference', referenceKind: 'character',
    character: asset(), characterStyle: true, fidelity: 0.75, vibes: [vibe()] }), async () => 'character-image');
  assert.equal(result.parameters.director_reference_images_cached[0].data, 'character-image');
  assert.deepEqual(result.parameters.director_reference_secondary_strength_values, [0.25]);
  assert.equal(result.parameters.director_reference_descriptions[0].caption.base_caption, 'character&style');
  assert.equal(result.parameters.reference_image_multiple_cached.length, 0);
});
test('unsupported models and OpenAI NAI aliases do not imply advanced support', () => {
  assert.equal(modelCapabilities('novelai', 'nai-diffusion-5-full').vibe, false);
  assert.equal(modelCapabilities('novelai', 'nai-diffusion-4-full').character, false);
  assert.equal(modelCapabilities('openai', 'nai-diffusion-4-5-full', { openAIEditEnabled: true }).image, false);
  assert.equal(modelCapabilities('openai', 'custom-image', {}).image, false);
  assert.equal(vibeModelKey('unknown'), '');
});
test('official Vibe file round trip preserves encoding parameters and model grouping', () => {
  const entry = vibe(), encoding = Buffer.alloc(120, 25).toString('base64');
  const exported = exportVibeFile(entry, { 'v4-5full': encoding });
  const parsed = parseVibeFile(JSON.stringify(exported));
  assert.equal(parsed.encodings[0].data, encoding); assert.equal(parsed.encodings[0].information, 0.8);
  assert.equal(parsed.encodings[0].modelKey, 'v4-5full');
  assert.equal(parsed.strength, 0.7);
});
test('malformed and unsafe Vibe files are rejected', () => {
  assert.throws(() => parseVibeFile('{"identifier":"other"}'), /naiv4vibe/);
  assert.throws(() => parseVibeFile('{"__proto__":{}}'), /JSON/);
  assert.throws(() => parseVibeFile(JSON.stringify({ identifier: 'novelai-vibe-transfer', encodings: {} })), /编码/);
});
test('Vibe encoding is one explicit request and never retried on failure', async () => {
  let calls = 0;
  await assert.rejects(encodeVibe({ endpoint: 'https://fixture.test', key: 'fixture', image: 'data',
    model: 'nai-diffusion-4-5-full', fetcher: async () => { calls++; return new Response('', { status: 429 }); } }), /429/);
  assert.equal(calls, 1);
});
test('Vibe encoding validates binary response instead of accepting an error JSON', async () => {
  await assert.rejects(encodeVibe({ endpoint: 'https://fixture.test', key: 'fixture', fetcher: async () =>
    new Response(JSON.stringify({ error: 'x'.repeat(200) }), { headers: { 'content-type': 'application/json' } }) }), /有效/);
});
test('Vibe encoding explains HTTP failures without exposing remote response bodies', async () => {
  const messages = new Map([[401, /鉴权/], [403, /权限/], [404, /不支持/], [405, /不支持/],
    [429, /频率或额度/], [503, /服务暂时异常/]]);
  for (const [status, message] of messages) {
    let calls = 0;
    await assert.rejects(encodeVibe({ endpoint: 'https://fixture.test', key: 'fixture', fetcher: async () => {
      calls++;
      return new Response('private upstream response', { status });
    } }), (error) => {
      assert.match(error.message, message);
      assert.match(error.message, new RegExp(`HTTP ${status}`));
      assert.doesNotMatch(error.message, /private upstream response/);
      return true;
    });
    assert.equal(calls, 1);
  }
});
test('Vibe network failure and timeout identify the encoding operation without disclosing credentials', async () => {
  let calls = 0;
  await assert.rejects(encodeVibe({ endpoint: 'https://fixture.test', key: 'private-key', fetcher: async () => {
    calls++;
    throw new TypeError('private-key at https://fixture.test/private-path');
  } }), (error) => {
    assert.match(error.message, /Vibe 编码.*代理、跨域/);
    assert.doesNotMatch(error.message, /private-key|private-path/);
    return true;
  });
  assert.equal(calls, 1);
  const controller = new AbortController();
  controller.abort(new DOMException('fixture timeout', 'TimeoutError'));
  await assert.rejects(encodeVibe({ endpoint: 'https://fixture.test', key: 'fixture', signal: controller.signal,
    fetcher: async () => { throw controller.signal.reason; } }), /编码请求超时.*勿连续点击/);
});
test('Vibe response download failures are reported as encoding network failures', async () => {
  await assert.rejects(encodeVibe({ endpoint: 'https://fixture.test', key: 'fixture', fetcher: async () => ({
    ok: true, arrayBuffer: async () => { throw new TypeError('fixture truncated response'); },
  }) }), /编码请求未取得可读取响应/);
});
test('Comfy templates use native input and mask nodes', () => {
  assert.equal(comfyTemplate('text')['5'].class_type, 'EmptyLatentImage');
  assert.equal(comfyTemplate('image')['5'].class_type, 'VAEEncode');
  assert.deepEqual(comfyTemplate('inpaint')['5'].inputs.mask, ['8', 1]);
});
test('multiple LoRAs chain and remove without losing model or text encoder links', () => {
  const graph = comfyTemplate('image', 'model.safetensors'), original = structuredClone(graph);
  let result = addComfyLora(graph); result = addComfyLora(result);
  assert.equal(comfyLoras(result).length, 2); assert.deepEqual(graph, original);
  assert.deepEqual(result['4'].inputs.model, ['lh-lora-2', 0]);
  result = removeComfyLora(result, 'lh-lora-1');
  assert.deepEqual(result['lh-lora-2'].inputs.model, ['1', 0]);
  result = removeComfyLora(result, 'lh-lora-2');
  assert.deepEqual(result['4'].inputs.model, ['1', 0]); assert.deepEqual(result['2'].inputs.clip, ['1', 1]);
});
test('ambiguous Comfy sampling branches refuse automatic LoRA insertion', () => {
  const graph = comfyTemplate('text'); graph['9'] = structuredClone(graph['4']);
  assert.throws(() => addComfyLora(graph), /多采样/);
});
test('WebSocket authentication never puts bearer tokens in a URL', () => {
  let calls = 0;
  const close = watchComfyProgress({ plan: { provider: 'comfyui', headers: { Authorization: 'Bearer fixture' } } },
    class { constructor() { calls++; } });
  close(); assert.equal(calls, 0);
});
test('Comfy progress ignores another prompt and closes on completion', () => {
  let instance, changes = 0;
  class Socket { constructor(url) { this.url = url; instance = this; } close() { this.closed = true; } }
  const job = { plan: { provider: 'comfyui', base: 'https://comfy.test/prefix', headers: {}, body: { client_id: 'client' } },
    controller: new AbortController(), execution: { promptId: 'own' }, notify: () => changes++ };
  const close = watchComfyProgress(job, Socket);
  instance.onmessage({ data: JSON.stringify({ type: 'progress', data: { prompt_id: 'other', value: 2, max: 10 } }) });
  assert.equal(changes, 0);
  instance.onmessage({ data: JSON.stringify({ type: 'progress', data: { prompt_id: 'own', value: 4, max: 10, node: '4' } }) });
  assert.equal(job.progress.value, 4);
  instance.onmessage({ data: JSON.stringify({ type: 'progress', data: { value: 6, max: 10 } }) });
  assert.equal(job.progress.value, 4);
  instance.onmessage({ data: JSON.stringify({ type: 'executing', data: { prompt_id: 'own', node: '4' } }) });
  instance.onmessage({ data: JSON.stringify({ type: 'progress', data: { value: 6, max: 10 } }) });
  assert.equal(job.progress.value, 6);
  instance.onmessage({ data: JSON.stringify({ type: 'executing', data: { prompt_id: 'other', node: '4' } }) });
  instance.onmessage({ data: JSON.stringify({ type: 'progress', data: { value: 8, max: 10 } }) });
  assert.equal(job.progress.value, 6); close(); assert.equal(instance.closed, true);
  assert.equal(instance.url, 'wss://comfy.test/prefix/ws?clientId=client');
});
