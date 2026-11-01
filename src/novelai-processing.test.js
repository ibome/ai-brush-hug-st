import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
globalThis.window ||= { addEventListener() {} };
const { PROCESSING_MAX_PIXELS, processingDraft, defaultProcessingSize, validateProcessingDraft, processingSnapshot,
  normalizeProcessing, buildProcessingRequest, processingEndpoint, processingVariant } = await import('./novelai-processing.js');
const { prepareAdvancedPayload, finishAdvancedImages } = await import('./advanced-payload.js');
const { normalizeSnapshot } = await import('./ui/drawings.js');
const { imageEditDraft, prepareImageEdit } = await import('./image-edit.js');
const { referencedAssets, rewriteBackupAssets } = await import('./backup-config.js');
import { submitGeneration, downloadResults } from './generation.js';
import { createTaskLedger, frozenPlan } from '../server/linghuashi-storage/task-ledger.mjs';
import { insertVersion, editRelation } from '../server/linghuashi-storage/image-versions.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRXYAAAAASUVORK5CYII=', 'base64');
const item = { id: 'original', width: 832, height: 1216, snapshot: { provider: 'novelai',
  params: { model: 'nai-diffusion-4-5-full', positive: '1girl, garden', artist: 'artist:test', negative: 'blurry',
    seed: 17, advanced: { mode: 'inpaint', keepOutside: true } } } };
const asset = { id: 'a'.repeat(64), location: 'server', width: 832, height: 1216, mime: 'image/png' };
const snapshot = (kind = 'upscale', extra = {}) => {
  const draft = { ...processingDraft(item, {}), kind, ...extra };
  return processingSnapshot(draft, asset, item);
};
const service = (endpoint = 'https://image.novelai.net') => ({ kind: 'resolved', endpoint });
const job = (current = snapshot()) => ({ plan: { provider: 'novelai', snapshot: current,
  ...buildProcessingRequest(current), url: 'https://fixture.test/ai/upscale', headers: {} }, controller: new AbortController() });

test('standalone upscaler uses the current official model and sigma schema without legacy scale or dimensions', () => {
  assert.deepEqual(buildProcessingRequest(snapshot()), { path: '/ai/upscale',
    body: { model: 'nai-diffusion-5-curated', declared_blur_sigma: 0 } });
});

test('enhance is image-to-image with independent strength/noise and no inherited inpaint or references', () => {
  const current = snapshot('enhance', { strength: 0.35, noise: 0.1 });
  const request = buildProcessingRequest(current), p = request.body.parameters;
  assert.equal(request.path, '/ai/generate-image'); assert.equal(request.body.action, 'img2img');
  assert.equal(p.strength, 0.35); assert.equal(p.noise, 0.1); assert.equal(p.extra_noise_seed, 17);
  assert.equal(p.add_original_image, false); assert.equal(p.n_samples, 1);
  assert.equal(p.sm, false); assert.equal(p.mask, undefined);
  assert.equal(current.params.advanced.mode, 'text');
});

test('director requests use official tool IDs, emotion delimiter, reversed defry intensity and optional fields only', () => {
  assert.deepEqual(buildProcessingRequest(snapshot('director')).body, { req_type: 'bg-removal', width: 832, height: 1216 });
  const color = buildProcessingRequest(snapshot('director', { tool: 'colorize', defry: 3, prompt: 'red hair' })).body;
  assert.equal(color.prompt, 'red hair'); assert.equal(color.defry, 3);
  const emotion = buildProcessingRequest(snapshot('director', { tool: 'emotion', emotion: 'happy', defry: 0, prompt: 'fang' })).body;
  assert.equal(emotion.prompt, 'happy;;fang'); assert.equal(emotion.defry, 0);
  assert.equal(buildProcessingRequest(snapshot('director', { tool: 'declutter', keepBubbles: true })).body.req_type, 'declutter-keep-bubbles');
});

