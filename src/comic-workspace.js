import { randomUUID } from './crypto-compat.js';
import { normalizeComicProject, comicRefKey, COMIC_LIMITS } from './comic.js';
import { readBrowserCache, writeBrowserCache } from './browser-cache.js';

export const COMIC_WORKSPACE_BYTES = 1500000;
export const COMIC_HISTORY_LIMIT = 12;
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const clone = (value) => structuredClone(value);

function editable(project, images = true) {
  if (!project) return null;
  const { updatedAt, createdAt, ...value } = clone(project);
  for (const panel of value.panels) {
    delete panel.jobs; delete panel.versions;
    if (!images) delete panel.image;
  }
  return value;
}
export const comicEditSignature = (project) => JSON.stringify(editable(project));
export const comicStorySignature = (project) => JSON.stringify(project && [
  project.source, project.panelCount, project.style, project.negative, project.characterScene,
  editable(project, false).panels,
]);
export function comicGenerationSignature(project, ids, identity) {
  return JSON.stringify([identity, project.id, project.style, project.negative, project.characterScene, project.referenceProfileId,
    ids.map((id) => editable(project).panels.find((panel) => panel.id === id))]);
}
function cleanProject(value, projectId) {
  try {
    if (!object(value) || value.id !== projectId || !Array.isArray(value.panels)) return null;
    return normalizeComicProject(value);
  } catch { return null; }
}
function cleanRevision(value, projectId) {
  const project = cleanProject(value?.project, projectId);
  return project && validId(value.id) ? { id: value.id, createdAt: Number(value.createdAt) || 0,
    label: text(value.label, 60), imageEdits: (Array.isArray(value.imageEdits) ? value.imageEdits : []).filter(validId).slice(0, 12), project } : null;
}
function cleanEntry(value) {
  if (!object(value) || !validId(value.projectId)) return null;
  const candidate = cleanProject(value.draft?.candidate, value.projectId);
  return {
    projectId: value.projectId, updatedAt: Number(value.updatedAt) || 0,
    draft: { candidate, candidateBase: candidate ? text(value.draft?.candidateBase, 750000) : '',
      rewrite: object(value.draft?.rewrite) && validId(value.draft.rewrite.panelId) ? {
        panelId: value.draft.rewrite.panelId, instruction: text(value.draft.rewrite.instruction, 4000),
        keepDialogue: value.draft.rewrite.keepDialogue !== false, keepCharacters: value.draft.rewrite.keepCharacters !== false,
        base: text(value.draft.rewrite.base, 750000), identity: text(value.draft.rewrite.identity, 16000),
        candidate: cleanProject(value.draft.rewrite.candidate, value.projectId),
      } : null,
      failureResponse: text(value.draft?.failureResponse, 100000), error: text(value.draft?.error, 1000),
      failureOpen: value.draft?.failureOpen === true },
    view: { tab: ['story', 'generate', 'layout', 'read'].includes(value.view?.tab) ? value.view.tab : 'story',
      panelId: validId(value.view?.panelId) ? value.view.panelId : '',
      layoutView: value.view?.layoutView === 'preview' ? 'preview' : 'edit',
      selectedBubble: validId(value.view?.selectedBubble) ? value.view.selectedBubble : '',
      snap: value.view?.snap !== false,
      scrollTop: Math.max(0, Math.min(1000000, Number(value.view?.scrollTop) || 0)),
      tabScroll: Math.max(0, Math.min(100000, Number(value.view?.tabScroll) || 0)) },
    past: (Array.isArray(value.past) ? value.past : []).slice(0, COMIC_HISTORY_LIMIT)
      .map((row) => cleanRevision(row, value.projectId)).filter(Boolean),
    future: (Array.isArray(value.future) ? value.future : []).slice(0, COMIC_HISTORY_LIMIT)
      .map((row) => cleanRevision(row, value.projectId)).filter(Boolean),
  };
}
export function normalizeComicWorkspace(value) {
  const projects = [], seen = new Set();
  for (const item of (Array.isArray(value?.projects) ? value.projects : []).slice(0, COMIC_LIMITS.chapters)) {
    const entry = cleanEntry(item);
    if (entry && !seen.has(entry.projectId)) { seen.add(entry.projectId); projects.push(entry); }
  }
  return { version: 1, projects };
}
export function compactComicWorkspace(value, budget = COMIC_WORKSPACE_BYTES) {
  const result = clone(value);
  while (bytes(result) > budget) {
    const candidates = result.projects.flatMap((entry) => ['past', 'future'].filter((key) => entry[key].length)
      .map((key) => ({ entry, key, time: entry[key].at(-1).createdAt }))).sort((a, b) => a.time - b.time);
    if (!candidates.length) throw new Error('漫画恢复记录容量不足，请导出项目并清除不再需要的分镜草稿');
    candidates[0].entry[candidates[0].key].pop();
  }
  return result;
}
export function restoreComicRevision(snapshot, current, imageEdits = []) {
  const restored = clone(snapshot);
  restored.createdAt = current.createdAt;
  restored.updatedAt = Date.now();
  // Task associations and image versions may have advanced since the edit snapshot.
  for (const panel of restored.panels) {
    const live = current.panels.find((row) => row.id === panel.id);
    if (!live) continue;
    if (!imageEdits.includes(panel.id)) panel.image = clone(live.image);
    panel.jobs = clone(live.jobs);
    panel.versions = [...new Map([...panel.versions, ...live.versions, live.image, panel.image]
      .filter(Boolean).map((ref) => [comicRefKey(ref), ref])).values()].slice(-COMIC_LIMITS.versions);
  }
  return normalizeComicProject(restored);
}

