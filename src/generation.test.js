import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  GenerationQueue, GenerationError, submitGeneration, downloadResults,
  buildNovelAIRequest, imageDescriptors, readLimited, cancelComfyPending, wait,
} from './generation.js';
import { canRecoverGeneration, INVALID_IMAGE_RESPONSE } from './generation-recovery.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRXYAAAAASUVORK5CYII=', 'base64');
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', ...headers },
});
const job = (provider = 'openai') => ({
  controller: new AbortController(),
  plan: {
    provider, url: 'https://api.example/v1/images/generations', base: 'https://comfy.example',
    headers: { Authorization: 'Bearer test-secret' }, body: { model: 'test', prompt: 'lake' },
  },
});
const eventually = async (check) => {
  for (let i = 0; i < 100; i++) { if (check()) return; await wait(5); }
  assert.fail('Expected state was not reached');
};
const plan = () => ({ provider: 'openai', model: 'test', headers: { Authorization: 'test-secret' }, body: {}, timeout: 5 });

test('unchanged task polling preserves jobs and emits only real additions, progress and removals', () => {
  let changes = 0;
  const queue = new GenerationQueue({ settings: () => ({}), run: async () => {}, changed: () => changes++ });
  const row = { id:'remote', status:'running', phase:'generating', savedIds:[], plan:plan(), createdAt:1 };
  assert.equal(queue.restore([row]), true);
  const current = queue.jobs[0], controller = current.controller;
  for (let index = 0; index < 5; index++) assert.equal(queue.restore([structuredClone(row)]), false);
  assert.equal(changes, 1);
  assert.equal(queue.jobs[0], current);
  assert.equal(current.controller, controller);
  const completed = { ...row, status:'completed', savedIds:['image'], phase:'done' };
  assert.equal(queue.restore([completed]), true);
  assert.equal(current.status, 'completed');
  assert.deepEqual(current.savedIds, ['image']);
  assert.equal(changes, 2);
  assert.equal(queue.restore([structuredClone(completed)]), false);
  assert.equal(queue.restore([]), true);
  assert.equal(changes, 3);
  assert.equal(queue.jobs.length, 0);
});

test('polling cannot overwrite an active locally owned task or discard retained result bytes', () => {
  let changes = 0;
  const queue = new GenerationQueue({ settings: () => ({}), run: async () => {}, changed: () => changes++ });
  const local = queue.add(plan(), { id:'local', defer:true });
  assert.equal(queue.restore([{ id:'local', plan:plan(), status:'paused' }]), false);
  assert.equal(local.status, 'queued');
  assert.equal(queue.restore([]), false);
  const bytes = new Uint8Array([1, 2, 3]);
  local.status = 'failed'; local.execution = { bytes };
  queue.restore([{ id:'local', plan:plan(), status:'failed' }]);
  const count = changes;
  assert.equal(queue.restore([{ id:'local', plan:plan(), status:'failed' }]), false);
  assert.equal(local.execution.bytes, bytes);
  assert.equal(changes, count);
});

test('missing advanced assets fail before submission marker and provider request', async () => {
  const current = job();
  let checkpoints = 0, calls = 0;
  current.preparePayload = async () => { throw new Error('missing asset'); };
  current.checkpoint = async () => checkpoints++;
  await assert.rejects(submitGeneration(current, async () => { calls++; return json({}); }), /missing asset/);
  assert.equal(calls, 0); assert.equal(checkpoints, 0); assert.equal(current.execution, undefined);
});

test('cancellation during reference preparation never marks or submits a paid request', async () => {
  const current = job();
  let checkpoints = 0, calls = 0;
  current.preparePayload = async () => { current.controller.abort(); return {}; };
  current.checkpoint = async () => checkpoints++;
  await assert.rejects(submitGeneration(current, async () => { calls++; return json({}); }), { name: 'AbortError' });
  assert.equal(calls, 0); assert.equal(checkpoints, 0);
});

test('prepared OpenAI edit multipart retains automatic boundary and accepted recovery skips preparation', async () => {
  const current = job(), form = new FormData();
  form.append('model', 'gpt-image-1'); form.append('image', new Blob([png], { type: 'image/png' }), 'source.png');
  let preparations = 0, calls = 0;
  current.preparePayload = async () => { preparations++; return form; };
  await submitGeneration(current, async (url, options) => {
    calls++; assert.equal(options.body, form);
    assert.equal(options.headers['Content-Type'], undefined);
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    return json({ data: [{ b64_json: png.toString('base64') }] });
  });
  await submitGeneration(current, () => assert.fail('unexpected resubmission'));
  assert.equal(preparations, 1); assert.equal(calls, 1);
});

