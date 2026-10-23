import { randomUUID, sha256Hex } from './crypto-compat.js';
import { validateComicLibrary, COMIC_LIMITS, comicProjectFile, comicRefKey, importComicProject } from './comic.js';

const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
const validKey = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const COMIC_CHAPTER_BUNDLE_BYTES = 12 * 1024 * 1024;
export function comicChapterRows(library) {
  return [...library.projects.map((project) => ({ id: project.id, title: project.title, seriesId: project.seriesId,
    chapter: project.chapter, archived: project.archived, panels: project.panels.length, loaded: true,
    cover: project.panels.find((panel) => panel.image)?.image || null, createdAt: project.createdAt, updatedAt: project.updatedAt })),
  ...(library.shelved || []).map((row) => ({ ...row, loaded: false }))];
}
export function comicChapterRecord(project) {
  const value = validateComicLibrary({ projects: [project] }).projects[0];
  return { format: 'linghuashi-comic-chapter', version: 1, project: value };
}
export function validateComicChapterRecord(value, expectedId) {
  if (value?.format !== 'linghuashi-comic-chapter' || value.version !== 1 || value.project?.id !== expectedId) throw new Error('章节正文与目录不一致，请从备份恢复');
  return comicChapterRecord(value.project);
}
export function normalizeComicChapterBundle(value = [], library) {
  if (!Array.isArray(value) || value.length > COMIC_LIMITS.chapters || bytes(value) > COMIC_CHAPTER_BUNDLE_BYTES) throw new Error('章节备份无效或超过 12 MB，请分系列导出');
  const seen = new Set(), result = value.map((row) => {
    if (!validKey(row?.key) || seen.has(row.key)) throw new Error('章节备份标识无效或重复');
    seen.add(row.key);
    const record = validateComicChapterRecord(row.record, row.record?.project?.id);
    record.project = comicProjectFile(record.project).project;
    return { key: row.key, record };
  });
  if (library && (library.shelved || []).some((row) => !result.some((entry) => entry.key === row.key && entry.record.project.id === row.id))) {
    throw new Error('备份缺少已卸载章节正文，已停止导出或恢复');
  }
  return result;
}
export class ComicChapterStore {
  constructor({ request, local, location = request ? 'server' : 'browser' }) { Object.assign(this, { request, local, location }); }
  async put(project) {
    const record = comicChapterRecord(project);
    const key = await sha256Hex(new TextEncoder().encode(JSON.stringify(record)));
    if (this.location === 'server') await this.request('comic/chapter-put', { key, record });
    else await this.local.put(`comic-chapter:${key}`, record);
    return { id: record.project.id, key, location: this.location, title: record.project.title,
      seriesId: record.project.seriesId, chapter: record.project.chapter, archived: record.project.archived,
      panels: record.project.panels.length, cover: record.project.panels.find((panel) => panel.image)?.image || null,
      createdAt: record.project.createdAt, updatedAt: record.project.updatedAt };
  }
  async get(row) {
    if (!validKey(row?.key)) throw new Error('章节正文标识无效');
    const record = row.location === 'server' ? await this.request?.('comic/chapter-get', { key: row.key })
      : await this.local.get(`comic-chapter:${row.key}`);
    if (!record) throw new Error(row.location === 'browser' ? '本设备没有此章节正文，请在原设备导出备份后导入' : '账号章节正文不存在或无法读取，请从备份恢复');
    const checked = validateComicChapterRecord(record, row.id);
    // Verify stored bytes before adding defaults introduced by newer editors.
    if (await sha256Hex(new TextEncoder().encode(JSON.stringify(record))) !== row.key) throw new Error('章节正文校验失败，请从备份恢复');
    return { ...checked.project, title: row.title, seriesId: row.seriesId, chapter: row.chapter, archived: row.archived };
  }
  async bundle(library) {
    const result = [];
    for (const row of library.shelved || []) {
      result.push({ key: row.key, record: comicChapterRecord(await this.get(row)) });
      if (bytes(result) > COMIC_CHAPTER_BUNDLE_BYTES) throw new Error('章节备份超过 12 MB，请分系列导出');
    }
    return normalizeComicChapterBundle(result, library);
  }
}
export async function shelveComicProject(library, projectId, store, busy = () => false, current = () => library) {
  const project = library.projects.find((row) => row.id === projectId);
  if (!project) throw new Error('章节尚未加载');
  if (busy(project)) throw new Error('本章还有未完成任务，请处理后再卸载');
  const row = await store.put(project);
  const live = current(), updated = live.projects.find((entry) => entry.id === projectId);
  if (!updated || busy(updated) || JSON.stringify(project) !== JSON.stringify(updated)) throw new Error('章节在保存期间发生变化，原稿已保留，请重试卸载');
  const next = structuredClone(live);
  next.projects = next.projects.filter((entry) => entry.id !== projectId);
  next.shelved = [...(next.shelved || []).filter((entry) => entry.id !== projectId), row];
  if (next.activeId === projectId) {
    const siblings = project.seriesId ? next.projects.filter((entry) => entry.seriesId === project.seriesId && entry.archived === project.archived)
      .sort((a, b) => a.chapter - b.chapter) : [];
    next.activeId = (siblings.find((entry) => entry.chapter > project.chapter)
      || siblings.filter((entry) => entry.chapter < project.chapter).at(-1))?.id || '';
  }
  return validateComicLibrary(next);
}
export async function loadComicChapter(library, projectId, store, busy = () => false, current = () => library) {
  if (library.projects.some((row) => row.id === projectId)) return { ...library, activeId: projectId };
  const entry = library.shelved?.find((row) => row.id === projectId);
  if (!entry) throw new Error('章节不存在');
  const project = await store.get(entry);
  const latest = current();
  if (latest.projects.some((row) => row.id === projectId)) return { ...latest, activeId: projectId };
  const liveEntry = latest.shelved?.find((row) => row.id === projectId && row.key === entry.key);
  if (!liveEntry) throw new Error('章节目录在加载期间发生变化，请重试');
  Object.assign(project, { title: liveEntry.title, seriesId: liveEntry.seriesId, chapter: liveEntry.chapter, archived: liveEntry.archived });
  let next = structuredClone(latest);
  if (next.projects.length >= COMIC_LIMITS.projects) {
    const candidate = next.projects.filter((row) => row.id !== next.activeId && !busy(row)).sort((a, b) => a.updatedAt - b.updatedAt)[0];
    if (!candidate) throw new Error('已加载的章节均有未完成任务，请处理后再打开其他章节');
    next = await shelveComicProject(next, candidate.id, store, busy, current);
  }
  next.shelved = next.shelved.filter((row) => row.id !== projectId);
  next.projects.push(project); next.activeId = project.id;
  return validateComicLibrary(next);
}
export function setComicSeries(library, projectId, seriesId, chapter) {
  const next = structuredClone(library), all = comicChapterRows(next);
  if (seriesId && !next.series?.some((row) => row.id === seriesId)) throw new Error('请选择已有系列');
  const number = Number(chapter);
  if (!Number.isInteger(number) || number < 1 || number > 9999) throw new Error('章节编号需为 1—9999');
  if (seriesId && all.some((row) => row.id !== projectId && row.seriesId === seriesId && row.chapter === number)) throw new Error('此系列已存在该章节编号，请使用其他编号');
  const project = next.projects.find((row) => row.id === projectId);
  if (!project) throw new Error('请先打开此章节，再修改所属系列');
  project.seriesId = seriesId; project.chapter = number;
  return validateComicLibrary(next);
}
export function newComicSeries(library, title) {
  if (typeof title !== 'string' || !title.trim() || title.length > 100) throw new Error('系列名称需为 1—100 字符');
  if (library.series?.some((row) => row.title === title.trim())) throw new Error('已有同名系列');
  return { ...library, series: [...(library.series || []), { id: randomUUID(), title: title.trim() }] };
}
export function availableComicChapter(library, projectId, seriesId, preferred = 1) {
  const start = Math.max(1, Math.min(9999, Math.round(Number(preferred) || 1)));
  if (!seriesId) return start;
  const used = new Set(comicChapterRows(library).filter((row) => row.id !== projectId && row.seriesId === seriesId).map((row) => row.chapter));
  for (let offset = 0; offset < 9999; offset++) {
    const number = (start - 1 + offset) % 9999 + 1;
    if (!used.has(number)) return number;
  }
  throw new Error('此系列已没有可用章节编号');
}
export function createComicSeriesForChapter(library, title, projectId) {
  const project = library.projects.find((row) => row.id === projectId);
  if (!project) throw new Error('请先打开要加入系列的章节');
  const next = newComicSeries(library, title), seriesId = next.series.at(-1).id;
  return setComicSeries(next, projectId, seriesId, availableComicChapter(next, projectId, seriesId, project.chapter));
}
export function comicChapterAssetRefs(project) {
  return [...new Map(project.panels.flatMap((panel) => [panel.image, ...panel.versions]).filter(Boolean).map((ref) => [comicRefKey(ref), ref])).values()];
}
export async function comicSeriesFile(library, store, seriesId) {
  const series = library.series?.find((row) => row.id === seriesId);
  if (!series) throw new Error('请先选择一个系列');
  const projects = [];
  for (const row of comicChapterRows(library).filter((row) => row.seriesId === seriesId).sort((a, b) => a.chapter - b.chapter)) {
    const project = row.loaded ? library.projects.find((entry) => entry.id === row.id) : await store.get(row);
    projects.push(comicProjectFile(project).project);
    if (bytes(projects) > COMIC_CHAPTER_BUNDLE_BYTES) throw new Error('系列配置超过 12 MB，请逐章导出');
  }
  if (!projects.length) throw new Error('此系列尚无章节');
  return { format: 'linghuashi-comic-series', version: 1, title: series.title, projects };
}
export function validateComicSeriesFile(value) {
  if (value?.format !== 'linghuashi-comic-series' || value.version !== 1 || !Array.isArray(value.projects)
    || !value.projects.length || value.projects.length > COMIC_LIMITS.chapters
    || bytes(value) > COMIC_CHAPTER_BUNDLE_BYTES) throw new Error('系列文件无效或超过容量限制');
  const numbers = new Set(), ids = new Set();
  return value.projects.map((project) => {
    if (!project || !/^[A-Za-z0-9_-]{1,100}$/.test(project.id || '') || !Number.isInteger(project.chapter)
      || project.chapter < 1 || project.chapter > 9999) throw new Error('系列文件章节标识或编号无效');
    if (ids.has(project.id) || numbers.has(project.chapter)) throw new Error('系列文件含重复章节标识或编号');
    ids.add(project.id); numbers.add(project.chapter);
    return importComicProject({ format: 'linghuashi-comic-project', version: 1, project });
  });
}
function seriesImportLibrary(library, series, rows) {
  return validateComicLibrary({ ...library, series: [...(library.series || []), series], shelved: [...(library.shelved || []), ...rows] });
}
export async function importComicSeriesFile(value, library, store, current = () => library, { signal, importImages } = {}) {
  const projects = validateComicSeriesFile(value);
  if (projects.length + comicChapterRows(library).length > COMIC_LIMITS.chapters) throw new Error('导入后超过 200 章，请先备份整理');
  if (!store) throw new Error('章节存储尚未准备好，请稍后再导入');
  let title = String(value.title || '导入系列').slice(0, 90), suffix = 1;
  while (library.series?.some((row) => row.title === title)) title = `${String(value.title || '导入系列').slice(0, 80)} (${++suffix})`;
  const series = newComicSeries(library, title).series.at(-1), seriesId = series.id, saved = [];
  for (const project of projects) project.seriesId = seriesId;
  // Reserve catalog space before saving images or immutable chapter bodies.
  seriesImportLibrary(library, series, projects.map((project) => ({ ...project, key: '0'.repeat(64), location: 'browser',
    panels: project.panels.length, cover: project.panels.find((panel) => panel.image)?.image || null })));
  signal?.throwIfAborted();
  if (importImages) {
    const refs = await importImages();
    for (const project of projects) for (const panel of project.panels) {
      const key = comicRefKey(panel.image);
      if (key && !refs.has(key)) throw new Error('系列配图未完整保存，请检查存储后重试');
      panel.image = key ? refs.get(key) : null; panel.versions = panel.image ? [panel.image] : [];
    }
  }
  for (const project of projects) {
    signal?.throwIfAborted();
    saved.push(await store.put(project));
  }
  signal?.throwIfAborted();
  return seriesImportLibrary(current(), series, saved);
}
