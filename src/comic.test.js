import test from 'node:test';
import assert from 'node:assert/strict';
import { newComicProject, newComicPanel, newComicBubble, normalizeComicLibrary, saveComicProject, comicSource,
  comicStoryboardMessages, parseComicStoryboard, comicPanelSnapshot, reconcileComicJobs, comicProjectFile, importComicProject,
  validateComicLibrary, comicPanelBusy, comicAssistantOptions, cleanComicSource, normalizeComicLayout,
  comicProjectProgress, comicPanelTask } from './comic.js';
import { createAssistantHost } from './assistant-host.js';
import { comicProjectPack, readComicProjectPack } from './comic-project-pack.js';
globalThis.window ||= { addEventListener() {} };
const { comicPageGeometry, comicLongGeometry, wrapComicText, comicOfflineHTML, comicBubbleGeometry } = await import('./comic-export.js');
const { normalizeBackupConfig, mergeBackupConfig } = await import('./backup-config.js');

function project(count = 4) {
  const row = newComicProject();
  row.source = '她打开门，走进花园。'; row.panelCount = count;
  row.panels = Array.from({ length: count }, () => ({ ...newComicPanel(), scene: '花园', positive: 'garden' }));
  return row;
}
function storyboard(row) {
  return JSON.stringify({ title: '花园日记', panels: row.panels.map((panel) => ({ ...panel, characterIds: [] })) });
}
test('comic projects are bounded, independent and retain selected images', () => {
  const row = project(), ref = { id: 'saved-frame', location: 'server' };
  row.panels[0].image = ref;
  const library = saveComicProject(normalizeComicLibrary(), row);
  assert.deepEqual(library.projects[0].panels[0].versions, [ref]);
  assert.equal(library.activeId, row.id);
  assert.equal(row.panels[0].versions.length, 0);
  assert.throws(() => validateComicLibrary({ projects: Array.from({ length: 9 }, () => project()) }), /8/);
  assert.throws(() => saveComicProject(library, { ...row, panels: [...row.panels, row.panels[0]] }), /重复/);
  assert.throws(() => saveComicProject(library, { ...row, source: 'x'.repeat(32001) }), /32000/);
});
test('comic source defaults to the last complete non-system character message and supports ranges', () => {
  const context = { name2: '绘图角色', chat: [
    { is_user: true, name: 'User', mes: '开门吧' }, { mes: '她走进花园' }, { is_system: true, mes: 'private system' },
  ] };
  assert.match(comicSource(context).source, /她走进花园/);
  assert.equal(comicSource(context).start, 2);
  assert.ok(!comicSource(context, { start: 1, end: 3 }).source.includes('private system'));
  assert.match(comicSource(context, { start: 1, end: 2 }).source, /开门吧/);
  assert.throws(() => comicSource(context, { start: 0, end: 2 }), /范围/);
  assert.throws(() => comicSource({ chat: [] }), /没有/);
  assert.throws(() => comicSource({ chat: [{ mes: 'x'.repeat(32001) }] }), /32000/);
});
test('comic storyboard extracts complete wrapped JSON and validates count and cast', () => {
  const row = project();
  assert.match(comicStoryboardMessages(row)[0].content, /exactly 4 panels/);
  assert.equal(parseComicStoryboard(`\`\`\`json\n${storyboard(row)}\n\`\`\``, row).panels.length, 4);
  assert.equal(parseComicStoryboard('intro ' + storyboard(row) + '\n分镜完成。', row).panels.length, 4);
  assert.equal(parseComicStoryboard('<think>{"panels":[]}</think>\n' + storyboard(row), row).panels.length, 4);
  assert.throws(() => parseComicStoryboard(storyboard(project(3)), row), /4 格/);
  const invalid = JSON.parse(storyboard(row)); invalid.panels[0].characterIds = ['invented'];
  assert.throws(() => parseComicStoryboard(JSON.stringify(invalid), row), /角色/);
  invalid.panels[0].characterIds = []; invalid.panels[0].bubbles = Array.from({ length: 5 }, newComicBubble);
  assert.throws(() => parseComicStoryboard(JSON.stringify(invalid), row), /字段/);
  const parsed = parseComicStoryboard(storyboard(row), row);
  assert.notEqual(parsed.panels[0].id, row.panels[0].id);
  assert.equal(parsed.panels[0].jobs.length, 0);
});
test('comic parsing keeps failed output only on the error and preserves custom project titles', () => {
  const row = project(); row.title = '我的项目名';
  assert.equal(parseComicStoryboard(storyboard(row), row).title, '我的项目名');
  for (const [raw, reason] of [
    ['{"panels":[', /未闭合/], ['没有任何 JSON', /未找到/],
    [storyboard(row) + storyboard(row), /多份/],
    ['<think>not finished', /未闭合/],
    ['{"title":"wrong schema"}', /panels/],
  ]) assert.throws(() => parseComicStoryboard(raw, row), (error) => {
    assert.match(error.message, reason);
    assert.equal(error.assistantResponse, raw);
    assert.equal(Object.getOwnPropertyDescriptor(error, 'assistantResponse').enumerable, false);
    assert.ok(!JSON.stringify(error).includes(raw)); return true;
  });
  const invalid = JSON.parse(storyboard(row));
  invalid.panels[0].characters = {};
  assert.throws(() => parseComicStoryboard(JSON.stringify(invalid), row), /第 1 格分镜字段/);
});
test('comic task settings are project-local, keep existing inheritance and reach the Tavern host', async () => {
  const a = { source: 'tavern', presetMode: 'current', responseMode: 'tool', maxTokens: 4000, tavernModel: 'chat' };
  const row = project(), inherited = { ...row, storyboard: undefined };
  assert.equal(comicAssistantOptions(a, inherited).presetMode, 'current');
  row.storyboard = { presetMode: 'none', responseMode: 'json', maxTokens: 32768, model: 'comic' };
  const options = comicAssistantOptions(a, row);
  assert.equal(options.tavernModel, 'comic'); assert.equal(options.presetMode, 'none');
  assert.equal(options.maxTokens, 32768); assert.equal(a.maxTokens, 4000); assert.equal(a.tavernModel, 'chat');
  let received, posted;
  const host = createAssistantHost({ getContext: () => ({}), settings: () => a,
    post: (_type, result) => { posted = result; }, textAccess: { generate: async (_messages, options) => { received = options; return '{}'; } } });
  await host.receive({ requestId: 'comic-settings-test', action: 'text',
    messages: [{ role: 'system', content: 'rules' }, { role: 'user', content: 'story' }],
    taskOptions: { maxTokens: 32768, responseMode: 'json', tavernModel: 'comic' } });
  assert.equal(received.maxTokens, 32768); assert.equal(received.responseMode, 'json');
  assert.equal(received.tavernModel, 'comic'); assert.ok(!posted.error); assert.equal(a.responseMode, 'tool');
});
test('comic chat extraction strips thought and image wrappers and retains visible story', () => {
  const input = '<think>private planning</think><p>她走进花园。</p>image###garden###<img src="x">';
  assert.equal(cleanComicSource(input), '她走进花园。');
  const result = comicSource({ chat: [{ mes: input }] });
  assert.equal(result.cleaned, true); assert.ok(!result.source.includes('private planning'));
  assert.match(result.label, /含用户消息/);
});
test('each comic image snapshot isolates prompts, mode and sample count', () => {
  const row = project(), panel = row.panels[0];
  const base = { provider: 'openai', params: { model: 'image', positive: 'old', negative: 'old', n: 4, extra: '{"n":8,"seed":42}', advanced: { mode: 'inpaint' } } };
  const result = comicPanelSnapshot(base, row, panel);
  assert.equal(result.params.n, 1);
  assert.deepEqual(JSON.parse(result.params.extra), { seed: -1 });
  assert.equal(result.params.advanced.mode, 'text');
  assert.match(result.params.positive, /single comic panel/);
  assert.equal(base.params.positive, 'old');
  assert.equal(base.params.n, 4);
  assert.equal(comicPanelSnapshot({ provider: 'sdwebui', params: { batch: 4 } }, row, panel).params.batch, 1);
  assert.equal(comicPanelSnapshot({ provider: 'novelai', params: { nSamples: 3 } }, row, panel).params.nSamples, 1);
});
test('completed durable comic jobs reconcile once, preserving older image selection', () => {
  const row = project(1), panel = row.panels[0];
  panel.jobs = [{ id: 'job1', location: 'server', createdAt: 1 }];
  const library = saveComicProject(normalizeComicLibrary(), row);
  const jobs = [{ id: 'job1', savedIds: ['job1-0'], status: 'completed' }];
  const next = reconcileComicJobs(library, jobs);
  assert.equal(next.projects[0].panels[0].image.id, 'job1-0');
  assert.equal(reconcileComicJobs(next, jobs), null);
  next.projects[0].panels[0].image = null;
  assert.equal(reconcileComicJobs(next, jobs), null);
  assert.equal(comicPanelBusy(panel, [{ id: 'job1', status: 'uncertain' }]), true);
  assert.equal(comicPanelBusy(panel, jobs), false);
});
test('pruned comic versions are never reinserted by polling older completed tasks', () => {
  const row = project(1), panel = row.panels[0];
  panel.jobs = Array.from({ length: 24 }, (_, index) => ({ id: `job-${index}`, location: 'server', createdAt: index }));
  const jobs = panel.jobs.map((job) => ({ id: job.id, status: 'completed', savedIds: [`${job.id}-0`] }));
  const updated = reconcileComicJobs(saveComicProject(normalizeComicLibrary(), row), jobs);
  assert.equal(updated.projects[0].panels[0].versions.length, 16);
  assert.equal(reconcileComicJobs(updated, jobs), null);
});
test('comic progress separates saved images from active redraws and unresolved tasks', () => {
  const row = project(4);
  row.panels.forEach((panel, index) => {
    panel.image = { id: `image-${index}`, location: 'browser' };
    panel.jobs = [{ id: `job-${index}`, location: 'browser' }];
  });
  const jobs = ['running', 'queued', 'uncertain', 'failed'].map((status, index) => ({ id: `job-${index}`, status }));
  assert.deepEqual(comicProjectProgress(row, jobs), {
    total: 4, pictured: 4, missing: 0, running: 1, queued: 1, paused: 0, uncertain: 1, failed: 1, cancelled: 0,
  });
  row.panels[0].jobs.push({ id: 'newer-finished', location: 'browser' });
  jobs.push({ id: 'newer-finished', status: 'completed' });
  assert.equal(comicPanelTask(row.panels[0], jobs).status, 'running');
  assert.equal(comicProjectProgress(null, []).total, 0);
});
test('comic version selection retains same-id images in different storage locations', () => {
  const row = project(1), panel = row.panels[0];
  panel.versions = [{ id: 'same-id', location: 'browser' }, { id: 'same-id', location: 'server' }];
  panel.image = panel.versions[1];
  const library = saveComicProject(normalizeComicLibrary(), row);
  assert.deepEqual(library.projects[0].panels[0].versions, panel.versions);
  assert.deepEqual(library.projects[0].panels[0].image, panel.image);
  panel.image = { id: 'selected-from-library', location: 'browser' };
  const changed = saveComicProject(library, row);
  assert.equal(changed.projects[0].panels[0].versions.length, 3);
  assert.equal(changed.projects[0].panels[0].jobs.length, 0);
});
test('portable comic imports detach task ids and regenerate identities without losing images', () => {
  const row = project(1);
  row.panels[0].jobs = [{ id: 'oldjob', location: 'server', createdAt: 1 }];
  row.panels[0].image = { id: 'oldjob-0', location: 'server' };
  const imported = importComicProject(comicProjectFile(row));
  assert.notEqual(imported.id, row.id);
  assert.notEqual(imported.panels[0].id, row.panels[0].id);
  assert.equal(imported.panels[0].jobs.length, 0);
  assert.deepEqual(imported.panels[0].image, row.panels[0].image);
  assert.equal(row.panels[0].jobs.length, 1);
});
test('comic backups detach imported tasks while preserving existing local associations', () => {
  const row = project(1);
  row.panels[0].jobs = [{ id: 'localtask', location: 'browser', createdAt: 1 }];
  const current = normalizeBackupConfig({});
  current.comicLibrary = saveComicProject(normalizeComicLibrary(), row);
  const backup = normalizeBackupConfig(current, ['comics']);
  assert.equal(backup.comicLibrary.projects[0].panels[0].jobs.length, 0);
  const merged = mergeBackupConfig(current, normalizeBackupConfig({}, ['general']), ['general']);
  assert.equal(merged.comicLibrary.projects[0].panels[0].jobs[0].id, 'localtask');
  const replaced = mergeBackupConfig(current, backup, ['comics'], 'replace');
  assert.equal(replaced.comicLibrary.projects[0].panels[0].jobs.length, 0);
});
test('comic geometry paginates and mirrors columns without reordering story', () => {
  const row = project(6); row.layout.mode = 'grid';
  const pages = comicPageGeometry(row);
  assert.deepEqual(pages.map((page) => page.rects.length), [4, 2]);
  const left = pages[0].rects[0].x;
  row.layout.direction = 'rtl';
  const mirrored = comicPageGeometry(row);
  assert.ok(mirrored[0].rects[0].x > left);
  assert.equal(mirrored[0].rects[0].index, 0);
  assert.throws(() => comicLongGeometry([{ width: 960, height: 17000 }]), /长图/);
});
test('automatic comic layout follows image proportions and contains images by default', () => {
  const row = project(1); row.panels[0].image = { id: 'landscape', location: 'browser' };
  assert.equal(normalizeComicLayout().fit, 'contain');
  const pages = comicPageGeometry(row, 960, new Map([['browser:landscape', { width: 1200, height: 800 }]]));
  const rect = pages[0].rects[0];
  assert.ok(Math.abs(rect.imageHeight / rect.width - 2 / 3) < 0.002);
  row.layout.aspect = 'portrait';
  assert.equal(comicPageGeometry(row)[0].rects[0].imageHeight, Math.round(rect.width * 1.25));
});
test('comic wrapping prevents line-leading Chinese punctuation and auto-fits short dialogue', () => {
  const context = { measureText: (value) => ({ width: Array.from(value).length * 10 }) };
  const lines = wrapComicText(context, '你好世界。新的「世界」！', 40);
  assert.ok(lines.every((line) => !/^[。！？」]/.test(line) && !/[「（]$/.test(line)));
  assert.ok(lines.every((line) => context.measureText(line).width <= 40));
  const rect = { x: 0, y: 0, width: 400, imageHeight: 300 };
  const bubble = { ...newComicBubble(), speaker: '很长的说话人名字', text: '旧事虽忘，剑心尚在。' };
  const fitted = comicBubbleGeometry(context, bubble, rect, normalizeComicLayout(), 1);
  assert.ok(!fitted.lines.join('').includes(bubble.speaker));
  assert.ok(fitted.lines.length <= 3); assert.ok(fitted.x >= 0 && fitted.x + fitted.width <= 400);
});
test('comic project packs carry current images, detach tasks and remap editable projects', async () => {
  const row = project(1); row.panels[0].image = { id: 'current', location: 'browser' };
  row.panels[0].versions = [{ id: 'older', location: 'browser' }, row.panels[0].image];
  row.panels[0].jobs = [{ id: 'job', location: 'browser' }];
  const blob = new Blob(['fixture-image'], { type: 'image/png' });
  const file = await comicProjectPack(row, new Map([['browser:current', blob]]));
  const result = await readComicProjectPack(file);
  assert.notEqual(result.project.id, row.id);
  assert.equal(result.project.panels[0].jobs.length, 0);
  assert.equal(result.project.panels[0].versions.length, 1);
  assert.equal(await result.blobs.get('browser:current').text(), 'fixture-image');
  await assert.rejects(comicProjectPack(row, new Map()), /缺失/);
});
test('comic wrapping handles CJK, newlines and Unicode; offline HTML escapes prose', async () => {
  assert.deepEqual(wrapComicText({ measureText: (value) => ({ width: Array.from(value).length * 10 }) }, '你好世界\nHi', 20), ['你好', '世界', 'Hi']);
  const row = project(1); row.title = '<script>alert(1)</script>'; row.panels[0].caption = '<img src=x>';
  const html = await (await comicOfflineHTML(row, [{ blob: new Blob(['png'], { type: 'image/png' }), width: 1, height: 1 }])).text();
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;img src=x&gt;'));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(!/https?:\/\//.test(html));
});
