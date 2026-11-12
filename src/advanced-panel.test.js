import test from 'node:test';
import assert from 'node:assert/strict';
import { advancedOf } from './advanced-generation.js';

globalThis.window ||= { addEventListener() {} };
const { AdvancedPanel } = await import('./ui/advanced.js');
const asset = (suffix = 'a') => ({ id: suffix.repeat(64), location: 'browser', name: 'reference.png',
  width: 512, height: 512, mime: 'image/png' });
const entry = () => ({ id: '88fe3a4a-29e0-4f67-bcab-100cad406186', name: 'reference',
  image: asset(), enabled: true, information: 1, strength: 0.6, encodings: {} });
function fixture({ encode = async () => new Blob([new Uint8Array(128)]), put } = {}) {
  let snapshot = { provider: 'novelai', params: { model: 'nai-diffusion-4-5-full',
    advanced: { mode: 'reference', vibes: [entry()] } } };
  const saved = [], renders = [];
  const panel = new AdvancedPanel({
    getSnapshot: () => structuredClone(snapshot),
    update: (value) => { snapshot = value; },
    render: () => renders.push(panel.html()),
    encode,
    assets: { put: put || (async (blob) => { saved.push(blob); return { ...asset('b'), mime: blob.type }; }) },
  });
  return { panel, saved, renders, snapshot: () => snapshot };
}

test('Vibe shows a visible encoding command and actionable model and extraction status', () => {
  const { panel } = fixture(), value = advancedOf(panel.getSnapshot());
  assert.match(panel.vibeHTML(value, 'nai-diffusion-4-5-full'), /<span>编码参考图<\/span>/);
  assert.match(panel.vibeHTML(value, 'nai-diffusion-4-5-full'), /<strong>未编码<\/strong>/);
  assert.match(panel.vibeHTML(value, 'nai-diffusion-4-5-full'), /需为当前模型编码参考图/);
  value.vibes[0].encodings['v4-5full'] = { asset: asset('b'), information: 0.8 };
  assert.match(panel.vibeHTML(value, 'nai-diffusion-4-5-full'), /提取量已变更/);
  value.vibes[0].information = 0.8;
  value.vibes[0].image = null;
  assert.match(panel.vibeHTML(value, 'nai-diffusion-4-5-full'), /当前模型可用/);
  assert.match(panel.vibeHTML(value, 'nai-diffusion-4-5-curated'), /缺少匹配编码，请重新添加原图/);
  assert.doesNotMatch(panel.vibeHTML(value, 'nai-diffusion-3'), /data-advanced-command="vibe-encode"/);
});

test('Vibe encoding shows progress immediately, prevents duplicate requests and stores the matching encoding', async () => {
  let resolve, calls = 0;
  const pending = new Promise((done) => { resolve = done; });
  const { panel, saved, renders, snapshot } = fixture({ encode: async () => { calls++; return pending; } });
  const target = { dataset: { vibeId: entry().id } };
  const completion = panel.command('vibe-encode', target);
  assert.equal(panel.ui.busy, true);
  assert.equal(panel.ui.encodingId, entry().id);
  assert.match(renders.at(-1), /正在编码参考图/);
  assert.match(renders.at(-1), /<fieldset disabled>/);
  await panel.command('vibe-encode', target);
  assert.equal(calls, 1);
  resolve(new Blob([new Uint8Array(128)], { type: 'application/octet-stream' }));
  await completion;
  assert.equal(saved.length, 1);
  assert.equal(panel.ui.busy, false);
  assert.equal(panel.ui.encodingId, '');
  const encoding = snapshot().params.advanced.vibes[0].encodings['v4-5full'];
  assert.equal(encoding.information, 1);
  assert.equal(encoding.asset.id, asset('b').id);
  assert.match(renders.at(-1), /<strong>已编码<\/strong>/);
  assert.match(renders.at(-1), /<span>重新编码<\/span>/);
  assert.match(renders.at(-1), /当前模型可用/);
});

test('Vibe encoding failures preserve the reference and never mark it usable', async () => {
  const { panel, saved, snapshot } = fixture({ encode: async () => { throw new Error('Vibe 编码鉴权未通过（HTTP 401）'); } });
  await panel.command('vibe-encode', { dataset: { vibeId: entry().id } });
  assert.equal(panel.ui.error, '');
  assert.match(panel.html(), /<strong>编码失败<\/strong>/);
  assert.match(panel.html(), /鉴权.*401/);
  assert.match(panel.html(), /<span>重试编码<\/span>/);
  assert.equal(panel.ui.busy, false);
  assert.equal(saved.length, 0);
  assert.deepEqual(snapshot().params.advanced.vibes[0].encodings, {});
  assert.equal(snapshot().params.advanced.vibes[0].image.id, asset().id);
});

