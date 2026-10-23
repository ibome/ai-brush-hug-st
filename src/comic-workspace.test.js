import test from 'node:test';
import assert from 'node:assert/strict';
import { newComicProject, newComicPanel, comicProjectProgress, normalizeComicLibrary, saveComicProject, comicPlanPromptPreview } from './comic.js';
import { ComicWorkspace, comicStorySignature, comicGenerationSignature, compactComicWorkspace,
  normalizeComicWorkspace, restoreComicRevision } from './comic-workspace.js';
import { checkComicImage, inspectComicAssets, comicMissingPanelIds } from './comic-assets.js';

function project() {
  const row = newComicProject(); row.source = '她走进花园。';
  row.panels = [{ ...newComicPanel(), title: '花园', positive: 'garden' }];
  return row;
}
function cache() {
  const values = new Map(), warnings = [];
  const open = (key = 'account-a') => new ComicWorkspace({ key, read: (name) => values.get(name),
    write: (name, value) => { values.set(name, value); return true; }, onStatus: (message) => warnings.push(message) });
  return { values, warnings, open };
}
test('comic recovery restores bounded drafts and view for the same account without modifying projects', () => {
  const storage = cache(), workspace = storage.open(), row = project();
  const original = structuredClone(row);
  workspace.draft(row.id, { candidate: row, candidateBase: comicStorySignature(row),
    failureResponse: 'reply', error: 'format', failureOpen: true },
  { tab: 'layout', panelId: row.panels[0].id, selectedBubble: 'bubble-view', snap: false, scrollTop: 480, tabScroll: 100 });
  assert.equal(workspace.flush(), true);
  const recovered = storage.open().get(row.id);
  assert.equal(recovered.draft.failureResponse, 'reply');
  assert.equal(recovered.draft.candidateBase, comicStorySignature(row));
  assert.equal(recovered.view.scrollTop, 480);
  assert.equal(recovered.view.tab, 'layout');
  assert.equal(recovered.view.selectedBubble, 'bubble-view');
  assert.equal(recovered.view.snap, false);
  assert.equal(storage.open('account-b').get(row.id), null);
  assert.deepEqual(row, original);
  assert.ok(!storage.values.get('account-a').includes('Authorization'));
});
test('comic undo coalesces typing, persists redo and clears redo after a new branch', () => {
  const storage = cache(), workspace = storage.open(), a = project(), b = structuredClone(a);
  b.source = '第一段';
  workspace.record(a, b, { label: '剧情', group: 'source', now: 100 });
  const c = structuredClone(b); c.source = '第一段继续';
  workspace.record(b, c, { label: '剧情', group: 'source', now: 300 });
  assert.equal(workspace.get(a.id).past.length, 1);
  const undo = workspace.travel(c, 'undo');
  assert.equal(undo.project.source, a.source);
  assert.equal(workspace.get(a.id).future.length, 0);
  undo.commit(); workspace.flush();
  const recovered = storage.open(), redo = recovered.travel(undo.project, 'redo');
  assert.equal(redo.project.source, c.source); redo.commit();
  const undoAgain = recovered.travel(redo.project, 'undo'); undoAgain.commit();
  recovered.record(undoAgain.project, b, { label: '新分支' });
  assert.equal(recovered.get(a.id).future.length, 0);
  recovered.flush();
});
test('undo preserves completed task associations and new images; explicit image selection remains undoable', () => {
  const a = project(), b = structuredClone(a), workspace = cache().open();
  b.title = '新标题'; workspace.record(a, b);
  b.panels[0].image = { id: 'new-image', location: 'server' };
  b.panels[0].versions = [b.panels[0].image];
  b.panels[0].jobs = [{ id: 'done-job', location: 'server', createdAt: 1, applied: true }];
  const undo = workspace.travel(b, 'undo');
  assert.equal(undo.project.title, a.title);
  assert.equal(undo.project.panels[0].image.id, 'new-image');
  assert.deepEqual(undo.project.panels[0].jobs, b.panels[0].jobs);
  undo.commit();
  const picked = structuredClone(undo.project); picked.panels[0].image = { id: 'picked-image', location: 'browser' };
  picked.panels[0].versions.push(picked.panels[0].image);
  workspace.record(undo.project, picked, { label: '选用图片' });
  const imageUndo = workspace.travel(picked, 'undo');
  assert.equal(imageUndo.project.panels[0].image.id, 'new-image');
  assert.ok(imageUndo.project.panels[0].versions.some((row) => row.id === 'picked-image'));
  imageUndo.commit();
  const redo = workspace.travel(imageUndo.project, 'redo');
  assert.equal(redo.project.panels[0].image.id, 'picked-image');
  redo.commit(); workspace.flush();
});
test('history restores deleted panels and does not alter the live project before successful commit', () => {
  const row = project(), deleted = structuredClone(row), workspace = cache().open();
  deleted.panels = [];
  workspace.record(row, deleted, { label: '删除画格前' });
  const revisionId = workspace.history(row.id).past[0].id;
  const recovery = workspace.travel(deleted, 'history-restore', revisionId);
  assert.equal(recovery.project.panels.length, 1);
  assert.equal(deleted.panels.length, 0);
  assert.equal(workspace.get(row.id).past.length, 1);
  assert.doesNotThrow(() => saveComicProject(normalizeComicLibrary(), recovery.project));
  recovery.commit(); workspace.flush();
  assert.equal(workspace.history(row.id).past[0].label, '恢复历史前');
});
test('recovery quota prunes old history first and reports a failed write without discarding the last saved copy', () => {
  const storage = cache(), workspace = storage.open(), a = project(), b = structuredClone(a);
  b.source = '修改';
  workspace.record(a, b); workspace.draft(a.id, { candidate: b, failureResponse: '保留回复' }, { tab: 'story' });
  workspace.flush();
  const value = structuredClone(workspace.value), base = structuredClone(value);
  base.projects[0].past = [];
  const budget = new TextEncoder().encode(JSON.stringify(base)).length + 10;
  const compacted = compactComicWorkspace(value, budget);
  assert.equal(compacted.projects[0].past.length, 0);
  assert.equal(compacted.projects[0].draft.failureResponse, '保留回复');
  const saved = storage.values.get('account-a');
  workspace.write = () => false;
  workspace.draft(a.id, { failureResponse: '未保存的新回复' }, { tab: 'generate' });
  assert.equal(workspace.flush(), false);
  assert.equal(storage.values.get('account-a'), saved);
  assert.match(storage.warnings.at(-1), /无法保存/);
  assert.throws(() => compactComicWorkspace(value, 5), /容量不足/);
});
test('corrupt workspace data is bounded and does not restore unknown project fields', () => {
  const row = project();
  const value = normalizeComicWorkspace({ projects: [{ projectId: row.id, draft: {
    candidate: { ...row, key: 'must-not-restore' }, failureResponse: 'a'.repeat(100001) },
  past: [{ id: 'revision', project: { ...row, apiKey: 'must-not-restore' } }], view: { tab: 'unknown', scrollTop: -2 } }] });
  assert.equal(value.projects[0].draft.failureResponse.length, 100000);
  assert.ok(!JSON.stringify(value).includes('must-not-restore'));
  assert.equal(value.projects[0].view.tab, 'story');
  assert.equal(value.projects[0].view.scrollTop, 0);
});
test('storyboard stale checks include manual panel edits but ignore new generated art and project renaming', () => {
  const a = project(), b = structuredClone(a), signature = comicStorySignature(a);
  b.title = '新名称'; b.panels[0].image = { id: 'image', location: 'browser' };
  b.panels[0].jobs = [{ id: 'job', location: 'browser' }];
  assert.equal(comicStorySignature(b), signature);
  b.panels[0].caption = '手动对白';
  assert.notEqual(comicStorySignature(b), signature);
});
test('generation confirmation signatures include prompts, cast and interface identity', () => {
  const a = project(), ids = [a.panels[0].id], signature = comicGenerationSignature(a, ids, 'model-a');
  const b = structuredClone(a); b.panels[0].jobs.push({ id: 'job', location: 'server' });
  assert.equal(comicGenerationSignature(b, ids, 'model-a'), signature);
  assert.notEqual(comicGenerationSignature(b, ids, 'model-b'), signature);
  b.panels[0].positive = 'changed';
  assert.notEqual(comicGenerationSignature(b, ids, 'model-a'), signature);
});
test('confirmation previews actual request text including artist and native NovelAI character captions', () => {
  const openai = comicPlanPromptPreview({ provider: 'openai', snapshot: { params: { positive: 'raw', negative: 'blurry' } },
    body: { prompt: 'artist, effective prompt\nAvoid: blurry' } }, 'panel');
  assert.equal(openai.positive, 'artist, effective prompt\nAvoid: blurry');
  assert.match(openai.negativeLabel, /合并/);
  const novelai = comicPlanPromptPreview({ provider: 'novelai', snapshot: { params: {} }, body: { input: 'artist, scene',
    parameters: { negative_prompt: 'blurry', characterPrompts: [{ prompt: 'green hair', uc: 'red hair' }] } } }, 'panel');
  assert.deepEqual(novelai.characters, [{ positive: 'green hair', negative: 'red hair' }]);
  assert.equal(novelai.positive, 'artist, scene');
  assert.equal(novelai.negative, 'blurry');
  const comfy = { provider: 'comfyui', snapshot: { config: { params: {}, mapping: { positive: { node: '6', input: 'text' } } } },
    body: { prompt: { 6: { inputs: { text: 'mapped prompt' } } } } };
  assert.equal(comicPlanPromptPreview(comfy, 'panel').positive, 'mapped prompt');
  assert.match(comicPlanPromptPreview(comfy, 'panel').negativeLabel, /未映射/);
  comfy.snapshot.config.mapping = {};
  assert.throws(() => comicPlanPromptPreview(comfy, 'panel'), /映射/);
});
test('image probe distinguishes missing files from authentication, server and network failures', async () => {
  const row = { srcURL: '/image/original' };
  for (const [status, type, expected] of [[200, 'image/png', 'available'], [404, 'text/plain', 'missing'],
    [410, 'text/plain', 'missing'], [403, 'text/html', 'unreachable'], [500, 'text/html', 'unreachable'],
    [200, 'text/html', 'unreachable']]) {
    assert.equal((await checkComicImage(row, { request: async () => new Response(null, { status, headers: { 'content-type': type } }) })).status, expected);
  }
  assert.equal((await checkComicImage(row, { request: async () => { throw new TypeError('Failed to fetch'); } })).status, 'unreachable');
  assert.equal((await checkComicImage({ blob: new Blob(['image']) })).status, 'available');
  assert.equal((await checkComicImage({ blob: new Blob([]) })).status, 'missing');
});
test('servers without HEAD support use a read-only GET fallback and cancellation stays cancellable', async () => {
  const calls = [];
  const result = await checkComicImage({ srcURL: '/original' }, { request: async (_url, options) => {
    calls.push(options.method || 'GET');
    return calls.length === 1 ? new Response(null, { status: 405 })
      : new Response('image', { headers: { 'content-type': 'image/png' } });
  } });
  assert.equal(result.status, 'available'); assert.deepEqual(calls, ['HEAD', 'GET']);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(checkComicImage({ srcURL: '/original' }, { signal: controller.signal }), { name: 'AbortError' });
});
test('asset inspection isolates an unreachable location, counts only usable art and never schedules uncertain re-generation', async () => {
  const row = project(), server = { id: 'server-art', location: 'server' }, browser = { id: 'browser-art', location: 'browser' };
  row.panels[0].image = server;
  row.panels.push({ ...newComicPanel(), image: browser }, { ...newComicPanel(), image: { id: 'missing', location: 'browser' } }, newComicPanel());
  const result = await inspectComicAssets(row, async (location) => {
    if (location === 'server') throw new TypeError('offline');
    return [{ id: browser.id, blob: new Blob(['image']) }];
  });
  assert.equal(result.states.get('server:server-art').status, 'unreachable');
  assert.equal(result.states.get('browser:browser-art').status, 'available');
  assert.equal(result.states.get('browser:missing').status, 'missing');
  const progress = comicProjectProgress(row, [], result.states);
  assert.equal(progress.pictured, 1); assert.equal(progress.missing, 2);
  assert.equal(progress.broken, 1); assert.equal(progress.unreachable, 1);
  assert.deepEqual(comicMissingPanelIds(row, result.states), [row.panels[2].id, row.panels[3].id]);
  assert.equal(row.panels[0].image.id, 'server-art');
});
