import { randomUUID } from './crypto-compat.js';
import { normalizeTaskDrafts } from './task-prompt-drafts.js';
import { cleanAssistantDraft } from './assistant-history.js';
import { normalizeComicProject, comicProjectFile } from './comic.js';
import { normalizeComicWorkspace, compactComicWorkspace, comicStorySignature } from './comic-workspace.js';
import { scrubBackup } from './backup-config.js';

export const RECOVERY_LIMIT = 6 * 1024 * 1024;
export const RECOVERY_KINDS = { rules: '任务提示词草稿', assistant: '助手画面草稿', comic: '漫画恢复记录', response: '失败回复' };
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);

export function recoveryRow(value) {
  if (!object(value) || !Object.hasOwn(RECOVERY_KINDS, value.kind) || !/^[A-Za-z0-9_:-]{1,120}$/.test(value.id || '')) {
    throw new Error('草稿记录格式无效');
  }
  let data;
  if (value.kind === 'rules') {
    const task = value.data?.task;
    const entry = normalizeTaskDrafts({ version: 1, entries: { [task]: value.data?.entry } }).entries[task];
    if (!entry) throw new Error('任务提示词草稿为空或无效');
    data = { task, entry };
  } else if (value.kind === 'assistant') {
    const input = text(value.data?.input, 32000), plan = value.data?.plan ? cleanAssistantDraft(value.data.plan) : null;
    if (!input.trim() && !plan) throw new Error('助手草稿为空');
    data = { input, plan };
  } else if (value.kind === 'response') {
    const response = text(value.data?.response, 100000);
    if (!response.trim()) throw new Error('失败回复为空');
    data = { response };
  } else {
    const original = normalizeComicProject(value.data?.project), project = comicProjectFile(original).project;
    const workspace = normalizeComicWorkspace({ version: 1, projects: [value.data?.workspace] }).projects[0];
    if (workspace?.projectId !== project.id) throw new Error('漫画恢复记录与项目不一致');
    const candidateFresh = value.data?.candidateFresh === true || workspace.draft.candidateBase === comicStorySignature(original);
    workspace.draft.candidateBase = '';
    if (workspace.draft.rewrite) { workspace.draft.rewrite.base = ''; workspace.draft.rewrite.identity = ''; }
    data = { project, candidateFresh, workspace: compactComicWorkspace({ version: 1, projects: [workspace] }).projects[0] };
  }
  return { id: value.id, kind: value.kind, title: text(value.title, 100) || RECOVERY_KINDS[value.kind],
    updatedAt: Math.max(0, Number(value.updatedAt) || 0), data };
}

export function recoveryBundle(rows) {
  if (!Array.isArray(rows) || rows.length > 80) throw new Error('草稿最多导出 80 项');
  const clean = rows.map((row) => recoveryRow(scrubBackup(row, { refs: true })));
  if (new Set(clean.map((row) => row.id)).size !== clean.length) throw new Error('草稿标识重复');
  const result = { type: 'linghuashi-recovery-drafts', formatVersion: 1, rows: clean };
  if (bytes(result) > RECOVERY_LIMIT) throw new Error('草稿包超过 6 MB，请减少所选记录');
  return result;
}

export function inspectRecovery(value) {
  if (bytes(value) > RECOVERY_LIMIT || value?.type !== 'linghuashi-recovery-drafts' || value.formatVersion !== 1) {
    throw new Error('不是受支持的灵画师草稿包');
  }
  return recoveryBundle(value.rows);
}

export function mergeRecoveryInbox(existing, incoming) {
  const rows = recoveryBundle(existing).rows;
  for (const row of recoveryBundle(incoming).rows) {
    if (rows.some((old) => old.kind === row.kind && JSON.stringify(old.data) === JSON.stringify(row.data))) continue;
    rows.push({ ...row, id: randomUUID() });
  }
  return recoveryBundle(rows).rows;
}

export function copyComicRecovery(row) {
  const clean = recoveryRow(row), project = structuredClone(clean.data.project);
  const workspace = structuredClone(clean.data.workspace), id = randomUUID();
  project.id = id; project.title = `${project.title.slice(0, 84)} · 恢复副本`;
  project.createdAt = project.updatedAt = Date.now();
  workspace.projectId = id;
  const snapshots = [project, workspace.draft.candidate, workspace.draft.rewrite?.candidate,
    ...workspace.past.map((entry) => entry.project), ...workspace.future.map((entry) => entry.project)].filter(Boolean);
  for (const snapshot of snapshots) {
    snapshot.id = id;
    for (const panel of snapshot.panels) panel.jobs = [];
    if (snapshot.characterScene) snapshot.characterScene.chatKey = '';
  }
  workspace.draft.candidateBase = clean.data.candidateFresh ? comicStorySignature(project) : '';
  // A single-panel rewrite is tied to the original project's interface identity.
  if (workspace.draft.rewrite) workspace.draft.rewrite.base = '';
  return { project: normalizeComicProject(project), workspace };
}
