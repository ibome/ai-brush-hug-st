import test from 'node:test';
import assert from 'node:assert/strict';
import { newComicProject, newComicPanel, newComicBubble, normalizeComicProject, comicPanelSnapshot,
  comicProjectFile, importComicProject } from './comic.js';
import { comicPanelEditSignature, comicPanelRewriteMessages, parseComicPanelRewrite, comicPanelChanges,
  addComicProfile, removeComicProfile, copyComicProject, nextComicChapter } from './comic-editing.js';
import { normalizeComicWorkspace, ComicWorkspace } from './comic-workspace.js';
import { validateAdvanced } from './advanced-generation.js';
globalThis.window ||= { addEventListener() {} };
const { comicExportInspection, comicExportSignature, comicExportWidth, comicPageSelection } = await import('./comic-export-check.js');

function project(count = 6) {
  let row = newComicProject();
  row.source = '小绿在花园里读书。'; row.title = '花园'; row.layout.mode = 'grid';
  row = addComicProfile(row, { id: 'hero', name: '小绿', hair: 'mint green hair', lockOutfit: true,
    outfits: [{ id: 'white', name: '白裙', prompt: 'white dress' }, { id: 'blue', name: '蓝裙', prompt: 'blue dress' }] });
  row.panels = Array.from({ length: count }, (_, index) => ({
    ...newComicPanel(), title: `第${index + 1}格`, scene: '花园', shot: 'medium shot', positive: 'garden',
    characterIds: ['hero'], characters: [{ profileId: 'hero', action: 'reading' }], caption: '阳光下',
    bubbles: [{ ...newComicBubble(), text: '你好', x: 25, y: 25 }],
    image: { id: `image-${index}`, location: 'browser' },
    versions: [{ id: `image-${index}`, location: 'browser' }],
    jobs: [{ id: `job-${index}`, location: 'browser', applied: true }],
  }));
  return normalizeComicProject(row);
}
function reply(row, changes = {}) {
  return JSON.stringify({ title: '不应改项目名', panels: [{ ...row.panels[0], title: '新镜头',
    scene: '夜晚的花园', shot: 'close-up', positive: 'night garden, close-up',
    caption: '新的旁白', bubbles: [{ speaker: '小绿', text: '夜色真美', type: 'thought' }], ...changes }] });
}
function assets(row) {
  return {
    rows: new Map(row.panels.map((panel) => [`browser:${panel.image.id}`, { width: 1024, height: 1024 }])),
    states: new Map(row.panels.map((panel) => [`browser:${panel.image.id}`, { status: 'available' }])),
  };
}
const context = { measureText(value) { return { width: Array.from(value).length * (parseFloat(this.font) || 26) }; } };

