import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { newComicProject, newComicPanel, normalizeComicLibrary } from './comic.js';
import { ComicChapterStore, importComicSeriesFile } from './comic-chapters.js';
import { comicSeriesPack, readComicArchive, inspectComicSeriesPack } from './comic-series-pack.js';

function fixture() {
  const projects = [1, 2].map((chapter) => ({ ...newComicProject(), chapter, seriesId: 'original-series', title: `第 ${chapter} 章`,
    panels: [{ ...newComicPanel(), image: { location: 'browser', id: `art-${chapter}` },
      versions: [{ location: 'browser', id: 'old-art' }], jobs: [{ id: 'old-task', location: 'server' }] }] }));
  return { format: 'linghuashi-comic-series', version: 1, title: '春日', projects };
}
const image = () => new Blob(['same-image-bytes'], { type: 'image/png' });
async function alter(blob, change) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const manifest = JSON.parse(await zip.file('series.json').async('string'));
  await change(manifest, zip);
  zip.file('series.json', JSON.stringify(manifest));
  return zip.generateAsync({ type: 'blob' });
}
test('series packs deduplicate identical contents across image references and retain editable chapters', async () => {
  const payload = fixture(), original = structuredClone(payload);
  const packed = await comicSeriesPack(payload, new Map([['browser:art-1', image()], ['browser:art-2', image()]]));
  assert.equal(packed.imageFiles, 1); assert.equal(packed.imageReferences, 2);
  const zip = await JSZip.loadAsync(await packed.blob.arrayBuffer());
  assert.equal(Object.keys(zip.files).filter((name) => /^images\/.*\.png$/.test(name)).length, 1);
  const read = await readComicArchive(packed.blob);
  assert.equal(read.series.projects.length, 2); assert.equal(read.imageFiles, 1);
  assert.equal(read.blobs.get('browser:art-1'), read.blobs.get('browser:art-2'));
  assert.equal(read.series.projects[0].panels[0].versions.length, 1);
  assert.equal(read.series.projects[0].panels[0].jobs.length, 0);
  assert.deepEqual(payload, original);
});
test('series preflight reports missing art, unreachable storage, reused references and known sizes', async () => {
  const payload = fixture();
  payload.projects[1].panels.push({ ...newComicPanel(), image: payload.projects[0].panels[0].image }, newComicPanel());
  const rows = [{ id: 'art-1', blob: image(), location: 'browser' }];
  const result = await inspectComicSeriesPack(payload, async () => rows);
  assert.equal(result.chapters, 2); assert.equal(result.panels, 4); assert.equal(result.images, 2);
  assert.equal(result.reused, 1); assert.equal(result.unpictured, 1);
  assert.equal(result.issues.length, 1); assert.equal(result.issues[0].code, 'missing');
  assert.match(result.issues[0].message, /第 2 章.*第 1 格/);
  const offline = await inspectComicSeriesPack(payload, async () => { throw new Error('offline'); });
  assert.ok(offline.issues.every((row) => row.code === 'unreachable'));
  const oversized = await inspectComicSeriesPack(payload, async () => [{ id: 'art-1', bytes: 65 * 1024 * 1024 },
    { id: 'art-2', bytes: 10 }], undefined, async () => ({ status: 'available' }));
  assert.ok(oversized.issues.some((row) => /64 MB/.test(row.message)));
});
test('series archives reject damaged, missing, duplicate, unregistered and unsafe image records', async () => {
  const { blob } = await comicSeriesPack(fixture(), new Map([['browser:art-1', image()], ['browser:art-2', image()]]));
  await assert.rejects(readComicArchive(await alter(blob, (manifest) => { manifest.images[0].sha256 = 'a'.repeat(64); })), /校验/);
  await assert.rejects(readComicArchive(await alter(blob, (manifest, zip) => { zip.remove(manifest.images[0].file); })), /缺失/);
  await assert.rejects(readComicArchive(await alter(blob, (manifest) => { manifest.images.pop(); })), /没有包含/);
  await assert.rejects(readComicArchive(await alter(blob, (manifest) => { manifest.images.push(manifest.images[0]); })), /记录无效/);
  await assert.rejects(readComicArchive(await alter(blob, (manifest) => { manifest.images[0].file = '../escape.png'; })), /记录无效/);
  await assert.rejects(readComicArchive(await alter(blob, (manifest, zip) => { zip.file('unexpected.txt', 'extra'); })), /未登记/);
  await assert.rejects(comicSeriesPack(fixture(), new Map()), /缺失/);
});
test('series imports reserve capacity before saving art and restore remapped references under a new series', async () => {
  const payload = fixture(), records = new Map();
  const store = new ComicChapterStore({ local: { put: async (key, value) => records.set(key, structuredClone(value)),
    get: async (key) => records.get(key) } });
  const library = normalizeComicLibrary({ projects: [payload.projects[0]], series: [{ id: 'original-series', title: payload.title }] });
  const before = structuredClone(library);
  const next = await importComicSeriesFile(payload, library, store, () => library, { importImages: async () =>
    new Map([['browser:art-1', { id: 'restored', location: 'server' }], ['browser:art-2', { id: 'restored', location: 'server' }]]) });
  assert.equal(next.series.length, 2); assert.equal(next.series[1].title, '春日 (2)');
  assert.equal(next.shelved.length, 2); assert.equal(next.activeId, library.activeId);
  assert.ok(next.shelved.every((row) => row.seriesId !== 'original-series'));
  const restored = await store.get(next.shelved[0]);
  assert.equal(restored.panels[0].image.id, 'restored'); assert.equal(restored.panels[0].image.location, 'server');
  assert.equal(restored.panels[0].jobs.length, 0); assert.notEqual(restored.id, payload.projects[0].id);
  assert.deepEqual(library, before);
  const full = normalizeComicLibrary({ series: Array.from({ length: 40 }, (_, index) => ({ id: `series-${index}`, title: `${index}` })) });
  let savedImages = false;
  await assert.rejects(importComicSeriesFile(payload, full, store, () => full, { importImages: async () => { savedImages = true; } }), /40/);
  assert.equal(savedImages, false);
});
test('cancellation, failed image imports and failed chapter writes leave the original catalog intact', async () => {
  const payload = fixture(), library = normalizeComicLibrary(), controller = new AbortController();
  controller.abort();
  let writes = 0;
  const store = { put: async () => { writes++; throw new Error('disk full'); } };
  await assert.rejects(importComicSeriesFile(payload, library, store, () => library, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(writes, 0);
  await assert.rejects(importComicSeriesFile(payload, library, store, () => library, { importImages: async () => { throw new Error('image full'); } }), /image full/);
  assert.equal(writes, 0);
  await assert.rejects(importComicSeriesFile(payload, library, store), /disk full/);
  assert.equal(writes, 1); assert.equal(library.series.length, 0); assert.equal(library.shelved.length, 0);
  await assert.rejects(comicSeriesPack(payload, new Map(), controller.signal), { name: 'AbortError' });
  await assert.rejects(readComicArchive(new Blob(['no']), controller.signal), { name: 'AbortError' });
});
