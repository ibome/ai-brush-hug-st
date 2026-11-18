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

test('image editor preserves grid and diagonal character positions', () => {
  const roles = [
    { id: 'blue', name: 'Blue', positive: 'blue jacket', negative: '', position: 'A3' },
    { id: 'red', name: 'Red', positive: 'red jacket', negative: '', position: 'bottom-right' },
  ];
  const snapshot = imageEditDraft({ provider: 'novelai', params: {
    model: 'nai-diffusion-4-5-full', positive: 'two adult hikers beside a lake',
  }, characterScene: { version: 1, entries: roles.map((role) => ({
    profileId: role.id, profile: { id: role.id, name: role.name }, position: role.position,
  })), characterPrompts: roles, applied: true, basePositive: 'two adult hikers beside a lake', baseNegative: '' } });
  const html = renderImageEditor({ id: 'image', title: 'hikers', src: 'blob:fixture' }, { draft: snapshot });
  assert.match(html, /aria-label="Blue · 画面位置">[\s\S]*?<option value="A3" selected>网格 A3<\/option>/);
  assert.match(html, /aria-label="Red · 画面位置">[\s\S]*?<option value="bottom-right" selected>右下<\/option>/);
  assert.match(html, /<option value="E5" >网格 E5<\/option>/);
  assert.deepEqual(prepareImageEdit(snapshot).characterScene.characterPrompts.map((role) => role.position), ['A3', 'bottom-right']);
});
