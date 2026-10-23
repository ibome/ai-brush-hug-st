import { escapeHtml as esc } from '../config.js';
import { icon, paintIcons } from '../icons.js';
import { comicRefKey, COMIC_TABS, COMIC_LIMITS, newComicProject, newComicPanel, newComicBubble,
  saveComicProject, validateComicLibrary, comicPanelBusy, comicPanelJobs, comicProjectFile, importComicProject,
  comicAssistantOptions, comicDraft, parseComicStoryboard, comicPanelTask, comicProjectProgress } from '../comic.js';
import { ComicImagePicker } from './comic-images.js';
import { ComicWorkspace, comicStorySignature, comicGenerationSignature } from '../comic-workspace.js';
import { comicMissingPanelIds, inspectComicAssets } from '../comic-assets.js';
import { renderComicPages, comicLongImage, comicPageArchive, comicOfflineHTML, comicPageGeometry } from '../comic-export.js';
import { comicProjectPack } from '../comic-project-pack.js';
import { inspectComicSeriesPack, comicSeriesPack, readComicArchive, COMIC_SERIES_IMAGE_BYTES } from '../comic-series-pack.js';
import { previewComicRepair } from '../comic-repair.js';
import { ASSISTANT_MAX_TOKENS } from '../assistant-limits.js';
import { experienceFold } from './experience.js';
import { renderAssistantBudget } from './assistant-compatibility.js';
import { comicPanelEditSignature, comicPanelChanges, addComicProfile, removeComicProfile, copyComicProject, nextComicChapter } from '../comic-editing.js';
import { COMIC_EXPORT_QUALITIES, comicExportWidth, comicExportInspection, comicExportSignature } from '../comic-export-check.js';
import { COMIC_LAYOUT_TEMPLATES, comicLayoutTemplate, comicLayoutSignature, suggestComicLayout, comicProtectedRect, comicProtectionGesture,
  comicBubblePosition, comicBubbleLayer } from '../comic-layout.js';
import { cacheComicPreview, readComicThumbnail } from '../comic-resilience.js';
import { comicChapterRows, shelveComicProject, loadComicChapter, setComicSeries, newComicSeries, createComicSeriesForChapter,
  availableComicChapter, comicSeriesFile, importComicSeriesFile, COMIC_CHAPTER_BUNDLE_BYTES } from '../comic-chapters.js';
import '../styles/comic.css';

const command = (action, glyph, label, disabled = false, kind = 'secondary', extra = '') =>
  `<button type="button" class="ui-button ${kind}" data-comic-action="${action}" ${extra} ${disabled ? 'disabled' : ''}>${icon(glyph)}<span>${label}</span></button>`;
const tool = (action, glyph, title, disabled = false, extra = '') =>
  `<button type="button" class="ui-icon-button" data-comic-action="${action}" title="${title}" aria-label="${title}" ${extra} ${disabled ? 'disabled' : ''}>${icon(glyph)}</button>`;
const field = (label, control) => `<label class="ui-field"><span>${label}</span>${control}</label>`;
const area = (scope, name, value, max = 2000, rows = 3) =>
  `<textarea data-comic-${scope}="${name}" maxlength="${max}" rows="${rows}">${esc(value)}</textarea>`;
const text = (scope, name, value, max = 100) => `<input data-comic-${scope}="${name}" maxlength="${max}" value="${esc(value)}">`;
const options = (values, selected) => values.map(([key, label]) => `<option value="${key}" ${key === selected ? 'selected' : ''}>${label}</option>`).join('');
const statusName = (job) => ({ queued: '等待生成', running: `生成中${job.progress ? ` · ${Math.round(job.progress)}%` : ''}`,
  completed: '已保存', failed: '失败', paused: '等待手动继续', uncertain: '提交结果待核对', cancelled: '已取消' })[job?.status] || '未生成';