test('OpenAI collects every base64 result and submits once', async () => {
  const current = job();
  let posts = 0;
  const fetcher = async (url, options) => {
    posts++;
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    return json({ data: [{ b64_json: png.toString('base64'), seed: 12 }, { b64_json: png.toString('base64'), seed: 13 }] });
  };
  await submitGeneration(current, fetcher);
  await submitGeneration(current, fetcher);
  const images = await downloadResults(current, fetcher);
  assert.equal(posts, 1);
  assert.equal(images.length, 2);
  assert.equal(images[1].seed, 13);
  assert.equal(images[0].blob.type, 'image/png');
});

test('CDN download receives no API key, and recovery never resubmits', async () => {
  const current = job();
  let posts = 0, downloads = 0;
  const fetcher = async (url, options) => {
    if (options.method === 'POST') { posts++; return json({ data: [{ url: 'https://cdn.example/image.png?sig=temporary' }] }); }
    downloads++;
    assert.deepEqual(options.headers, {});
    if (downloads === 1) throw new TypeError('test-secret must never reach a log');
    return new Response(png);
  };
  await submitGeneration(current, fetcher);
  await assert.rejects(downloadResults(current, fetcher), TypeError);
  await submitGeneration(current, fetcher);
  assert.equal((await downloadResults(current, fetcher)).length, 1);
  assert.equal(posts, 1);
  assert.equal(downloads, 2);
});

test('wrong endpoint JSON cannot loop in recovery; a new task uses the corrected connection', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, authorization: options.headers.Authorization, prompt: JSON.parse(options.body).prompt });
    return url.includes('/wrong/')
      ? json({ error: 'Not an image endpoint; secret must not reach diagnostics' })
      : json({ data: [{ b64_json: png.toString('base64') }] });
  };
  const queue = new GenerationQueue({
    settings: () => ({ enabled: true, generationMode: 'queue', queueInterval: 0 }),
    run: async (current) => {
      await submitGeneration(current, fetcher);
      await downloadResults(current, fetcher);
    },
  });
  const original = job().plan;
  original.url = 'https://api.example/wrong/images/generations';
  const failed = queue.add({ ...original, timeout: 5 });
  await eventually(() => failed.status === 'failed' && queue.running === 0);
  assert.equal(failed.diagnostic.code, INVALID_IMAGE_RESPONSE);
  assert.ok(!failed.error.includes('secret must not'));
  assert.equal(canRecoverGeneration(failed), false);
  queue.retry(failed.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.attempts, 1);
  const corrected = queue.add({ ...original, url: 'https://corrected.example/v1/images/generations',
    headers: { Authorization: 'Bearer corrected-key' }, timeout: 5 });
  await eventually(() => corrected.status === 'completed' && queue.running === 0);
  assert.notEqual(corrected.id, failed.id);
  assert.deepEqual(calls, [
    { url: original.url, authorization: 'Bearer test-secret', prompt: 'lake' },
    { url: 'https://corrected.example/v1/images/generations', authorization: 'Bearer corrected-key', prompt: 'lake' },
  ]);
});

test('unusable embedded image data is classified separately from a temporary CDN response', async () => {
  for (const body of [
    { data: [{ b64_json: '%%%invalid%%%' }] },
    { data: [{ b64_json: btoa('not an image') }] },
    { data: [{ url: 'data:text/html,invalid' }] },
  ]) {
    const current = job();
    await submitGeneration(current, async () => json(body));
    await assert.rejects(downloadResults(current), (error) => error.code === INVALID_IMAGE_RESPONSE);
  }
  const current = job();
  await submitGeneration(current, async () => json({ data: [{ url: 'https://cdn.example/image.png' }] }));
  await assert.rejects(downloadResults(current, async () => new Response('temporary CDN failure')),
    (error) => error.code !== INVALID_IMAGE_RESPONSE);
  assert.equal((await downloadResults(current, async () => new Response(png))).length, 1);
});

