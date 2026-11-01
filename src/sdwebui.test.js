import test from 'node:test';
import assert from 'node:assert/strict';
import { SDWEBUI_DEFAULTS, normalizeSDWebUI, sdwebuiBase, sdwebuiHeaders, probeSDWebUI,
  buildSDWebUIRequest, sdwebuiImages, loraPrompt, watchSDWebUIProgress } from './sdwebui.js';
import { normalizeAdvanced } from './advanced-generation.js';
import { normalizeConnections } from './connections.js';
import { TaskPersistence } from './task-persistence.js';
import { createTaskLedger, frozenPlan } from '../server/linghuashi-storage/task-ledger.mjs';
import { submitGeneration, downloadResults, wait } from './generation.js';
import { emphasisFormat } from './prompt-composer.js';

globalThis.window ||= { addEventListener() {} };
const { prepareAdvancedPayload } = await import('./advanced-payload.js');
const { normalizeSDWebUIState, loadSDWebUIPreset, saveSDWebUIPreset } = await import('./ui/sdwebui.js');
const { applyAssistantPlan, normalizeAssistant } = await import('./prompt-assistant.js');

const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0]);
const base64 = btoa(String.fromCharCode(...image));
const source = { id: 'a'.repeat(64), location: 'browser', width: 512, height: 512, mime: 'image/png' };
const mask = { ...source, id: 'b'.repeat(64) };
const snapshot = (params = {}) => ({ provider: 'sdwebui', params: normalizeSDWebUI({ positive: 'a cat', ...params }) });
const plan = (params = {}) => {
  const s = snapshot(params), request = buildSDWebUIRequest(s);
  return { provider: 'sdwebui', model: 'fixture', snapshot: s, body: request.body,
    base: 'https://sd.fixture/reverse', url: `https://sd.fixture/reverse${request.path}`, timeout: 20 };
};