export class ComicPanel {
  constructor(dependencies) {
    Object.assign(this, dependencies);
    this.tab = 'story'; this.panelId = ''; this.error = ''; this.message = '';
    this.busy = false; this.submitting = false; this.candidate = null; this.confirm = null;
    this.rows = new Map(); this.previews = new Map(); this.pageURLs = [];
    this.range = { start: 1, end: 1 }; this.assetRevision = 0; this.previewRevision = 0;
    this.failureResponse = ''; this.candidateBase = ''; this.assetStates = new Map(); this.repairPreview = null;
    this.exportFile = null;
    this.layoutView = 'edit'; this.exportQuality = 'standard'; this.exportSelection = '';
    this.previewBlobs = new Map(); this.renderedPages = new Map(); this.coverURLs = new Map(); this.coverRefs = new Map();
    this.previewFailures = new Set(); this.snap = true;
    this.imagePicker = new ComicImagePicker(dependencies);
    this.workspace = new ComicWorkspace({ key: dependencies.workspaceKey, onStatus: (message) => {
      this.workspaceWarning = message;
      const node = this.root?.querySelector('[data-comic-workspace-warning]');
      if (node) { node.textContent = message; node.hidden = !message; }
      this.refreshSaveStatus();
    } });
    this.workspace.retain(this.chapters.map((row) => row.id));
    this.loadDraft();
    const flush = () => {
      this.stashDraft(); this.workspace.flush();
      try { this.flushLibrary?.(); } catch { this.workspaceWarning = '项目尚未保存，请回到页面重试或导出备份'; this.refreshSaveStatus(); }
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flush(); this.previewController?.abort(); this.hiddenAt = Date.now();
      } else if (this.hiddenAt) this.resumeReadonly();
    });
    window.addEventListener('online', () => this.resumeReadonly());
  }
  get library() { return this.getLibrary(); }
  get chapters() { return comicChapterRows(this.library); }
  get project() { return this.library.projects.find((row) => row.id === this.library.activeId); }
  get panel() { return this.project?.panels.find((row) => row.id === this.panelId) || this.project?.panels[0]; }
  async fromAssistant(source) {
    if (this.busy || this.submitting) throw new Error('漫画任务进行中，请稍后带入剧情');
    if (!source.trim()) throw new Error('请先准备画面描述');
    this.busy = true;
    try { await this.makeChapterRoom(); }
    finally { this.busy = false; }
    const project = newComicProject(this.currentScene());
    project.title = '助手画面';
    project.source = source.slice(0, 32000);
    project.sourceLabel = '提示词助手';
    this.stashDraft();
    this.update(saveComicProject(this.library, project)); this.loadDraft(); this.tab = 'story';
    this.message = '已带入独立项目，等待手动创建分镜'; this.clearPreviews();
  }
  hasTasks(project = this.project) { return Boolean(project?.panels.some((panel) => comicPanelBusy(panel, this.jobs()))); }
  commit(change, redraw = false, history = {}) {
    const before = this.project, project = structuredClone(before);
    if (!project) throw new Error('请先新建漫画项目');
    change(project);
    this.update(saveComicProject(this.library, project));
    this.workspace.record(before, this.project, history);
    this.confirm = null;
    this.exportInspection = null; this.acceptExportWarnings = false;
    this.stashDraft();
    if (redraw) this.render();
  }
  html() { return `<section class="comic-page" data-comic-root aria-label="漫画工坊">${this.content()}</section>`; }
  content() {
    const project = this.project, locked = this.busy || this.submitting;
    return `<div class="page-heading"><div><h1>漫画工坊</h1><p>${project ? this.progressLabel(project) : '漫画项目'}</p></div></div>
      <div class="comic-project-bar">${field('漫画项目', `<select data-comic-project-select aria-label="漫画项目" ${locked ? 'disabled' : ''}><option value="" ${!project ? 'selected' : ''} disabled>选择项目</option>${this.chapters.map((row) => `<option value="${esc(row.id)}" ${row.id === project?.id ? 'selected' : ''}>${esc(row.title)}${row.loaded ? '' : ' · 按需加载'}</option>`).join('')}</select>`)}
      <div class="comic-actions comic-project-actions" role="group" aria-label="漫画项目操作">${command('new', 'plus', '新建', locked || this.chapters.length >= COMIC_LIMITS.chapters)}
      ${tool('import', 'folder-open', '导入漫画项目', locked)}
      ${tool('project-export', 'file-json', '导出项目配置（图片请单独备份绘图管理）', !project || locked)}
      ${tool('projects', 'library-big', '项目整理', locked, `aria-expanded="${Boolean(this.projectsOpen)}" aria-controls="comic-project-manager"`)}
      ${tool('delete', 'trash-2', '删除漫画项目', !project || locked || this.hasTasks())}</div></div>
      <input type="file" data-comic-import accept=".json,.zip,application/json,application/zip" hidden>
      <input type="file" data-comic-reference-file accept="image/png,image/jpeg,image/webp" hidden>
      ${this.projectsOpen ? this.projectsHTML() : ''}
      ${project ? this.historyHTML(project) : ''}
      ${project ? `<div class="comic-save-status" data-comic-save-status role="status">${this.saveStatusHTML()}</div>` : ''}
      <div class="comic-tabs" role="tablist" aria-label="漫画流程">${COMIC_TABS.map(([key, label]) => `<button type="button" role="tab" aria-selected="${key === this.tab}" data-comic-tab="${key}" ${locked ? 'disabled' : ''}>${label}</button>`).join('')}</div>
      <p class="comic-workspace-warning" role="status" data-comic-workspace-warning ${this.workspaceWarning ? '' : 'hidden'}>${esc(this.workspaceWarning || '')}</p>
      <p class="comic-error" role="alert" ${this.error ? '' : 'hidden'}>${esc(this.error)}</p>
      ${this.error && this.errorContext ? `<div class="comic-actions comic-error-actions">
        ${this.errorContext === 'assistant' ? command('assistant-settings', 'settings-2', '检查文字接口') + command('diagnostic', 'copy', '复制脱敏诊断')
          : this.errorContext === 'image' ? command('image-settings', 'plug', '检查生图接口') + command('queue', 'list-todo', '查看任务记录')
          : this.errorContext === 'chapter' && this.retryChapterId ? command('chapter-retry', 'refresh-cw', '重试加载章节') : ''}
      </div>` : ''}
      <p class="comic-message" role="status" ${this.message ? '' : 'hidden'}>${esc(this.message)}</p>
      ${this.busy ? `<div class="comic-busy">${icon('loader-circle', 'spin')}<span>${esc(this.busyLabel || '处理中…')}</span>${command('cancel', 'square', '取消')}</div>` : ''}
      ${this.recoveryHTML()}
      ${!project ? `<div class="comic-empty">${icon('panels-top-left')}<p>${this.chapters.length ? '请选择章节继续，可从上方目录打开' : '暂无漫画项目'}</p>${command('new', 'plus', '新建漫画', locked)}</div>`
        : `<fieldset class="comic-work" ${locked ? 'disabled' : ''}>${this.tab === 'story' ? this.story(project) : this.tab === 'generate' ? this.generation(project) : this.tab === 'layout' ? this.layout(project) : this.read(project)}</fieldset>`}
      ${this.candidate ? this.candidateHTML() : ''}${project ? this.nextHTML(project) : ''}`;
  }
  storySignature(project) { return comicStorySignature(project); }
  progressLabel(project) {
    const progress = comicProjectProgress(project, this.jobs(), this.assetStates);
    return `${progress.total} 格 · ${progress.pictured} 格配图可用${progress.checking ? ` · ${progress.checking} 格待检测` : ''}${progress.broken ? ` · ${progress.broken} 格缺图` : ''}${progress.unreachable ? ` · ${progress.unreachable} 格暂无法读取` : ''}`;
  }
  view() {
    return this.restoreView || { tab: this.tab, panelId: this.panel?.id || '', layoutView: this.layoutView,
      selectedBubble: this.selectedBubble || '', snap: this.snap !== false,
      scrollTop: this.root?.closest('.plugin-content')?.scrollTop ?? this.savedView?.scrollTop ?? 0,
      tabScroll: this.root?.querySelector('.comic-tabs')?.scrollLeft ?? this.savedView?.tabScroll ?? 0 };
  }
  stashDraft() {
    this.savedView = this.view();
    if (this.project) this.workspace.draft(this.project.id, { candidate: this.candidate, candidateBase: this.candidateBase,
      rewrite: this.rewrite || null, failureResponse: this.failureResponse, error: this.error, failureOpen: this.failureOpen === true }, this.savedView);
  }
  loadDraft() {
    const entry = this.workspace.get(this.project?.id);
    Object.assign(this, { candidate: null, candidateBase: '', failureResponse: '', error: '', failureOpen: false, rewrite: null }, entry?.draft);
    this.repairPreview = null;
    this.layoutSuggestion = null;
    this.selectedBubble = entry?.view?.selectedBubble || '';
    this.bubbleToolsFor = '';
    this.snap = entry?.view?.snap !== false;
    this.protectionEditing = '';
    this.restoreView = entry?.view || null;
    this.savedView = entry?.view || null; this.message = '';
    this.tab = entry?.view.tab || 'story'; this.panelId = entry?.view.panelId || '';
    this.layoutView = entry?.view.layoutView || 'edit'; this.exportInspection = null; this.exportSelection = '';
    this.addProfileId = ''; this.chapterStart = this.chapterEnd = null;
    this.seriesAssignment = null; this.chapterNumber = null;
    if (this.failureResponse) this.errorContext = 'assistant';
    if (this.candidate || this.failureResponse) this.message = '已恢复本设备保存的分镜草稿，请核对后采用';
  }
  switchTab(tab) {
    if (this.tab !== tab) this.projectsOpen = false;
    this.tab = tab;
    this.protectionEditing = '';
  }
  historyHTML(project) {
    const entry = this.workspace.history(project.id), locked = this.busy || this.submitting || this.hasTasks();
    return `<div class="comic-edit-actions comic-actions" role="group" aria-label="漫画编辑历史">
      ${tool('undo', 'undo-2', '撤销上次编辑', locked || !entry?.past.length)}
      ${tool('redo', 'redo-2', '重做编辑', locked || !entry?.future.length)}
      ${command('history', 'history', '编辑历史', locked || !entry?.past.length)}
      <span class="comic-note">本设备 · 最多 12 次编辑</span></div>
      ${this.historyOpen ? `<section class="comic-edit-history" aria-label="项目编辑历史">
        ${(entry?.past || []).map((row) => `<div><span><strong>${esc(row.label)}</strong><small>${esc(new Date(row.createdAt).toLocaleString())} · ${row.panels} 格</small></span>
        ${command('history-restore', 'rotate-ccw', '恢复此版本', locked, 'secondary', `data-revision-id="${esc(row.id)}"`)}</div>`).join('') || '<p>暂无编辑记录</p>'}</section>` : ''}`;
  }
  saveStatusHTML() {
    const info = this.saveStatus?.() || { state: 'saved', message: '项目保留在当前页面', retry: false };
    const failed = info.retry || Boolean(this.workspaceWarning);
    return `<span data-save-state="${info.state}">${esc(info.message)}${this.workspaceWarning ? ' · 恢复记录待重试' : ''}</span>
      ${tool('save-retry', failed ? 'refresh-cw' : 'save', failed ? '重试保存' : '立即保存', this.busy || this.submitting)}`;
  }
  refreshSaveStatus() {
    const node = this.root?.querySelector('[data-comic-save-status]');
    if (node) { node.innerHTML = this.saveStatusHTML(); paintIcons(node); }
  }
  reveal(selector, alignTop = false) {
    const node = this.root?.querySelector(selector);
    if (!node) return;
    const container = this.root.closest('.plugin-content');
    if (container) {
      const box = node.getBoundingClientRect(), outer = container.getBoundingClientRect();
      if (alignTop || box.top < outer.top || box.bottom > outer.bottom) container.scrollTop += box.top - outer.top - 16;
    }
  }
  nextHTML(project) {
    const progress = comicProjectProgress(project, this.jobs(), this.assetStates), missing = progress.missing;
    const active = progress.queued + progress.running, blocked = progress.paused + progress.uncertain;
    const state = !project.source.trim() && !project.panels.length ? ['story', '输入剧情或读取聊天', '']
      : this.candidate ? ['story', '分镜已生成，等待确认', 'candidate']
      : !project.panels.length ? ['story', '剧情已准备，创建分镜', 'storyboard']
      : blocked ? ['generate', `${blocked} 格任务需要核对，已配图 ${progress.pictured} / ${progress.total}`, '']
      : active ? ['generate', `${active} 格正在排队或生成，已配图 ${progress.pictured} / ${progress.total}`, '']
      : missing ? ['generate', `分镜已准备，${missing} 格待配图`, '']
      : progress.checking || progress.unreachable ? ['generate', `${progress.checking + progress.unreachable} 格图片需要检测或恢复连接`, '']
      : ['layout', 'read'].includes(this.tab) ? ['read', '已全部配图，可阅读与导出', '']
      : ['layout', '已全部配图，调整排版与对白', ''];
    return `<div class="comic-next" data-comic-next role="status"><span>${esc(state[1])}</span>
      ${command('next', 'arrow-right', state[2] === 'candidate' ? '查看分镜' : state[2] === 'storyboard' ? '创建分镜'
        : state[0] === 'generate' ? '画格生成' : state[0] === 'layout' ? '排版与对白' : state[0] === 'read' ? '阅读与导出' : '填写剧情',
      this.busy || this.submitting)}</div>`;
  }
  recoveryHTML() {
    if (!this.failureResponse && !this.diagnosticText) return '';
    return `<details class="comic-recovery" ${this.failureOpen || !this.failureResponse ? 'open' : ''}><summary>${this.failureResponse ? `查看失败回复 · ${this.failureResponse.length} 字符` : '分镜调用诊断'}</summary>
      ${this.failureResponse ? `<textarea rows="8" maxlength="100000" data-comic-failure aria-label="分镜失败回复" spellcheck="false">${esc(this.failureResponse)}</textarea>` : ''}
      <div class="comic-actions">${command('reparse', 'braces', '重新解析此回复', !this.failureResponse || this.busy || this.submitting)}
      ${command('repair-preview', 'wand-sparkles', '格式修复预览', !this.failureResponse || this.busy || this.submitting)}
      ${command('diagnostic', 'copy', '复制脱敏诊断', this.busy)}
      ${command('failure-clear', 'trash-2', '清除失败回复', this.busy)}</div>
      <p class="comic-note">重新解析不调用模型；回复自动保存在本设备当前账号的恢复记录中。</p>
      ${this.repairHTML()}
      ${this.diagnosticText ? `<textarea rows="5" readonly aria-label="分镜脱敏诊断">${esc(this.diagnosticText)}</textarea>` : ''}</details>`;
  }
  repairHTML() {
    const preview = this.repairPreview;
    if (!preview) return '';
    const stale = preview.original !== this.failureResponse || preview.base !== this.storySignature(this.project);
    const labels = { title: '标题', scene: '画面描述', shot: '镜头', positive: '正向提示词', negative: '负面提示词',
      caption: '旁白', speaker: '说话人', text: '对白', type: '气泡类型' };
    return `<section class="comic-format-repair" data-comic-repair-preview aria-label="分镜格式修复预览">
      <h2>格式修复预览</h2><p>转义 ${preview.quotes} 处字符串引号 · ${preview.panels} 格分镜 · 原始回复保留</p>
      <ul>${preview.changes.map((row) => `<li>第 ${row.line} 行 · ${labels[row.field]} · ${row.quotes} 处引号</li>`).join('')}</ul>
      <textarea rows="8" readonly aria-label="修复后的分镜 JSON" spellcheck="false">${esc(preview.source)}</textarea>
      <p role="status" data-comic-repair-stale ${stale ? '' : 'hidden'}>剧情或回复已变化，请重新预览修复。</p>
      <div class="comic-actions">${command('repair-apply', 'check', '使用修复并解析', stale || this.busy || this.submitting, 'primary')}
        ${command('repair-dismiss', 'x', '取消修复', this.busy || this.submitting)}</div></section>`;
  }
  settingsHTML(project) {
    const local = project.storyboard, setup = this.setup?.() || {}, a = comicAssistantOptions(setup.assistant, project);
    return `<details class="comic-assistant-settings" data-experience-fold="comic-model" ${this.experience?.().level === 'full' ? 'open' : ''}><summary>分镜调用设置 · ${esc(a.source === 'api' ? a.model || '未选文字模型' : a.tavernModel || setup.currentModel || '酒馆当前模型')}</summary>
      <p class="comic-note">${a.source === 'api' ? '独立 API' : '跟随酒馆接口'} · ${esc(a.source === 'api' ? a.apiTransport === 'tavern' ? '酒馆转发' : '设备直连' : '酒馆调用')} · ${a.maxTokens} Token</p>
      <div class="comic-form-grid">
      ${field('漫画文字模型', `<input data-comic-assistant="model" maxlength="200" value="${esc(local.model)}" placeholder="${esc(a.source === 'api' ? setup.assistant?.model || '沿用助手模型' : setup.currentModel || '沿用酒馆当前模型')}">`)}
      ${field('分镜预设', `<select data-comic-assistant="presetMode">${options([['none', '仅分镜内置规则'], ['current', '酒馆当前预设 · 全部启用条目'], ['inherit', '沿用提示词助手预设选择']], local.presetMode)}</select>`)}
      ${field('返回方式', `<select data-comic-assistant="responseMode">${options([['text', '普通 JSON 回复'], ['json', '接口 JSON 模式'], ['tool', '工具调用'], ['inherit', '沿用提示词助手设置']], local.responseMode)}</select>`)}
      ${field('最大输出 Token（0 为沿用助手）', `<input type="number" min="0" max="${ASSISTANT_MAX_TOKENS}" data-comic-assistant="maxTokens" value="${local.maxTokens}">`)}
      </div>${renderAssistantBudget(setup.budget)}<div class="comic-actions">${command('assistant-settings', 'settings-2', '配置文字接口')}
        ${command('budget-preview', 'list-checks', '估算分镜预算', !project.source.trim())}</div></details>`;
  }
  projectsHTML() {
    const filter = this.projectFilter || 'active', project = this.project;
    const all = this.chapters, series = this.library.series || [], query = (this.projectSearch || '').trim().toLowerCase();
    const filtered = all.filter((row) => (filter === 'all' || row.archived === (filter === 'archived'))
      && (!this.seriesFilter || row.seriesId === this.seriesFilter)
      && (!query || `${row.title} ${row.chapter} ${series.find((item) => item.id === row.seriesId)?.title || ''}`.toLowerCase().includes(query)))
      .sort((a, b) => this.seriesFilter ? a.chapter - b.chapter || a.updatedAt - b.updatedAt : b.updatedAt - a.updatedAt);
    const count = Math.max(1, Math.ceil(filtered.length / 12)), page = Math.min(this.projectPage || 1, count);
    const rows = filtered.slice((page - 1) * 12, page * 12);
    return `<section class="comic-project-manager" id="comic-project-manager" aria-label="漫画项目整理">
      <div class="comic-actions"><h2>系列与章节</h2><span class="comic-note">已加载 ${this.library.projects.length} / 8 · 共 ${all.length} / 200 章</span>${tool('projects-close', 'chevron-up', '收起项目整理')}</div>
      <div class="comic-form-grid">${field('项目状态', `<select data-comic-project-filter>${options([['active', '进行中'], ['archived', '已归档'], ['all', '全部']], filter)}</select>`)}
      ${field('筛选系列', `<select data-comic-series-filter>${options([['', '全部系列'], ...series.map((row) => [row.id, row.title])], this.seriesFilter || '')}</select>`)}
      ${field('搜索章节', `<input data-comic-project-search value="${esc(this.projectSearch || '')}" maxlength="100" type="search">`)}</div>
      <div class="comic-project-list">${rows.map((row) => `<div class="comic-project-row">
        <span class="comic-project-cover" data-comic-cover="${esc(row.id)}">${this.coverURLs.has(row.id) ? `<img src="${esc(this.coverURLs.get(row.id))}" alt="" loading="lazy">` : icon('panels-top-left')}</span>
        <span><strong>${esc(row.title)}</strong><small>${esc(series.find((item) => item.id === row.seriesId)?.title || '独立项目')} · 第 ${row.chapter} 章 · ${row.panels} 格${row.archived ? ' · 已归档' : ''} · ${row.loaded ? '已加载' : row.location === 'server' ? '账号章节库' : '本设备章节库'}</small></span>
        ${command('project-open', 'folder-open', row.id === project?.id ? '当前项目' : '打开', row.id === project?.id, 'secondary', `data-project-id="${esc(row.id)}"`)}</div>`).join('') || '<p class="comic-note">暂无此类项目</p>'}</div>
      <div class="comic-actions">${tool('chapter-prev', 'chevron-left', '上一页章节', page <= 1)}<span>${page} / ${count}</span>${tool('chapter-next', 'chevron-right', '下一页章节', page >= count)}</div>
      <div class="comic-readonly-status" data-comic-covers-status ${this.coverWarning ? '' : 'hidden'}><span>${esc(this.coverWarning || '')}</span>${command('covers-retry', 'refresh-cw', '重试读取封面')}</div>
      <div class="comic-series-create">${field('新系列名称', `<input data-comic-series-name value="${esc(this.seriesName || '')}" maxlength="100">`)}
        <div class="comic-actions">${project ? command('series-create-join', 'book-plus', '创建并加入本章', this.hasTasks(), 'primary') : ''}
        ${command('series-create', 'library-big', '仅创建空系列')}</div></div>
      <div class="comic-actions">${command('series-pack-check', 'package', '检查系列带图备份', !this.seriesFilter)}
        ${command('series-export', 'file-json', '导出配置（不含图片）', !this.seriesFilter)}
        ${command('series-rename', 'pencil', '重命名所选系列', !this.seriesFilter)}
        ${command('series-remove', 'trash-2', '删除所选分组', !this.seriesFilter)}</div>
      <p class="comic-note">配置 JSON 不含图片；带图备份包含当前配图，历史版本与参考素材请使用完整备份。</p>
      ${this.seriesPackHTML()}
      ${project ? `<div class="comic-actions comic-divider">${command('project-copy', 'copy', '复制项目', this.hasTasks())}
        ${command('project-sequel', 'book-plus', '新建续章', this.hasTasks())}
        ${command('project-archive', project.archived ? 'archive-restore' : 'archive', project.archived ? '取消归档' : '归档项目', this.hasTasks())}
        ${command('chapter-unload', 'hard-drive-download', '保存并卸载本章', this.hasTasks() || !this.chapterStore)}</div>
      <div class="comic-chapter-range">${field('本章所属系列', `<select data-comic-series-assignment>${options([['', '独立项目'], ...series.map((row) => [row.id, row.title])], this.seriesAssignment ?? project.seriesId)}</select>`)}
        ${field('本章编号', `<input type="number" data-comic-chapter-number min="1" max="9999" value="${this.chapterNumber ?? project.chapter}">`)}
        ${command('series-assign', 'check', '保存系列与编号', this.hasTasks())}</div>
      <div class="comic-chapter-range">${field('章节起始画格', `<input type="number" data-comic-chapter-start min="1" max="${project.panels.length}" value="${this.chapterStart || 1}">`)}
        ${field('章节结束画格', `<input type="number" data-comic-chapter-end min="1" max="${project.panels.length}" value="${this.chapterEnd || project.panels.length || 1}">`)}
        ${command('project-split', 'scissors', '复制为新章节', !project.panels.length || this.hasTasks())}</div>` : ''}</section>`;
  }
  castHTML(project) {
    const entries = project.characterScene?.entries || [], profiles = this.getProfiles?.() || [];
    const available = profiles.filter((profile) => !entries.some((entry) => entry.profileId === profile.id));
    return `<section class="comic-project-cast" aria-label="项目角色管理"><div class="comic-cast-add">
      ${field('添加项目角色', `<select data-comic-profile-add><option value="">选择角色档案</option>${options(available.map((row) => [row.id, row.name]), this.addProfileId || '')}</select>`)}
      ${command('cast-add', 'user-round-plus', '添加角色', entries.length >= 6 || this.hasTasks())}
      ${command('cast-refresh', 'users-round', '同步当前角色档案', this.hasTasks())}
      ${tool('characters', 'settings-2', '管理角色档案库', this.hasTasks())}</div>
      ${entries.map((entry) => `<div class="comic-cast-locks"><strong>${esc(entry.profile.name)}</strong>
        <label class="comic-check"><input type="checkbox" data-comic-profile-lock="lockAppearance" data-profile-id="${esc(entry.profileId)}" ${entry.profile.lockAppearance ? 'checked' : ''}>锁定外观</label>
        <label class="comic-check"><input type="checkbox" data-comic-profile-lock="lockOutfit" data-profile-id="${esc(entry.profileId)}" ${entry.profile.lockOutfit ? 'checked' : ''}>锁定服装</label>
        ${field('项目服装', `<select data-comic-outfit="${esc(entry.profileId)}"><option value="">无指定服装</option>${options(entry.profile.outfits.map((row) => [row.id, row.name]), entry.outfitId)}</select>`)}
        ${tool('cast-reference', 'image-plus', entry.profile.reference ? '替换项目人物参考图' : '上传项目人物参考图', this.hasTasks(), `data-profile-id="${esc(entry.profileId)}"`)}
        ${entry.profile.reference ? tool('cast-reference-clear', 'image-off', '移除项目人物参考图', this.hasTasks(), `data-profile-id="${esc(entry.profileId)}"`) : ''}
        ${tool('cast-remove', 'user-round-minus', '从项目移除角色', this.hasTasks(), `data-profile-id="${esc(entry.profileId)}"`)}
        ${entry.profile.reference ? `<small>${esc(entry.profile.reference.name)}</small>` : ''}</div>`).join('')}
      ${entries.length ? `${field('生图人物参考（仅在该角色出场时使用）', `<select data-comic-reference-profile><option value="">不使用人物参考图</option>${options(entries.filter((entry) => entry.profile.reference).map((entry) => [entry.profileId, entry.profile.name]), project.referenceProfileId)}</select>`)}
      <p class="comic-note">${esc(this.referenceCapability?.() || '当前接口未启用人物参考图能力')} · 项目角色修改不影响原档案</p>` : '<p class="comic-note">未绑定角色档案，跨格外观可能变化。</p>'}
      </section>`;
  }
  seriesSignature(seriesId = this.seriesFilter) {
    return JSON.stringify([this.library.series?.find((row) => row.id === seriesId),
      this.library.projects.filter((row) => row.seriesId === seriesId),
      this.library.shelved?.filter((row) => row.seriesId === seriesId)]);
  }
  seriesPackHTML() {
    const report = this.seriesPackInspection;
    if (!report || report.seriesId !== this.seriesFilter) return '';
    const stale = report.signature !== this.seriesSignature(report.seriesId);
    const size = (report.estimatedBytes / 1024 / 1024).toFixed(1);
    return `<section class="comic-series-inspection" aria-label="系列备份检查" role="status">
      <strong>${report.chapters} 章 · ${report.panels} 格 · ${report.images} 张当前配图</strong>
      <p>预计 ${size} MB${report.unknownSizes ? `，另有 ${report.unknownSizes} 张大小待读取` : ''} · 图片上限 64 MB${report.reused ? ` · 复用 ${report.reused} 次图片引用` : ''}</p>
      ${report.unpictured ? `<p class="comic-note">${report.unpictured} 格尚未配图，将保留可编辑分镜。</p>` : ''}
      ${report.issues.length ? `<ul>${report.issues.slice(0, 12).map((issue) => `<li><span>${esc(issue.message)}</span>${issue.panelId && ['missing', 'unreachable'].includes(issue.code)
        ? command('series-pack-fix', 'image', '前往画格', false, 'secondary', `data-project-id="${esc(issue.projectId)}" data-panel-id="${esc(issue.panelId)}"`) : ''}</li>`).join('')}</ul>
        ${report.issues.length > 12 ? `<p>另有 ${report.issues.length - 12} 项问题。</p>` : ''}` : '<p class="comic-note">当前引用的原图可读取。</p>'}
      ${stale ? '<p class="comic-export-error">系列内容已变化，请重新检查。</p>' : ''}
      <div class="comic-actions">${command('series-pack-export', 'download', '下载系列与配图', stale || report.issues.length > 0, 'primary')}
        ${command('series-pack-check', 'refresh-cw', '重新检查')}${command('series-pack-dismiss', 'x', '收起检查')}</div>
      ${this.exportFile?.seriesId === this.seriesFilter ? `<div class="comic-export-result"><p>文件已准备：${esc(this.exportFile.name)}</p>
        <div class="comic-actions">${command('download-again', 'download', '重新下载')}${command('export-open', 'external-link', '打开文件')}
        ${globalThis.navigator?.canShare && globalThis.navigator?.share ? command('export-share', 'share-2', '分享文件') : ''}</div></div>` : ''}</section>`;
  }
  rewriteHTML(project, panel) {
    const draft = this.rewrite?.panelId === panel.id ? this.rewrite : null;
    const stale = draft?.candidate && draft.base !== comicPanelEditSignature(project, panel.id, this.assistantIdentity?.());
    const changes = draft?.candidate ? comicPanelChanges(project, draft.candidate, panel.id) : [];
    return `<section class="comic-panel-rewrite" aria-label="单格 AI 修改"><h2>单格 AI 修改</h2>
      ${field('本格修改要求', `<textarea data-comic-rewrite-input maxlength="4000" rows="2" placeholder="改成近景，保留人物，换成夜晚">${esc(draft?.instruction || '')}</textarea>`)}
      <div class="comic-actions">${['keepCharacters', 'keepDialogue'].map((key) => `<label class="comic-check"><input type="checkbox" data-comic-rewrite-lock="${key}" ${draft?.[key] !== false ? 'checked' : ''}>${key === 'keepCharacters' ? '保留出场角色' : '保留旁白与对白'}</label>`).join('')}
      ${command('panel-rewrite', 'sparkles', 'AI 修改本格', comicPanelBusy(panel, this.jobs()) || !draft?.instruction.trim(), 'primary')}</div>
      ${draft?.candidate ? `<div data-comic-rewrite-result>
        <p data-comic-rewrite-stale ${stale ? '' : 'hidden'}>画格、剧情、角色或文字接口设置已变化，请重新修改本格。</p>
        ${changes.length ? changes.map((row) => `<section class="comic-rewrite-change"><strong>${esc(row.label)}</strong><div class="comic-rewrite-columns">
          <div><small>当前</small><pre>${esc(row.before)}</pre></div><div><small>修改后</small><pre>${esc(row.after)}</pre></div></div></section>`).join('') : '<p>没有字段变化。</p>'}
        <div class="comic-actions">${command('rewrite-accept', 'check', '采用本格修改', stale || comicPanelBusy(panel, this.jobs()), 'primary')}
        ${command('rewrite-discard', 'x', '放弃本格修改')}</div></div>` : ''}</section>`;
  }
  story(project) {
    const panel = this.panel;
    return `${this.settingsHTML(project)}<div class="comic-form-grid">
      ${field('项目名称', text('project', 'title', project.title))}
      ${field('分镜格数', `<input type="number" min="1" max="12" data-comic-project="panelCount" value="${project.panelCount}">`)}
      <div class="comic-wide comic-source-toolbar"><div class="comic-range">${field('起始楼层', `<input type="number" min="1" data-comic-range="start" value="${this.range.start}">`)}
      ${field('结束楼层', `<input type="number" min="1" data-comic-range="end" value="${this.range.end}">`)}</div><div class="comic-actions">${command('chat-latest', 'message-square', '读取最新回复')}${command('chat-range', 'messages-square', '读取所选楼层')}</div></div>
      <div class="comic-wide">${field('剧情正文', area('project', 'source', project.source, 32000, 8))}
      <small>${esc(project.sourceLabel || '手动输入')} · ${project.source.length} / 32000 字符</small></div>
      ${field('统一画风', area('project', 'style', project.style))}
      ${field('统一负面提示词', area('project', 'negative', project.negative))}
      </div>${experienceFold({ experience: this.experience?.() }, 'comic-cast', '项目角色与外观锁定', this.castHTML(project))}
      <div class="comic-actions comic-divider">${command('storyboard', 'sparkles', 'AI 创建分镜', !project.source.trim() || this.hasTasks(), 'primary')}
      ${command('task-prompts', 'pencil', '分镜提示词')}
      ${command('panel-add', 'plus', '添加空白画格', project.panels.length >= COMIC_LIMITS.panels || this.hasTasks())}</div>
      ${project.panels.length ? `${this.panelSelector(project)}${this.panelEditor(panel, project)}` : '<p class="comic-empty">暂无分镜</p>'}`;
  }
  panelSelector(project) {
    return `<div class="comic-panel-select">${field('当前画格', `<select data-comic-panel-select>${project.panels.map((panel, index) => `<option value="${esc(panel.id)}" ${panel.id === this.panel?.id ? 'selected' : ''}>${index + 1}. ${esc(panel.title || '画格')}</option>`).join('')}</select>`)}
      <div class="comic-actions">${tool('panel-up', 'arrow-up', '上移画格', project.panels[0]?.id === this.panel?.id)}
      ${tool('panel-down', 'arrow-down', '下移画格', project.panels.at(-1)?.id === this.panel?.id)}
      ${tool('panel-delete', 'trash-2', '删除当前画格', comicPanelBusy(this.panel, this.jobs()))}</div></div>`;
  }
  panelEditor(panel, project) {
    return `<div class="comic-form-grid">${field('画格名称', text('panel', 'title', panel.title))}
      ${field('镜头与构图', text('panel', 'shot', panel.shot, 240))}
      <div class="comic-wide">${field('画面描述', area('panel', 'scene', panel.scene))}</div>
      ${field('生图提示词', area('panel', 'positive', panel.positive, 6000, 5))}
      ${field('本格负面提示词', area('panel', 'negative', panel.negative))}
      <div class="comic-wide comic-cast"><span>本格出场角色</span><div>${(project.characterScene?.entries || []).map((entry) => `<label><input type="checkbox" data-comic-cast="${esc(entry.profileId)}" ${panel.characterIds.includes(entry.profileId) ? 'checked' : ''}>${esc(entry.profile.name)}</label>`).join('') || '<span>无绑定档案</span>'}</div></div>
      ${(project.characterScene?.entries || []).filter((entry) => panel.characterIds.includes(entry.profileId)).map((entry) => {
        const direction = panel.characters.find((row) => row.profileId === entry.profileId);
        return `${field(`${esc(entry.profile.name)} · 动作`, `<input data-comic-character="action" data-profile-id="${esc(entry.profileId)}" value="${esc(direction?.action || '')}" maxlength="1000">`)}
        ${field(`${esc(entry.profile.name)} · 表情`, `<input data-comic-character="expression" data-profile-id="${esc(entry.profileId)}" value="${esc(direction?.expression || '')}" maxlength="500">`)}`;
      }).join('')}</div>${this.rewriteHTML(project, panel)}`;
  }
  generation(project) {
    return `<div class="comic-actions">${command('generate-missing', 'images', '生成未配图画格', !comicMissingPanelIds(project, this.assetStates).length || this.hasTasks(), 'primary')}
      ${command('generate-failed', 'rotate-ccw', '仅重试失败格', !this.failedPanelIds(project).length || this.hasTasks())}
      ${command('assets-refresh', 'scan-search', '检测图片')}
      ${command('queue', 'list-todo', '查看任务记录')}</div>
      <section class="comic-progress" data-comic-progress aria-label="画格任务进度">${this.progressHTML(project)}</section>
      ${this.generationSummary()}
      ${this.confirmHTML(project)}
      <div class="comic-frame-grid">${project.panels.map((panel, index) => `<article class="comic-frame" data-comic-frame="${esc(panel.id)}">
        <div class="comic-frame-image" data-comic-image-slot="${esc(panel.id)}">${this.imageHTML(panel)}</div>
        <div class="comic-frame-copy"><div class="comic-frame-heading"><strong>${index + 1}. ${esc(panel.title || '画格')}</strong>
        <div class="comic-actions">${tool('panel-edit', 'pencil', '编辑本格提示词', false, `data-panel-id="${esc(panel.id)}"`)}
        ${tool('panel-image', 'images', '选用图库图片', comicPanelBusy(panel, this.jobs()), `data-panel-id="${esc(panel.id)}"`)}</div></div><p>${esc(panel.scene)}</p>
        <p class="comic-task-status" data-comic-status="${esc(panel.id)}">${this.panelStatus(panel)}</p>
        <div class="comic-actions">${command('panel-generate', 'refresh-cw', panel.image ? '再画一张' : '生成本格', comicPanelBusy(panel, this.jobs()), 'secondary', `data-panel-id="${esc(panel.id)}"`)}
        ${command('panel-cancel', 'square', '取消任务', !comicPanelJobs(panel, this.jobs()).some((job) => ['queued', 'running'].includes(job.status)), 'secondary', `data-panel-id="${esc(panel.id)}"`)}</div>
        ${field('图片版本', `<select data-comic-version="${esc(panel.id)}" ${panel.versions.length ? '' : 'disabled'}><option value="">尚未配图</option>${panel.versions.map((ref, index) => `<option value="${esc(comicRefKey(ref))}" ${comicRefKey(ref) === comicRefKey(panel.image) ? 'selected' : ''}>第 ${index + 1} 张 · ${ref.location === 'server' ? '酒馆服务器' : '浏览器'}</option>`).join('')}</select>`)}
        </div></article>`).join('') || '<p class="comic-empty">请先创建分镜</p>'}</div>`;
  }
  failedPanelIds(project) {
    return project.panels.filter((panel) => comicPanelTask(panel, this.jobs())?.status === 'failed'
      && !comicPanelBusy(panel, this.jobs())).map((panel) => panel.id);
  }
  progressHTML(project) {
    const progress = comicProjectProgress(project, this.jobs(), this.assetStates);
    const counts = [['running', '生成中'], ['queued', '排队中'], ['paused', '待继续'], ['uncertain', '待核对'], ['failed', '失败'], ['cancelled', '已取消']]
      .filter(([key]) => progress[key]).map(([key, label]) => `<span data-comic-progress-state="${key}">${label} ${progress[key]}</span>`).join('');
    return `<div class="comic-progress-heading"><strong>配图可用 ${progress.pictured} / ${progress.total}</strong><div>${counts}
      ${progress.missing ? `<span>待配图 ${progress.missing}${progress.broken ? `（含缺图 ${progress.broken}）` : ''}</span>` : ''}
      ${progress.checking ? `<span>检测中 ${progress.checking}</span>` : ''}${progress.unreachable ? `<span>暂无法读取 ${progress.unreachable}</span>` : ''}</div></div>
      <progress max="${Math.max(1, progress.total)}" value="${progress.pictured}" aria-label="已配图画格"></progress>
      ${progress.paused || progress.uncertain ? `<div class="comic-progress-attention"><span>${progress.uncertain ? '提交结果待核对' : '存在暂停任务'}</span>${command('queue', 'list-todo', '处理待核对任务')}</div>` : ''}`;
  }
  generationSummary() {
    const info = this.setup?.().image || {};
    return `<dl class="comic-facts"><dt>生图接口</dt><dd>${esc(this.providerTitle())} · ${esc(info.connection || '当前配置')}</dd>
      <dt>模型</dt><dd>${esc(info.model || '当前工作流')}</dd><dt>尺寸与步数</dt><dd>${esc(info.size || '由工作流决定')} · ${esc(info.steps || '默认')} 步</dd>
      <dt>图片保存</dt><dd>${esc(info.storage || '当前存储位置')} · 每格 1 张 · 自动收藏</dd></dl>
      <div class="comic-actions">${command('image-settings', 'plug', '生图接口设置')}</div>`;
  }
  imageHTML(panel) {
    const src = this.previews.get(comicRefKey(panel.image));
    const state = this.assetStates.get(comicRefKey(panel.image));
    return src && !this.thumbnailErrors?.has(comicRefKey(panel.image)) ? `<img src="${esc(src)}" alt="${esc(panel.title || '漫画画格')}" loading="lazy" decoding="async">`
      : `<span class="comic-image-missing">${icon(state?.status === 'unreachable' ? 'wifi-off' : panel.image ? 'image-off' : 'image')}<span>${esc(!panel.image ? '尚未生成'
        : this.thumbnailErrors?.has(comicRefKey(panel.image)) ? '缩略图暂时无法显示，可检测原图或重新选图' : state?.detail || '正在检测图片…')}</span></span>`;
  }
  panelStatus(panel) {
    const latest = comicPanelTask(panel, this.jobs());
    const state = this.assetStates.get(comicRefKey(panel.image));
    const asset = !panel.image ? '未配图' : ({ available: '原图可用', loading: '正在检测原图', missing: '图片缺失，可选图或补画',
      unreachable: '存储暂时无法读取，请重新检测' })[state?.status] || '图片待检测';
    return esc([latest && `${statusName(latest)}${latest.error ? ` · ${latest.error}` : ''}`, asset].filter(Boolean).join(' · '));
  }
  confirmHTML(project) {
    if (!this.confirm || this.confirm.projectId !== project.id) return '';
    return `<div class="comic-confirm" role="status"><strong>即将提交 ${this.confirm.ids.length} 个生图任务</strong>
      <p>${this.confirm.ids.map((id) => `第 ${project.panels.findIndex((panel) => panel.id === id) + 1} 格`).join('、')} · 费用以所选服务实际扣费为准</p>
      ${(this.confirm.preview || []).map((row) => `<details class="comic-confirm-prompt"><summary>第 ${project.panels.findIndex((panel) => panel.id === row.id) + 1} 格 · 实际提交提示词</summary>
      ${field('正向提示词', `<textarea rows="4" readonly>${esc(row.positive)}</textarea>`)}${field(esc(row.negativeLabel || '负面提示词'), `<textarea rows="3" readonly>${esc(row.negative)}</textarea>`)}
      ${(row.characters || []).map((character, index) => `${field(`角色 ${index + 1} 正向`, `<textarea rows="3" readonly>${esc(character.positive)}</textarea>`)}
      ${field(`角色 ${index + 1} 负向`, `<textarea rows="2" readonly>${esc(character.negative)}</textarea>`)}`).join('')}</details>`).join('')}
      <div class="comic-actions">${command('generate-confirm', 'check', `确认生成 ${this.confirm.ids.length} 格`, false, 'primary')}${command('generate-dismiss', 'x', '取消')}</div></div>`;
  }
  layout(project) {
    const layout = project.layout, panel = this.panel;
    return `<div class="comic-layout-switch" role="group" aria-label="排版视图">
      ${[['edit', 'sliders-horizontal', '编辑'], ['preview', 'eye', '预览']].map(([view, glyph, label]) => `<button type="button" class="ui-button secondary" data-comic-action="layout-view" data-view="${view}" aria-pressed="${this.layoutView === view}">${icon(glyph)}${label}</button>`).join('')}
      </div>${this.layoutSuggestion ? `<section class="comic-layout-suggestion" role="status"><strong>位置建议 · ${this.layoutSuggestion.changes.length} 处移动</strong>
        ${this.layoutSuggestion.warnings.map((value) => `<p>${esc(value)}</p>`).join('')}
        <div class="comic-actions">${command('layout-accept', 'check', '采用建议', this.layoutSuggestion.base !== comicLayoutSignature(project))}
          ${command('layout-dismiss', 'x', '取消建议')}</div></section>` : ''}
      <div class="comic-layout-workspace" data-layout-view="${this.layoutView}"><div class="comic-layout-controls">
      <div class="comic-template-row">${field('排版模板', `<select data-comic-layout-template>${options(COMIC_LAYOUT_TEMPLATES.map((row) => [row.id, row.title]), this.layoutTemplate || 'scroll')}</select>`)}
        ${command('layout-template', 'layout-template', '采用模板', !project.panels.length)}</div>
      <div class="comic-form-grid">${field('版式', `<select data-comic-layout="mode">${options([['strip', '条漫'], ['grid', '四格分页'], ['double', '双列漫画']], layout.mode)}</select>`)}
      ${field('阅读方向', `<select data-comic-layout="direction">${options([['ltr', '从左到右'], ['rtl', '从右到左']], layout.direction)}</select>`)}
      ${field('画格比例', `<select data-comic-layout="aspect">${options([['auto', '自动匹配图片比例'], ['portrait', '竖构图'], ['square', '正方形'], ['landscape', '横构图']], layout.aspect)}</select>`)}
      ${field('图片适配', `<select data-comic-layout="fit">${options([['cover', '填满画格 · 居中裁切'], ['contain', '完整显示图片']], layout.fit)}</select>`)}
      ${field('画格间距', `<input type="range" min="4" max="40" step="1" value="${layout.gap}" data-comic-layout="gap">`)}
      ${field('对白字号', `<input type="range" min="18" max="44" step="1" value="${layout.fontSize}" data-comic-layout="fontSize">`)}</div>
      ${panel ? `${this.panelSelector(project)}
      ${field('本格旁白', area('panel', 'caption', panel.caption, 600))}
      <details class="comic-protection-controls" data-experience-fold="comic-protection"><summary>本格主体保护区（手动）</summary>
        ${this.protectionFields(panel)}
        <div class="comic-actions">${command('protection-edit', 'scan', '在图片上编辑保护区', false, 'secondary')}</div></details>
      <div class="comic-actions">${command('layout-suggest', 'wand-sparkles', '预览本格位置建议', !panel.bubbles.some((row) => row.text.trim()))}</div>
      <div class="comic-bubble-list">${panel.bubbles.map((bubble, index) => this.bubbleEditor(panel, bubble, index)).join('')}</div>
      <div class="comic-actions">${command('bubble-add', 'message-circle-plus', '添加对白', panel.bubbles.length >= COMIC_LIMITS.bubbles)}</div>` : ''}
      </div><div class="comic-layout-preview"><div class="comic-preview-selector">${field('预览画格', `<select data-comic-preview-panel>${options(project.panels.map((row, index) => [row.id, `${index + 1}. ${row.title || '画格'}`]), this.panel?.id)}</select>`)}</div>
        ${panel ? `<div class="comic-protection-toolbar">${command('protection-edit', this.protectionEditing ? 'check' : 'scan', this.protectionEditing ? '完成保护区编辑' : '编辑主体保护区', false, 'secondary', `aria-pressed="${Boolean(this.protectionEditing)}"`)}
          ${this.protectionEditing ? `<div class="comic-protection-precise">${this.protectionFields(panel, true)}</div>` : ''}</div>` : ''}
        ${this.previewHTML()}<section class="comic-bubble-inspector" data-comic-bubble-inspector aria-label="选中气泡编辑" ${this.selectedBubble && !this.protectionEditing ? '' : 'hidden'}>${this.selectedBubbleHTML()}</section></div></div>`;
  }
  bubbleEditor(panel, bubble, index, compact = false) {
    const binding = `data-bubble-id="${esc(bubble.id)}" data-panel-id="${esc(panel.id)}"`;
    const toolsOpen = compact && this.bubbleToolsFor === bubble.id;
    const position = `<div class="comic-bubble-tools" role="group" aria-label="气泡位置微调">
      ${[['left', 'arrow-left', '气泡左移'], ['up', 'arrow-up', '气泡上移'], ['down', 'arrow-down', '气泡下移'], ['right', 'arrow-right', '气泡右移'],
        ['center-x', 'align-horizontal-justify-center', '气泡水平居中'], ['center-y', 'align-vertical-justify-center', '气泡垂直居中']]
        .map(([move, glyph, title]) => tool('bubble-position', glyph, title, false, `data-move="${move}"`)).join('')}
      <label class="comic-check"><input type="checkbox" data-comic-snap ${this.snap ? 'checked' : ''}>位置吸附</label></div>`;
    const style = `<div class="comic-form-grid comic-bubble-style-grid">
      ${field('说话人', `<input data-comic-bubble="speaker" value="${esc(bubble.speaker)}" maxlength="60">`)}
      ${field('独立字号（0 跟随全局）', `<input type="number" min="0" max="64" step="1" data-comic-bubble="fontSize" value="${bubble.fontSize || 0}">`)}
      ${field('文字对齐', `<select data-comic-bubble="align">${options([['left', '左对齐'], ['center', '居中'], ['right', '右对齐']], bubble.align || 'left')}</select>`)}
      ${field('气泡层级', `<select data-comic-bubble-layer>${options(panel.bubbles.map((row, layer) => [row.id, `第 ${layer + 1} 层${layer === 0 ? ' · 底层' : layer === panel.bubbles.length - 1 ? ' · 顶层' : ''}`]), bubble.id)}</select>`)}
      ${field('类型', `<select data-comic-bubble="type">${options([['speech', '对话'], ['thought', '内心独白']], bubble.type)}</select>`)}
      ${field('尾巴方向', `<select data-comic-bubble="tail">${options([['none', '无'], ['bottom', '向下'], ['top', '向上'], ['left', '向左'], ['right', '向右']], bubble.tail || 'bottom')}</select>`)}
      <label class="comic-check"><input type="checkbox" data-comic-bubble="speakerVisible" ${bubble.speakerVisible ? 'checked' : ''}>显示说话人</label>
      <label class="comic-check"><input type="checkbox" data-comic-bubble="autoFit" ${bubble.autoFit ? 'checked' : ''}>自动适配气泡宽度</label>
      ${[['x', '横向位置', 5, 95], ['y', '纵向位置', 5, 90], ['width', '气泡宽度', 22, 90], ['tailPosition', '尾巴起点', 10, 90], ['tailLength', '尾巴长度', 4, 40]]
        .map(([key, label, min, max]) => field(label, `<input type="range" step="0.1" data-comic-bubble="${key}" min="${min}" max="${max}" value="${bubble[key]}">`)).join('')}</div>`;
    return `<article class="comic-bubble-editor" ${binding} data-selected="${this.selectedBubble === bubble.id}">
      <div class="comic-bubble-heading"><strong>${compact ? `第 ${this.project.panels.indexOf(panel) + 1} 格 · ` : ''}对白 ${index + 1}</strong>
        ${compact ? tool('bubble-tools-toggle', 'sliders-horizontal', '气泡位置与样式', false, `aria-expanded="${toolsOpen}" aria-controls="comic-bubble-adjustments"`) : ''}
        ${compact ? tool('bubble-deselect', 'x', '收起气泡编辑') : tool('bubble-locate', 'locate-fixed', '在预览中定位气泡', !bubble.text.trim())}
        ${compact ? '' : tool('bubble-delete', 'trash-2', '删除对白', false, binding)}</div>
      ${field('对白文字', `<textarea data-comic-bubble="text" maxlength="600" rows="${compact ? 2 : 3}">${esc(bubble.text)}</textarea>`)}
      ${compact ? `<div id="comic-bubble-adjustments" class="comic-bubble-adjustments" ${toolsOpen ? '' : 'hidden'}>${position}${style}</div>` : position + style}</article>`;
  }
  selectedBubbleHTML() {
    const panel = this.project?.panels.find((row) => row.bubbles.some((bubble) => bubble.id === this.selectedBubble));
    const index = panel?.bubbles.findIndex((row) => row.id === this.selectedBubble);
    return panel && index >= 0 ? this.bubbleEditor(panel, panel.bubbles[index], index, true) : '';
  }
  refreshBubbleInspector() {
    const node = this.root?.querySelector('[data-comic-bubble-inspector]');
    if (!node) return;
    const html = this.selectedBubbleHTML();
    node.hidden = !html || Boolean(this.protectionEditing);
    this.root.dataset.bubbleEditing = String(!node.hidden);
    if (node.dataset.bubble !== this.selectedBubble || !node.firstElementChild) {
      node.innerHTML = html; node.dataset.bubble = this.selectedBubble; paintIcons(node);
    }
  }
  syncBubbleControls(id) {
    const panel = this.project?.panels.find((row) => row.bubbles.some((bubble) => bubble.id === id));
    const bubble = panel?.bubbles.find((row) => row.id === id);
    if (!bubble) return;
    for (const editor of this.root.querySelectorAll(`[data-bubble-id="${id}"]`)) {
      for (const node of editor.querySelectorAll('[data-comic-bubble]')) {
        if (node === document.activeElement) continue;
        const value = bubble[node.dataset.comicBubble];
        if (node.type === 'checkbox') node.checked = value;
        else node.value = value;
      }
    }
  }
  protectionFields(panel, compact = false) {
    const region = panel.protection;
    return `<label class="comic-check"><input type="checkbox" data-comic-protection="enabled" ${region.enabled ? 'checked' : ''}>避开此区域</label>
      <div class="comic-form-grid">${[['x', '左侧', 0], ['y', '顶部', 0], ['width', '宽度', 10], ['height', '高度', 10]].map(([key, label, min]) => {
        const max = key === 'x' ? 100 - region.width : key === 'y' ? 100 - region.height : 90;
        return field(`${label}（%）`, `<div class="comic-protection-value">${compact ? '' : `<input type="range" data-comic-protection="${key}" min="${min}" max="${max}" step="1" value="${region[key]}" aria-label="保护区${label}滑块">`}
          <input type="number" data-comic-protection="${key}" min="${min}" max="${max}" step="1" value="${Math.round(region[key] * 10) / 10}" aria-label="保护区${label}百分比"></div>`);
      }).join('')}</div>`;
  }
  protectionRegionHTML(region) {
    return region.enabled ? `<div class="comic-protected-region" data-editing="true" aria-label="手动主体保护区"
      style="left:${region.x}%;top:${region.y}%;width:${region.width}%;height:${region.height}%">
      <button type="button" class="comic-protection-move" data-comic-protection-gesture="move" aria-label="移动主体保护区" title="移动主体保护区">${icon('move')}</button></div>
      <button type="button" class="comic-protection-resize" data-comic-protection-gesture="resize" aria-label="调整主体保护区大小" title="调整主体保护区大小"
      style="left:clamp(22px,${region.x + region.width}%,calc(100% - 22px));top:clamp(22px,${region.y + region.height}%,calc(100% - 22px))">${icon('move-diagonal-2')}</button>` : '';
  }
  read(project) {
    return `<div class="comic-export-options">${field('导出清晰度', `<select data-comic-export-quality>${options(COMIC_EXPORT_QUALITIES.map(([key, label]) => [key, label]), this.exportQuality)}</select>`)}
      ${field('导出页码（留空为全部）', `<input data-comic-export-selection maxlength="120" value="${esc(this.exportSelection)}" placeholder="1-3 或 1,3">`)}
      ${command('export-check', 'scan-search', '导出前检查', !project.panels.length)}</div>
      <div data-comic-export-inspection>${this.inspectionHTML()}</div>
      <div class="comic-actions">${command('preview', 'refresh-cw', '更新预览', !project.panels.length)}
      ${command('export-long', 'image-down', '导出长图', !project.panels.length, 'primary')}
      ${command('export-pages', 'files', '导出分页图片', !project.panels.length)}
      ${command('export-html', 'file-down', '导出离线 HTML', !project.panels.length)}
      ${command('export-project-pack', 'package', '项目与配图备份', !project.panels.length)}</div>
      <p class="comic-note">项目与配图备份包含当前配图和可编辑分镜；历史版本与参考素材请使用完整备份。</p>
      ${this.exportFile?.projectId === project.id ? `<div class="comic-export-result"><p>文件已准备：${esc(this.exportFile.name)}</p><div class="comic-actions">
        ${command('download-again', 'download', '重新下载')}${command('export-open', 'external-link', '打开文件')}
        ${globalThis.navigator?.canShare && globalThis.navigator?.share ? command('export-share', 'share-2', '分享文件') : ''}</div>
        ${this.exportFile.blob.type === 'image/png' ? `<img src="${esc(this.exportFile.url)}" alt="导出的漫画长图">` : ''}</div>` : ''}
      ${this.previewHTML()}`;
  }
  inspectionHTML() {
    const report = this.exportInspection;
    if (!report) return '<p class="comic-note">尚未检查导出</p>';
    if (report.error) return `<p class="comic-export-error">${esc(report.error)}</p>`;
    return `<section class="comic-export-inspection" aria-label="导出检查结果"><strong>已选 ${report.pages.length} 页 · 宽 ${report.width}px</strong>
      <p class="comic-note">${report.pages.map((page) => `第 ${page.number} 页 ${page.width} × ${page.height}px`).join('；')}</p>
      <p class="comic-note">${report.long ? `长图 ${report.long.width} × ${report.long.height}px` : esc(report.longError)}</p>
      ${report.issues.length ? `<ul>${report.issues.map((issue) => `<li data-severity="${issue.severity}"><span>${esc(issue.message)}</span>
      ${command('export-fix', issue.code === 'missing' || issue.code === 'unreachable' ? 'image' : 'message-circle', '前往画格', false, 'secondary', `data-panel-id="${esc(issue.panelId)}" data-issue-code="${issue.code}"`)}</li>`).join('')}</ul>`
      : '<p class="comic-note">所选页面未发现缺图或对白排版问题。</p>'}
      ${report.issues.some((issue) => issue.severity === 'warning') ? `<label class="comic-check"><input type="checkbox" data-comic-export-warnings-ok ${this.acceptExportWarnings ? 'checked' : ''}>已核对排版警告，仍然导出</label>` : ''}</section>`;
  }
  refreshInspection() {
    if (!this.project) return;
    const signature = JSON.stringify([comicExportSignature(this.project), this.exportQuality, this.exportSelection]);
    if (signature !== this.exportInspectionSignature) this.acceptExportWarnings = false;
    this.exportInspectionSignature = signature;
    try {
      const context = document.createElement('canvas').getContext('2d');
      this.exportInspection = comicExportInspection(this.project, { rows: this.rows, states: this.assetStates,
        width: comicExportWidth(this.exportQuality), selection: this.exportSelection, context });
    } catch (error) { this.exportInspection = { error: error.message }; }
    const node = this.root?.querySelector('[data-comic-export-inspection]');
    if (node) { node.innerHTML = this.inspectionHTML(); paintIcons(node); }
  }
  previewHTML() {
    this.previewMarkup = this.pageURLs.length ? this.previewPagesHTML() : '<p class="comic-empty">暂无排版预览</p>';
    return `<div class="comic-preview" data-comic-preview tabindex="-1">${this.previewMarkup}</div>
      <div class="comic-readonly-status" data-comic-preview-status role="status" ${this.previewStatus() ? '' : 'hidden'}><span>${esc(this.previewStatus())}</span>
        ${command('preview-retry', 'refresh-cw', '重试读取预览')}</div>`;
  }
  previewStatus() {
    const unreachable = [...this.assetStates.values()].filter((row) => row.status === 'unreachable').length;
    return this.previewError || (this.previewFailures.size ? `${this.previewFailures.size} 张预览暂时无法读取，已有图片引用保留`
      : unreachable ? `${unreachable} 张原图暂时无法验证，已有预览保留` : '');
  }
  refreshPreviewStatus() {
    const node = this.root?.querySelector('[data-comic-preview-status]'), message = this.previewStatus();
    if (!node) return;
    node.hidden = !message;
    const text = node.querySelector('span'); if (text) text.textContent = message;
  }
  resumeReadonly() {
    if (!this.root?.isConnected || this.busy || this.submitting || this.drag || document.visibilityState === 'hidden') return;
    if (Date.now() - (this.resumedAt || 0) < 3000) return;
    this.resumedAt = Date.now();
    if (this.projectsOpen) void this.loadCovers(true);
    if (this.tab !== 'story') void this.refreshAssets(true);
  }
  previewPagesHTML() {
    return this.pageURLs.map((src, index) => {
      const page = this.pageLayouts?.[index];
      const current = !this.panel || page?.rects?.some((rect) => rect.id === this.panel.id);
      // Keep the scroll range stable while a refreshed preview image decodes.
      const ratio = page ? `style="aspect-ratio:${page.width}/${page.height}"` : '';
      const dimensions = page ? `width="${page.width}" height="${page.height}"` : '';
      return `<div class="comic-preview-page" data-comic-preview-page="${index}" data-current="${Boolean(current)}" ${ratio}><img src="${esc(src)}" alt="漫画预览第 ${index + 1} 页" ${dimensions} decoding="async">
        ${this.tab === 'layout' ? (page?.rects || []).map((rect) => {
          const panel = this.project.panels.find((row) => row.id === rect.id), region = panel && comicProtectedRect(panel, rect);
          if (this.protectionEditing === panel?.id) return `<div class="comic-protection-surface" data-comic-protection-surface="${esc(panel.id)}" aria-label="框选主体保护区"
            style="left:${rect.x / page.width * 100}%;top:${rect.y / page.height * 100}%;width:${rect.width / page.width * 100}%;height:${rect.imageHeight / page.height * 100}%">${this.protectionRegionHTML(panel.protection)}</div>`;
          return region ? `<span class="comic-protected-region" aria-label="手动主体保护区" style="left:${region.x / page.width * 100}%;top:${region.y / page.height * 100}%;width:${region.width / page.width * 100}%;height:${region.height / page.height * 100}%"></span>` : '';
        }).join('') : ''}
        ${this.tab === 'layout' && page && !this.protectionEditing ? page.bubbles.map((bubble) => `<button type="button" class="comic-bubble-handle"
          style="left:${bubble.x / page.width * 100}%;top:${bubble.y / page.height * 100}%;width:${bubble.width / page.width * 100}%;height:${bubble.height / page.height * 100}%"
          data-comic-drag="${esc(bubble.id)}" data-panel-id="${esc(bubble.panelId)}" data-selected="${this.selectedBubble === bubble.id}"
          aria-pressed="${this.selectedBubble === bubble.id}" aria-label="选择或移动对白气泡" title="选择或移动对白气泡">${icon('move')}</button>
          <button type="button" class="comic-bubble-resize" style="left:clamp(24px,${(bubble.x + bubble.width) / page.width * 100}%,calc(100% - 24px));top:clamp(24px,${(bubble.y + bubble.height) / page.height * 100}%,calc(100% - 24px))"
          data-comic-resize="${esc(bubble.id)}" data-panel-id="${esc(bubble.panelId)}" ${this.selectedBubble === bubble.id ? '' : 'hidden'}
          aria-label="调整气泡宽度" title="调整气泡宽度">${icon('move-horizontal')}</button>`).join('') : ''}</div>`;
    }).join('');
  }
  candidateHTML() {
    const stale = this.candidateBase !== this.storySignature(this.project);
    return `<section class="comic-candidate"><h2>分镜待确认 · ${this.candidate.panels.length} 格</h2>
      <ol>${this.candidate.panels.map((panel) => `<li><strong>${esc(panel.title)}</strong><p>${esc(panel.scene)}</p></li>`).join('')}</ol>
      ${this.project.panels.length ? '<p>采用后替换当前分镜；已有图片仍保留在绘图管理。</p>' : ''}
      <p data-comic-candidate-stale ${stale ? '' : 'hidden'}>剧情、角色或格数已变化，请重新创建分镜；原结果仍保留供查看。</p>
      <div class="comic-actions">${command('candidate-accept', 'check', '采用分镜', this.hasTasks() || stale, 'primary')}${command('candidate-dismiss', 'x', '放弃')}</div></section>`;
  }
  bind(host) {
    this.root = host.querySelector('[data-comic-root]');
    if (!this.root) return;
    const preview = this.root.querySelector('[data-comic-preview]');
    if (preview && this.previewMarkup) preview.dataset.signature = this.previewMarkup;
    if (this.scrollHost) this.scrollHost.removeEventListener('scroll', this.scrollListener);
    this.scrollHost = this.root.closest('.plugin-content');
    this.scrollListener = () => {
      clearTimeout(this.viewTimer);
      this.viewTimer = setTimeout(() => this.stashDraft(), 150);
    };
    this.scrollHost?.addEventListener('scroll', this.scrollListener, { passive: true });
    if (this.restoreView) {
      const saved = this.restoreView, projectId = this.project?.id; this.restoreView = null;
      requestAnimationFrame(() => {
        if (this.project?.id !== projectId || !this.root?.isConnected) return;
        if (this.scrollHost) this.scrollHost.scrollTop = saved.scrollTop;
        const tabs = this.root.querySelector('.comic-tabs'); if (tabs) tabs.scrollLeft = saved.tabScroll;
      });
    }
    if (this.imageErrorListener) this.root.removeEventListener('error', this.imageErrorListener, true);
    this.imageErrorListener = (event) => {
      if (!(event.target instanceof HTMLImageElement)) return;
      const id = event.target.closest('[data-comic-frame]')?.dataset.comicFrame;
      const panel = this.project?.panels.find((row) => row.id === id);
      if (!panel) return;
      this.thumbnailErrors ||= new Set();
      this.thumbnailErrors.add(comicRefKey(panel.image)); this.refreshStatus();
    };
    this.root.addEventListener('error', this.imageErrorListener, true);
    this.root.onclick = (event) => {
      if (event.target.closest('[data-comic-protection-surface]')) return;
      const bubble = event.target.closest('[data-comic-drag],[data-comic-resize]');
      if (bubble) { this.selectBubble(bubble.dataset.comicDrag || bubble.dataset.comicResize); return; }
      if (event.target.closest('[data-comic-preview-page]')) this.selectBubble('');
      const tab = event.target.closest('[data-comic-tab]')?.dataset.comicTab;
      if (tab) {
        this.switchTab(tab); this.error = ''; this.render(); this.reveal('.comic-tabs', true);
        if (tab !== 'story') void this.refreshAssets();
        return;
      }
      const button = event.target.closest('[data-comic-action]');
      if (button) void this.action(button.dataset.comicAction, button).catch((error) => this.fail(error));
    };
    this.root.oninput = (event) => this.input(event);
    this.bindBubbleDragging();
    if (this.setup?.().assistant?.source === 'tavern' && this.inspectModel && Date.now() - (this.modelChecked || 0) > 30000) {
      this.modelChecked = Date.now();
      void this.inspectModel().then(() => {
        const summary = this.root?.querySelector('.comic-assistant-settings > summary');
        if (summary && this.project) {
          const setup = this.setup(), a = comicAssistantOptions(setup.assistant, this.project);
          summary.textContent = `分镜调用设置 · ${a.tavernModel || setup.currentModel || '酒馆当前模型'}`;
        }
      }).catch(() => {});
    }
    this.root.onchange = (event) => {
      const target = event.target;
      if (target.matches('[data-comic-reference-file]')) {
        const file = target.files?.[0], profileId = this.referenceTarget, projectId = this.project?.id;
        target.value = '';
        if (file && profileId) void this.run('正在保存项目参考图…', async (signal) => {
          const asset = await this.storeReference(file, signal);
          signal.throwIfAborted();
          if (this.project?.id !== projectId || !this.project.characterScene?.entries.some((row) => row.profileId === profileId)) throw new Error('项目角色已变化，请重新上传');
          this.commit((project) => { project.characterScene.entries.find((row) => row.profileId === profileId).profile.reference = asset; },
            false, { label: '绑定项目参考图' });
          this.message = '项目参考图已保存；选择参考角色后仅在其出场时使用';
        }).catch((error) => this.fail(error));
      } else if (target.matches('[data-comic-project-filter]')) {
        this.projectFilter = target.value; this.projectPage = 1; this.render();
      } else if (target.matches('[data-comic-series-filter]')) {
        this.seriesFilter = target.value; this.projectPage = 1; this.seriesPackInspection = null; this.render();
      } else if (target.matches('[data-comic-series-assignment]')) {
        this.seriesAssignment = target.value;
        this.chapterNumber = availableComicChapter(this.library, this.project.id, target.value, this.project.chapter);
        this.root.querySelector('[data-comic-chapter-number]').value = this.chapterNumber;
      } else if (target.matches('[data-comic-layout-template]')) {
        this.layoutTemplate = target.value;
      } else if (target.matches('[data-comic-profile-add]')) {
        this.addProfileId = target.value;
      } else if (target.matches('[data-comic-export-quality]')) {
        this.exportQuality = target.value; this.exportInspection = null;
        const node = this.root.querySelector('[data-comic-export-inspection]'); if (node) node.innerHTML = this.inspectionHTML();
      } else if (target.matches('[data-comic-export-warnings-ok]')) {
        this.acceptExportWarnings = target.checked;
      } else if (target.matches('[data-comic-rewrite-lock]')) {
        if (this.rewrite?.panelId !== this.panel.id) this.rewrite = { panelId: this.panel.id, instruction: '', keepCharacters: true, keepDialogue: true };
        this.rewrite[target.dataset.comicRewriteLock] = target.checked; this.rewrite.candidate = null;
        this.stashDraft(); this.render();
      } else if (target.matches('[data-comic-preview-panel]')) {
        this.panelId = target.value; if (this.protectionEditing) this.protectionEditing = target.value;
        this.render(); this.reveal('.comic-layout-switch', true);
      } else if (target.matches('[data-comic-reference-profile]')) {
        this.commit((project) => { project.referenceProfileId = target.value; }, false, { label: '选择人物参考图' }); this.refreshStatus();
      } else if (target.matches('[data-comic-import]')) {
        const file = target.files?.[0];
        if (file) void this.import(file).catch((error) => this.fail(error));
      } else if (target.matches('[data-comic-project-select]')) {
        void this.openChapter(target.value).catch((error) => this.fail(error));
      } else if (target.matches('[data-comic-panel-select]')) { this.panelId = target.value; this.render(); }
      else if (target.matches('[data-comic-snap]')) {
        this.snap = target.checked;
        for (const node of this.root.querySelectorAll('[data-comic-snap]')) node.checked = this.snap;
        this.stashDraft();
      } else if (target.matches('[data-comic-bubble-layer]')) {
        const editor = target.closest('[data-bubble-id]'), panel = this.project.panels.find((row) => row.id === editor.dataset.panelId);
        const index = panel.bubbles.findIndex((row) => row.id === target.value);
        this.commit((project) => {
          const next = project.panels.find((row) => row.id === panel.id);
          next.bubbles = comicBubbleLayer(next.bubbles, editor.dataset.bubbleId, index);
        }, true, { label: '调整气泡层级' });
        this.schedulePreview();
      }
      else if (target.matches('[data-comic-version]')) {
        this.commit((project) => {
          const panel = project.panels.find((row) => row.id === target.dataset.comicVersion);
          panel.image = panel.versions.find((ref) => comicRefKey(ref) === target.value) || null;
        }, false, { label: '切换配图版本' }); this.refreshStatus(); this.schedulePreview();
      } else if (target.matches('[data-comic-cast]')) {
        this.commit((project) => {
          const panel = project.panels.find((row) => row.id === this.panel.id);
          panel.characterIds = target.checked ? [...panel.characterIds, target.dataset.comicCast]
            : panel.characterIds.filter((key) => key !== target.dataset.comicCast);
        }, true, { label: '修改出场角色' });
      } else if (target.matches('[data-comic-profile-lock],[data-comic-outfit]')) {
        this.commit((project) => {
          const entry = project.characterScene?.entries.find((row) => row.profileId === (target.dataset.profileId || target.dataset.comicOutfit));
          if (entry && target.dataset.comicProfileLock) entry.profile[target.dataset.comicProfileLock] = target.checked;
          else if (entry) entry.outfitId = target.value;
        }, false, { label: '修改角色锁定或服装' }); this.refreshStatus();
      } else if (target.matches('select[data-comic-layout],select[data-comic-bubble],select[data-comic-assistant]')) this.input(event);
      else if (target.matches('[type="checkbox"][data-comic-bubble],[type="checkbox"][data-comic-protection]')) this.input(event);
    };
    if (this.tab !== 'story') {
      if (this.assetProject !== this.project?.id) void this.refreshAssets();
      else this.schedulePreview();
    }
    if (this.projectsOpen) void this.loadCovers();
    else this.clearCovers();
    this.root.dataset.bubbleEditing = String(this.tab === 'layout' && Boolean(this.selectedBubble) && !this.protectionEditing);
    paintIcons();
  }
  input(event) {
    const target = event.target, data = target.dataset;
    if (target.matches('select,[type="checkbox"],[type="file"]') && event.type !== 'change') return;
    try {
      if (target.matches('[data-comic-project-search]')) {
        this.projectSearch = target.value; this.projectPage = 1;
        clearTimeout(this.projectSearchTimer);
        this.projectSearchTimer = setTimeout(() => { this.render(); this.root?.querySelector('[data-comic-project-search]')?.focus({ preventScroll: true }); }, 350);
        return;
      }
      if (target.matches('[data-comic-series-name]')) { this.seriesName = target.value; return; }
      if (target.matches('[data-comic-chapter-number]')) { this.chapterNumber = target.value; return; }
      if (data.comicRange) { this.range[data.comicRange] = Number(target.value); return; }
      if (target.matches('[data-comic-failure]')) {
        this.failureResponse = target.value; this.repairPreview = null;
        this.root.querySelector('[data-comic-repair-preview]')?.remove(); this.stashDraft(); return;
      }
      if (target.matches('[data-comic-rewrite-input]')) {
        if (this.rewrite?.panelId !== this.panel?.id) this.rewrite = { panelId: this.panel.id, keepCharacters: true, keepDialogue: true };
        this.rewrite.instruction = target.value; this.rewrite.candidate = null;
        this.root.querySelector('[data-comic-rewrite-result]')?.remove();
        this.stashDraft(); this.refreshStatus(); return;
      }
      if (target.matches('[data-comic-export-selection]')) {
        this.exportSelection = target.value; this.exportInspection = null;
        const node = this.root.querySelector('[data-comic-export-inspection]'); if (node) node.innerHTML = this.inspectionHTML();
        return;
      }
      if (target.matches('[data-comic-chapter-start],[data-comic-chapter-end]')) {
        this[target.matches('[data-comic-chapter-start]') ? 'chapterStart' : 'chapterEnd'] = Number(target.value); return;
      }
      const panelId = target.closest('[data-bubble-id]')?.dataset.panelId || this.panel?.id;
      if (!['comicProject', 'comicPanel', 'comicLayout', 'comicBubble', 'comicCharacter', 'comicAssistant', 'comicProtection'].some((key) => Object.hasOwn(data, key))) return;
      if (data.comicProtection && data.comicProtection !== 'enabled' && target.value === '') return;
      this.commit((project) => {
        const panel = project.panels.find((row) => row.id === panelId);
        if (data.comicProject) project[data.comicProject] = data.comicProject === 'panelCount' ? Number(target.value) : target.value;
        if (data.comicAssistant) project.storyboard[data.comicAssistant] = data.comicAssistant === 'maxTokens' ? Number(target.value) : target.value;
        if (data.comicPanel && panel) panel[data.comicPanel] = target.value;
        if (data.comicProtection && panel) panel.protection[data.comicProtection] = data.comicProtection === 'enabled' ? target.checked : Number(target.value);
        if (data.comicLayout) project.layout[data.comicLayout] = ['gap', 'fontSize'].includes(data.comicLayout) ? Number(target.value) : target.value;
        if (data.comicBubble && panel) {
          const bubble = panel.bubbles.find((row) => row.id === target.closest('[data-bubble-id]').dataset.bubbleId);
          if (bubble) {
            bubble[data.comicBubble] = ['x', 'y', 'width', 'tailPosition', 'tailLength', 'fontSize'].includes(data.comicBubble) ? Number(target.value)
              : ['autoFit', 'speakerVisible'].includes(data.comicBubble) ? target.checked : target.value;
            if (data.comicBubble === 'width') bubble.autoFit = false;
          }
        }
        if (data.comicCharacter && panel) {
          let row = panel.characters.find((row) => row.profileId === data.profileId);
          if (!row) { row = { profileId: data.profileId }; panel.characters.push(row); }
          row[data.comicCharacter] = target.value;
        }
      }, false, { label: data.comicProtection ? '调整主体保护区' : data.comicBubble ? '修改对白' : data.comicLayout ? '调整排版' : data.comicPanel ? '修改画格'
        : data.comicCharacter ? '修改角色动作' : data.comicAssistant ? '修改分镜调用设置' : '修改剧情设置',
      group: JSON.stringify([panelId, target.closest('[data-bubble-id]')?.dataset.bubbleId, data]) });
      this.layoutSuggestion = null;
      this.root.querySelector('.comic-layout-suggestion')?.remove();
      if (data.comicProtection) this.syncProtectionControls(this.panel.protection);
      if (this.tab === 'layout') this.schedulePreview();
      if (data.comicBubble) this.syncBubbleControls(target.closest('[data-bubble-id]').dataset.bubbleId);
      this.refreshStatus();
    } catch (error) { this.fail(error); }
  }
  selectBubble(id) {
    if (this.selectedBubble !== id) this.bubbleToolsFor = '';
    this.selectedBubble = id;
    for (const node of this.root.querySelectorAll('[data-comic-drag]')) {
      const selected = node.dataset.comicDrag === id;
      node.dataset.selected = String(selected); node.setAttribute('aria-pressed', String(selected));
    }
    for (const node of this.root.querySelectorAll('[data-comic-resize]')) node.hidden = node.dataset.comicResize !== id;
    for (const node of this.root.querySelectorAll('.comic-bubble-editor')) node.dataset.selected = String(node.dataset.bubbleId === id);
    this.refreshBubbleInspector(); this.stashDraft();
  }
  nudgeBubble(id, move, step = 1) {
    const panel = this.project?.panels.find((row) => row.bubbles.some((bubble) => bubble.id === id));
    if (!panel) return;
    this.commit((project) => {
      const bubble = project.panels.find((row) => row.id === panel.id).bubbles.find((row) => row.id === id);
      Object.assign(bubble, comicBubblePosition(bubble, { dx: move === 'left' ? -step : move === 'right' ? step : 0,
        dy: move === 'up' ? -step : move === 'down' ? step : 0,
        ...(move === 'center-x' ? { x: 50 } : move === 'center-y' ? { y: 50 } : {}) }));
    }, false, { label: '微调气泡位置', group: `bubble-position:${id}` });
    this.syncBubbleControls(id); this.refreshStatus(); this.schedulePreview();
  }
  syncProtectionControls(region) {
    for (const node of this.root.querySelectorAll('[data-comic-protection]')) {
      const key = node.dataset.comicProtection;
      if (key === 'enabled') node.checked = region.enabled;
      else {
        node.value = Math.round(region[key] * 10) / 10;
        if (key === 'x' || key === 'y') node.max = 100 - region[key === 'x' ? 'width' : 'height'];
      }
    }
  }
  startProtectionGesture(event, surface) {
    if (this.busy || this.submitting || this.drag || event.button > 0) return;
    const panel = this.project?.panels.find((row) => row.id === surface.dataset.comicProtectionSurface);
    if (!panel || this.protectionEditing !== panel.id) return;
    event.preventDefault();
    clearTimeout(this.previewTimer); this.previewRevision++; this.previewController?.abort();
    const bounds = surface.getBoundingClientRect();
    const point = { x: (event.clientX - bounds.left) / bounds.width * 100, y: (event.clientY - bounds.top) / bounds.height * 100 };
    this.drag = { kind: 'protection', pointerId: event.pointerId, panelId: panel.id, projectId: this.project.id, handle: surface, bounds, start: point,
      mode: event.target.closest('[data-comic-protection-gesture]')?.dataset.comicProtectionGesture || 'draw',
      original: structuredClone(panel.protection), base: comicLayoutSignature(this.project) };
    surface.setPointerCapture(event.pointerId);
  }
  moveProtectionGesture(event) {
    const drag = this.drag;
    const point = { x: (event.clientX - drag.bounds.left) / drag.bounds.width * 100,
      y: (event.clientY - drag.bounds.top) / drag.bounds.height * 100 };
    const region = comicProtectionGesture(drag.original, drag.mode, drag.start, point);
    drag.next = region;
    let node = drag.handle.querySelector('.comic-protected-region');
    if (!node && region.enabled) {
      drag.handle.innerHTML = this.protectionRegionHTML(region); paintIcons(drag.handle);
      node = drag.handle.querySelector('.comic-protected-region');
    }
    if (node) Object.assign(node.style, { left: `${region.x}%`, top: `${region.y}%`, width: `${region.width}%`, height: `${region.height}%` });
    const resize = drag.handle.querySelector('.comic-protection-resize');
    if (resize) Object.assign(resize.style, { left: `clamp(22px,${region.x + region.width}%,calc(100% - 22px))`,
      top: `clamp(22px,${region.y + region.height}%,calc(100% - 22px))` });
    this.syncProtectionControls(region);
  }
  finishProtectionGesture(event) {
    const drag = this.drag;
    this.moveProtectionGesture(event); this.drag = null;
    if (this.project?.id !== drag.projectId || comicLayoutSignature(this.project) !== drag.base) {
      this.render(); this.schedulePreview(); throw new Error('排版在拖动期间发生变化，请重新调整保护区');
    }
    if (JSON.stringify(drag.next) !== JSON.stringify(drag.original)) {
      this.layoutSuggestion = null;
      this.commit((project) => { project.panels.find((row) => row.id === drag.panelId).protection = drag.next; },
        false, { label: drag.mode === 'draw' ? '框选主体保护区' : drag.mode === 'resize' ? '缩放主体保护区' : '移动主体保护区' });
    }
    this.render(); this.schedulePreview();
  }
  bindBubbleDragging() {
    this.root.onkeydown = (event) => {
      const handle = event.target.closest('[data-comic-drag]');
      const move = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[event.key];
      if (!handle || !move || event.altKey || event.ctrlKey || event.metaKey || this.busy || this.submitting || this.drag) return;
      event.preventDefault();
      this.nudgeBubble(handle.dataset.comicDrag, move, event.shiftKey ? 5 : 1);
    };
    if (this.bubbleFocusListener) this.root.removeEventListener('focusin', this.bubbleFocusListener);
    this.bubbleFocusListener = (event) => {
      const handle = event.target.closest('[data-comic-drag],[data-comic-resize]');
      if (handle) this.selectBubble(handle.dataset.comicDrag || handle.dataset.comicResize);
    };
    this.root.addEventListener('focusin', this.bubbleFocusListener);
    this.root.onpointerdown = (event) => {
      const surface = event.target.closest('[data-comic-protection-surface]');
      if (surface) { this.startProtectionGesture(event, surface); return; }
      const handle = event.target.closest('[data-comic-drag],[data-comic-resize]');
      if (!handle || this.busy || this.submitting || this.drag || event.button > 0) return;
      const pageNode = handle.closest('[data-comic-preview-page]'), page = this.pageLayouts?.[Number(pageNode.dataset.comicPreviewPage)];
      const id = handle.dataset.comicDrag || handle.dataset.comicResize;
      const geometry = page?.bubbles.find((row) => row.id === id);
      if (!geometry) return;
      event.preventDefault();
      this.selectBubble(id);
      clearTimeout(this.previewTimer); this.previewRevision++; this.previewController?.abort();
      this.drag = { id, pointerId: event.pointerId, panelId: geometry.panelId, geometry, scale: page.width / pageNode.getBoundingClientRect().width,
        startX: event.clientX, startY: event.clientY, handle, resize: Boolean(handle.dataset.comicResize) };
      handle.setPointerCapture(event.pointerId);
    };
    this.root.onpointermove = (event) => {
      if (!this.drag || this.drag.pointerId !== event.pointerId) return;
      if (this.drag.kind === 'protection') { this.moveProtectionGesture(event); return; }
      const { handle, startX, startY, resize } = this.drag;
      handle.style.transform = `${resize ? 'translate(-50%,-50%) ' : ''}translate(${event.clientX - startX}px,${resize ? 0 : event.clientY - startY}px)`;
    };
    this.root.onpointerup = (event) => {
      if (!this.drag || this.drag.pointerId !== event.pointerId) return;
      if (this.drag.kind === 'protection') {
        try { this.finishProtectionGesture(event); } catch (error) { this.fail(error); }
        return;
      }
      const drag = this.drag; this.drag = null;
      const dx = (event.clientX - drag.startX) * drag.scale, dy = (event.clientY - drag.startY) * drag.scale;
      drag.handle.style.transform = '';
      if (Math.abs(dx) + Math.abs(dy) < 2) { this.schedulePreview(); return; }
      this.panelId = drag.panelId;
      this.commit((project) => {
        const bubble = project.panels.find((row) => row.id === drag.panelId)?.bubbles.find((row) => row.id === drag.id);
        if (!bubble) return;
        const rect = drag.geometry.rect;
        if (drag.resize) {
          bubble.width = Math.max(22, Math.min(90, (drag.geometry.width + dx) / rect.width * 100)); bubble.autoFit = false;
        } else {
          const panel = project.panels.find((row) => row.id === drag.panelId);
          Object.assign(bubble, comicBubblePosition(bubble, {
            x: (drag.geometry.x + drag.geometry.width / 2 + dx - rect.x) / rect.width * 100,
            y: (drag.geometry.y + drag.geometry.height / 2 + dy - rect.y) / rect.imageHeight * 100,
            snap: this.snap, others: panel.bubbles.filter((row) => row.id !== bubble.id),
          }));
        }
      }, true, { label: drag.resize ? '调整气泡大小' : '移动对白气泡' }); this.schedulePreview();
    };
    this.root.onpointercancel = (event) => {
      if (!this.drag || this.drag.pointerId !== event.pointerId) return;
      const protection = this.drag?.kind === 'protection';
      if (this.drag) this.drag.handle.style.transform = '';
      this.drag = null; if (protection) this.render(); this.schedulePreview();
    };
  }
  fail(error) {
    this.error = error?.name === 'AbortError' ? '操作已取消' : error.message || '操作失败';
    if (error?.name !== 'AbortError' && typeof error.assistantResponse === 'string') {
      this.failureResponse = error.assistantResponse; this.failureOpen = true; this.repairPreview = null;
    }
    this.stashDraft(); this.render(); this.reveal('.comic-error:not([hidden])');
  }
  render() {
    if (!this.root?.isConnected) return;
    this.stashDraft();
    const parent = this.root.closest('.plugin-content'), scrollTop = parent?.scrollTop || 0;
    const tabScroll = this.root.querySelector('.comic-tabs')?.scrollLeft || 0;
    const folds = new Map([...this.root.querySelectorAll('[data-experience-fold]')].map((node) => [node.dataset.experienceFold, node.open]));
    this.root.innerHTML = this.content(); this.bind(this.root.parentElement);
    for (const node of this.root.querySelectorAll('[data-experience-fold]')) if (folds.has(node.dataset.experienceFold)) node.open = folds.get(node.dataset.experienceFold);
    const tabs = this.root.querySelector('.comic-tabs'); if (tabs) tabs.scrollLeft = tabScroll;
    if (parent) parent.scrollTop = scrollTop;
  }
  refreshStatus() {
    if (!this.root?.isConnected) return;
    this.refreshSaveStatus();
    for (const panel of this.project?.panels || []) {
      const status = this.root.querySelector(`[data-comic-status="${panel.id}"]`);
      if (status && status.innerHTML !== this.panelStatus(panel)) status.innerHTML = this.panelStatus(panel);
      const frame = this.root.querySelector(`[data-comic-frame="${panel.id}"]`);
      if (frame) {
        const active = comicPanelBusy(panel, this.jobs());
        const generate = frame.querySelector('[data-comic-action="panel-generate"]');
        if (generate) {
          generate.disabled = active || this.busy || this.submitting;
          const label = generate.querySelector('span');
          if (label) label.textContent = panel.image ? '再画一张' : '生成本格';
        }
        const cancel = frame.querySelector('[data-comic-action="panel-cancel"]');
        if (cancel) cancel.disabled = !comicPanelJobs(panel, this.jobs()).some((row) => ['queued', 'running'].includes(row.status));
        const picker = frame.querySelector('[data-comic-action="panel-image"]');
        if (picker) picker.disabled = active || this.busy || this.submitting;
        const slot = frame.querySelector('[data-comic-image-slot]');
        const key = comicRefKey(panel.image);
        const assetSignature = JSON.stringify([key, this.previews.get(key), this.assetStates.get(key), this.thumbnailErrors?.has(key)]);
        if (slot && slot.dataset.ref !== assetSignature) {
          slot.dataset.ref = assetSignature; slot.innerHTML = this.imageHTML(panel);
        }
        const select = frame.querySelector('[data-comic-version]');
        if (select && document.activeElement !== select && select.dataset.signature !== JSON.stringify(panel.versions)) {
          select.dataset.signature = JSON.stringify(panel.versions);
          select.innerHTML = `<option value="">尚未配图</option>${panel.versions.map((ref, index) => `<option value="${esc(comicRefKey(ref))}">第 ${index + 1} 张 · ${ref.location === 'server' ? '酒馆服务器' : '浏览器'}</option>`).join('')}`;
          select.value = key; select.disabled = !panel.versions.length;
        }
      }
    }
    const missing = this.root.querySelector('[data-comic-action="generate-missing"]');
    if (missing) missing.disabled = !comicMissingPanelIds(this.project, this.assetStates).length || this.hasTasks() || this.busy || this.submitting;
    const storyboard = this.root.querySelector('[data-comic-action="storyboard"]');
    if (storyboard) storyboard.disabled = !this.project?.source.trim() || this.hasTasks() || this.busy || this.submitting;
    const heading = this.root.querySelector('.page-heading p');
    if (heading && this.project) heading.textContent = this.progressLabel(this.project);
    for (const name of ['delete', 'cast-refresh']) {
      const button = this.root.querySelector(`[data-comic-action="${name}"]`);
      if (button) button.disabled = this.hasTasks() || this.busy || this.submitting;
    }
    const confirmation = this.root.querySelector('.comic-confirm');
    if (this.confirm && (!this.project || this.confirm.signature !== comicGenerationSignature(this.project, this.confirm.ids, this.identity?.()))) {
      this.confirm = null;
      this.message = '生图配置已变化，请重新选择画格并确认';
      const node = this.root.querySelector('.comic-message'); if (node) { node.hidden = false; node.textContent = this.message; }
    }
    if (confirmation && !this.confirm) confirmation.remove();
    const history = this.workspace.history(this.project?.id);
    for (const [name, disabled] of [['undo', !history?.past.length], ['redo', !history?.future.length], ['history', !history?.past.length]]) {
      const button = this.root.querySelector(`[data-comic-action="${name}"]`);
      if (button) button.disabled = disabled || this.busy || this.submitting || this.hasTasks();
    }
    const failed = this.root.querySelector('[data-comic-action="generate-failed"]');
    if (failed) failed.disabled = !this.failedPanelIds(this.project).length || this.hasTasks() || this.busy || this.submitting;
    const rewriteButton = this.root.querySelector('[data-comic-action="panel-rewrite"]');
    if (rewriteButton) rewriteButton.disabled = this.busy || this.submitting || comicPanelBusy(this.panel, this.jobs())
      || this.rewrite?.panelId !== this.panel.id || !this.rewrite?.instruction?.trim();
    if (this.rewrite?.candidate && this.project) {
      const stale = this.rewrite.base !== comicPanelEditSignature(this.project, this.rewrite.panelId, this.assistantIdentity?.());
      const warning = this.root.querySelector('[data-comic-rewrite-stale]'); if (warning) warning.hidden = !stale;
      const accept = this.root.querySelector('[data-comic-action="rewrite-accept"]');
      if (accept) accept.disabled = stale || this.busy || this.submitting || comicPanelBusy(this.panel, this.jobs());
    }
    const next = this.root.querySelector('[data-comic-next]');
    if (next && this.project) {
      const html = this.nextHTML(this.project);
      if (this.nextSignature !== html) { next.outerHTML = html; this.nextSignature = html; }
    }
    const progress = this.root.querySelector('[data-comic-progress]');
    if (progress && this.project) {
      const signature = JSON.stringify(comicProjectProgress(this.project, this.jobs(), this.assetStates));
      if (progress.dataset.signature !== signature) { progress.dataset.signature = signature; progress.innerHTML = this.progressHTML(this.project); }
    }
    if (this.repairPreview && this.project) {
      const stale = this.repairPreview.original !== this.failureResponse || this.repairPreview.base !== this.storySignature(this.project);
      const warning = this.root.querySelector('[data-comic-repair-stale]'); if (warning) warning.hidden = !stale;
      const apply = this.root.querySelector('[data-comic-action="repair-apply"]');
      if (apply) apply.disabled = stale || this.busy || this.submitting;
    }
    if (this.candidate && this.project) {
      const stale = this.candidateBase !== this.storySignature(this.project);
      const warning = this.root.querySelector('[data-comic-candidate-stale]');
      if (warning) warning.hidden = !stale;
      const accept = this.root.querySelector('[data-comic-action="candidate-accept"]');
      if (accept) accept.disabled = stale || this.hasTasks() || this.busy;
    }
    const selectedProject = this.root.querySelector('[data-comic-project-select] option:checked');
    if (selectedProject && this.project) selectedProject.textContent = this.project.title;
    const signature = JSON.stringify(this.project?.panels.map((panel) => panel.image));
    if (signature !== this.imageSignature) {
      this.imageSignature = signature;
      if (this.tab !== 'story') void this.refreshAssets();
    }
    paintIcons();
  }
  async action(action, button) {
    if (action === 'cancel') { this.controller?.abort(); return; }
    if (this.busy || this.submitting) return;
    if (action === 'save-retry') {
      this.stashDraft(); this.workspace.flush(); await this.retrySave?.(); this.refreshSaveStatus(); return;
    }
    if (action === 'chapter-retry') return this.openChapter(this.retryChapterId);
    if (action === 'covers-retry') return this.loadCovers(true);
    if (action === 'preview-retry') { this.previewError = ''; this.previewFailures.clear(); await this.refreshAssets(true); return; }
    if (action === 'bubble-deselect') { this.selectBubble(''); return; }
    if (action === 'bubble-tools-toggle') {
      const editor = button.closest('[data-bubble-id]'), controls = editor?.querySelector('.comic-bubble-adjustments');
      if (!controls) return;
      controls.hidden = !controls.hidden;
      this.bubbleToolsFor = controls.hidden ? '' : editor.dataset.bubbleId;
      button.setAttribute('aria-expanded', String(!controls.hidden));
      return;
    }
    if (action === 'bubble-position' || action === 'bubble-locate') {
      const editor = button.closest('[data-bubble-id]'), id = editor?.dataset.bubbleId;
      if (action === 'bubble-position') this.nudgeBubble(id, button.dataset.move);
      else {
        this.panelId = editor.dataset.panelId; this.selectedBubble = id; this.layoutView = 'preview'; this.render();
        this.reveal(`[data-comic-drag="${id}"]`);
      }
      return;
    }
    this.error = ''; this.message = '';
    const project = this.project;
    if (action === 'budget-preview') {
      const budget = await this.previewBudget(project);
      this.message = [`估算输入 ${budget.input} + 输出上限 ${budget.output} = ${budget.total} Token`,
        budget.error, ...budget.warnings].filter(Boolean).join('；');
      this.render(); return;
    }
    if (action === 'assistant-settings') { this.navigate('assistant'); return; }
    if (action === 'image-settings') { this.navigate('connection'); return; }
    if (action === 'characters') { this.navigate('characters'); return; }
    if (action === 'download-again' && this.exportFile) { this.save(this.exportFile.blob, this.exportFile.name); this.message = '已重新发起下载'; this.render(); return; }
    if (action === 'export-open' && this.exportFile) { window.open(this.exportFile.url, '_blank', 'noopener'); return; }
    if (action === 'export-share' && this.exportFile) {
      const file = new File([this.exportFile.blob], this.exportFile.name, { type: this.exportFile.blob.type });
      if (!navigator.canShare?.({ files: [file] })) throw new Error('当前浏览器不支持分享此文件，请下载或打开文件');
      await navigator.share({ files: [file] }); return;
    }
    if (action === 'projects' || action === 'projects-close') {
      this.projectsOpen = action === 'projects-close' ? false : !this.projectsOpen;
      this.render(); this.reveal(this.projectsOpen ? '.comic-project-manager' : '.comic-project-bar'); return;
    }
    if (['chapter-prev', 'chapter-next'].includes(action)) {
      this.projectPage = Math.max(1, (this.projectPage || 1) + (action === 'chapter-next' ? 1 : -1)); this.render(); return;
    }
    if (action === 'series-create' || action === 'series-create-join') {
      if (action === 'series-create-join' && this.hasTasks()) throw new Error('请先处理本章未完成的任务');
      const next = action === 'series-create-join' ? createComicSeriesForChapter(this.library, this.seriesName, project?.id)
        : validateComicLibrary(newComicSeries(this.library, this.seriesName));
      this.update(next);
      this.seriesFilter = next.series.at(-1).id; this.projectSearch = ''; this.projectPage = 1;
      this.projectFilter = project?.archived ? 'archived' : 'active';
      this.seriesAssignment = null; this.chapterNumber = null; this.seriesName = '';
      this.message = action === 'series-create-join' ? `系列已创建，本章已加入为第 ${this.project.chapter} 章` : '空系列已创建，可随时加入章节';
      this.render(); return;
    }
    if (action === 'series-export') {
      return this.run('正在读取系列章节…', async () => {
        const file = await comicSeriesFile(this.library, this.chapterStore, this.seriesFilter);
        this.save(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }), `${file.title.replace(/[<>:"/\\|?\x00-\x1f]/g, '_')}.comic-series.json`);
        this.message = `已导出 ${file.projects.length} 章可编辑配置；图片请通过完整备份迁移`;
      });
    }
    if (action === 'series-pack-dismiss') { this.seriesPackInspection = null; this.render(); return; }
    if (action === 'series-pack-fix') {
      await this.openChapter(button.dataset.projectId);
      this.panelId = button.dataset.panelId; this.projectsOpen = false; this.switchTab('generate');
      this.render(); await this.refreshAssets(); this.reveal(`[data-comic-frame="${this.panelId}"]`); return;
    }
    if (action === 'series-pack-check') {
      return this.run('正在检查系列章节与配图…', async (signal) => {
        const seriesId = this.seriesFilter, signature = this.seriesSignature(seriesId);
        const payload = await comicSeriesFile(this.library, this.chapterStore, seriesId);
        const report = await inspectComicSeriesPack(payload, this.listImages, signal);
        signal.throwIfAborted();
        if (signature !== this.seriesSignature(seriesId)) throw new Error('系列在检查期间发生变化，请重新检查');
        this.seriesPackInspection = { ...report, seriesId, signature, payload };
      }, '.comic-series-inspection');
    }
    if (action === 'series-pack-export') {
      const report = this.seriesPackInspection;
      if (!report || report.seriesId !== this.seriesFilter || report.signature !== this.seriesSignature(report.seriesId)) throw new Error('请先重新检查系列备份');
      if (report.issues.length) throw new Error('请先处理系列备份检查中的问题');
      return this.run('正在读取系列原图…', async (signal) => {
        const checked = await inspectComicSeriesPack(report.payload, this.listImages, signal);
        if (checked.issues.length) { this.seriesPackInspection = { ...report, ...checked }; throw new Error('原图状态已变化，请先处理缺图或存储连接问题'); }
        const blobs = new Map();
        let bytes = 0;
        for (const project of report.payload.projects) for (const [index, panel] of project.panels.entries()) {
          signal.throwIfAborted();
          const key = comicRefKey(panel.image);
          if (!key || blobs.has(key)) continue;
          let loaded;
          try { loaded = await this.materialize(checked.rows.get(key), signal); }
          catch (error) { signal.throwIfAborted(); throw new Error(`第 ${project.chapter} 章 · 第 ${index + 1} 格原图读取失败，请检查存储后重试`); }
          bytes += loaded.blob.size;
          if (bytes > COMIC_SERIES_IMAGE_BYTES) throw new Error('系列原图超过 64 MB，请分章节备份');
          blobs.set(key, loaded.blob);
          const node = this.root?.querySelector('.comic-busy > span');
          if (node) node.textContent = `正在读取系列原图 ${blobs.size} / ${report.images}`;
        }
        const packed = await comicSeriesPack(report.payload, blobs, signal, (message) => {
          const node = this.root?.querySelector('.comic-busy > span'); if (node) node.textContent = message;
        });
        signal.throwIfAborted();
        if (report.signature !== this.seriesSignature(report.seriesId)) throw new Error('系列在打包期间发生变化，请重新检查');
        const filename = report.payload.title.replace(/[<>:"/\\|?\x00-\x1f]/g, '_').slice(0, 70);
        this.downloadExport(packed.blob, `${filename}.comic-series.zip`, '');
        this.exportFile.seriesId = report.seriesId;
        this.message = `已打包 ${report.chapters} 章与 ${packed.imageFiles} 份去重原图，并发起下载`;
      }, '.comic-series-inspection');
    }
    if (action === 'series-rename' || action === 'series-remove') {
      const series = this.library.series?.find((row) => row.id === this.seriesFilter);
      if (!series) throw new Error('请先筛选系列');
      const next = structuredClone(this.library);
      if (action === 'series-remove') {
        if (!window.confirm(`删除“${series.title}”分组？章节会保留为独立项目。`)) return;
        next.series = next.series.filter((row) => row.id !== series.id);
        [...next.projects, ...next.shelved].forEach((row) => { if (row.seriesId === series.id) row.seriesId = ''; });
        this.seriesFilter = '';
      } else {
        if (!this.seriesName?.trim() || next.series.some((row) => row.id !== series.id && row.title === this.seriesName.trim())) throw new Error('请填写未使用的系列名称');
        next.series.find((row) => row.id === series.id).title = this.seriesName.trim();
      }
      this.update(validateComicLibrary(next)); this.seriesName = ''; this.message = '系列分组已更新'; this.render(); return;
    }
    if (action === 'project-open') {
      return this.openChapter(button.dataset.projectId);
    }
    if (action === 'new') {
      return this.run('正在准备漫画章节…', async () => {
        this.stashDraft();
        const existing = this.library.projects.find((row) => !row.archived && comicDraft(row));
        if (!existing) await this.makeChapterRoom();
        const value = existing || newComicProject(this.currentScene());
        this.update(saveComicProject(this.library, value)); this.panelId = ''; this.loadDraft(); this.confirm = null;
        this.tab = 'story'; this.clearPreviews();
      });
    }
    if (action === 'import') { this.root.querySelector('[data-comic-import]').click(); return; }
    if (!project) return;
    if (action === 'chapter-unload') {
      return this.run('正在保存章节正文…', async () => {
        this.stashDraft();
        const next = await shelveComicProject(this.library, project.id, this.chapterStore, (row) => this.hasTasks(row), () => this.library);
        this.update(next); await this.flushLibrary?.();
        this.loadDraft(); this.clearPreviews(); this.projectsOpen = true;
        this.seriesFilter = project.seriesId; this.projectFilter = project.archived ? 'archived' : 'active';
        this.projectSearch = ''; this.projectPage = 1;
        this.message = `本章正文已存入章节库${this.project ? `，已打开同系列第 ${this.project.chapter} 章` : '，可从目录选择章节继续'}`;
      });
    }
    if (action === 'series-assign') {
      this.update(setComicSeries(this.library, project.id, this.seriesAssignment ?? project.seriesId, this.chapterNumber ?? project.chapter));
      this.seriesAssignment = null; this.chapterNumber = null; this.message = '系列与章节编号已保存'; this.render(); return;
    }
    if (action === 'layout-template') {
      this.layoutSuggestion = null;
      this.commit((value) => { value.layout = comicLayoutTemplate(value.layout, this.layoutTemplate || 'scroll'); }, true, { label: '采用排版模板' });
      this.schedulePreview(); return;
    }
    if (action === 'protection-edit') {
      this.protectionEditing = this.protectionEditing ? '' : this.panel?.id || '';
      this.layoutSuggestion = null; this.selectedBubble = ''; this.layoutView = 'preview';
      this.render(); this.schedulePreview(); this.reveal('.comic-protection-toolbar', true); return;
    }
    if (action === 'layout-suggest') {
      this.layoutSuggestion = suggestComicLayout(project, document.createElement('canvas').getContext('2d'), { dimensions: this.rows, panelId: this.panel?.id });
      this.layoutView = 'preview'; this.render(); this.schedulePreview(); return;
    }
    if (action === 'layout-dismiss') {
      this.layoutSuggestion = null; this.render(); this.schedulePreview(); return;
    }
    if (action === 'layout-accept') {
      const suggestion = this.layoutSuggestion;
      if (!suggestion || suggestion.base !== comicLayoutSignature(project)) throw new Error('排版已变化，请重新预览位置建议');
      this.commit((value) => { value.panels.forEach((panel) => { panel.bubbles = structuredClone(suggestion.project.panels.find((row) => row.id === panel.id).bubbles); }); },
        false, { label: '采用气泡位置建议' });
      this.layoutSuggestion = null; this.message = '已采用位置建议，可撤销'; this.render(); this.schedulePreview(); return;
    }
    if (action === 'layout-view') {
      this.layoutView = button.dataset.view === 'preview' ? 'preview' : 'edit';
      this.stashDraft(); this.render(); this.reveal('.comic-layout-switch', true); return;
    }
    if (['project-copy', 'project-sequel', 'project-split', 'project-archive'].includes(action)) {
      if (this.hasTasks()) throw new Error('请先处理此项目的未完成任务');
      if (action === 'project-archive') {
        this.commit((value) => { value.archived = !value.archived; }, false, { label: project.archived ? '取消归档' : '归档项目' });
        this.projectFilter = this.project.archived ? 'archived' : 'active'; this.render(); return;
      }
      return this.run('正在创建章节…', async () => {
      await this.makeChapterRoom(project.id);
      const chapter = action !== 'project-copy' ? nextComicChapter(this.library, project) : undefined;
      if (chapter > 9999) throw new Error('章节编号已达上限');
      const copied = copyComicProject(project, { sequel: action === 'project-sequel', chapter,
        ...(action === 'project-split' ? { start: this.chapterStart || 1, end: this.chapterEnd || project.panels.length } : {}) });
      if (action === 'project-copy') { copied.seriesId = ''; copied.chapter = 1; }
      this.stashDraft();
      let library = this.library;
      if (action !== 'project-copy' && !project.seriesId) {
        const title = project.title.replace(/ · 第\d+章$/, '').slice(0, 100);
        const existingSeries = library.series?.find((row) => row.title === title);
        if (!existingSeries) library = newComicSeries(library, title);
        const seriesId = existingSeries?.id || library.series.at(-1).id;
        library = setComicSeries(library, project.id, seriesId, project.chapter);
        copied.seriesId = seriesId;
      }
      this.update(saveComicProject(library, copied)); this.loadDraft(); this.confirm = null;
      this.projectFilter = 'active'; this.chapterStart = this.chapterEnd = null; this.clearPreviews(); this.tab = 'story';
      this.message = action === 'project-sequel' ? '续章已创建，角色、画风和版式已沿用，请输入新的剧情'
        : '已复制为独立项目，原项目保留；配图继续复用，旧生成任务不关联';
      });
    }
    if (['cast-add', 'cast-remove', 'cast-reference', 'cast-reference-clear'].includes(action)) {
      if (this.hasTasks()) throw new Error('请先处理此项目的未完成任务');
      if (action === 'cast-add') {
        const value = addComicProfile(project, (this.getProfiles?.() || []).find((row) => row.id === this.addProfileId));
        this.commit((next) => { next.characterScene = value.characterScene; }, true, { label: '添加项目角色' });
        this.addProfileId = ''; return;
      }
      const profileId = button.dataset.profileId;
      if (action === 'cast-remove') {
        const value = removeComicProfile(project, profileId);
        this.commit((next) => Object.assign(next, value), true, { label: '移除项目角色前' }); return;
      }
      if (action === 'cast-reference-clear') {
        this.commit((next) => {
          const entry = next.characterScene?.entries.find((row) => row.profileId === profileId);
          if (entry) entry.profile.reference = null;
          if (next.referenceProfileId === profileId) next.referenceProfileId = '';
        }, true, { label: '移除项目参考图前' }); return;
      }
      this.referenceTarget = profileId; this.root.querySelector('[data-comic-reference-file]').click(); return;
    }
    if (action === 'panel-rewrite') {
      const panel = this.panel;
      if (comicPanelBusy(panel, this.jobs())) throw new Error('请先处理本格未完成的生图任务');
      const draft = structuredClone(this.rewrite);
      if (draft?.panelId !== panel.id || !draft.instruction?.trim()) throw new Error('请先填写本格修改要求');
      const identity = this.assistantIdentity?.(), signature = comicPanelEditSignature(project, panel.id, identity);
      this.errorContext = 'assistant';
      return this.run('正在修改此画格…', async (signal) => {
        let candidate;
        try { candidate = await this.rewritePanel(structuredClone(project), panel.id, draft.instruction, draft, signal); }
        catch (error) { if (error.name === 'AbortError') throw error; throw new Error(error.message); }
        signal.throwIfAborted();
        if (signature !== comicPanelEditSignature(this.project, panel.id, this.assistantIdentity?.())) throw new Error('画格或文字接口已变化，请重新修改本格');
        this.rewrite = { ...draft, identity, base: signature, candidate };
        this.stashDraft(); this.message = '本格修改已生成，请对照后采用；尚未生图';
      }, '[data-comic-rewrite-result]');
    }
    if (action === 'rewrite-discard') { this.rewrite = null; this.stashDraft(); this.render(); return; }
    if (action === 'rewrite-accept') {
      const draft = this.rewrite;
      if (!draft?.candidate || draft.base !== comicPanelEditSignature(project, draft.panelId, this.assistantIdentity?.())) throw new Error('本格修改已失效，请重新修改');
      const current = project.panels.find((row) => row.id === draft.panelId);
      if (!current || comicPanelBusy(current, this.jobs())) throw new Error('请先处理本格未完成的任务');
      const candidate = draft.candidate.panels.find((row) => row.id === draft.panelId);
      this.commit((next) => {
        const target = next.panels.find((row) => row.id === draft.panelId);
        for (const key of ['title', 'scene', 'shot', 'positive', 'negative', 'characterIds', 'characters', 'caption', 'bubbles']) target[key] = structuredClone(candidate[key]);
      }, false, { label: '采用单格 AI 修改前' });
      this.rewrite = null; this.stashDraft(); this.message = '已采用本格修改，原图与其他画格保留；需要时再单独重画';
      this.render(); return;
    }
    if (action === 'history') { this.historyOpen = !this.historyOpen; this.render(); return; }
    if (['undo', 'redo', 'history-restore'].includes(action)) {
      if (this.hasTasks()) throw new Error('请先处理此项目的未完成任务，再恢复编辑记录');
      const revision = this.workspace.travel(project, action, button?.dataset.revisionId);
      this.update(saveComicProject(this.library, revision.project));
      revision.commit(); this.confirm = null;
      if (!this.project.panels.some((panel) => panel.id === this.panelId)) this.panelId = this.project.panels[0]?.id || '';
      this.message = `${action === 'redo' ? '已重做' : action === 'undo' ? '已撤销' : '已恢复'}：${revision.label}`;
      this.clearPreviews(); this.render(); if (this.tab !== 'story') void this.refreshAssets(); return;
    }
    if (action === 'next') {
      if (this.candidate) { this.switchTab('story'); this.render(); this.reveal('.comic-candidate'); return; }
      if (!project.panels.length) {
        this.switchTab('story'); this.render();
        if (project.source.trim()) return this.action('storyboard');
        this.reveal('[data-comic-project="source"]'); this.root?.querySelector('[data-comic-project="source"]')?.focus(); return;
      }
      const progress = comicProjectProgress(project, this.jobs(), this.assetStates);
      this.switchTab(this.hasTasks() || progress.missing || progress.checking || progress.unreachable ? 'generate' : ['layout', 'read'].includes(this.tab) ? 'read' : 'layout');
      this.render(); this.reveal('.comic-tabs', true); void this.refreshAssets(); return;
    }
    if (action === 'task-prompts') { this.editRules?.(); return; }
    if (action === 'panel-edit') {
      if (!project.panels.some((panel) => panel.id === button.dataset.panelId)) return;
      this.panelId = button.dataset.panelId; this.switchTab('story'); this.render();
      this.reveal('[data-comic-panel="positive"]'); this.root?.querySelector('[data-comic-panel="positive"]')?.focus({ preventScroll: true }); return;
    }
    if (action === 'panel-image') {
      const panel = project.panels.find((row) => row.id === button.dataset.panelId);
      if (!panel || comicPanelBusy(panel, this.jobs())) throw new Error('请先处理此画格的未完成任务');
      this.imagePicker.open({
        title: `${project.panels.indexOf(panel) + 1}. ${panel.title || '画格'}`,
        location: panel.image?.location || this.setup?.().image?.location || 'browser',
        onSelect: (ref) => {
          if (!this.root?.isConnected || this.project?.id !== project.id) throw new Error('漫画项目已变化，请重新选择');
          const current = this.project.panels.find((row) => row.id === panel.id);
          if (!current || comicPanelBusy(current, this.jobs())) throw new Error('画格不存在或有待处理任务，请重新选择');
          this.commit((value) => { value.panels.find((row) => row.id === panel.id).image = ref; }, false, { label: '选用图库图片' });
          this.message = '已选用图库图片并收藏，原图保留在本格历史版本';
          this.render(); void this.refreshAssets(true);
        },
      }); return;
    }
    if (action === 'diagnostic') {
      this.diagnosticText = JSON.stringify(this.diagnostic?.() || { status: '尚无调用诊断' }, null, 2);
      try { await navigator.clipboard.writeText(this.diagnosticText); this.message = '脱敏诊断已复制'; }
      catch { this.message = '可在失败回复下方复制脱敏诊断'; }
      this.render(); this.reveal('.comic-recovery'); return;
    }
    if (action === 'failure-clear') { this.failureResponse = ''; this.diagnosticText = ''; this.repairPreview = null; this.stashDraft(); this.render(); return; }
    if (action === 'repair-preview') {
      const preview = previewComicRepair(this.failureResponse, project);
      this.repairPreview = { ...preview, original: this.failureResponse, base: this.storySignature(project) };
      this.failureOpen = true; this.error = ''; this.message = '';
      this.render(); this.reveal('[data-comic-repair-preview]'); return;
    }
    if (action === 'repair-dismiss') { this.repairPreview = null; this.render(); return; }
    if (action === 'repair-apply') {
      const preview = this.repairPreview;
      if (!preview || preview.original !== this.failureResponse || preview.base !== this.storySignature(project)) {
        throw new Error('剧情或失败回复已变化，请重新预览格式修复');
      }
      const candidate = parseComicStoryboard(preview.source, project);
      this.candidate = candidate; this.candidateBase = this.storySignature(project);
      this.error = ''; this.message = `已从修复预览解析出 ${candidate.panels.length} 格分镜，尚未采用；原始回复已保留`;
      this.stashDraft(); this.render(); this.reveal('.comic-candidate'); return;
    }
    if (action === 'reparse') {
      this.candidate = parseComicStoryboard(this.failureResponse, project);
      this.candidateBase = this.storySignature(project); this.error = ''; this.message = '已从回复中解析出分镜，尚未采用';
      this.stashDraft(); this.render(); this.reveal('.comic-candidate'); return;
    }
    if (action === 'project-export') {
      this.save(new Blob([JSON.stringify(comicProjectFile(project), null, 2)], { type: 'application/json' }), `${this.filename()}.comic.json`); return;
    }
    if (action === 'delete') {
      if (this.hasTasks()) throw new Error('请先在任务记录中处理此项目的未完成任务');
      if (!window.confirm(`删除漫画“${project.title}”？图片会保留在绘图管理。`)) return;
      this.update(validateComicLibrary({ ...this.library, projects: this.library.projects.filter((row) => row.id !== project.id), activeId: '' }));
      this.confirm = null;
      this.workspace.retain(this.chapters.map((row) => row.id)); this.loadDraft();
      this.clearPreviews(); this.render(); this.workspace.flush(); return;
    }
    if (action === 'chat-latest' || action === 'chat-range') return this.run('正在读取聊天…', async (signal) => {
      const result = await this.source(action === 'chat-range' ? this.range : undefined, signal);
      this.commit((value) => { value.source = result.source; value.sourceLabel = result.label; }, false, { label: '读取聊天前' });
      this.range = { start: result.start, end: result.end };
      this.message = result.cleaned ? '剧情已载入，已移除思考块、图片标签和 HTML 标签；请核对正文' : '剧情已载入，请核对正文';
    });
    if (action === 'cast-refresh') {
      if (this.hasTasks()) throw new Error('请先处理此项目的未完成任务');
      const scene = this.currentScene();
      this.commit((value) => { value.characterScene = scene; }, true, { label: '同步角色前' }); return;
    }
    if (action === 'storyboard') {
      this.errorContext = 'assistant';
      this.failureResponse = ''; this.failureOpen = false; this.diagnosticText = ''; this.repairPreview = null;
      return this.run('正在创建漫画分镜…', async (signal) => {
        this.candidate = await this.storyboard(structuredClone(project), signal);
        this.candidateBase = this.storySignature(project); this.stashDraft();
      }, '.comic-candidate');
    }
    if (action === 'candidate-dismiss') { this.candidate = null; this.stashDraft(); this.render(); return; }
    if (action === 'candidate-accept') {
      if (this.hasTasks()) throw new Error('请先处理此项目的未完成任务');
      if (!this.candidate || this.candidateBase !== this.storySignature(project)) throw new Error('剧情或角色已变化，请重新创建分镜');
      const title = project.title === '未命名漫画' ? this.candidate.title : project.title;
      this.commit((value) => { value.title = title; value.panels = this.candidate.panels; }, false, { label: '采用分镜前' });
      this.candidate = null; this.panelId = '';
      this.stashDraft(); this.message = '分镜已采用，可进入画格生成';
      this.confirm = null; this.clearPreviews(); this.render(); return;
    }
    if (action === 'panel-add') {
      if (project.panels.length >= COMIC_LIMITS.panels) throw new Error('每个项目最多 12 格');
      const panel = newComicPanel(); panel.title = `画格 ${project.panels.length + 1}`;
      this.panelId = panel.id; this.commit((value) => { value.panels.push(panel); }, true, { label: '添加画格' }); return;
    }
    if (['panel-up', 'panel-down', 'panel-delete'].includes(action)) {
      const panel = this.panel, index = project.panels.findIndex((row) => row.id === panel.id);
      if (action === 'panel-delete') {
        if (comicPanelBusy(panel, this.jobs())) throw new Error('此画格仍有未处理任务');
        if (!window.confirm('删除当前画格？已生成图片仍保留在绘图管理。')) return;
        this.commit((value) => { value.panels.splice(index, 1); }, true, { label: '删除画格前' });
      } else {
        const next = index + (action === 'panel-up' ? -1 : 1);
        if (next < 0 || next >= project.panels.length) return;
        this.commit((value) => { [value.panels[index], value.panels[next]] = [value.panels[next], value.panels[index]]; }, true, { label: '调整画格顺序' });
      }
      return;
    }
    if (action === 'bubble-add' || action === 'bubble-delete') {
      this.commit((value) => {
        const panel = value.panels.find((row) => row.id === this.panel.id);
        if (action === 'bubble-add') {
          if (panel.bubbles.length >= 4) throw new Error('每格最多 4 个对白');
          panel.bubbles.push(newComicBubble(panel.bubbles.length));
        } else panel.bubbles = panel.bubbles.filter((row) => row.id !== button.dataset.bubbleId);
      }, false, { label: action === 'bubble-add' ? '添加对白' : '删除对白前' });
      if (action === 'bubble-delete' && this.selectedBubble === button.dataset.bubbleId) this.selectedBubble = '';
      this.render(); this.schedulePreview(); return;
    }
    if (action === 'generate-dismiss') { this.confirm = null; this.render(); return; }
    if (['generate-missing', 'generate-failed', 'panel-generate'].includes(action)) {
      this.errorContext = 'image';
      const ids = action === 'generate-missing' ? comicMissingPanelIds(project, this.assetStates)
        : action === 'generate-failed' ? this.failedPanelIds(project) : [button.dataset.panelId];
      if (!ids.length) throw new Error('所有画格都已配图，可单独选择再画一张');
      if (ids.some((id) => comicPanelBusy(project.panels.find((panel) => panel.id === id), this.jobs()))) throw new Error('画格已有未完成任务，请先在任务记录中核对');
      const identity = this.identity?.(), signature = comicGenerationSignature(project, ids, identity);
      const prepared = await this.preflight?.(project, ids);
      if (this.project?.id !== project.id || signature !== comicGenerationSignature(this.project, ids, this.identity?.())) {
        throw new Error('生图配置或画格已变化，请重新选择并确认');
      }
      this.confirm = { projectId: project.id, ids, signature, preview: prepared?.preview, token: prepared?.token };
      this.render(); this.reveal('.comic-confirm'); return;
    }
    if (action === 'generate-confirm') {
      const confirmation = this.confirm; if (!confirmation || confirmation.projectId !== project.id) return;
      if (confirmation.signature !== comicGenerationSignature(project, confirmation.ids, this.identity?.())) {
        this.confirm = null; throw new Error('生图配置或提示词已变化，请重新选择画格并确认');
      }
      this.submitting = true; this.render();
      try {
        const result = await this.submit(structuredClone(project), confirmation.ids, confirmation.token);
        this.message = result.error || `已加入 ${result.ids.length} 个画格任务`;
        this.confirm = null;
      } finally { this.submitting = false; this.render(); }
      return;
    }
    if (action === 'panel-cancel') {
      const panel = project.panels.find((row) => row.id === button.dataset.panelId);
      for (const job of comicPanelJobs(panel, this.jobs())) if (['queued', 'running'].includes(job.status)) this.cancelTask(job.id);
      this.refreshStatus(); return;
    }
    if (action === 'queue') { this.showQueue(); return; }
    if (action === 'assets-refresh') { await this.refreshAssets(true); return; }
    if (action === 'preview') { await this.refreshAssets(true); return; }
    if (action === 'export-check') {
      await this.refreshAssets(true); this.refreshInspection(); this.reveal('[data-comic-export-inspection]'); return;
    }
    if (action === 'export-fix') {
      this.panelId = button.dataset.panelId;
      this.switchTab(['missing', 'unreachable'].includes(button.dataset.issueCode) ? 'generate' : 'layout');
      this.layoutView = 'edit'; this.render();
      this.reveal(this.tab === 'layout' ? '.comic-panel-select' : `[data-comic-frame="${this.panelId}"]`); return;
    }
    if (action.startsWith('export-')) return this.export(action);
  }
  async run(label, callback, resultSelector = '.comic-message:not([hidden])') {
    this.busy = true; this.busyLabel = label; this.controller = new AbortController(); this.render();
    this.reveal('.comic-busy');
    try { await callback(this.controller.signal); }
    finally { this.busy = false; this.controller = null; this.render(); this.reveal(resultSelector); }
  }
  async makeChapterRoom(excludeId = '') {
    if (this.chapters.length >= COMIC_LIMITS.chapters) throw new Error('章节目录已达 200 章，请先备份整理');
    if (this.library.projects.length < COMIC_LIMITS.projects) return;
    if (!this.chapterStore) throw new Error('已加载 8 个项目，请先导出并整理');
    const candidate = this.library.projects.filter((row) => row.id !== excludeId && row.id !== this.project?.id && !this.hasTasks(row))
      .sort((a, b) => a.updatedAt - b.updatedAt)[0];
    if (!candidate) throw new Error('其他已加载章节均有未完成任务，请先处理任务');
    const next = await shelveComicProject(this.library, candidate.id, this.chapterStore, (row) => this.hasTasks(row), () => this.library);
    this.update(next); await this.flushLibrary?.();
  }
  async openChapter(id) {
    if (this.busy || this.submitting) return;
    this.errorContext = 'chapter'; this.retryChapterId = id; this.error = '';
    return this.run('正在加载章节…', async () => {
      this.stashDraft();
      const next = this.library.projects.some((row) => row.id === id) ? { ...this.library, activeId: id }
        : await loadComicChapter(this.library, id, this.chapterStore, (row) => this.hasTasks(row), () => this.library);
      this.update(next); await this.flushLibrary?.(); this.loadDraft(); this.confirm = null;
      this.retryChapterId = ''; this.errorContext = '';
      this.panelId = ''; this.clearPreviews();
    });
  }
  filename() { return (this.project?.title || '漫画').replace(/[<>:"/\\|?\x00-\x1f]/g, '_').slice(0, 70); }
  async import(file) {
    if (this.busy || this.submitting) return;
    return this.run('正在导入漫画项目…', async (signal) => {
      let project;
      if (/\.zip$/i.test(file.name)) {
        const pack = await readComicArchive(file, signal);
        if (pack.series) {
          const next = await importComicSeriesFile(pack.series, this.library, this.chapterStore, () => this.library, {
            signal, importImages: () => this.importImages({ title: pack.series.title }, pack.blobs, signal),
          });
          this.update(next); await this.flushLibrary?.(); this.projectsOpen = true;
          this.seriesFilter = next.series.at(-1).id; this.projectSearch = ''; this.projectFilter = 'all'; this.projectPage = 1;
          this.seriesPackInspection = null;
          this.message = `已导入新系列，共 ${pack.series.projects.length} 章与 ${pack.imageFiles} 份原图；点击章节继续编辑`;
          return;
        }
        await this.makeChapterRoom();
        project = pack.project;
        saveComicProject(this.library, project);
        const refs = await this.importImages(project, pack.blobs, signal);
        for (const panel of project.panels) {
          panel.image = refs.get(comicRefKey(panel.image)) || null;
          panel.versions = panel.image ? [panel.image] : [];
        }
      } else {
        if (file.size > COMIC_CHAPTER_BUNDLE_BYTES) throw new Error('漫画配置文件超过 12 MB');
        const value = JSON.parse(await file.text());
        if (value.format === 'linghuashi-comic-series') {
          const next = await importComicSeriesFile(value, this.library, this.chapterStore, () => this.library, { signal });
          this.update(next); await this.flushLibrary?.(); this.projectsOpen = true;
          this.seriesFilter = next.series.at(-1).id; this.projectSearch = ''; this.projectFilter = 'all'; this.projectPage = 1;
          this.seriesPackInspection = null; this.message = '系列已导入章节库，点击章节打开；JSON 不包含图片'; return;
        }
        if (file.size > COMIC_LIMITS.bytes) throw new Error('单章项目文件超过 750 KB');
        project = importComicProject(value);
        await this.makeChapterRoom();
      }
      this.stashDraft(); this.update(saveComicProject(this.library, project)); this.loadDraft(); this.panelId = '';
      this.message = /\.zip$/i.test(file.name) ? '项目与配图已导入，未提交任何生图任务' : '项目已导入；JSON 不含图片，跨设备需恢复图片备份';
      this.clearPreviews(); this.tab = 'story';
    });
  }
  async refreshAssets(force = false) {
    const project = this.project;
    if (!project) return;
    const signature = JSON.stringify(project.panels.map((panel) => panel.image));
    if (this.assetPromise && this.assetTarget === project.id && this.assetTargetSignature === signature) return this.assetPromise;
    if (!force && this.assetProject === project.id && this.assetSignature === signature && Date.now() - this.assetCheckedAt < 30000) {
      this.schedulePreview(); return;
    }
    this.assetController?.abort();
    this.assetController = new AbortController();
    const signal = this.assetController.signal;
    this.assetTarget = project.id; this.assetTargetSignature = signature; this.imageSignature = signature;
    const revision = ++this.assetRevision;
    for (const panel of project.panels) if (panel.image) this.assetStates.set(comicRefKey(panel.image), { status: 'loading', detail: '正在检测原图…' });
    this.refreshStatus();
    const work = (async () => {
      try {
        const { rows, states } = await inspectComicAssets(project, this.listImages, this.checkImage, signal);
        if (revision !== this.assetRevision || this.project?.id !== project.id) return;
        for (const [key, state] of states) if (state.status === 'unreachable' && !rows.has(key) && this.rows.has(key)) rows.set(key, this.rows.get(key));
        this.rows = rows; this.assetStates = states; this.assetProject = project.id;
        this.assetSignature = signature; this.assetCheckedAt = Date.now();
        if (force) this.thumbnailErrors?.clear();
        if (force) { this.previewFailures.clear(); this.previewSourceRevision = (this.previewSourceRevision || 0) + 1; }
        const wanted = new Set(project.panels.map((panel) => comicRefKey(panel.image)).filter(Boolean));
        for (const key of this.previewBlobs.keys()) if (!wanted.has(key)) this.previewBlobs.delete(key);
        for (const [key, url] of this.previews) if (!wanted.has(key)) { if (url.startsWith('blob:')) URL.revokeObjectURL(url); this.previews.delete(key); }
        for (const key of wanted) {
          if (this.previews.has(key)) continue;
          const row = rows.get(key);
          if (row?.thumbnailURL) this.previews.set(key, row.thumbnailURL);
          else if (row?.thumbnail instanceof Blob) this.previews.set(key, URL.createObjectURL(row.thumbnail));
        }
        this.refreshStatus(); this.refreshPreviewStatus(); this.schedulePreview();
      } catch (error) {
        if (error.name !== 'AbortError' && revision === this.assetRevision) {
          this.previewError = '图库暂时无法读取，已有图片引用保留，请恢复连接后重试';
          this.refreshPreviewStatus();
        }
      }
      finally {
        if (revision === this.assetRevision) this.assetPromise = null;
      }
    })();
    this.assetPromise = work;
    return work;
  }
  clearPreviews() {
    this.assetRevision++; this.previewRevision++; this.assetProject = null;
    this.assetController?.abort(); this.assetPromise = null; this.assetStates.clear(); this.thumbnailErrors?.clear();
    this.previewController?.abort();
    for (const url of this.previews.values()) if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    this.previews.clear(); this.previewBlobs.clear(); this.previewFailures.clear(); this.previewError = '';
    this.rows.clear(); this.clearPages();
  }
  clearPages() { for (const url of this.pageURLs) URL.revokeObjectURL(url); this.pageURLs = []; this.pageLayouts = []; this.renderedPages.clear(); }
  coverTargets() {
    const ids = new Set([...this.root?.querySelectorAll('[data-comic-cover]') || []].map((node) => node.dataset.comicCover));
    return this.chapters.filter((row) => ids.has(row.id)).slice(0, 12);
  }
  clearCovers() {
    this.coverRevision = (this.coverRevision || 0) + 1;
    for (const url of this.coverURLs.values()) if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    this.coverURLs.clear(); this.coverRefs.clear(); this.coverSignature = '';
  }
  async loadCovers(force = false) {
    const chapters = this.coverTargets(), signature = JSON.stringify(chapters.map((row) => [row.id, row.cover]));
    if (this.coverLoading) { this.coverReload = true; return; }
    if (!force && signature === this.coverSignature) return;
    this.coverLoading = true;
    const sources = new Map(), revision = this.coverRevision || 0;
    let failed = false;
    try {
      const wanted = new Set(chapters.map((row) => row.id));
      for (const [id, url] of this.coverURLs) if (!wanted.has(id)) {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
        this.coverURLs.delete(id); this.coverRefs.delete(id);
      }
      for (const project of chapters) {
        const ref = project.cover;
        if (!ref) continue;
        if (!sources.has(ref.location)) {
          try { sources.set(ref.location, await this.listImages(ref.location)); } catch { sources.set(ref.location, []); failed = true; }
        }
      }
      if (revision !== (this.coverRevision || 0) || signature !== JSON.stringify(this.coverTargets().map((row) => [row.id, row.cover]))) return;
      for (const project of chapters) {
        const ref = project.cover;
        const row = sources.get(ref?.location)?.find((row) => row.id === ref.id);
        if (this.coverRefs.get(project.id) !== comicRefKey(ref)) {
          const old = this.coverURLs.get(project.id);
          if (old?.startsWith('blob:')) URL.revokeObjectURL(old);
          this.coverURLs.delete(project.id);
        }
        const url = this.coverURLs.get(project.id) || row?.thumbnailURL || (row?.thumbnail instanceof Blob ? URL.createObjectURL(row.thumbnail) : '');
        if (!url) continue;
        this.coverURLs.set(project.id, url); this.coverRefs.set(project.id, comicRefKey(ref));
        const node = this.root?.querySelector(`[data-comic-cover="${project.id}"]`);
        if (node) node.innerHTML = `<img src="${esc(url)}" alt="" loading="lazy">`;
      }
      this.coverWarning = failed ? '部分章节封面暂时无法读取，章节内容保留' : '';
      const status = this.root?.querySelector('[data-comic-covers-status]');
      if (status) { status.hidden = !failed; status.querySelector('span').textContent = this.coverWarning; }
      this.coverSignature = failed ? '' : signature;
    } finally {
      this.coverLoading = false;
      if (this.coverReload) { this.coverReload = false; if (this.projectsOpen && this.root?.isConnected) void this.loadCovers(); }
    }
  }
  schedulePreview() {
    if (!['layout', 'read'].includes(this.tab) || !this.root?.isConnected || this.busy || this.drag || document.visibilityState === 'hidden') return;
    clearTimeout(this.previewTimer);
    this.previewController?.abort();
    this.previewTimer = setTimeout(() => { void this.preview().catch((error) => {
      if (error.name !== 'AbortError') { this.previewError = error.message || '排版预览未完成，请重试'; this.refreshPreviewStatus(); }
    }); }, 250);
  }
  async preview() {
    if (!this.project?.panels.length || this.busy) return;
    this.previewController?.abort(); this.previewController = new AbortController();
    const signal = this.previewController.signal;
    const revision = ++this.previewRevision, project = structuredClone(this.layoutSuggestion?.base === comicLayoutSignature(this.project)
      ? this.layoutSuggestion.project : this.project), blobs = new Map();
    let previewBytes = 0;
    for (const panel of project.panels) {
      const key = comicRefKey(panel.image), row = this.rows.get(key);
      if (blobs.has(key)) continue;
      if (this.previewBlobs.has(key)) {
        const cached = this.previewBlobs.get(key);
        if (previewBytes + cached.size <= 16 * 1024 * 1024) { blobs.set(key, cached); previewBytes += cached.size; continue; }
      }
      if (panel.image) {
        try {
          const blob = await readComicThumbnail(row, { signal });
          if (previewBytes + blob.size > 16 * 1024 * 1024) throw new Error('预览缓存已达上限');
          previewBytes += blob.size;
          blobs.set(key, blob); cacheComicPreview(this.previewBlobs, key, blob); this.previewFailures.delete(key);
        } catch { signal.throwIfAborted(); this.previewFailures.add(key); }
      }
      if (revision !== this.previewRevision) return;
    }
    const dimensions = new Map(this.rows);
    const geometry = comicPageGeometry(project, 720, dimensions);
    const signature = (page) => JSON.stringify([project.title, project.layout, page.width, page.height, this.previewSourceRevision,
      page.rects.map((rect) => {
        const panel = project.panels[rect.index];
        return [panel.id, panel.image, blobs.has(comicRefKey(panel.image)), panel.caption, panel.bubbles];
      })]);
    const dirty = geometry.filter((page) => this.renderedPages.get(page.number)?.signature !== signature(page)).map((page) => page.number);
    const pages = dirty.length ? await renderComicPages(project, blobs, { width: 720, signal, dimensions, pageNumbers: dirty }) : [];
    signal.throwIfAborted();
    if (revision !== this.previewRevision || this.project?.id !== project.id) return;
    for (const [number, cached] of this.renderedPages) if (!geometry.some((page) => page.number === number)) {
      URL.revokeObjectURL(cached.url); this.renderedPages.delete(number);
    }
    const actual = comicPageGeometry(project, 720, dimensions);
    for (const page of pages) {
      const old = this.renderedPages.get(page.number); if (old) URL.revokeObjectURL(old.url);
      this.renderedPages.set(page.number, { signature: signature(actual.find((row) => row.number === page.number)), page, url: URL.createObjectURL(page.blob) });
    }
    this.pageLayouts = actual.map((page) => this.renderedPages.get(page.number)?.page).filter(Boolean);
    this.pageURLs = actual.map((page) => this.renderedPages.get(page.number)?.url).filter(Boolean);
    const root = this.root?.querySelector('[data-comic-preview]');
    if (root) {
      const html = this.previewPagesHTML();
      if (root.dataset.signature !== html) {
        const focused = root.contains(document.activeElement) ? document.activeElement?.dataset?.comicDrag : '';
        root.innerHTML = html; root.dataset.signature = html; paintIcons(root);
        if (focused) root.querySelector(`[data-comic-drag="${focused}"]`)?.focus({ preventScroll: true });
      }
    }
    this.previewError = ''; this.refreshPreviewStatus();
  }
  async export(action) {
    const project = structuredClone(this.project);
    if (!project.panels.length) throw new Error('请先创建分镜');
    const revision = comicExportSignature(project);
    await this.refreshAssets(true);
    if (revision !== comicExportSignature(this.project)) throw new Error('项目内容已变化，请重新检查导出');
    const pack = action === 'export-project-pack', width = comicExportWidth(this.exportQuality);
    let report;
    if (!pack) {
      this.refreshInspection(); report = this.exportInspection;
      if (report.error) throw new Error(report.error);
      const failure = report.issues.find((issue) => issue.severity === 'error');
      if (failure) throw new Error(failure.message);
      if (action === 'export-long' && report.longError) throw new Error(report.longError);
      if (report.issues.some((issue) => issue.severity === 'warning') && !this.acceptExportWarnings) {
        this.message = '请先核对导出检查中的排版警告，调整后重试，或勾选仍然导出';
        this.render(); this.reveal('[data-comic-export-inspection]'); return;
      }
    }
    const panels = pack ? project.panels : project.panels.filter((panel) => report.panelIds.includes(panel.id));
    const filename = this.filename() + (!pack && (this.exportSelection.trim() || width !== 960) ? `-p${report.numbers.join('-')}-${width}w` : '');
    await this.run('正在准备漫画导出…', async (signal) => {
      const blobs = new Map(), locations = [...new Set(panels.map((panel) => panel.image?.location).filter(Boolean))];
      let bytes = 0;
      const rows = new Map();
      for (const location of locations) {
        let available;
        try { available = await this.listImages(location); }
        catch { throw new Error(`${location === 'server' ? '酒馆图库' : '浏览器存储'}暂时无法读取，请恢复连接后重试导出`); }
        for (const row of available) rows.set(`${location}:${row.id}`, row);
      }
      for (const panel of panels) {
        const index = project.panels.indexOf(panel);
        signal.throwIfAborted();
        const key = comicRefKey(panel.image);
        if (blobs.has(key)) continue;
        const row = rows.get(key);
        if (!row) throw new Error(`第 ${index + 1} 格图片缺失，请恢复备份或为该格选择其他图片`);
        let loaded;
        try { loaded = await this.materialize(row); }
        catch { throw new Error(`第 ${index + 1} 格原图无法读取，请检测图片或恢复存储连接后重试`); }
        bytes += loaded.blob.size;
        if (bytes > 64 * 1024 * 1024) throw new Error('漫画原图合计超过 64 MB，请分为多个项目');
        blobs.set(key, loaded.blob);
      }
      if (pack) {
        const blob = await comicProjectPack(project, blobs, signal);
        signal.throwIfAborted();
        if (revision !== comicExportSignature(this.project)) throw new Error('项目内容已变化，请重新导出');
        this.downloadExport(blob, `${filename}.comic.zip`, project.id); return;
      }
      const pages = await renderComicPages(project, blobs, { signal, width, pageNumbers: report.numbers, dimensions: rows, progress: (message) => {
        const node = this.root?.querySelector('.comic-busy > span'); if (node) node.textContent = message;
      } });
      signal.throwIfAborted();
      const blob = action === 'export-long' ? await comicLongImage(pages, signal)
        : action === 'export-pages' ? await comicPageArchive(pages, signal) : await comicOfflineHTML({ ...project, panels }, pages, signal,
          { panelNumbers: panels.map((panel) => project.panels.findIndex((row) => row.id === panel.id) + 1) });
      signal.throwIfAborted();
      if (revision !== comicExportSignature(this.project)) throw new Error('项目内容已变化，请重新检查导出');
      this.downloadExport(blob, `${filename}${action === 'export-long' ? '.png' : action === 'export-pages' ? '.zip' : '.html'}`, project.id);
    });
  }
  downloadExport(blob, name, projectId) {
    if (this.exportFile) URL.revokeObjectURL(this.exportFile.url);
    this.exportFile = { blob, name, projectId, url: URL.createObjectURL(blob) };
    this.save(blob, name);
    this.message = '文件已生成并发起下载；未收到时可重新下载、打开或分享文件';
  }
  leave() {
    this.stashDraft();
    this.restoreView = this.savedView;
    this.workspace.flush(); clearTimeout(this.viewTimer);
    this.scrollHost?.removeEventListener('scroll', this.scrollListener);
    this.scrollHost = null;
    this.imagePicker.close();
    this.controller?.abort(); this.previewRevision++; clearTimeout(this.previewTimer);
    this.previewController?.abort();
    if (this.exportFile) URL.revokeObjectURL(this.exportFile.url);
    this.exportFile = null; this.clearPreviews(); this.clearCovers(); this.root = null;
  }
}