test('NAI ZIP keeps all images and validates their bytes', async () => {
  const zip = new JSZip();
  zip.file('one.png', png); zip.file('two.png', png); zip.file('info.txt', 'metadata');
  const results = await imageDescriptors(await zip.generateAsync({ type: 'uint8array' }));
  assert.equal(results.length, 2);
  zip.file('bad.png', 'not an image');
  await assert.rejects(imageDescriptors(await zip.generateAsync({ type: 'uint8array' })), /不是 PNG/);
});

test('NAI request carries negative caption, real seed, model and options', () => {
  const params = {
    model: 'nai-diffusion-4-5-full', artist: 'artist', positive: 'lake', negative: 'blurry',
    width: 832, height: 1216, steps: 23, scale: 5, seed: 0,
    sampler: 'k_euler_ancestral', nSamples: 2, ucPreset: '0', qualityTags: true,
    cfgRescale: 0.2, noiseSchedule: 'karras', variety: true,
  };
  const request = buildNovelAIRequest(params);
  assert.equal(request.input, 'artist, lake');
  assert.equal(request.parameters.seed, 0);
  assert.equal(request.parameters.n_samples, 2);
  assert.equal(request.parameters.v4_negative_prompt.caption.base_caption, 'blurry');
  assert.equal(request.parameters.skip_cfg_above_sigma, 19);
  const v3 = buildNovelAIRequest({ ...params, model: 'nai-diffusion-3', sm: true, smDyn: false });
  assert.equal(v3.parameters.sm, true);
  assert.equal(v3.parameters.v4_prompt, undefined);
});

test('ComfyUI uses returned prompt ID and selected output; view is authenticated', async () => {
  const current = job('comfyui');
  current.plan.outputNode = '9';
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push(url);
    if (options.method === 'POST') return json({ prompt_id: 'own-id' });
    if (url.includes('/history/')) return json({
      'own-id': { status: { completed: true, status_str: 'success' }, outputs: {
        '8': { images: [{ filename: 'excluded.png' }] },
        '9': { images: [{ filename: 'one.png', subfolder: 'folder with space' }, { filename: 'two.png' }] },
      } },
    });
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    return new Response(png);
  };
  await submitGeneration(current, fetcher);
  const results = await downloadResults(current, fetcher);
  assert.equal(results.length, 2);
  assert(calls.includes('https://comfy.example/history/own-id'));
  assert.equal(calls.filter((url) => url.includes('excluded')).length, 0);
  assert(calls.some((url) => url.includes('folder+with+space')));
});

test('ComfyUI cancellation deletes own queued ID and never calls global interrupt', async () => {
  const current = job('comfyui');
  current.execution = { promptId: 'own-id' };
  const calls = [];
  await cancelComfyPending(current, async (url, options) => { calls.push([url, JSON.parse(options.body)]); return json({}); });
  assert.deepEqual(calls, [['https://comfy.example/queue', { delete: ['own-id'] }]]);
});

test('ComfyUI execution errors do not become empty successful batches', async () => {
  const current = job('comfyui');
  current.execution = { promptId: 'own-id' };
  await assert.rejects(downloadResults(current, async () => json({
    'own-id': { status: { completed: true, status_str: 'error' }, outputs: {} },
  })), /执行失败/);
});

test('authentication and rate errors are classified without response body secrets', async () => {
  for (const status of [401, 403, 429]) {
    const current = job();
    await assert.rejects(submitGeneration(current, async () => json({ error: 'test-secret' }, status, { 'retry-after': '2' })), (error) => {
      assert.equal(error.status, status);
      assert(!error.message.includes('test-secret'));
      if (status === 429) assert.equal(error.cooldown, 2000);
      return true;
    });
    assert.equal(current.execution, undefined);
  }
});

test('oversized and nonimage responses are rejected', async () => {
  await assert.rejects(readLimited(new Response('large', { headers: { 'content-length': '30' } }), 20), /响应过大/);
  await assert.rejects(imageDescriptors(new TextEncoder().encode('not an image')), /不是图片/);
  const current = job();
  current.execution = { bytes: new TextEncoder().encode(JSON.stringify({ data: [{ url: 'data:text/html,bad' }] })) };
  await assert.rejects(downloadResults(current), /地址不可使用/);
});

