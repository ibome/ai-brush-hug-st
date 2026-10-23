import test from 'node:test';
import assert from 'node:assert/strict';
import { newComicProject, newComicPanel } from './comic.js';
import { ComicWorkspace, comicStorySignature } from './comic-workspace.js';
globalThis.window ||= { addEventListener() {} };
const { recoveryBundle, inspectRecovery, mergeRecoveryInbox, copyComicRecovery } = await import('./recovery-drafts.js');
const { createBackup, inspectBackup } = await import('./backup.js');

const rules = { id: 'rules:comic', kind: 'rules', title: '分镜规则', updatedAt: 1,
  data: { task: 'comic', entry: { draft: { prefix: 'new', rules: 'invalid draft still editable' },
    baseline: { prefix: '', rules: 'previous rules' }, updatedAt: 1 } } };
test('draft files retain inactive invalid edits, scrub credentials and merge without replacing earlier drafts', () => {
  const token = 'sk-' + 'private'.repeat(8);
  const pack = recoveryBundle([{ ...rules, data: { ...rules.data, entry: { ...rules.data.entry,
    draft: { ...rules.data.entry.draft, prefix: token } } } }]);
  assert.ok(!JSON.stringify(pack).includes(token));
  assert.equal(inspectRecovery(pack).rows[0].data.entry.draft.rules, 'invalid draft still editable');
  const original = mergeRecoveryInbox([], pack.rows);
  assert.equal(mergeRecoveryInbox(original, pack.rows).length, 1);
  const changed = { ...rules, data: { ...rules.data, entry: { ...rules.data.entry, draft: { prefix: 'next', rules: 'another edit' } } } };
  const next = mergeRecoveryInbox(original, [changed]);
  assert.equal(next.length, 2); assert.notEqual(next[0].id, next[1].id);
  assert.deepEqual(next[0], original[0]);
  assert.throws(() => inspectRecovery({ type: 'other', rows: [] }), /草稿包/);
  assert.throws(() => recoveryBundle([rules, rules]), /重复/);
});
test('comic recovery creates a detached editable project and preserves candidate staleness', () => {
  const project = newComicProject(); project.source = 'A garden scene'; project.panels = [newComicPanel()];
  const workspace = new ComicWorkspace({ key: 'fixture', read: () => null, write: () => true });
  const candidate = structuredClone(project); candidate.panels[0].scene = 'A new scene';
  workspace.draft(project.id, { candidate, candidateBase: comicStorySignature(project), rewrite: null,
    failureResponse: '', failureOpen: false, error: '' }, { tab: 'story' });
  workspace.flush();
  const row = { id: 'comic:fixture', kind: 'comic', title: 'Comic', data: { project, workspace: workspace.get(project.id) } };
  const copied = copyComicRecovery(inspectRecovery(recoveryBundle([row])).rows[0]);
  assert.notEqual(copied.project.id, project.id);
  assert.equal(copied.workspace.draft.candidate.id, copied.project.id);
  assert.equal(copied.workspace.draft.candidateBase, comicStorySignature(copied.project));
  assert.equal(project.panels[0].scene, '');
  row.data.workspace.draft.candidateBase = 'stale';
  assert.equal(copyComicRecovery(row).workspace.draft.candidateBase, '');
});
test('optional drafts round trip in personal backups and stay out of share packages', async () => {
  const drafts = recoveryBundle([rules]), state = {};
  const pack = await createBackup({ state, sections: ['assistant'], drafts });
  const inspected = await inspectBackup(pack);
  assert.deepEqual(inspected.manifest.drafts, drafts);
  const shared = await inspectBackup(await createBackup({ state, sections: ['assistant'], drafts, kind: 'share' }));
  assert.equal(shared.manifest.drafts, undefined);
});