test('Vibe identification timeouts and errors without messages still identify the failed operation', async () => {
  for (const [error, message] of [[new DOMException('fixture', 'TimeoutError'), /编码服务识别超时/],
    [new Error(), /参考图编码未完成/], [null, /参考图编码未完成/]]) {
    const { panel } = fixture({ encode: async () => { throw error; } });
    await panel.command('vibe-encode', { dataset: { vibeId: entry().id } });
    assert.match(panel.html(), message);
    assert.match(panel.html(), /<strong>编码失败<\/strong>/);
    assert.equal(panel.ui.busy, false);
  }
});

test('Vibe failures belong to the affected image, model and extraction settings', async () => {
  const { panel } = fixture({ encode: async () => { throw new Error('Fixture service unavailable (HTTP 503)'); } });
  const snapshot = panel.getSnapshot(), second = { ...entry(), id: '22fe3a4a-29e0-4f67-bcab-100cad406186', name: 'second' };
  snapshot.params.advanced.vibes.push(second);
  panel.update(snapshot);
  await panel.command('vibe-encode', { dataset: { vibeId: entry().id } });
  const values = advancedOf(panel.getSnapshot()).vibes;
  assert.equal(panel.vibeState(values[0], 'v4-5full').state, 'failed');
  assert.equal(panel.vibeState(values[1], 'v4-5full').state, 'unencoded');
  assert.equal(panel.vibeState(values[0], 'v4-5curated').state, 'unencoded');
  values[0].information = 0.7;
  assert.equal(panel.vibeState(values[0], 'v4-5full').state, 'unencoded');
  assert.equal(panel.vibeState({ ...values[0], information: 1, image: asset('c') }, 'v4-5full').state, 'unencoded');
});

test('a manual retry clears the old Vibe failure and shows saved success', async () => {
  let calls = 0;
  const { panel } = fixture({ encode: async () => {
    if (++calls === 1) throw new Error('Fixture service unavailable (HTTP 503)');
    return new Blob([new Uint8Array(128)], { type: 'application/octet-stream' });
  } });
  const target = { dataset: { vibeId: entry().id } };
  await panel.command('vibe-encode', target);
  assert.match(panel.html(), /编码失败/);
  await panel.command('vibe-encode', target);
  assert.equal(calls, 2);
  assert.doesNotMatch(panel.html(), /HTTP 503|重试编码/);
  assert.match(panel.html(), /<strong>已编码<\/strong>/);
});

test('saved Vibe encodings show success when the panel is reopened without a new encoding request', async () => {
  const { panel, snapshot } = fixture();
  await panel.command('vibe-encode', { dataset: { vibeId: entry().id } });
  const reopened = new AdvancedPanel({
    getSnapshot: snapshot,
    render() {},
    encode() { throw new Error('Reopening must not encode'); },
  });
  assert.match(reopened.html(), /<strong>已编码<\/strong>/);
  assert.match(reopened.html(), /当前模型可用/);
  const stale = snapshot();
  stale.params.advanced.vibes[0].information = 0.5;
  panel.update(stale);
  assert.match(reopened.html(), /<strong>待重新编码<\/strong>/);
});

test('failed re-encoding preserves the usable encoding and escapes the row error', async () => {
  const { panel, snapshot } = fixture();
  const target = { dataset: { vibeId: entry().id } };
  await panel.command('vibe-encode', target);
  panel.encode = async () => { throw new Error('<img src=x> Fixture failure'); };
  await panel.command('vibe-encode', target);
  assert.equal(snapshot().params.advanced.vibes[0].encodings['v4-5full'].asset.id, asset('b').id);
  assert.match(panel.html(), /编码失败/);
  assert.match(panel.html(), /原编码仍可用于当前模型/);
  assert.match(panel.html(), /&lt;img src=x&gt;/);
  assert.doesNotMatch(panel.html(), /<img src=x>/);
});

test('non-encoding operations continue to show their general error', async () => {
  const { panel } = fixture();
  await panel.perform(async () => { throw new Error('Fixture upload failed'); });
  assert.equal(panel.ui.error, 'Fixture upload failed');
  assert.match(panel.html(), /Fixture upload failed/);
  assert.equal(panel.ui.busy, false);
  assert.equal(panel.vibeFailures.size, 0);
});
