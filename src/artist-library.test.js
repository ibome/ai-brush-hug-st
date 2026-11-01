import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyArtist, normalizeArtistLibrary, normalizeArtist, saveArtist, importArtistLibrary, appendPrompt, applyArtist } from './artist-library.js';

const entry = () => ({ ...emptyArtist(), name: 'Watercolor', artist: 'artist:a, watercolor', quality: 'best quality', negative: 'blurry' });
const state = (provider = 'novelai') => ({
  provider, novelai: { artist: 'artist:b', positive: '1girl, garden', negative: 'low quality', width: 832, seed: 123 },
  openai: { artist: 'soft light', model: 'nai-diffusion-4-5-full', positive: 'garden', negative: '', width: 1024 },
  comfyui: { mapping: { positive: {}, negative: {} }, params: { positive: 'garden', negative: '', seed: 123 } },
  connections: { novelai: { keyRef: 'fixture', endpoint: 'fixture' } }, characterProfiles: { fixture: true },
});

test('artist save, duplicate detection and import are atomic and keep existing entries', () => {
  const first = saveArtist([], entry());
  assert.throws(() => saveArtist(first, { ...entry() }), /同名/);
  const imported = importArtistLibrary(first, { format: 'linghuashi-artists', version: 1, entries: first });
  assert.equal(imported.length, 2);
  assert.equal(first.length, 1);
  assert.notEqual(imported[0].id, imported[1].id);
  assert.equal(imported[1].name, 'Watercolor (2)');
  assert.throws(() => importArtistLibrary(first, { format: 'linghuashi-artists', version: 1, entries: [entry(), { name: '' }] }));
  assert.equal(first.length, 1);
});

test('normalization strips external previews, credentials and unknown fields', () => {
  const normalized = normalizeArtist({ ...entry(), preview: 'https://fixture.example/image.png', key: 'secret', connection: {} });
  assert.equal(normalized.preview, '');
  assert.equal(normalized.key, undefined);
  assert.equal(normalized.connection, undefined);
  assert.equal(normalizeArtistLibrary([null, entry()]).length, 1);
});

test('apply changes only selected style fields and avoids repeating quality or negative tags', () => {
  const value = state(), connections = structuredClone(value.connections), profiles = structuredClone(value.characterProfiles);
  applyArtist(value, entry(), { quality: true, negative: true });
  applyArtist(value, entry(), { mode: 'append', quality: true, negative: true });
  assert.equal(value.novelai.artist, 'artist:a, watercolor');
  assert.equal(value.novelai.positive, '1girl, garden, best quality');
  assert.equal(value.novelai.negative, 'low quality, blurry');
  assert.equal(value.novelai.seed, 123);
  assert.equal(value.novelai.width, 832);
  assert.deepEqual(value.connections, connections); assert.deepEqual(value.characterProfiles, profiles);
  assert.equal(appendPrompt('{artist:a, artist:b}, watercolor', '{artist:a, artist:b}'), '{artist:a, artist:b}, watercolor');
});

test('ComfyUI appends style without overwriting subject, and unmapped fields reject atomically', () => {
  const value = state('comfyui');
  applyArtist(value, entry(), { quality: true });
  assert.equal(value.comfyui.params.positive, 'garden, artist:a, watercolor, best quality');
  delete value.comfyui.mapping.negative;
  const before = structuredClone(value);
  assert.throws(() => applyArtist(value, entry(), { negative: true }), /映射/);
  assert.deepEqual(value, before);
});

test('OpenAI unsupported negative fields and incompatible providers reject atomically', () => {
  const value = state('openai'); value.openai.model = 'gpt-image-2';
  const before = structuredClone(value);
  assert.throws(() => applyArtist(value, entry(), { negative: true }), /独立负面/);
  assert.deepEqual(value, before);
  assert.throws(() => applyArtist(value, { ...entry(), target: 'novelai' }), /不适用/);
  applyArtist(value, entry());
  assert.equal(value.openai.positive, 'garden');
});

test('oversized artist application and library import do not silently truncate parameters', () => {
  const value = state(); value.novelai.artist = 'x'.repeat(4000);
  const before = structuredClone(value);
  assert.throws(() => applyArtist(value, entry(), { mode: 'append' }), /长度/);
  assert.deepEqual(value, before);
  assert.throws(() => importArtistLibrary([], { format: 'linghuashi-artists', version: 1, entries: Array.from({ length: 101 }, entry) }), /100/);
});
