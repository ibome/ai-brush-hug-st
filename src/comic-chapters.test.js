import test from 'node:test';
import assert from 'node:assert/strict';
import { newComicProject, newComicPanel, newComicBubble, normalizeComicLibrary, saveComicProject, validateComicLibrary } from './comic.js';
import { sha256Hex } from './crypto-compat.js';
import { ComicChapterStore, comicChapterRows, shelveComicProject, loadComicChapter, newComicSeries, setComicSeries,
  normalizeComicChapterBundle, comicSeriesFile, importComicSeriesFile, availableComicChapter, createComicSeriesForChapter } from './comic-chapters.js';
globalThis.window ||= { addEventListener() {} };
const { createBackup, inspectBackup } = await import('./backup.js');
function memory() {
  const records = new Map();
  return { records, store: new ComicChapterStore({ local: { get: async (key) => structuredClone(records.get(key)),
    put: async (key, value) => { records.set(key, structuredClone(value)); } } }) };
}
function project(number = 1) {
  const row = newComicProject(); row.title = `章节 ${number}`; row.chapter = number; row.source = `剧情 ${number}`;
  row.panels = [{ ...newComicPanel(), positive: 'garden', image: { id: `image-${number}`, location: 'server' } }];
  return row;
}
test('older immutable chapter bodies verify before new bubble style defaults are applied', async () => {
  const { records, store } = memory(), row = project();
  row.panels[0].bubbles = [{ ...newComicBubble(), text: '旧版对白' }];
  const reference = await store.put(row);
  const record = records.get(`comic-chapter:${reference.key}`);
  delete record.project.panels[0].bubbles[0].fontSize;
  delete record.project.panels[0].bubbles[0].align;
  const oldKey = await sha256Hex(new TextEncoder().encode(JSON.stringify(record)));
  records.set(`comic-chapter:${oldKey}`, record);
  const loaded = await store.get({ ...reference, key: oldKey });
  assert.equal(loaded.panels[0].bubbles[0].text, '旧版对白');
  assert.equal(loaded.panels[0].bubbles[0].fontSize, 0);
  assert.equal(loaded.panels[0].bubbles[0].align, 'left');
  record.project.panels[0].bubbles[0].text = 'tampered';
  await assert.rejects(store.get({ ...reference, key: oldKey }), /校验/);
});
test('a 20-chapter library loads one body at a time and does not serialize unloaded prose', async () => {
  const { store } = memory(); let library = normalizeComicLibrary();
  library = newComicSeries(library, '长篇');
  const seriesId = library.series[0].id;
  for (let index = 1; index <= 20; index++) {
    const row = { ...project(index), seriesId };
    library = saveComicProject(library, row);
    library = await shelveComicProject(library, row.id, store);
  }
  assert.equal(library.projects.length, 0); assert.equal(library.shelved.length, 20);
  assert.ok(!JSON.stringify(library).includes('剧情'));
  const id = library.shelved[14].id;
  library = await loadComicChapter(library, id, store);
  assert.equal(library.projects.length, 1); assert.equal(library.projects[0].source, '剧情 15');
  assert.equal(comicChapterRows(library).length, 20); assert.equal(library.activeId, id);
  assert.equal((await store.bundle(library)).length, 19);
});
test('chapter write failure and corrupt body never remove original projects or catalogs', async () => {
  const f = memory(), row = project(), library = saveComicProject(normalizeComicLibrary(), row);
  await assert.rejects(shelveComicProject(library, row.id, { put: async () => { throw new Error('disk full'); } }), /disk full/);
  assert.equal(library.projects[0].source, '剧情 1');
  const shelved = await shelveComicProject(library, row.id, f.store);
  const key = `comic-chapter:${shelved.shelved[0].key}`;
  f.records.get(key).project.source = 'tampered';
  await assert.rejects(loadComicChapter(shelved, row.id, f.store), /校验/);
  assert.equal(shelved.shelved.length, 1);
});
test('unloading the active chapter prefers the nearest loaded successor, then the previous chapter in its series', async () => {
  const { store } = memory(), unrelated = project(1);
  const earlier = { ...project(2), seriesId: 'series-a' }, active = { ...project(5), seriesId: 'series-a' };
  const later = { ...project(7), seriesId: 'series-a' }, last = { ...project(10), seriesId: 'series-a' };
  const archived = { ...project(6), seriesId: 'series-a', archived: true };
  let library = normalizeComicLibrary({ projects: [unrelated, last, earlier, active, archived, later], activeId: active.id });
  library = await shelveComicProject(library, active.id, store);
  assert.equal(library.activeId, later.id);
  library = await shelveComicProject(library, later.id, store);
  assert.equal(library.activeId, last.id);
  library = await shelveComicProject(library, last.id, store);
  assert.equal(library.activeId, earlier.id);
  library = await shelveComicProject(library, earlier.id, store);
  assert.equal(library.activeId, '');
  assert.ok(library.projects.some((row) => row.id === unrelated.id));
  assert.ok(library.projects.some((row) => row.id === archived.id));
  assert.equal(normalizeComicLibrary(JSON.parse(JSON.stringify(library))).activeId, '');
});
test('unloading an independent project leaves the catalog selected and never loads shelved siblings implicitly', async () => {
  const { store } = memory(), unrelated = project(1), active = project(2);
  const library = normalizeComicLibrary({ projects: [unrelated, active], activeId: active.id });
  const next = await shelveComicProject(library, active.id, store);
  assert.equal(next.activeId, '');
  assert.equal(next.projects.length, 1);
  const grouped = normalizeComicLibrary({ ...next, projects: [{ ...unrelated, seriesId: 'only-shelved' }],
    shelved: next.shelved.map((row) => ({ ...row, seriesId: 'only-shelved' })), activeId: unrelated.id });
  const empty = await shelveComicProject(grouped, unrelated.id, store);
  assert.equal(empty.activeId, ''); assert.equal(empty.projects.length, 0); assert.equal(empty.shelved.length, 2);
  assert.equal(normalizeComicLibrary({ projects: [unrelated] }).activeId, unrelated.id);
  assert.equal(normalizeComicLibrary({ projects: [unrelated], activeId: 'missing' }).activeId, unrelated.id);
});
test('unloading retains other chapter task updates and rejects a changed chapter during the write', async () => {
  const { store } = memory(), a = project(), b = project(2);
  let live = saveComicProject(saveComicProject(normalizeComicLibrary(), a), b);
  const updating = { put: async (project) => {
    const row = await store.put(project);
    live = structuredClone(live); live.projects.find((entry) => entry.id === b.id).panels[0].image = { id: 'new-result', location: 'server' };
    return row;
  } };
  const next = await shelveComicProject(live, a.id, updating, () => false, () => live);
  assert.equal(next.projects.find((row) => row.id === b.id).panels[0].image.id, 'new-result');
  assert.equal(next.activeId, b.id);
  await assert.rejects(shelveComicProject(live, a.id, { put: async (project) => {
    const row = await store.put(project); live = structuredClone(live); live.projects.find((entry) => entry.id === a.id).source = 'edited'; return row;
  } }, () => false, () => live), /发生变化/);
  assert.equal(live.projects.find((row) => row.id === a.id).source, 'edited');
});
test('full slots evict only inactive chapters without tasks; no free slot fails without loss', async () => {
  const { store } = memory(); let library = normalizeComicLibrary();
  const target = project(9); library = saveComicProject(library, target);
  library = await shelveComicProject(library, target.id, store);
  for (let index = 1; index <= 8; index++) library = saveComicProject(library, project(index));
  const original = structuredClone(library), protectedId = library.projects[0].id;
  library = await loadComicChapter(library, target.id, store, (row) => row.id === protectedId);
  assert.equal(library.projects.length, 8); assert.equal(library.shelved.length, 1);
  assert.ok(library.projects.some((row) => row.id === protectedId));
  assert.equal(library.activeId, target.id);
  await assert.rejects(loadComicChapter(original, target.id, store, () => true), /未完成任务/);
  assert.equal(original.projects.length, 8); assert.equal(original.shelved[0].id, target.id);
  await assert.rejects(shelveComicProject(original, protectedId, store, () => true), /未完成任务/);
});
test('series numbering sees unloaded chapters and rejects duplicates; old groups gain a title', async () => {
  const { store } = memory(); let library = newComicSeries(normalizeComicLibrary(), '花园');
  const seriesId = library.series[0].id, a = { ...project(1), seriesId }, b = project(2);
  library = saveComicProject(library, a); library = await shelveComicProject(library, a.id, store);
  library = saveComicProject(library, b);
  assert.throws(() => setComicSeries(library, b.id, seriesId, 1), /已存在/);
  library = setComicSeries(library, b.id, seriesId, 2);
  assert.equal(library.projects[0].chapter, 2);
  const legacy = normalizeComicLibrary({ projects: [{ ...project(), seriesId: 'old-series' }] });
  assert.equal(legacy.series[0].id, 'old-series');
});
test('series exports include unloaded bodies and import as detached new chapters', async () => {
  const { store } = memory(); let library = newComicSeries(normalizeComicLibrary(), '连载');
  const seriesId = library.series[0].id, a = { ...project(), seriesId };
  library = saveComicProject(library, a); library = await shelveComicProject(library, a.id, store);
  const file = await comicSeriesFile(library, store, seriesId);
  assert.equal(file.projects[0].source, a.source);
  const imported = await importComicSeriesFile(file, library, store);
  assert.equal(imported.shelved.length, 2); assert.notEqual(imported.shelved[1].id, a.id);
  assert.notEqual(imported.shelved[1].seriesId, seriesId);
  const loaded = await store.get(imported.shelved[1]); assert.equal(loaded.panels[0].jobs.length, 0);
  await assert.rejects(importComicSeriesFile({ ...file, projects: [...file.projects, ...file.projects] }, library, store), /重复/);
});
test('create and join is atomic; automatic numbering includes unloaded and archived chapters', async () => {
  const { store } = memory(), a = project(1), b = project(1), archived = { ...project(2), archived: true };
  let library = saveComicProject(normalizeComicLibrary(), a);
  library = createComicSeriesForChapter(library, '新系列', a.id);
  const seriesId = library.series[0].id;
  assert.equal(library.projects[0].seriesId, seriesId);
  library = saveComicProject(library, { ...archived, seriesId });
  library = await shelveComicProject(library, a.id, store);
  library = saveComicProject(library, b);
  assert.equal(availableComicChapter(library, b.id, seriesId, 1), 3);
  assert.equal(availableComicChapter(library, b.id, seriesId, 9999), 9999);
  assert.equal(availableComicChapter(library, archived.id, seriesId, 2), 2);
  const before = structuredClone(library);
  assert.throws(() => createComicSeriesForChapter(library, '新系列', b.id), /同名/);
  assert.throws(() => createComicSeriesForChapter(library, '不会创建', 'missing'), /打开/);
  assert.deepEqual(library, before);
});
test('personal configuration backup carries every unloaded body and rejects incomplete bundles', async () => {
  const { store } = memory(), row = project();
  const comicLibrary = await shelveComicProject(saveComicProject(normalizeComicLibrary(), row), row.id, store);
  await assert.rejects(createBackup({ state: { comicLibrary }, sections: ['comics'] }), /缺少/);
  const comicChapters = await store.bundle(comicLibrary);
  const blob = await createBackup({ state: { comicLibrary }, sections: ['comics'], comicChapters });
  const pack = await inspectBackup(blob);
  assert.equal(pack.manifest.comicChapters[0].record.project.source, row.source);
  assert.equal(pack.manifest.config.comicLibrary.shelved[0].id, row.id);
  assert.throws(() => normalizeComicChapterBundle([], comicLibrary), /缺少/);
  assert.throws(() => validateComicLibrary({ ...comicLibrary, shelved: [...comicLibrary.shelved, ...comicLibrary.shelved] }), /重复/);
});
