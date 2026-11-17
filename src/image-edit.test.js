import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window = { addEventListener() {} };
const { imageEditDraft, imageEditAvailability, prepareImageEdit } = await import('./image-edit.js');
const { renderImageEditor } = await import('./ui/image-editor.js');

test('unsupported editing shortcuts and version submission share capability validation', () => {
  const snapshot = imageEditDraft({ provider: 'openai', params: {
    model: 'nai-diffusion-4-5-full', positive: 'a quiet lake', advanced: { mode: 'text', openAIEditEnabled: false },
  } });
  assert.deepEqual(imageEditAvailability(snapshot), { image: false, inpaint: false, issue: '' });
  const html = renderImageEditor({ id: 'image', title: 'lake', src: 'blob:fixture' }, { draft: snapshot });
  assert.match(html, /data-action="image-edit-inpaint" disabled/);
  assert.match(html, /data-action="image-edit-source" disabled/);
  assert.doesNotMatch(html, /data-action="image-edit-generate" disabled/);
  snapshot.params.advanced.mode = 'inpaint';
  assert.match(imageEditAvailability(snapshot).issue, /图片编辑能力/);
  assert.throws(() => prepareImageEdit(snapshot), /图片编辑能力/);
  assert.match(renderImageEditor({ id: 'image', title: 'lake', src: 'blob:fixture' }, { draft: snapshot }),
    /data-action="image-edit-generate" disabled/);
});

test('supported editing still requires a valid source and mask', () => {
  const snapshot = imageEditDraft({ provider: 'openai', params: {
    model: 'image-model', positive: 'a quiet lake', advanced: { openAIEditEnabled: true, mode: 'inpaint' },
  } });
  assert.equal(imageEditAvailability(snapshot).inpaint, true);
  assert.match(imageEditAvailability(snapshot).issue, /底图/);
  assert.throws(() => prepareImageEdit(snapshot), /底图/);
});