test('SDWebUI roots preserve reverse proxy paths and reject credential-bearing addresses', () => {
  for (const tail of ['', '/', '/sdapi/v1', '/sdapi/v1/', '/sdapi/v1/txt2img/']) {
    assert.equal(sdwebuiBase(`https://sd.fixture/reverse${tail}`), 'https://sd.fixture/reverse');
  }
  assert.equal(sdwebuiBase('http://127.0.0.1:7860/'), 'http://127.0.0.1:7860');
  for (const address of ['https://a:b@sd.fixture', 'https://sd.fixture?key=private', 'file:///x', 'https://sd.fixture#x']) assert.throws(() => sdwebuiBase(address));
});
test('native Basic and optional Bearer credentials are constructed outside stored settings', () => {
  assert.deepEqual(sdwebuiHeaders({ auth: 'none' }, 'unused'), {});
  assert.equal(sdwebuiHeaders({ auth: 'basic', username: 'alice' }, 'fixture-password').Authorization,
    `Basic ${btoa('alice:fixture-password')}`);
  assert.equal(sdwebuiHeaders({ auth: 'bearer' }, 'token').Authorization, 'Bearer token');
  for (const connection of [{ auth: 'basic', username: '' }, { auth: 'basic', username: 'a:b' }, { auth: 'bearer' }]) {
    assert.throws(() => sdwebuiHeaders(connection, ''));
  }
});
test('native text body preserves negative, LoRA and temporary model overrides without settings writes', () => {
  const s = snapshot({ model: 'fixture.safetensors', artist: 'watercolor', positive: 'cat, <lora:fur:0.7>',
    negative: 'blurry', highres: true, hrScale: 2, hrSteps: 10, seed: 42, batch: 2 });
  const original = structuredClone(s), { path, body } = buildSDWebUIRequest(s);
  assert.equal(path, '/sdapi/v1/txt2img');
  assert.equal(body.prompt, 'watercolor, cat, <lora:fur:0.7>');
  assert.equal(body.negative_prompt, 'blurry'); assert.equal(body.batch_size, 2);
  assert.equal(body.override_settings.sd_model_checkpoint, 'fixture.safetensors');
  assert.equal(body.override_settings_restore_afterwards, true);
  assert.equal(body.enable_hr, true); assert.equal(body.hr_second_pass_steps, 10);
  assert.equal(body.save_images, false); assert.deepEqual(s, original);
});
test('image, inpaint and upscale bodies require prepared assets and retain white-mask polarity', async () => {
  const blobs = new Map([[source.id, new Blob([image])], [mask.id, new Blob([new Uint8Array([...image, 3])])]]);
  for (const mode of ['image', 'inpaint', 'upscale']) {
    const p = plan({ advanced: { mode, source, mask, strength: 0.55 } });
    const job = { id: crypto.randomUUID(), plan: p, controller: new AbortController() };
    const payload = await prepareAdvancedPayload(job, { get: (asset) => blobs.get(asset.id) });
    if (mode === 'upscale') {
      assert.equal(p.url.endsWith('/extra-single-image'), true);
      assert.equal(payload.image, base64); assert.equal(payload.upscaling_resize, 2);
      assert.equal(payload.gfpgan_visibility, 0);
    } else {
      assert.equal(p.url.endsWith('/img2img'), true);
      assert.deepEqual(payload.init_images, [base64]); assert.equal(payload.denoising_strength, 0.55);
      assert.equal(payload.include_init_images, false); assert.equal(payload.enable_hr, undefined);
      if (mode === 'inpaint') { assert.notEqual(payload.mask, payload.init_images[0]); assert.equal(payload.inpainting_mask_invert, 0); }
    }
    assert.equal(p.body.image, undefined); assert.equal(p.body.init_images, undefined);
  }
  assert.throws(() => plan({ advanced: { mode: 'image' } }), /底图/);
  assert.throws(() => plan({ advanced: { mode: 'inpaint', source } }), /蒙版/);
  assert.throws(() => plan({ highres: true, width: 4096, height: 4096 }), /4096/);
});
test('grid response is skipped while per-image seeds and actual model metadata are retained', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ images: [base64, base64, `data:image/png;base64,${base64}`],
    info: JSON.stringify({ index_of_first_image: 1, all_seeds: [42, 43], sd_model_name: 'actual-model' }) }));
  const result = sdwebuiImages(bytes);
  assert.equal(result.length, 2); assert.deepEqual(result.map((row) => row.seed), [42, 43]);
  assert.equal(result[0].model, 'actual-model');
  const images = await downloadResults({ plan: { provider: 'sdwebui' }, execution: { bytes }, controller: new AbortController() });
  assert.equal(images.length, 2); assert.equal(images[0].blob.type, 'image/png');
  for (const value of [{ images: [] }, { images: ['https://private/image'] }, { images: [base64], info: '{"index_of_first_image":1}' }]) {
    assert.throws(() => sdwebuiImages(new TextEncoder().encode(JSON.stringify(value))));
  }
});
test('dedicated upscale response supports the single image field without generation seed invention', () => {
  const result = sdwebuiImages(new TextEncoder().encode(JSON.stringify({ image: base64, html_info: '<b>done</b>' })));
  assert.equal(result.length, 1); assert.equal(result[0].seed, undefined);
});
test('service discovery tolerates absent optional endpoints and detects only advertised task-scoped progress', async () => {
  const seen = [];
  const document = { paths: { '/sdapi/v1/txt2img': { post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Text' } } } } } },
    '/internal/progress': { post: { requestBody: { content: { 'application/json': { schema: { properties: { id_task: {} } } } } } } } },
    components: { schemas: { Text: { properties: { force_task_id: {} } } } } };
  const result = await probeSDWebUI('https://sd.fixture/reverse/sdapi/v1/', { auth: 'basic', username: 'alice' }, 'pass', {
    fetcher: async (url, options) => {
      seen.push({ url, options });
      if (url.endsWith('/openapi.json')) return Response.json(document);
      if (url.endsWith('/sd-models')) return Response.json([{ title: 'SDXL [abc]' }, { title: 'SDXL [abc]' }]);
      if (url.endsWith('/samplers')) return Response.json([{ name: 'Euler' }]);
      return new Response('', { status: 404 });
    },
  });
  assert.deepEqual(result.models, ['SDXL [abc]']); assert.equal(result.textTaskId, true);
  assert.equal(result.imageTaskId, false); assert.equal(result.progressMode, 'internal'); assert.equal(result.unavailable.length, 5);
  assert.ok(seen.every((row) => row.url.startsWith('https://sd.fixture/reverse/') && row.options.headers.Authorization === `Basic ${btoa('alice:pass')}`));
});
test('discovery rejects failed mandatory endpoints and never treats an HTML login page as success', async () => {
  await assert.rejects(probeSDWebUI('https://sd.fixture', {}, '', { fetcher: async () => new Response('', { status: 401 }) }), /鉴权失败/);
  await assert.rejects(probeSDWebUI('https://sd.fixture', {}, '', { fetcher: async () => new Response('<html>login</html>') }));
});
test('preset save and reload preserve native settings and immutable credential references', () => {
  const state = { sdwebui: { positive: 'cat', model: 'SDXL' }, connections: { sdwebui: { endpoint: 'https://sd.fixture', auth: 'basic',
    username: 'alice', keyRef: `browser:${crypto.randomUUID()}` } } };
  normalizeSDWebUIState(state); normalizeConnections(state);
  const preset = saveSDWebUIPreset(state, 'SDXL 竖图');
  state.sdwebui.positive = 'changed';
  loadSDWebUIPreset(state, preset.id);
  assert.equal(state.sdwebui.positive, 'cat'); assert.equal(state.connections.sdwebui.username, 'alice');
  assert.ok(state.connections.sdwebui.keyRef);
  assert.throws(() => saveSDWebUIPreset(state, 'SDXL 竖图'), /同名/);
});
test('durable native task restores Basic auth from its secret reference and never persists password or headers', async () => {
  let saved;
  const ledger = createTaskLedger({ load: async () => saved, save: async (value) => { saved = structuredClone(value); },
    writeChunk: async () => {}, readChunk: async () => new Uint8Array(), removeResult: async () => {} });
  const persistence = new TaskPersistence({ request: (action, body) => ledger.dispatch(action, body),
    settings: () => ({ generationMode: 'queue', queueInterval: 0 }), readKey: async () => 'fixture-password' });
  const p = { ...plan(), auth: 'basic', username: 'alice', keyRef: `browser:${crypto.randomUUID()}`, sdTaskIdSupported: true, sdProgressMode: 'internal' };
  const row = await persistence.create(p), job = { ...row, controller: new AbortController() };
  await persistence.claim(job);
  assert.equal(job.plan.headers.Authorization, `Basic ${btoa('alice:fixture-password')}`);
  assert.doesNotMatch(JSON.stringify(saved), /fixture-password|Authorization|Basic /);
  assert.equal(frozenPlan(p).sdTaskIdSupported, true);
  job.status = 'cancelled'; await persistence.finish(job);
});
test('native submit assigns its own stable remote task ID and retains accepted bytes for recovery', async () => {
  const p = { ...plan(), sdTaskIdSupported: true, sdProgressMode: 'none' };
  const job = { id: crypto.randomUUID(), plan: p, controller: new AbortController() };
  let count = 0, body;
  const fetcher = async (url, options) => {
    count++; body = JSON.parse(options.body);
    return Response.json({ images: [base64], info: JSON.stringify({ seed: 42 }) });
  };
  await submitGeneration(job, fetcher); await submitGeneration(job, fetcher);
  assert.equal(count, 1); assert.equal(body.force_task_id, `task(linghuashi-${job.id})`);
  assert.equal(p.body.force_task_id, undefined); assert.ok(job.execution.bytes);
});
test('task-scoped progress ignores another task and unknown services never poll global progress', async () => {
  const p = { ...plan(), sdTaskIdSupported: true, sdProgressMode: 'native' };
  const job = { id: crypto.randomUUID(), plan: p, controller: new AbortController() };
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json({ progress: 0.7, current_task: calls === 1 ? 'another-task' : `task(linghuashi-${job.id})` }); };
  const stop = watchSDWebUIProgress(job, fetcher);
  await wait(1300); assert.equal(job.progress, undefined);
  await wait(1300); stop();
  assert.equal(job.progress?.value, 70); assert.equal(job.phase, 'generating');
  const count = calls;
  watchSDWebUIProgress({ ...job, plan: { ...p, sdTaskIdSupported: false } }, fetcher)();
  await wait(10); assert.equal(calls, count);
});
test('SDWebUI prompt assistant and visual editor use tags and native SD weights', () => {
  const s = snapshot({ seed: 42 });
  assert.equal(emphasisFormat({ provider: 'sdwebui' }), 'sd');
  const output = applyAssistantPlan(s, { positive: 'blue sky', negative: 'rain', characters: [], aspect: 'square' },
    { ...normalizeAssistant(), count: 2, aspect: 'square' });
  assert.equal(output.params.batch, 2); assert.equal(output.params.seed, 42); assert.equal(output.params.width, 1024);
  assert.ok(output.params.negative.includes('rain')); assert.deepEqual(s.params, normalizeSDWebUI({ positive: 'a cat', seed: 42 }));
  assert.equal(loraPrompt('detail', 0.7), '<lora:detail:0.7>');
  assert.throws(() => loraPrompt('x:1>, hidden', 1));
  assert.deepEqual(normalizeAdvanced().mode, 'text'); assert.equal(SDWEBUI_DEFAULTS.highres, false);
});
