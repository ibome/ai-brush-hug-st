import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMaterialText, resolveMaterialCard, cardLayout, restoreCardLayout } from './material-cards.js';
import { normalizeTagLibrary, saveTagTemplate, importTags } from './tag-library.js';
import { buildBatchPreview, artistCandidates, normalizeReviews, reviewValue, setReview } from './prompt-workbench.js';
import { parsePrompt, serializePrompt } from './prompt-composer.js';
import { normalizeVibeLibrary, saveVibe, searchVibes } from './vibe-library.js';
import { prepareExportImage, exportFilename } from './image-export.js';
const cards = [
  { id: 'a', category: '角色', name: '旅人', positive: 'short hair, green eyes', negative: 'long hair', artist: 'watercolor' },
  { id: 'b', category: '场景', name: '花园', positive: '<角色:旅人>, garden', negative: '<角色:旅人>, blurry', artist: '<角色:旅人>' },
];
const snapshot = () => ({ provider: 'novelai', params: { model: 'nai-diffusion-4-5-full', positive: 'portrait',
  artist: '', negative: 'text', seed: -1, nSamples: 4, steps: 24 } });
test('material references resolve each channel and preserve unrelated angle syntax', () => {
  const result = resolveMaterialCard(cards[1], cards);
  assert.equal(result.positive, 'short hair, green eyes, garden');
  assert.equal(result.negative, 'long hair, blurry');
  assert.equal(result.artist, 'watercolor');
  assert.equal(resolveMaterialText('<lora:lineart:0.5>, <plain>', cards), '<lora:lineart:0.5>, <plain>');
  assert.equal(resolveMaterialText('<lora:lineart>', cards), '<lora:lineart>');
});
test('missing, cyclic, ambiguous, deep and expanded oversized references fail', () => {
  assert.throws(() => resolveMaterialText('<角色:缺失>', cards), /找不到/);
  assert.throws(() => resolveMaterialText('<角色:旅人>', [...cards, { ...cards[0], id: 'c' }]), /重名/);
  assert.throws(() => resolveMaterialText('<角色:旅人>', [{ ...cards[0], positive: '<角色:旅人>' }]), /循环/);
  assert.throws(() => resolveMaterialText('<角色:旅人>'.repeat(5), cards, 'positive', { limit: 50 }), /超过/);
  const deep = Array.from({ length: 11 }, (_, i) => ({ id: `d${i}`, category: '嵌套', name: `${i}`, positive: i === 10 ? 'end' : `<嵌套:${i + 1}>` }));
  assert.throws(() => resolveMaterialText('<嵌套:0>', deep), /8 层/);
});
test('cards preserve favorites, model and named group layout through refresh and JSON import', () => {
  const items = parsePrompt('1::smile, blue eyes::').items;
  items[0].name = '表情'; items[0].color = 'green';
  const entry = { id: 'template-layout', name: '表情卡', category: '角色', positive: serializePrompt(items), favorite: true,
    model: 'nai-diffusion-4-5-full', layout: { positive: cardLayout(items) } };
  const library = saveTagTemplate(normalizeTagLibrary(), entry);
  const restored = importTags(normalizeTagLibrary(), { format: 'linghuashi-tags', version: 2, library: JSON.parse(JSON.stringify(library)) });
  assert.equal(restored.templates[0].favorite, true);
  assert.equal(restored.templates[0].model, entry.model);
  const next = restoreCardLayout(parsePrompt(entry.positive).items, restored.templates[0].layout.positive);
  assert.equal(next[0].name, '表情'); assert.equal(next[0].color, 'green');
  assert.equal(serializePrompt(next), entry.positive);
});
test('forward references in a whole card import resolve after all cards are available', () => {
  const library = normalizeTagLibrary({ templates: [
    { id: 'template-forward', name: '引用者', category: '场景', positive: '<角色:后定义>' },
    { id: 'template-later', name: '后定义', category: '角色', positive: 'red hair' },
  ] });
  const merged = importTags(normalizeTagLibrary(), { format: 'linghuashi-tags', version: 2, library });
  assert.equal(resolveMaterialCard(merged.templates[0], merged.templates).positive, 'red hair');
});
test('card import remaps nested references when an existing name collides', () => {
  const current = normalizeTagLibrary({ templates: [{ id: 'template-old', name: '旅人', category: '角色', positive: 'old prompt' }] });
  const incoming = normalizeTagLibrary({ templates: [
    { id: 'template-new', name: '旅人', category: '角色', positive: 'new prompt' },
    { id: 'template-ref', name: '花园', category: '场景', positive: '<角色:旅人>, garden' },
  ] });
  const merged = importTags(current, { format: 'linghuashi-tags', version: 2, library: incoming });
  const card = merged.templates.find((row) => row.id === 'template-ref');
  assert.equal(card.positive, '<角色:旅人 (2)>, garden');
  assert.equal(resolveMaterialCard(card, merged.templates).positive, 'new prompt, garden');
  assert.equal(current.templates.length, 1);
  const repeated = importTags(merged, { format: 'linghuashi-tags', version: 2, library: incoming });
  assert.equal(repeated.templates.length, merged.templates.length);
});
test('Cartesian batch snapshots are independent, one image each, with paired seed comparisons', () => {
  const before = snapshot();
  const preview = buildBatchPreview(before, { characters: 'A | red hair\nB | blue hair', actions: 'reading\nwalking',
    styles: 'ink\nwatercolor', repeats: 2, seedMode: 'same', seed: 500 });
  assert.equal(preview.count, 16); assert.equal(preview.expectedImages, 16);
  assert.deepEqual(preview.rows.slice(0, 4).map((row) => row.seed), [500, 501, 500, 501]);
  assert.equal(preview.rows[0].snapshot.params.nSamples, 1);
  assert.equal(before.params.nSamples, 4);
  preview.rows[0].snapshot.params.positive = 'changed';
  assert.notEqual(preview.rows[1].snapshot.params.positive, 'changed');
  assert.equal(before.params.positive, 'portrait');
});
test('whole material references carry positive, negative and artist into each frozen combination', () => {
  const preview = buildBatchPreview(snapshot(), { characters: '<场景:花园>', seedMode: 'increment', seed: 4294967295, repeats: 2 }, { cards });
  assert.equal(preview.rows[0].snapshot.params.positive, 'portrait, short hair, green eyes, garden');
  assert.equal(preview.rows[0].snapshot.params.negative, 'text, long hair, blurry');
  assert.equal(preview.rows[0].snapshot.params.artist, 'watercolor');
  assert.deepEqual(preview.rows.map((row) => row.seed), [4294967295, 0]);
});
test('batch additions survive a frozen role scene without duplicating role text', () => {
  const scene = { version: 1, applied: true, basePositive: 'portrait', baseNegative: 'text',
    entries: [{ profileId: 'role-a', profile: { id: 'role-a', name: 'Alice', tags: 'green eyes' } }],
    characterPrompts: [{ id: 'role-a', name: 'Alice', positive: 'green eyes', negative: '', position: 'auto' }] };
  const nai = { ...snapshot(), characterScene: scene };
  const preview = buildBatchPreview(nai, { actions: 'reading\nwalking' });
  assert.match(preview.rows[0].snapshot.params.positive, /reading/);
  assert.match(preview.rows[1].snapshot.params.positive, /walking/);
  assert.equal(preview.rows[0].snapshot.characterScene.characterPrompts[0].positive, 'green eyes');
  const open = { provider: 'openai', params: { model: 'gpt-image-2', positive: 'portrait\nCharacter 1 (Alice): green eyes',
    negative: 'text', extra: '{}' }, characterScene: scene };
  const next = buildBatchPreview(open, { actions: 'reading', seedMode: 'service' }).rows[0].snapshot;
  assert.equal((next.params.positive.match(/Character 1/g) || []).length, 1);
  assert.match(next.params.positive, /portrait, reading/);
});
test('batch overflow, unsupported negatives and unmapped workflow fields fail without mutating config', () => {
  assert.throws(() => buildBatchPreview(snapshot(), { characters: 'a\nb\nc\nd\ne', actions: '1\n2\n3\n4\n5', repeats: 2 }), /50.*32/);
  const openai = { provider: 'openai', params: { model: 'gpt-image-2', positive: 'garden', negative: '', extra: '{}' } };
  assert.throws(() => buildBatchPreview(openai, { characters: '<角色:旅人>', seedMode: 'service' }, { cards }), /负面词/);
  assert.throws(() => buildBatchPreview(openai, { seedMode: 'same' }), /服务默认/);
  const comfy = { provider: 'comfyui', config: { params: { positive: 'portrait', negative: '' }, mapping: {} } };
  assert.throws(() => buildBatchPreview(comfy, { seedMode: 'service' }), /正向提示词节点/);
  comfy.config.mapping.positive = { node: '1', input: 'text' };
  const preview = buildBatchPreview(comfy, { styles: 'watercolor', seedMode: 'service' });
  assert.equal(preview.expectedImages, null);
  assert.equal(preview.rows[0].snapshot.config.params.positive, 'portrait, watercolor');
});
test('artist candidates use unique bounded combinations and retain quality and negative words', () => {
  const artists = ['a', 'b', 'c'].map((id) => ({ id, name: id, artist: `artist ${id}`, quality: 'best quality', negative: 'text', target: 'all' }));
  const rows = artistCandidates(artists, ['a', 'b', 'c'], 2, 20);
  assert.equal(rows.length, 3); assert.equal(new Set(rows.map((row) => row.label)).size, 3);
  assert.equal(rows[0].positive, 'best quality');
  const preview = buildBatchPreview(snapshot(), { mode: 'explore', artistIds: ['a', 'b', 'c'], combinationSize: 2 }, { artists });
  assert.equal(preview.count, 3);
  assert.equal(preview.rows[0].snapshot.params.artist, 'artist a, artist b');
});
test('review marks are scoped by storage, preserve other images and clear to unrated', () => {
  let value = setReview({}, 'server', 'image-a', 'best');
  value = setReview(value, 'browser', 'image-a', 'reject');
  assert.equal(reviewValue(value, 'server', 'image-a'), 'best');
  value = setReview(value, 'server', 'image-a', 'unrated');
  assert.equal(reviewValue(value, 'server', 'image-a'), 'unrated');
  assert.equal(reviewValue(value, 'browser', 'image-a'), 'reject');
  assert.deepEqual(normalizeReviews({ 'server:bad/path': 'best', 'server:good': 'bad', unknown: 'reject' }), {});
});
test('Vibe library keeps references and per-model encodings with search and favorites', () => {
  const image = { id: 'a'.repeat(64), location: 'browser', mime: 'image/png', name: 'ref', width: 64, height: 64 };
  const entry = { id: crypto.randomUUID(), name: '墨色', category: '水墨', favorite: true, strength: .4, information: .8, image,
    model: 'nai-diffusion-4-5-full', encodings: { 'v4-5full': { asset: { ...image, mime: 'application/octet-stream' }, information: .8 } } };
  const library = saveVibe([], entry);
  assert.deepEqual(normalizeVibeLibrary(library), library);
  assert.equal(searchVibes(library, '水墨', true, 'nai-diffusion-4-5-full').length, 1);
  assert.equal(searchVibes(library, '', true, 'nai-diffusion-4-full').length, 0);
  assert.equal(library[0].encodings['v4-5full'].information, .8);
});
test('PNG metadata removal retains pixel chunks and embedded UTF8 parameters can be removed again', async () => {
  const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRXYAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' });
  const embedded = await prepareExportImage(png, 'embed', { provider: 'novelai', params: { positive: '花园', seed: 42 } });
  const text = new TextDecoder().decode(await embedded.arrayBuffer());
  assert.match(text, /linghuashi/); assert.match(text, /花园/);
  const clean = await prepareExportImage(embedded, 'remove');
  assert.deepEqual(new Uint8Array(await clean.arrayBuffer()), new Uint8Array(await png.arrayBuffer()));
  const jpg = new Blob(['jpeg'], { type: 'image/jpeg' });
  assert.equal(await prepareExportImage(jpg, 'remove'), jpg);
  assert.equal(exportFilename({ title: '../a/b', blob: png, snapshot: snapshot() }, 2, 'index-seed'), '003-seed--1.png');
});