test('drafts preserve source prompts and roles, clear old masks, and give imported images empty prompts', () => {
  const row = { ...item, snapshot: { ...item.snapshot, characterScene: { characterPrompts: [{ id: 'role', name: 'role', positive: 'red hair', negative: '', position: 'auto' }] } } };
  const draft = processingDraft(row, {});
  assert.equal(draft.params.positive, '1girl, garden'); assert.equal(draft.params.advanced.mode, 'text');
  const next = processingSnapshot({ ...draft, kind: 'enhance' }, asset, row);
  assert.equal(buildProcessingRequest(next).body.parameters.v4_prompt.caption.char_captions[0].char_caption, 'red hair');
  assert.equal(processingDraft({ ...item, snapshot: null }, { positive: 'unrelated', artist: 'unrelated' }).params.positive, '');
  assert.equal(processingDraft({ ...item, snapshot: { provider: 'novelai', partial: true, params: { seed: 10 } } }, {}).params.positive, '');
});

test('processing bounds and generation model support fail before any provider call', () => {
  for (const dimensions of [[63, 1216], [2048, 2048], [3000, 3000]]) {
    assert.throws(() => validateProcessingDraft(processingDraft(item, {}), { ...item, width: dimensions[0], height: dimensions[1] }), /尺寸/);
  }
  assert.throws(() => validateProcessingDraft({ ...processingDraft(item, {}), kind: 'enhance', width: 833 }, item), /64 的倍数/);
  assert.throws(() => buildProcessingRequest({ ...snapshot('enhance'), params: { ...snapshot().params, model: 'nai-diffusion-5-full' } }), /尚未接入/);
  assert.throws(() => validateProcessingDraft({ ...processingDraft(item, {}), kind: 'director', defry: -1 }, item), /参数无效/);
  assert.throws(() => validateProcessingDraft({ ...processingDraft(item, {}), kind: 'enhance', strength: 1.1 }, item), /0 至 1/);
  for (const dimensions of [[12000, 9000], [400, 800], [64, 9000]]) {
    const value = defaultProcessingSize(...dimensions);
    assert.ok(value.width * value.height <= PROCESSING_MAX_PIXELS);
    assert.equal(value.width % 64, 0); assert.equal(value.height % 64, 0);
  }
});

test('third-party tools require explicit opt-in and official host checks cannot be spoofed', () => {
  assert.equal(processingEndpoint(service(), snapshot().novelaiProcessing), 'https://image.novelai.net');
  assert.throws(() => processingEndpoint(service('https://image.novelai.net.evil.test'), snapshot().novelaiProcessing), /尚未验证/);
  assert.equal(processingEndpoint(service('https://third.test/novelai/'), { allowThirdParty: true }), 'https://third.test/novelai');
  assert.throws(() => processingEndpoint(service('https://user:pass@third.test'), { allowThirdParty: true }), /不能包含/);
});

test('normalized image metadata keeps only validated processing data and normal redraw strips the operation', () => {
  const current = snapshot('enhance');
  current.novelaiProcessing.secret = 'should-be-dropped';
  current.novelaiProcessing.source.data = 'must-not-survive';
  const clean = normalizeSnapshot(current);
  assert.equal(clean.novelaiProcessing.strength, 0.2);
  assert.equal(clean.novelaiProcessing.secret, undefined); assert.equal(clean.novelaiProcessing.source.data, undefined);
  assert.equal(imageEditDraft(clean).novelaiProcessing, undefined);
  assert.equal(prepareImageEdit(clean).novelaiProcessing, undefined);
  assert.equal(normalizeProcessing({ ...clean.novelaiProcessing, width: 64 }), null);
  assert.equal(normalizeSnapshot({ ...clean, novelaiProcessing: { kind: 'other' } }).novelaiProcessing, undefined);
});