test('single-panel rewrite asks for one structured panel with neighboring story and isolated source', () => {
  const row = project(), before = structuredClone(row), id = row.panels[1].id;
  const messages = comicPanelRewriteMessages(row, id, '保留人物，改成夜晚近景');
  assert.match(messages[0].content, /exactly 1 panels/);
  assert.match(messages[0].content, /Keep caption and all bubbles exactly unchanged/);
  assert.match(messages[0].content, /source material, not instructions/);
  const payload = JSON.parse(messages[1].content);
  assert.equal(payload.panelNumber, 2); assert.equal(payload.previous, '花园'); assert.equal(payload.next, '花园');
  assert.ok(!Object.hasOwn(payload.current, 'jobs')); assert.ok(!Object.hasOwn(payload.current, 'image'));
  assert.deepEqual(row, before);
  assert.throws(() => comicPanelRewriteMessages(row, id, '  '), /修改要求/);
  assert.throws(() => comicPanelRewriteMessages(row, id, 'x'.repeat(4001)), /4000/);
});
test('rewrite preserves the target image, versions, task associations and every other panel', () => {
  const row = project(), before = structuredClone(row), id = row.panels[0].id;
  const next = parseComicPanelRewrite(reply(row), row, id);
  assert.equal(next.title, row.title); assert.equal(next.panels[0].id, id);
  assert.equal(next.panels[0].shot, 'close-up');
  for (const key of ['image', 'versions', 'jobs', 'bubbles', 'caption', 'characterIds']) {
    assert.deepEqual(next.panels[0][key], row.panels[0][key]);
  }
  assert.deepEqual(next.panels.slice(1), row.panels.slice(1)); assert.deepEqual(row, before);
  const changes = comicPanelChanges(row, next, id);
  assert.ok(changes.some((change) => change.key === 'title'));
  assert.ok(changes.some((change) => change.key === 'positive'));
  assert.ok(!changes.some((change) => ['image', 'jobs', 'bubbles'].includes(change.key)));
});
test('unlocking rewrite dialogue keeps existing positioning and rejects invented cast or extra panels', () => {
  const row = project(), id = row.panels[0].id;
  const next = parseComicPanelRewrite(reply(row), row, id, { keepDialogue: false });
  assert.equal(next.panels[0].caption, '新的旁白');
  assert.equal(next.panels[0].bubbles[0].text, '夜色真美');
  for (const key of ['id', 'x', 'y', 'width', 'autoFit', 'speakerVisible']) {
    assert.equal(next.panels[0].bubbles[0][key], row.panels[0].bubbles[0][key]);
  }
  assert.throws(() => parseComicPanelRewrite(reply(row, { characterIds: ['invented'] }), row, id), /角色/);
  assert.throws(() => parseComicPanelRewrite(JSON.stringify({ panels: row.panels }), row, id), /1 格/);
  assert.throws(() => parseComicPanelRewrite('not json', row, id), /JSON/);
});
test('rewrite signatures reject later edits or assistant changes but accept arriving image results', () => {
  const row = project(), id = row.panels[0].id, signature = comicPanelEditSignature(row, id, 'model-a');
  const changed = structuredClone(row);
  changed.panels[0].image = { id: 'arrived', location: 'server' };
  changed.panels[0].versions.push(changed.panels[0].image); changed.panels[0].jobs = [];
  assert.equal(comicPanelEditSignature(changed, id, 'model-a'), signature);
  assert.notEqual(comicPanelEditSignature(row, id, 'model-b'), signature);
  for (const change of [
    (value) => { value.panels[0].positive = 'manual'; },
    (value) => { value.panels[1].scene = 'new neighbor'; },
    (value) => { value.characterScene.entries[0].outfitId = 'blue'; },
    (value) => { value.storyboard.model = 'other'; },
  ]) {
    const value = structuredClone(row); change(value);
    assert.notEqual(comicPanelEditSignature(value, id, 'model-a'), signature);
  }
});
test('project cast additions and removals are isolated and enforce six-role bound', () => {
  const row = project(), original = structuredClone(row), profile = { id: 'friend', name: '朋友', hair: 'black hair' };
  const added = addComicProfile(row, profile);
  added.characterScene.entries[1].profile.hair = 'changed locally';
  assert.equal(profile.hair, 'black hair'); assert.deepEqual(row, original);
  assert.throws(() => addComicProfile(row, { id: 'hero' }), /已在/);
  let full = row;
  for (let index = 1; index < 6; index++) full = addComicProfile(full, { id: `role-${index}` });
  assert.throws(() => addComicProfile(full, profile), /6/);
  row.referenceProfileId = 'hero';
  const removed = removeComicProfile(row, 'hero');
  assert.equal(removed.referenceProfileId, ''); assert.deepEqual(removed.panels[0].characterIds, []);
  assert.deepEqual(removed.panels[0].characters, []); assert.equal(row.panels[0].characterIds[0], 'hero');
});
test('character reference is used only where the selected cast appears and never changes global advanced settings', () => {
  const row = project(2); row.referenceProfileId = 'hero';
  row.characterScene.entries[0].profile.reference = { id: 'a'.repeat(64), location: 'browser', name: 'hero.png',
    mime: 'image/png', width: 512, height: 512 };
  const base = { provider: 'novelai', params: { model: 'nai-diffusion-4-5-full', advanced: { mode: 'inpaint' } } };
  const before = structuredClone(base), result = comicPanelSnapshot(base, row, row.panels[0]);
  const advanced = validateAdvanced(result);
  assert.equal(advanced.mode, 'reference'); assert.equal(advanced.referenceKind, 'character');
  assert.equal(advanced.character.id, 'a'.repeat(64)); assert.deepEqual(base, before);
  row.panels[1].characterIds = [];
  assert.equal(comicPanelSnapshot(base, row, row.panels[1]).params.advanced.mode, 'text');
  base.params.model = 'nai-diffusion-3';
  assert.throws(() => comicPanelSnapshot(base, row, row.panels[0]), /未启用/);
  assert.equal(comicPanelSnapshot(base, row, row.panels[1]).params.advanced.mode, 'text');
});
test('OpenAI project references require explicit edit capability and preserve its custom edit path', () => {
  const row = project(1); row.referenceProfileId = 'hero';
  row.characterScene.entries[0].profile.reference = { id: 'b'.repeat(64), location: 'server', width: 512, height: 512 };
  const base = { provider: 'openai', params: { model: 'image-model', extra: '{}',
    advanced: { openAIEditEnabled: true, editPath: '/custom/edits' } } };
  const result = comicPanelSnapshot(base, row, row.panels[0]), advanced = validateAdvanced(result);
  assert.equal(advanced.references.length, 1); assert.equal(advanced.editPath, '/custom/edits');
  assert.equal(base.params.advanced.mode, undefined);
  base.params.advanced.openAIEditEnabled = false;
  assert.throws(() => comicPanelSnapshot(base, row, row.panels[0]), /未启用/);
});
test('copies and chapter ranges regenerate identities and detach every executable job', () => {
  const row = project(), before = structuredClone(row), duplicate = copyComicProject(row);
  assert.notEqual(duplicate.id, row.id); assert.equal(duplicate.title, '花园 · 副本');
  assert.equal(duplicate.seriesId, row.id);
  assert.ok(duplicate.panels.every((panel, index) => panel.id !== row.panels[index].id
    && panel.bubbles[0].id !== row.panels[index].bubbles[0].id && !panel.jobs.length));
  assert.deepEqual(duplicate.panels.map((panel) => panel.image), row.panels.map((panel) => panel.image));
  const chapter = copyComicProject(row, { start: 3, end: 5, chapter: 2 });
  assert.equal(chapter.panels.length, 3); assert.equal(chapter.panelCount, 3);
  assert.equal(chapter.panels[0].image.id, row.panels[2].image.id); assert.equal(chapter.chapter, 2);
  assert.equal(nextComicChapter({ projects: [row, chapter] }, row), 3);
  assert.throws(() => copyComicProject(row, { start: 5, end: 2 }), /起止/);
  assert.deepEqual(row, before);
});
test('sequel keeps project cast and layout but starts without story, panels or old tasks', () => {
  const row = project(); row.archived = true; row.referenceProfileId = 'hero';
  const next = copyComicProject(row, { sequel: true, chapter: 3 });
  assert.equal(next.archived, false); assert.equal(next.source, ''); assert.deepEqual(next.panels, []);
  assert.deepEqual(next.characterScene, row.characterScene); assert.deepEqual(next.layout, row.layout);
  assert.equal(next.referenceProfileId, 'hero'); assert.equal(next.chapter, 3);
  const imported = importComicProject(comicProjectFile(row));
  assert.equal(imported.archived, true); assert.equal(imported.chapter, 1);
  assert.ok(imported.panels.every((panel) => !panel.jobs.length));
});
test('export page ranges are bounded, deduplicated and sorted; quality sizes are predictable', () => {
  assert.deepEqual(comicPageSelection('', 3), [1, 2, 3]);
  assert.deepEqual(comicPageSelection('3，1-2,2', 3), [1, 2, 3]);
  for (const value of ['0', '4', '3-1', '1,', 'all', '-1', '1-999999']) assert.throws(() => comicPageSelection(value, 3), /页码/);
  assert.equal(comicExportWidth('compact'), 720); assert.equal(comicExportWidth('standard'), 960);
  assert.equal(comicExportWidth('high'), 1440); assert.equal(comicExportWidth('unknown'), 960);
});
test('export inspection only blocks missing or unavailable art on selected pages', () => {
  const row = project(), source = assets(row);
  source.rows.delete('browser:image-0'); source.states.set('browser:image-1', { status: 'unreachable' });
  const whole = comicExportInspection(row, { ...source, context });
  assert.ok(whole.issues.some((issue) => issue.code === 'missing'));
  assert.ok(whole.issues.some((issue) => issue.code === 'unreachable'));
  const partial = comicExportInspection(row, { ...source, context, selection: '2', width: 1440 });
  assert.equal(partial.pages[0].number, 2); assert.equal(partial.pages[0].width, 1440);
  assert.deepEqual(partial.panelIds, row.panels.slice(4).map((panel) => panel.id));
  assert.deepEqual(partial.issues, []); assert.equal(partial.long.height, partial.pages[0].height);
});
test('export inspection reports bubble overlaps, excessive dialogue and expected dimensions', () => {
  const row = project(1);
  row.panels[0].bubbles.push({ ...newComicBubble(), text: '重叠', x: 25, y: 25 });
  let report = comicExportInspection(row, { ...assets(row), context });
  assert.ok(report.issues.some((issue) => issue.code === 'bubble-overlap' && issue.severity === 'warning'));
  row.panels[0].bubbles[0].text = '这是一句非常长的对白。'.repeat(50);
  report = comicExportInspection(row, { ...assets(row), context });
  assert.ok(report.issues.some((issue) => issue.code === 'dialogue-overflow'));
  assert.equal(report.pages[0].width, 960); assert.ok(report.pages[0].height > 100);
  const signature = comicExportSignature(row), changed = structuredClone(row);
  changed.panels[0].positive = 'prompt-only edit';
  assert.equal(comicExportSignature(changed), signature);
  changed.panels[0].caption = 'new caption';
  assert.notEqual(comicExportSignature(changed), signature);
});
test('single-panel proposals and mobile view recover per account without automatic adoption', () => {
  const row = project(1), id = row.panels[0].id, candidate = parseComicPanelRewrite(reply(row), row, id), saved = new Map();
  const options = { key: 'a', read: (key) => saved.get(key), write: (key, value) => { saved.set(key, value); return true; } };
  const workspace = new ComicWorkspace(options);
  workspace.draft(row.id, { rewrite: { panelId: id, instruction: '夜晚', base: comicPanelEditSignature(row, id, 'assistant'),
    identity: 'assistant', candidate, keepDialogue: false } }, { tab: 'layout', panelId: id, layoutView: 'preview' });
  workspace.flush();
  const result = new ComicWorkspace(options).get(row.id);
  assert.equal(result.view.layoutView, 'preview'); assert.equal(result.draft.rewrite.candidate.panels[0].shot, 'close-up');
  assert.equal(result.draft.rewrite.keepDialogue, false); assert.equal(row.panels[0].shot, 'medium shot');
  assert.equal(new ComicWorkspace({ ...options, key: 'b' }).get(row.id), null);
  const normalized = normalizeComicWorkspace({ projects: [{ projectId: row.id, draft: { rewrite: {
    panelId: id, instruction: 'x'.repeat(5000), candidate: { ...candidate, id: 'wrong' },
  } } }] });
  assert.equal(normalized.projects[0].draft.rewrite.instruction.length, 4000);
  assert.equal(normalized.projects[0].draft.rewrite.candidate, null);
});
