import { randomUUID } from './crypto-compat.js';
import { normalizeCharacterScene, normalizeCharacterDirections, profileContext, applyCharacterScene } from './character-profiles.js';
import { setAdvanced, advancedOf, modelCapabilities } from './advanced-generation.js';
import { normalizeAssistant } from './prompt-assistant.js';
import { ASSISTANT_MAX_TOKENS } from './assistant-limits.js';
import { renderTaskRules } from './assistant-rules.js';

export const COMIC_LIMITS = Object.freeze({ projects: 8, chapters: 200, series: 40, panels: 12, bubbles: 4, versions: 16, jobs: 24, bytes: 750000 });
export const COMIC_TABS = [['story', '剧情与分镜'], ['generate', '画格生成'], ['layout', '排版与对白'], ['read', '阅读与导出']];
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const id = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : randomUUID();
const number = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
const unique = (rows, key, max) => {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).filter((row) => object(row) && !seen.has(row[key]) && seen.add(row[key])).slice(0, max);
};
export const comicRefKey = (ref) => ref ? `${ref.location}:${ref.id}` : '';
export function comicImageRef(value) {
  return object(value) && typeof value.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value.id)
    && ['browser', 'server'].includes(value.location) ? { id: value.id, location: value.location } : null;
}
export function normalizeComicLayout(value = {}) {
  return {
    mode: ['strip', 'grid', 'double'].includes(value.mode) ? value.mode : 'strip',
    direction: value.direction === 'rtl' ? 'rtl' : 'ltr',
    aspect: ['auto', 'portrait', 'square', 'landscape'].includes(value.aspect) ? value.aspect : 'auto',
    fit: value.fit === 'cover' ? 'cover' : 'contain',
    gap: Math.round(number(value.gap, 12, 4, 40)),
    fontSize: Math.round(number(value.fontSize, 26, 18, 44)),
  };
}
export function normalizeComicAssistant(value = {}) {
  if (!object(value)) value = {};
  return {
    presetMode: ['inherit', 'none', 'current'].includes(value.presetMode) ? value.presetMode : 'inherit',
    responseMode: ['inherit', 'text', 'json', 'tool'].includes(value.responseMode) ? value.responseMode : 'inherit',
    maxTokens: value.maxTokens ? Math.round(number(value.maxTokens, 4000, 256, ASSISTANT_MAX_TOKENS)) : 0,
    model: text(value.model, 200).trim(),
  };
}
export function comicAssistantOptions(settings, project) {
  const options = normalizeAssistant(settings), local = normalizeComicAssistant(project.storyboard);
  if (local.presetMode !== 'inherit') {
    options.presetMode = local.presetMode;
    options.presetSelection = null;
  }
  if (local.responseMode !== 'inherit') options.responseMode = options.responseModeOverride = local.responseMode;
  if (local.maxTokens) options.maxTokens = local.maxTokens;
  if (local.model) options[options.source === 'api' ? 'model' : 'tavernModel'] = local.model;
  return options;
}
export function comicDraft(project) {
  return project && project.title === '未命名漫画' && !project.source.trim() && !project.panels.length;
}
export function newComicBubble(index = 0) {
  return { id: randomUUID(), speaker: '', speakerVisible: false, autoFit: true,
    text: '', type: 'speech', x: index % 2 ? 72 : 28, y: 18 + index * 18, width: 42,
    tail: 'bottom', tailPosition: 30, tailLength: 10, fontSize: 0, align: 'left' };
}
function normalizeBubble(value) {
  return { ...newComicBubble(), id: id(value.id), speaker: text(value.speaker, 60), text: text(value.text, 600),
    type: value.type === 'thought' ? 'thought' : 'speech',
    speakerVisible: value.speakerVisible !== false, autoFit: value.autoFit !== false,
    fontSize: Number(value.fontSize) > 0 ? Math.round(number(value.fontSize, 26, 14, 64)) : 0,
    align: ['left', 'center', 'right'].includes(value.align) ? value.align : 'left',
    tail: ['none', 'top', 'bottom', 'left', 'right'].includes(value.tail) ? value.tail : 'bottom',
    tailPosition: number(value.tailPosition, 30, 10, 90), tailLength: number(value.tailLength, 10, 4, 40),
    x: number(value.x, 28, 5, 95), y: number(value.y, 18, 5, 90), width: number(value.width, 42, 22, 90) };
}
export function normalizeComicProtection(value = {}) {
  if (!object(value)) value = {};
  const width = number(value.width, 44, 10, 90), height = number(value.height, 62, 10, 90);
  return { enabled: value.enabled === true, x: number(value.x, 28, 0, 100 - width),
    y: number(value.y, 22, 0, 100 - height), width, height };
}
export function newComicPanel() {
  return { id: randomUUID(), title: '', scene: '', shot: '', positive: '', negative: '', characterIds: [], characters: [],
    caption: '', protection: normalizeComicProtection(), bubbles: [], image: null, versions: [], jobs: [] };
}
function normalizePanel(value, castIds) {
  const versions = [...new Map((Array.isArray(value.versions) ? value.versions : [])
    .map(comicImageRef).filter(Boolean).map((ref) => [comicRefKey(ref), ref])).values()].slice(-COMIC_LIMITS.versions);
  const image = comicImageRef(value.image);
  if (image && !versions.some((ref) => comicRefKey(ref) === comicRefKey(image))) versions.push(image);
  return { id: id(value.id), title: text(value.title, 100), scene: text(value.scene, 2000), shot: text(value.shot, 240),
    positive: text(value.positive, 6000), negative: text(value.negative, 2000),
    characterIds: [...new Set((Array.isArray(value.characterIds) ? value.characterIds : []).filter((key) => castIds.has(key)))],
    characters: normalizeCharacterDirections(value.characters).filter((row) => castIds.has(row.profileId)),
    caption: text(value.caption, 600),
    protection: normalizeComicProtection(value.protection),
    bubbles: unique(value.bubbles, 'id', COMIC_LIMITS.bubbles).map(normalizeBubble),
    image, versions: versions.slice(-COMIC_LIMITS.versions),
    jobs: unique(value.jobs, 'id', COMIC_LIMITS.jobs).flatMap((row) => {
      const ref = comicImageRef(row);
      return ref ? [{ ...ref, createdAt: number(row.createdAt, Date.now(), 0, 9e15), applied: row.applied === true }] : [];
    }) };
}
export function newComicProject(scene = null) {
  return { id: randomUUID(), title: '未命名漫画', createdAt: Date.now(), updatedAt: Date.now(),
    archived: false, seriesId: '', chapter: 1, referenceProfileId: '',
    source: '', sourceLabel: '', panelCount: 4,
    style: 'anime comic illustration, clean line art, soft cel shading, consistent character design',
    negative: '', characterScene: normalizeCharacterScene(scene),
    storyboard: { presetMode: 'none', responseMode: 'text', maxTokens: 4000, model: '' },
    layout: normalizeComicLayout(), panels: [] };
}
export function normalizeComicProject(value) {
  if (!object(value)) return null;
  const characterScene = normalizeCharacterScene(value.characterScene);
  if (characterScene) {
    delete characterScene.applied; delete characterScene.basePositive; delete characterScene.baseNegative; delete characterScene.characterPrompts;
  }
  const castIds = new Set(characterScene?.entries.map((entry) => entry.profileId));
  return { id: id(value.id), title: text(value.title, 100) || '未命名漫画',
    archived: value.archived === true, seriesId: text(value.seriesId, 100).replace(/[^A-Za-z0-9_-]/g, ''),
    chapter: Math.round(number(value.chapter, 1, 1, 9999)),
    referenceProfileId: castIds.has(value.referenceProfileId) ? value.referenceProfileId : '',
    createdAt: number(value.createdAt, Date.now(), 0, 9e15), updatedAt: number(value.updatedAt, Date.now(), 0, 9e15),
    source: text(value.source, 32000), sourceLabel: text(value.sourceLabel, 240),
    panelCount: Math.round(number(value.panelCount, 4, 1, COMIC_LIMITS.panels)),
    style: text(value.style, 2000), negative: text(value.negative, 2000), characterScene,
    storyboard: normalizeComicAssistant(value.storyboard),
    layout: normalizeComicLayout(value.layout),
    panels: unique(value.panels, 'id', COMIC_LIMITS.panels).map((panel) => normalizePanel(panel, castIds)) };
}
export function normalizeComicLibrary(value) {
  const projects = unique(value?.projects, 'id', COMIC_LIMITS.projects).map(normalizeComicProject);
  const shelved = unique(value?.shelved, 'id', COMIC_LIMITS.chapters).filter((row) => !projects.some((project) => project.id === row.id))
    .filter((row) => /^[A-Za-z0-9_-]{1,100}$/.test(row.key || '') && ['server', 'browser'].includes(row.location))
    .map((row) => ({ id: id(row.id), key: row.key, location: row.location, title: text(row.title, 100) || '未命名漫画',
      seriesId: text(row.seriesId, 100).replace(/[^A-Za-z0-9_-]/g, ''), chapter: Math.round(number(row.chapter, 1, 1, 9999)),
      archived: row.archived === true, panels: Math.round(number(row.panels, 0, 0, COMIC_LIMITS.panels)),
      cover: comicImageRef(row.cover), createdAt: number(row.createdAt, Date.now(), 0, 9e15),
      updatedAt: number(row.updatedAt, Date.now(), 0, 9e15) }));
  const series = unique(value?.series, 'id', COMIC_LIMITS.series).map((row) => ({ id: id(row.id), title: text(row.title, 100) || '未命名系列' }));
  for (const row of [...projects, ...shelved]) if (row.seriesId && !series.some((entry) => entry.id === row.seriesId) && series.length < COMIC_LIMITS.series) {
    const first = projects.find((entry) => entry.id === row.seriesId);
    series.push({ id: row.seriesId, title: (first?.title || row.title).replace(/ · 第\d+章$/, '') });
  }
  const activeId = value?.activeId === '' || projects.some((row) => row.id === value?.activeId) ? value.activeId : projects[0]?.id || '';
  return { version: 1, activeId, projects, shelved, series };
}
export function validateComicLibrary(value) {
  if (!object(value) || !Array.isArray(value.projects) || value.projects.length > COMIC_LIMITS.projects) throw new Error('最多保存 8 个漫画项目，请先导出并删除旧项目');
  if (value.projects.length + (value.shelved?.length || 0) > COMIC_LIMITS.chapters) throw new Error('章节目录最多保存 200 章，请先备份整理');
  if ((value.series?.length || 0) > COMIC_LIMITS.series) throw new Error('最多保存 40 个漫画系列');
  for (const project of value.projects) {
    if (!object(project) || !Array.isArray(project.panels) || project.panels.length > COMIC_LIMITS.panels) throw new Error('每个漫画最多 12 格');
    if (typeof project.source !== 'string' || project.source.length > 32000) throw new Error('剧情需在 32000 字符以内');
    if (project.panels.some((panel) => (panel.bubbles || []).length > COMIC_LIMITS.bubbles)) throw new Error('每格最多 4 个对白气泡');
  }
  const result = normalizeComicLibrary(value);
  if (result.shelved.length !== (value.shelved?.length || 0)
    || value.series && unique(value.series, 'id', COMIC_LIMITS.series).length !== value.series.length) throw new Error('章节目录或系列标识重复、无效');
  if (result.projects.length !== value.projects.length || result.projects.some((row, index) => row.panels.length !== value.projects[index].panels.length)) {
    throw new Error('漫画项目或画格标识重复');
  }
  const reserved = result.projects.reduce((sum, project) => sum + project.panels.reduce((count, panel) =>
    count + panel.jobs.filter((job) => !job.applied).length * 384, 0), 0);
  if (new TextEncoder().encode(JSON.stringify(result)).length + reserved > COMIC_LIMITS.bytes) throw new Error('漫画项目配置超过 750 KB（含待完成图片关联预留），请先导出并精简项目');
  return result;
}
export function saveComicProject(library, project) {
  const next = structuredClone(library);
  const index = next.projects.findIndex((row) => row.id === project.id);
  next.shelved = (next.shelved || []).filter((row) => row.id !== project.id);
  const value = { ...project, updatedAt: Date.now() };
  if (index < 0) next.projects.push(value); else next.projects[index] = value;
  next.activeId = project.id;
  return validateComicLibrary(next);
}
export function comicProjectFile(project) {
  const detached = structuredClone(project);
  for (const panel of detached.panels) panel.jobs = [];
  if (detached.characterScene) detached.characterScene.chatKey = '';
  return { format: 'linghuashi-comic-project', version: 1, project: detached };
}
export function importComicProject(value) {
  if (!object(value) || value.format !== 'linghuashi-comic-project' || value.version !== 1 || !object(value.project)) throw new Error('不是灵画师漫画项目文件');
  const original = value.project;
  validateComicLibrary({ version: 1, activeId: original.id, projects: [original] });
  const result = normalizeComicProject(original);
  result.id = randomUUID(); result.createdAt = result.updatedAt = Date.now();
  result.panels.forEach((panel) => { panel.id = randomUUID(); panel.jobs = []; panel.bubbles.forEach((bubble) => { bubble.id = randomUUID(); }); });
  if (result.characterScene) result.characterScene.chatKey = '';
  return result;
}
export function cleanComicSource(value) {
  return String(value).replace(/<(think|thinking|analysis|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(?:think|thinking|analysis)\b[^>]*>[\s\S]*$/gi, '')
    .replace(/```(?:analysis|thinking|think)\s[\s\S]*?(?:```|$)/gi, '')
    .replace(/image###[\s\S]*?###/g, '').replace(/<img\b[^>]*>/gi, '')
    .replace(/<[^>\n]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
}
export function comicSource(context, range) {
  const rows = context.chat || [];
  let start, end;
  if (range) {
    start = Number(range.start); end = Number(range.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > rows.length || end - start >= 100) {
      throw new Error('请选择有效的聊天楼层范围，最多 100 条');
    }
  } else {
    const index = rows.map((row, index) => ({ row, index })).reverse().find(({ row }) => row && !row.is_user && !row.is_system && typeof row.mes === 'string' && row.mes.trim())?.index;
    if (index === undefined) throw new Error('当前聊天没有可读取的角色回复');
    start = end = index + 1;
  }
  const selected = rows.slice(start - 1, end).filter((row) => row && !row.is_system && typeof row.mes === 'string' && row.mes.trim());
  const source = selected.map((row) => {
    const body = cleanComicSource(row.mes);
    return body ? `${text(row.name || (row.is_user ? context.name1 : context.name2) || '角色', 80)}：\n${body}` : '';
  }).filter(Boolean).join('\n\n');
  if (!source) throw new Error('所选楼层没有可用正文');
  if (source.length > 32000) throw new Error('所选聊天超过 32000 字符，请缩小楼层范围');
  return { source, label: `${text(context.name2 || '当前聊天', 100)} · 第 ${start}—${end} 条（含用户消息）`, start, end,
    cleaned: selected.some((row) => cleanComicSource(row.mes) !== row.mes.trim()) };
}
export function comicStoryboardMessages(project, settings = {}) {
  if (!project.source.trim()) throw new Error('请先输入剧情或读取聊天');
  return [
    { role: 'system', content: renderTaskRules('comic', settings, { panelCount: project.panelCount }) },
    { role: 'user', content: JSON.stringify({ story: project.source, style: project.style, characters: profileContext(project.characterScene) }) },
  ];
}
function storyboardObject(raw) {
  const source = raw.trim();
  try { return JSON.parse(source); } catch { /* Extract complete objects without modifying their contents. */ }
  const candidates = [], lower = source.toLowerCase();
  let start = -1, depth = 0, quoted = false, escaped = false, unfinishedThought = false, invalidJSON = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (start < 0) {
      const thought = char === '<' ? source.slice(index).match(/^<(think|thinking|analysis)>/i) : null;
      const fence = char === '`' ? source.slice(index).match(/^```(?:analysis|thinking|think)\s/i) : null;
      if (thought || fence) {
        const closing = thought ? `</${thought[1].toLowerCase()}>` : '```';
        const end = lower.indexOf(closing, index + (thought || fence)[0].length);
        if (end < 0) { unfinishedThought = true; break; }
        index = end + closing.length - 1; continue;
      }
      if (char === '{') { start = index; depth = 1; quoted = false; escaped = false; }
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === '{') depth++;
    else if (char === '}') depth--;
    if (depth) continue;
    try {
      const value = JSON.parse(source.slice(start, index + 1));
      if (object(value) && Array.isArray(value.panels)) candidates.push(value);
    } catch { invalidJSON = true; }
    start = -1;
  }
  if (candidates.length > 1) throw new Error('回复包含多份分镜 JSON，无法确定采用哪份；请在失败回复中保留一份完整结果后重新解析');
  if (candidates.length === 1) return candidates[0];
  if (unfinishedThought || start >= 0) throw new Error('分镜回复未闭合，可能达到输出上限；请减少格数、缩短剧情或提高本项目最大输出 Token');
  if (invalidJSON) throw new Error('分镜 JSON 格式有误，可能包含未转义引号或无效符号；请查看失败回复并预览格式修复');
  throw new Error('回复中未找到完整的分镜 JSON；请查看失败回复，核对聊天预设是否要求续写或其他输出格式');
}
export function parseComicStoryboard(raw, project) {
  try {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 100000) throw new Error('漫画分镜回复为空或超过 10 万字符');
    return validateStoryboard(storyboardObject(raw), project);
  } catch (error) {
    if (typeof raw === 'string' && raw.length <= 100000) Object.defineProperty(error, 'assistantResponse', { value: raw });
    error.comicParseFailure = true;
    throw error;
  }
}
function validateStoryboard(value, project) {
  if (!object(value) || !Array.isArray(value.panels)) throw new Error('回复 JSON 缺少 panels 分镜列表，请核对分镜任务模板');
  if (value.panels.length !== project.panelCount) throw new Error(`需要 ${project.panelCount} 格，实际返回 ${value.panels.length} 格；请减少格数或提高本项目最大输出 Token 后重试`);
  const cast = new Set(project.characterScene?.entries.map((entry) => entry.profileId));
  const panels = value.panels.map((panel, index) => {
    if (!object(panel) || typeof panel.positive !== 'string' || !panel.positive.trim() || panel.positive.length > 6000
      || typeof panel.scene !== 'string' || panel.scene.length > 2000
      || panel.bubbles !== undefined && (!Array.isArray(panel.bubbles) || panel.bubbles.length > 4)
      || !Array.isArray(panel.characterIds) || panel.characterIds.some((key) => !cast.has(key))
      || panel.characters !== undefined && (!Array.isArray(panel.characters)
        || panel.characters.some((row) => !object(row) || !cast.has(row.profileId)))) throw new Error(`第 ${index + 1} 格分镜字段无效或角色不属于项目，请查看失败回复`);
    if ((panel.bubbles || []).some((row) => !object(row) || typeof row.text !== 'string' || row.text.length > 600)
      || String(panel.caption || '').length > 600) throw new Error(`第 ${index + 1} 格对白过长`);
    return normalizePanel({ ...newComicPanel(), ...panel, id: randomUUID(),
      bubbles: (panel.bubbles || []).map((row, i) => ({ ...newComicBubble(i), ...row, id: randomUUID() })),
      image: null, versions: [], jobs: [] }, cast);
  });
  return { ...structuredClone(project), title: project.title !== '未命名漫画' ? project.title : text(value.title, 100) || project.title, panels };
}
export function comicPanelSnapshot(base, project, panel) {
  if (!panel.positive.trim()) throw new Error('请先填写每格的生图提示词');
  const snapshot = structuredClone(base), params = snapshot.params || snapshot.config.params;
  params.positive = [project.style, panel.shot, panel.positive, 'single comic panel, no text, no speech bubbles'].filter(Boolean).join(', ');
  params.negative = [project.negative, panel.negative, 'text, watermark, speech bubble, caption, comic page, collage'].filter(Boolean).join(', ');
  params.seed = -1;
  if (snapshot.provider === 'novelai') params.nSamples = 1;
  if (snapshot.provider === 'openai') {
    params.n = 1;
    const extra = JSON.parse(params.extra || '{}');
    delete extra.n;
    for (const key of ['n_samples', 'batch_size', 'batch_count']) if (Object.hasOwn(extra, key)) extra[key] = 1;
    if (Object.hasOwn(extra, 'seed')) extra.seed = -1;
    params.extra = JSON.stringify(extra);
  }
  if (snapshot.provider === 'sdwebui') params.batch = 1;
  if (snapshot.provider === 'comfyui') {
    params.batchSize = 1;
    params.batch = 1;
    if (!snapshot.config.mapping.batch && Object.values(snapshot.config.graph).some((node) => Number(node.inputs?.batch_size) > 1)) {
      throw new Error('漫画每格仅生成 1 张，请先在 ComfyUI 工作流映射批量数量或将 batch_size 设为 1');
    }
  }
  const previousAdvanced = advancedOf(snapshot);
  setAdvanced(snapshot, { mode: 'text' });
  const reference = project.characterScene?.entries.find((entry) => entry.profileId === project.referenceProfileId
    && panel.characterIds.includes(entry.profileId));
  if (reference) {
    if (!reference.profile.reference) throw new Error('项目人物参考图缺失，请重新上传或取消参考图选择');
    const capabilities = modelCapabilities(snapshot.provider, params.model, previousAdvanced);
    if (snapshot.provider === 'novelai' && capabilities.character) {
      setAdvanced(snapshot, { mode: 'reference', referenceKind: 'character', character: reference.profile.reference });
    } else if (snapshot.provider === 'openai' && capabilities.image) {
      setAdvanced(snapshot, { ...previousAdvanced, mode: 'reference', references: [reference.profile.reference] });
    } else throw new Error('当前接口或模型未启用人物参考图能力，请更换模型或在项目角色中取消参考图');
  }
  const scene = normalizeCharacterScene(project.characterScene);
  if (scene) scene.entries = scene.entries.filter((entry) => panel.characterIds.includes(entry.profileId));
  delete snapshot.characterScene;
  const result = applyCharacterScene(snapshot, scene, panel.characters);
  if (result.provider === 'openai' && !/nai-diffusion/i.test(params.model) && result.params.negative) {
    result.params.positive += `\nAvoid: ${result.params.negative}`;
  }
  return result;
}
export function comicPlanPromptPreview(plan, panelId) {
  const params = plan.snapshot.params || plan.snapshot.config.params, body = plan.body;
  let positive = body.prompt, negative = body.negative_prompt;
  if (plan.provider === 'novelai') {
    positive = body.input; negative = body.parameters.negative_prompt;
  } else if (plan.provider === 'comfyui') {
    const read = (key) => {
      const mapped = plan.snapshot.config.mapping[key];
      return mapped ? body.prompt[mapped.node]?.inputs[mapped.input] : undefined;
    };
    positive = read('positive'); negative = read('negative');
    if (typeof positive !== 'string') throw new Error('漫画生图请先映射 ComfyUI 正向提示词');
  }
  const embedded = plan.provider === 'openai' && typeof negative !== 'string';
  return { id: panelId, positive, negative: embedded ? params.negative : negative || '',
    negativeLabel: embedded ? '排除要求（已合并到正向提示词）' : plan.provider === 'comfyui' && negative === undefined
      ? '负面提示词（工作流未映射）' : '负面提示词',
    characters: (body.parameters?.characterPrompts || []).map((row) => ({ positive: row.prompt, negative: row.uc })) };
}
export function comicPanelJobs(panel, jobs) {
  const ids = new Set(panel.jobs.map((job) => job.id));
  return jobs.filter((job) => ids.has(job.id));
}
export function comicPanelBusy(panel, jobs) {
  return comicPanelJobs(panel, jobs).some((job) => ['queued', 'running', 'paused', 'uncertain'].includes(job.status));
}
export function comicPanelTask(panel, jobs) {
  const rows = comicPanelJobs(panel, jobs);
  return rows.filter((job) => ['queued', 'running', 'paused', 'uncertain'].includes(job.status)).at(-1) || rows.at(-1);
}
export function comicProjectProgress(project, jobs, assets) {
  const result = { total: project?.panels.length || 0, pictured: 0, missing: 0,
    queued: 0, running: 0, paused: 0, uncertain: 0, failed: 0, cancelled: 0 };
  if (assets) Object.assign(result, { broken: 0, checking: 0, unreachable: 0 });
  for (const panel of project?.panels || []) {
    const state = assets?.get(comicRefKey(panel.image))?.status;
    if (!panel.image) result.missing++;
    else if (!assets || state === 'available') result.pictured++;
    else if (state === 'missing') { result.missing++; result.broken++; }
    else if (state === 'unreachable') result.unreachable++;
    else result.checking++;
    const status = comicPanelTask(panel, jobs)?.status;
    if (['queued', 'running', 'paused', 'uncertain', 'failed', 'cancelled'].includes(status)) result[status]++;
  }
  return result;
}
export function reconcileComicJobs(library, jobs) {
  let changed = false;
  const next = structuredClone(library);
  for (const project of next.projects) for (const panel of project.panels) {
    for (const job of comicPanelJobs(panel, jobs)) {
      if (!job.savedIds?.length) continue;
      const association = panel.jobs.find((row) => row.id === job.id);
      if (association.applied) continue;
      const location = association.location;
      for (const savedId of job.savedIds) {
        const ref = comicImageRef({ id: savedId, location });
        if (!ref || panel.versions.some((old) => comicRefKey(old) === comicRefKey(ref))) continue;
        panel.versions.push(ref); panel.versions = panel.versions.slice(-COMIC_LIMITS.versions);
        panel.image = ref; project.updatedAt = Date.now(); changed = true;
      }
      association.applied = true; changed = true;
    }
  }
  return changed ? validateComicLibrary(next) : null;
}
