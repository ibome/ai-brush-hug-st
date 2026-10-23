import { normalizeCharacterScene, normalizeProfile, SCENE_LIMIT, profileContext } from './character-profiles.js';
import { comicStoryboardMessages, parseComicStoryboard, normalizeComicProject, importComicProject, comicProjectFile } from './comic.js';

const copy = (value) => structuredClone(value);
export function comicPanelEditSignature(project, panelId, identity = '') {
  const panel = project?.panels.find((row) => row.id === panelId);
  if (!panel) return '';
  const { image, versions, jobs, ...content } = panel;
  return JSON.stringify([identity, project.id, project.source, project.style, project.negative, project.storyboard,
    project.characterScene, content, project.panels.map((row) => [row.id, row.scene, row.caption])]);
}
export function comicPanelRewriteMessages(project, panelId, instruction, locks = {}, settings = {}) {
  if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 4000) throw new Error('请输入 1—4000 字符的本格修改要求');
  const index = project.panels.findIndex((row) => row.id === panelId), panel = project.panels[index];
  if (!panel) throw new Error('画格不存在');
  const rules = comicStoryboardMessages({ ...project, source: project.source || panel.scene || panel.positive, panelCount: 1 }, settings)[0].content;
  const { image, versions, jobs, ...current } = panel;
  return [{ role: 'system', content: `${rules}
Revise ONLY the selected panel according to the edit request. Return {"panels":[one complete revised panel]}. Keep the chronology and neighboring panels unchanged.
${locks.keepCharacters !== false ? 'Keep the same visible characterIds and character identities. Preserve locked appearance and outfit descriptions.' : 'Only use supplied project characterIds.'}
${locks.keepDialogue !== false ? 'Keep caption and all bubbles exactly unchanged.' : 'You may revise caption and dialogue if required.'}
Do not include image references, task ids or runtime data.` },
  { role: 'user', content: JSON.stringify({ editRequest: instruction.trim(), panelNumber: index + 1, current,
    previous: project.panels[index - 1]?.scene || '', next: project.panels[index + 1]?.scene || '',
    story: project.source, style: project.style, characters: profileContext(project.characterScene) }) }];
}
export function parseComicPanelRewrite(raw, project, panelId, locks = {}) {
  const current = project.panels.find((row) => row.id === panelId);
  if (!current) throw new Error('画格不存在');
  const result = parseComicStoryboard(raw, { ...project, panelCount: 1 }).panels[0];
  const next = copy(project);
  const replacement = { ...result, id: current.id, image: copy(current.image), versions: copy(current.versions), jobs: copy(current.jobs) };
  if (locks.keepDialogue !== false) { replacement.caption = current.caption; replacement.bubbles = copy(current.bubbles); }
  else replacement.bubbles.forEach((bubble, index) => {
    const old = current.bubbles[index];
    if (old) Object.assign(bubble, { id: old.id, x: old.x, y: old.y, width: old.width, autoFit: old.autoFit, speakerVisible: old.speakerVisible,
      tail: old.tail, tailPosition: old.tailPosition, tailLength: old.tailLength });
  });
  if (locks.keepCharacters !== false) {
    replacement.characterIds = copy(current.characterIds);
    replacement.characters = replacement.characters.filter((entry) => current.characterIds.includes(entry.profileId));
  }
  next.panels[next.panels.findIndex((row) => row.id === panelId)] = replacement;
  return normalizeComicProject(next);
}
export function comicPanelChanges(before, after, panelId) {
  const a = before.panels.find((row) => row.id === panelId), b = after.panels.find((row) => row.id === panelId);
  if (!a || !b) return [];
  const format = (value) => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return [['title', '画格名称'], ['shot', '镜头与构图'], ['scene', '画面描述'], ['positive', '生图提示词'], ['negative', '负面提示词'],
    ['characterIds', '出场角色'], ['characters', '角色动作与表情'], ['caption', '旁白'], ['bubbles', '对白']]
    .filter(([key]) => JSON.stringify(a[key]) !== JSON.stringify(b[key]))
    .map(([key, label]) => ({ key, label, before: format(a[key]), after: format(b[key]) }));
}
export function addComicProfile(project, value) {
  const profile = normalizeProfile(value);
  if (!profile) throw new Error('请选择有效角色档案');
  const next = copy(project), entries = next.characterScene?.entries || [];
  if (entries.some((entry) => entry.profileId === profile.id)) throw new Error('该角色已在项目中');
  if (entries.length >= SCENE_LIMIT) throw new Error('每个漫画项目最多绑定 6 个角色');
  next.characterScene = normalizeCharacterScene({ entries: [...entries, { profileId: profile.id, profile, outfitId: profile.defaultOutfitId }] });
  return normalizeComicProject(next);
}
export function removeComicProfile(project, profileId) {
  const next = copy(project);
  if (next.characterScene) next.characterScene.entries = next.characterScene.entries.filter((row) => row.profileId !== profileId);
  return normalizeComicProject(next);
}
export function copyComicProject(project, { start = 1, end = project.panels.length, chapter, sequel = false } = {}) {
  if (!sequel && project.panels.length && (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > project.panels.length)) {
    throw new Error('请选择有效的起止画格');
  }
  const payload = comicProjectFile(project);
  payload.project.panels = sequel ? [] : payload.project.panels.slice(start - 1, end);
  const next = importComicProject(payload);
  next.archived = false;
  next.seriesId = project.seriesId || project.id;
  next.chapter = chapter || project.chapter;
  next.title = (chapter ? `${project.title.replace(/ · 第\d+章$/, '')} · 第${chapter}章` : `${project.title} · 副本`).slice(0, 100);
  if (sequel) { next.source = ''; next.sourceLabel = ''; }
  else if (next.panels.length) next.panelCount = next.panels.length;
  return next;
}
export function nextComicChapter(library, project) {
  const series = project.seriesId || project.id;
  return Math.max(project.chapter, ...[...library.projects, ...(library.shelved || [])]
    .filter((row) => row.id === series || row.seriesId === series).map((row) => row.chapter)) + 1;
}