export class ComicWorkspace {
  constructor({ key, read = readBrowserCache, write = writeBrowserCache, onStatus = () => {} } = {}) {
    Object.assign(this, { key, write, onStatus });
    let value;
    try { const raw = read(key); if (raw?.length <= COMIC_WORKSPACE_BYTES) value = JSON.parse(raw); } catch {}
    this.value = normalizeComicWorkspace(value);
    this.groups = new Map();
    this.status = 'idle';
  }
  entry(projectId) {
    let entry = this.value.projects.find((row) => row.projectId === projectId);
    if (!entry) {
      entry = cleanEntry({ projectId });
      if (!entry) throw new Error('漫画项目标识无效');
      this.value.projects.push(entry);
    }
    return entry;
  }
  get(projectId) { return clone(this.value.projects.find((row) => row.projectId === projectId) || null); }
  history(projectId) {
    const entry = this.value.projects.find((row) => row.projectId === projectId);
    return { past: entry?.past.map(({ project, ...row }) => ({ ...row, panels: project.panels.length })) || [],
      future: entry?.future.map(({ id }) => ({ id })) || [] };
  }
  retain(ids) {
    const valid = new Set(ids);
    this.value.projects = this.value.projects.filter((row) => valid.has(row.projectId));
  }
  draft(projectId, draft, view) {
    const entry = this.entry(projectId);
    if (JSON.stringify([entry.draft, entry.view]) === JSON.stringify([draft, view])) return;
    entry.draft = clone(draft);
    entry.view = clone(view);
    entry.updatedAt = Date.now();
    this.schedule();
  }
  record(before, after, { label = '编辑项目', group = '', now = Date.now() } = {}) {
    if (comicEditSignature(before) === comicEditSignature(after)) return;
    const entry = this.entry(before.id), previous = this.groups.get(before.id);
    if (!group || previous?.key !== group || now - previous.time > 1200 || !entry.past.length) {
      const imageEdits = before.panels.filter((panel) => {
        const next = after.panels.find((row) => row.id === panel.id);
        return next && comicRefKey(panel.image) !== comicRefKey(next.image);
      }).map((panel) => panel.id);
      entry.past.unshift({ id: randomUUID(), createdAt: now, label, imageEdits, project: clone(before) });
      entry.past = entry.past.slice(0, COMIC_HISTORY_LIMIT);
    }
    this.groups.set(before.id, { key: group, time: now });
    entry.future = []; this.schedule();
  }
  travel(current, direction, revisionId) {
    const entry = this.entry(current.id), source = direction === 'redo' ? entry.future : entry.past;
    const index = revisionId ? source.findIndex((row) => row.id === revisionId) : 0;
    const revision = source[index];
    if (!revision) throw new Error('没有可恢复的漫画编辑记录');
    const next = restoreComicRevision(revision.project, current, revision.imageEdits);
    return { project: next, label: revision.label, commit: () => {
      if (revisionId) {
        entry.past.unshift({ id: randomUUID(), createdAt: Date.now(), label: '恢复历史前', imageEdits: revision.imageEdits, project: clone(current) });
        entry.past = entry.past.slice(0, COMIC_HISTORY_LIMIT); entry.future = [];
      } else {
        source.shift();
        const target = direction === 'redo' ? entry.past : entry.future;
        target.unshift({ id: randomUUID(), createdAt: Date.now(), label: revision.label, imageEdits: revision.imageEdits, project: clone(current) });
        target.splice(COMIC_HISTORY_LIMIT);
      }
      this.groups.delete(current.id); this.schedule();
    } };
  }
  schedule() {
    clearTimeout(this.timer);
    this.status = 'pending';
    this.timer = setTimeout(() => this.flush(), 200);
  }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    try {
      const value = compactComicWorkspace(this.value);
      if (!this.write(this.key, JSON.stringify(value))) throw new Error('本设备无法保存漫画恢复记录，请检查浏览器存储');
      this.value = value; this.status = 'saved'; this.onStatus('');
      return true;
    } catch (error) { this.status = 'error'; this.onStatus(error.message); return false; }
  }
}
