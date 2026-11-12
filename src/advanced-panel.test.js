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
  assert.match(renders.at(-1), /当前模型可用/);
});

test('Vibe encoding failures preserve the reference and never mark it usable', async () => {
  const { panel, saved, snapshot } = fixture({ encode: async () => { throw new Error('Vibe 编码鉴权未通过（HTTP 401）'); } });
  await panel.command('vibe-encode', { dataset: { vibeId: entry().id } });
  assert.match(panel.ui.error, /鉴权.*401/);
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
    assert.match(panel.ui.error, message);
    assert.equal(panel.ui.busy, false);
  }
});