test('queue cancellation and interval are applied after completion', async () => {
  const starts = [];
  const settings = { enabled: true, generationMode: 'queue', concurrency: 2, queueInterval: 0.04 };
  const queue = new GenerationQueue({
    settings: () => settings,
    run: async (current) => { starts.push(Date.now()); await wait(12, current.controller.signal); },
  });
  const one = queue.add(plan());
  const cancelled = queue.add(plan());
  queue.cancel(cancelled.id);
  const three = queue.add(plan());
  await eventually(() => three.status === 'completed');
  assert.equal(one.status, 'completed');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(starts.length, 2);
  assert(starts[1] - starts[0] >= 45);
  assert(!JSON.stringify(queue.records()).includes('test-secret'));
});
test('deferred batch does not start until committed; pause leaves running task and resumes only waiting jobs', async () => {
  let release;
  const started = [];
  const queue = new GenerationQueue({ settings: () => ({ enabled: true, generationMode: 'queue', queueInterval: 0 }),
    run: async (job) => { started.push(job.id); if (started.length === 1) await new Promise((resolve) => { release = resolve; }); } });
  const batch = () => ({ ...plan(), snapshot: { experiment: { id: 'batch-a' } } });
  const first = queue.add(batch(), { defer: true }), second = queue.add(batch(), { defer: true });
  assert.equal(started.length, 0);
  queue.pump();
  assert.equal(first.status, 'running');
  queue.pauseBatch('batch-a');
  assert.equal(second.status, 'paused'); assert.equal(first.status, 'running');
  release(); await eventually(() => first.status === 'completed');
  assert.equal(started.length, 1);
  queue.resumeBatch('batch-a'); await eventually(() => second.status === 'completed');
  assert.equal(started.length, 2);
});

test('parallel limit and active cancellation free slots only when runner stops', async () => {
  let active = 0, peak = 0;
  const settings = { enabled: true, generationMode: 'parallel', concurrency: 2, queueInterval: 0 };
  const queue = new GenerationQueue({
    settings: () => settings,
    run: async (current) => {
      active++; peak = Math.max(peak, active);
      try { await wait(20, current.controller.signal); } finally { active--; }
    },
  });
  const jobs = [queue.add(plan()), queue.add(plan()), queue.add(plan())];
  queue.cancel(jobs[0].id);
  await eventually(() => jobs[2].status === 'completed');
  assert.equal(peak, 2);
  assert.equal(jobs[0].status, 'cancelled');
  assert.equal(queue.running, 0);
});

test('manual recovery retains accepted execution, failed POST is never retried', async () => {
  let calls = 0;
  const settings = { enabled: true, generationMode: 'queue', concurrency: 1, queueInterval: 0 };
  const queue = new GenerationQueue({
    settings: () => settings,
    run: async (current) => {
      calls++;
      if (calls === 1) { current.execution = { bytes: png }; throw new GenerationError('download failed'); }
      assert(current.execution);
    },
  });
  const current = queue.add(plan());
  await eventually(() => current.status === 'failed');
  queue.retry(current.id);
  await eventually(() => current.status === 'completed');
  assert.equal(current.attempts, 2);
  assert.equal(current.execution, undefined);
});

test('quota failure preserves the accepted response for manual saving without another generation', async () => {
  let posts = 0, saves = 0;
  const queue = new GenerationQueue({
    settings: () => ({ enabled: true, generationMode: 'queue', queueInterval: 0 }),
    run: async (current) => {
      if (!current.execution) { posts++; current.execution = { bytes: png }; }
      current.failurePhase = 'saving';
      if (++saves === 1) throw new DOMException('private', 'QuotaExceededError');
    },
  });
  const current = queue.add(plan());
  await eventually(() => current.status === 'failed');
  assert.equal(current.diagnostic.code, 'BROWSER_QUOTA');
  assert.equal(current.diagnostic.phase, 'saving');
  assert.ok(current.execution);
  queue.retry(current.id);
  await eventually(() => current.status === 'completed');
  assert.equal(posts, 1);
  assert.equal(saves, 2);
});

test('429 cooldown pauses later queued tasks without automatically replaying failed one', async () => {
  const starts = [];
  const settings = { enabled: true, generationMode: 'queue', queueInterval: 0 };
  const queue = new GenerationQueue({
    settings: () => settings,
    run: async () => {
      starts.push(Date.now());
      if (starts.length === 1) throw new GenerationError('limited', { status: 429, cooldown: 45 });
    },
  });
  const first = queue.add(plan()), second = queue.add(plan());
  await eventually(() => second.status === 'completed');
  assert.equal(first.status, 'failed');
  assert(starts[1] - starts[0] >= 40);
  assert.equal(first.attempts, 1);
});