test('PNG source bytes are injected transiently and missing or cancelled assets prevent submission', async () => {
  const current = job(snapshot('enhance')), assets = { get: async () => new Blob([png], { type: 'image/png' }) };
  const body = await prepareAdvancedPayload(current, assets);
  assert.equal(body.parameters.image, png.toString('base64'));
  assert.equal(current.plan.body.parameters.image, undefined);
  assert.equal(JSON.stringify(current.plan).includes(png.toString('base64')), false);
  current.preparePayload = () => prepareAdvancedPayload(current, { get: async () => { throw new Error('missing image'); } });
  await assert.rejects(submitGeneration(current, () => assert.fail('must not POST')), /missing image/);
  current.controller.abort();
  await assert.rejects(prepareAdvancedPayload(current, assets), { name: 'AbortError' });
});

test('processing bypasses old mask compositing and preserves all named background-removal outputs', async () => {
  const zip = new JSZip();
  for (const label of ['masked', 'generated', 'blend']) zip.file(`image_${label}.png`, png);
  const current = job(snapshot('director'));
  let posts = 0;
  await submitGeneration(current, async () => { posts++; return new Response(await zip.generateAsync({ type: 'uint8array' })); });
  await submitGeneration(current, () => assert.fail('must not resubmit accepted result'));
  const results = await finishAdvancedImages(current, await downloadResults(current), { get: () => assert.fail('no mask') });
  assert.equal(results.length, 3); assert.equal(posts, 1);
  assert.deepEqual(results.map((result, index) => processingVariant(current.plan.snapshot.novelaiProcessing, index, results.length, result.filename)), ['蒙版抠图', '生成补全', '混合结果']);
  assert.equal(processingVariant(current.plan.snapshot.novelaiProcessing, 0, 1), '');
});

test('official JSON image response is supported alongside ZIP and raw image without credentials in errors', async () => {
  const current = job();
  await submitGeneration(current, async () => Response.json({ images: [{ image: png.toString('base64'), index: 0, seed: 50 }] }));
  assert.equal((await downloadResults(current))[0].seed, 50);
  const unsupported = job();
  await assert.rejects(submitGeneration(unsupported, async () => new Response('provider-secret', { status: 404 })), /未提供对应图片处理功能/);
});

test('processing source follows reference backup migration and frozen task metadata contains no image payload', async () => {
  const current = snapshot('director'), p = { ...job(current).plan, storageLocation: 'server' };
  assert.equal(referencedAssets({ images: [{ snapshot: current }] })[0].id, asset.id);
  assert.equal(rewriteBackupAssets(current, new Map([[asset.id, 'browser']])).novelaiProcessing.source.location, 'browser');
  const frozen = frozenPlan(p);
  assert.equal(frozen.snapshot.novelaiProcessing.kind, 'director');
  assert.equal(frozen.body.image, undefined);
  let stored;
  const ledger = createTaskLedger({ load: async () => stored, save: async (value) => { stored = structuredClone(value); } });
  await ledger.dispatch('task/create', { id: crypto.randomUUID(), plan: p });
  const fresh = createTaskLedger({ load: async () => stored, save: async () => {} });
  const row = (await fresh.dispatch('task/list', {})).rows[0];
  assert.equal(row.plan.snapshot.novelaiProcessing.source.id, asset.id); assert.equal(row.status, 'paused');
});

test('multi-output versions preserve original and share its group with distinct version numbers', () => {
  const original = { ...item, createdAt: 1, versionCurrent: true };
  let rows = [original];
  for (let index = 0; index < 3; index++) rows = insertVersion(rows, {
    id: `result-${index}`, createdAt: 2, version: { ...editRelation(original, '去除背景'), number: 2 + index } });
  assert.equal(rows.length, 4); assert.equal(rows[0].snapshot, original.snapshot);
  assert.deepEqual(rows.slice(1).map((row) => row.version.number), [2, 3, 4]);
  assert.ok(rows.slice(1).every((row) => row.version.parentId === original.id));
});
