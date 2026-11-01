import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window ||= { addEventListener() {} };
const { TagLibraryPanel } = await import('./ui/tags.js');
const { normalizeTagLibrary } = await import('./tag-library.js');
const fixture = (options = {}) => {
  let library = normalizeTagLibrary({});
  const context = { provider: 'novelai', params: { model: 'nai-diffusion-4-5-full', positive: '{smile, blue eyes}', negative: 'blurry', seed: 123 } };
  const calls = [];
  const panel = new TagLibraryPanel({ getContext: () => context, getLibrary: () => library,
    setLibrary: (next) => { library = next; }, insert: (params, targets) => { calls.push(targets); context.params = params; }, ...options });
  return { panel, context, calls };
};

test('one undo reverses a cross-column move and does not apply draft parameters', () => {
  const { panel, context, calls } = fixture();
  const source = panel.composition('positive');
  panel.transferItem('positive', source.items[0].children[0].id);
  assert.equal(panel.composition('positive').text, '{blue eyes}');
  assert.equal(panel.composition('negative').text, 'blurry, {smile}');
  panel.undoComposition();
  assert.equal(panel.composition('positive').text, '{smile, blue eyes}');
  assert.equal(panel.composition('negative').text, 'blurry');
  assert.equal(context.params.negative, 'blurry');
  assert.equal(calls.length, 0);
});
test('redo restores a paired transfer and new edits invalidate redo', () => {
  const { panel } = fixture();
  panel.transferItem('positive', panel.composition('positive').items[0].children[0].id);
  const moved = panel.composition('negative').text;
  panel.undoComposition(); panel.redoComposition();
  assert.equal(panel.composition('negative').text, moved);
  panel.undoComposition(); panel.changeComposition('fresh edit');
  assert.equal(panel.redoHistory().length, 0);
});
test('multi-selection transfer is atomic when any selected item overlaps the destination', () => {
  const { panel } = fixture();
  panel.changeComposition('smile, blue eyes');
  panel.changeComposition('blue eyes', { target: 'negative' });
  const items = panel.composition('positive').items;
  panel.selections.set('positive', new Set(items.map((item) => item.id)));
  assert.throws(() => panel.selectedOperation('positive', 'transfer'), /已包含/);
  assert.equal(panel.composition('positive').text, 'smile, blue eyes');
  assert.equal(panel.composition('negative').text, 'blue eyes');
});
test('undo after parsing manual edits restores the unparsed source and disables stale item edits', () => {
  const { panel } = fixture();
  panel.composition().text = 'night, rain';
  panel.changeComposition('night, rain');
  assert.equal(panel.composition().parsedText, 'night, rain');
  panel.undoComposition();
  assert.equal(panel.composition().text, 'night, rain');
  assert.equal(panel.composition().parsedText, '{smile, blue eyes}');
  assert.ok(panel.composerColumn('positive').includes('原文已修改，待解析'));
});
test('paired apply calls insertion once with both fields; recent list failure does not misreport applied parameters', () => {
  const { panel, context, calls } = fixture({ setLibrary: () => { throw new Error('fixture storage failure'); } });
  panel.changeComposition('night', { target: 'positive' });
  panel.changeComposition('text', { target: 'negative' });
  panel.applyCompositions(['positive', 'negative']);
  assert.deepEqual(calls, [['positive', 'negative']]);
  assert.equal(context.params.positive, 'night');
  assert.equal(context.params.negative, 'text');
  assert.equal(context.params.seed, 123);
  assert.match(panel.status, /正负组合已应用.*最近使用保存失败/);
});
test('large expanded groups have a bounded number of rendered rows without dropping draft tokens', () => {
  const { panel } = fixture();
  panel.changeComposition(`1::${Array.from({ length: 1000 }, (_, i) => `fixture ${i}`).join(', ')}::`);
  panel.expanded.add(panel.composition().items[0].id);
  const html = panel.composerColumn('positive');
  assert.ok((html.match(/data-composer-item=/g) || []).length <= 400);
  assert.ok(html.includes('fixture 999'));
  assert.equal(panel.composition().items[0].children.length, 1000);
});
test('visual transfer to artist and nested delete are draft-only and undo atomically', () => {
  const { panel, context, calls } = fixture();
  const child = panel.composition('positive').items[0].children[0];
  panel.selections.set('positive', new Set([child.id]));
  panel.transferSelection('positive', 'artist');
  assert.equal(panel.composition('artist').text, '{smile}');
  assert.equal(panel.composition('positive').text, '{blue eyes}');
  panel.undoComposition();
  assert.equal(panel.composition('artist').text, '');
  panel.selections.set('positive', new Set([child.id]));
  panel.selectedOperation('positive', 'delete');
  assert.equal(panel.composition('positive').text, '{blue eyes}');
  assert.equal(context.params.positive, '{smile, blue eyes}');
  assert.equal(calls.length, 0);
});
test('three-field apply is atomic on conflict and keeps unrelated generation settings', () => {
  const { panel, context, calls } = fixture();
  for (const [target, text] of Object.entries({ positive: 'forest', negative: 'text', artist: 'ink' })) panel.changeComposition(text, { target });
  context.params.negative = 'changed elsewhere';
  assert.throws(() => panel.applyCompositions(['positive', 'negative', 'artist']), /其他位置修改/);
  assert.equal(calls.length, 0);
  assert.equal(context.params.positive, '{smile, blue eyes}');
  context.params.negative = 'blurry';
  panel.applyCompositions(['positive', 'negative', 'artist']);
  assert.equal(calls.length, 1);
  assert.equal(context.params.artist, 'ink');
  assert.equal(context.params.seed, 123);
});
test('scoped editor rejects unavailable profile fields and over-limit outfit text', () => {
  const { panel, calls } = fixture();
  panel.getContext = () => ({ provider: 'novelai', params: { model: 'nai-diffusion-4-5-full', positive: '', negative: '' },
    allowedTargets: ['positive'], limits: { positive: 10 } });
  panel.changeComposition('text', { target: 'negative' });
  assert.throws(() => panel.applyCompositions(['negative']), /不支持/);
  assert.throws(() => panel.appendVisualText('x'.repeat(11)), /10 字符/);
  assert.equal(calls.length, 0);
});
