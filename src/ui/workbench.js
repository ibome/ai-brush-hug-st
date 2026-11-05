import { escapeHtml as esc } from '../config.js';
import { icon, paintIcons } from '../icons.js';
import { normalizeWorkbench, buildBatchPreview } from '../prompt-workbench.js';
import { cardReference } from '../material-cards.js';

const field = (label, body) => `<label class="ui-field"><span>${label}</span>${body}</label>`;
const button = (glyph, label, command, attrs = '') => `<button type="button" class="ui-button secondary" data-batch-command="${command}" ${attrs}>${icon(glyph)}<span>${label}</span></button>`;

export class WorkbenchPanel {
  constructor({ getDraft, setDraft, getSnapshot, cards, artists, identity, submit, jobs, queue, saveCandidate, render }) {
    Object.assign(this, { getDraft, setDraft, getSnapshot, cards, artists, identity, submit, jobs, queue, saveCandidate, rerender: render });
    this.ui = { busy: false, error: '', preview: null, submitted: false, ids: [], identity: '', row: 0 };
  }
  html() {
    const draft = normalizeWorkbench(this.getDraft()), ui = this.ui, snapshot = this.getSnapshot();
    const params = snapshot.params || snapshot.config.params, openaiSeed = snapshot.provider === 'openai' && !/nai-diffusion/i.test(params.model);
    const preview = ui.preview, selected = preview?.rows[ui.row] || preview?.rows[0];
    const selectedParams = selected?.snapshot.params || selected?.snapshot.config?.params;
    return `<div class="page-heading"><div><h1>组合生图</h1><p>${esc(snapshot.provider === 'comfyui' ? snapshot.config.name : params.model)}</p></div></div>
      <section class="batch-workbench" data-batch-root>
      <div class="batch-modes" role="group" aria-label="组合方式">${[['batch', '组合批量'], ['explore', '画风探索']].map(([id, label]) =>
        `<button type="button" data-batch-mode="${id}" aria-pressed="${draft.mode === id}" ${ui.busy ? 'disabled' : ''}>${label}</button>`).join('')}</div>
      <fieldset ${ui.busy ? 'disabled' : ''}>
      ${draft.mode === 'batch' ? `<div class="batch-axes">${[['characters', '主体候选'], ['actions', '动作／场景候选'], ['styles', '风格候选']].map(([key, label]) =>
        `<div>${field(`${label} · 每行一项`, `<textarea rows="6" data-batch-field="${key}" maxlength="12000" placeholder="${key === 'characters' ? 'girl, long hair\nboy, short hair' : key === 'actions' ? 'reading a book\nwalking in a garden' : 'watercolor\nsoft cel shading'}">${esc(draft[key])}</textarea>`)}
        ${field('素材卡', `<select data-batch-card="${key}"><option value="">添加素材卡</option>${this.cards().map((card) => `<option value="${esc(card.id)}">${esc(card.category)} · ${esc(card.name)}</option>`).join('')}</select>`)}</div>`).join('')}</div>`
        : `<div class="batch-artist-pool">${this.artists().map((row) => `<label><input type="checkbox" data-batch-artist="${esc(row.id)}" ${draft.artistIds.includes(row.id) ? 'checked' : ''} />
          <span><strong>${esc(row.name)}</strong><small>${esc(row.artist.slice(0, 150))}</small></span></label>`).join('') || '<p>画师串库暂无条目</p>'}</div>
          <div class="batch-options">${field('每组画师数', `<input type="number" data-batch-field="combinationSize" min="1" max="3" value="${draft.combinationSize}" />`)}
          ${field('候选上限', `<input type="number" data-batch-field="candidates" min="1" max="32" value="${draft.candidates}" />`)}</div>`}
      <div class="batch-options">${field('每组重复', `<input type="number" data-batch-field="repeats" min="1" max="8" value="${draft.repeats}" />`)}
      ${field('种子方式', `<select data-batch-field="seedMode">${[['same', '同种子对比'], ['increment', '逐张递增'], ['random', '逐张随机'], ['service', '服务默认']].map(([value, label]) =>
        `<option value="${value}" ${draft.seedMode === value ? 'selected' : ''} ${openaiSeed && value !== 'service' ? 'disabled' : ''}>${label}</option>`).join('')}</select>`)}
      ${field('起始种子', `<input type="number" data-batch-field="seed" min="0" max="4294967295" value="${draft.seed}" ${['service', 'random'].includes(draft.seedMode) ? 'disabled' : ''} />`)}</div>
      <div class="batch-actions">${button('list-checks', '预览组合', 'preview')}</div></fieldset>
      ${ui.error ? `<p class="batch-error" role="alert">${esc(ui.error)}</p>` : ''}
      ${preview ? `<section class="batch-preview" aria-label="组合预览"><div class="field-heading"><h2>${preview.count} 个任务 · ${preview.expectedImages === null ? '张数由工作流输出决定' : `预计 ${preview.expectedImages} 张`}</h2>
        ${button('play', ui.submitted ? '已提交' : '提交全部组合', 'submit', ui.busy || ui.submitted ? 'disabled' : '')}</div>
        <div class="batch-preview-layout"><ol>${preview.rows.map((row, index) => `<li><button type="button" data-batch-row="${index}" aria-pressed="${index === ui.row}">
          <strong>${index + 1}. ${esc(row.label)}</strong><small>${row.seed === null ? '服务默认种子' : `种子 ${row.seed}`}</small></button></li>`).join('')}</ol>
        <div class="batch-preview-detail">${['positive', 'negative', 'artist'].filter((key) => selectedParams?.[key]).map((key) =>
          field(({ positive: '正向提示词', negative: '负面提示词', artist: '画师／风格' })[key], `<textarea readonly rows="4">${esc(selectedParams[key])}</textarea>`)).join('')}
          ${selected?.artistIds.length ? `${field('保存画师组合名称', '<input data-batch-candidate-name maxlength="40" />')}${button('save', '保存到画师串库', 'save-candidate')}` : ''}
        </div></div></section>` : ''}
      <section class="batch-runs">${this.runsHTML()}</section></section>`;
  }
  runsHTML() {
    const jobs = this.jobs().filter((job) => job.plan.snapshot?.experiment);
    const groups = [...new Map([...jobs].reverse().map((job) => [job.plan.snapshot.experiment.id, job.plan.snapshot.experiment])).values()].slice(0, 8);
    return groups.length ? `<h2>最近组合任务</h2>${groups.map((group) => {
        const rows = jobs.filter((job) => job.plan.snapshot.experiment.id === group.id);
        const queued = rows.filter((row) => row.status === 'queued').length, paused = rows.filter((row) => row.status === 'paused' && row.stage === 'waiting').length;
        return `<div><span><strong>${group.mode === 'explore' ? '画风探索' : '组合批量'} · ${new Date(group.createdAt).toLocaleString()}</strong>
          <small>${rows.filter((row) => row.status === 'completed').length} 完成 · ${queued} 等待 · ${paused} 暂停 · ${rows.filter((row) => row.status === 'running').length} 运行</small></span>
          ${button('pause', '暂停等待任务', 'pause', `data-batch-id="${group.id}" ${queued ? '' : 'disabled'}`)}
          ${button('play', '继续等待任务', 'resume', `data-batch-id="${group.id}" ${paused ? '' : 'disabled'}`)}</div>`;
      }).join('')}` : '';
  }
  refreshStatus(container) {
    const root = container.querySelector('.batch-runs'), html = this.runsHTML();
    if (root && this.runsMarkup !== html) {
      root.innerHTML = html; this.runsMarkup = html; paintIcons(root);
    }
  }
  update(key, value) {
    const draft = normalizeWorkbench({ ...this.getDraft(), [key]: value });
    this.setDraft(draft); this.ui.preview = null; this.ui.error = ''; this.ui.submitted = false;
  }
  preview() {
    this.ui.preview = buildBatchPreview(this.getSnapshot(), this.getDraft(), { cards: this.cards(), artists: this.artists() });
    this.ui.identity = this.identity(); this.ui.row = 0; this.ui.submitted = false; this.ui.error = '';
  }
  bind(container) {
    const root = container.querySelector('[data-batch-root]');
    if (!root) return;
    this.runsMarkup = this.runsHTML();
    root.addEventListener('input', (event) => {
      const target = event.target;
      if (!target.dataset.batchField) return;
      event.stopPropagation();
      this.update(target.dataset.batchField, target.type === 'number' ? Number(target.value) : target.value);
      root.querySelector('.batch-preview')?.remove();
    });
    root.addEventListener('change', (event) => {
      const target = event.target;
      try {
        if (target.dataset.batchField) {
          this.update(target.dataset.batchField, target.type === 'number' ? Number(target.value) : target.value);
          event.stopPropagation();
          if (target.tagName === 'SELECT') this.rerender();
          return;
        } else if (target.dataset.batchArtist) {
          const ids = this.getDraft().artistIds || [];
          const next = target.checked ? [...new Set([...ids, target.dataset.batchArtist])] : ids.filter((id) => id !== target.dataset.batchArtist);
          if (next.length > 12) throw new Error('画师池最多选 12 项');
          this.update('artistIds', next);
        } else if (target.dataset.batchCard && target.value) {
          const card = this.cards().find((card) => card.id === target.value), key = target.dataset.batchCard;
          this.update(key, [this.getDraft()[key], cardReference(card)].filter(Boolean).join('\n'));
        } else return;
      } catch (error) { this.ui.error = error.message; }
      event.stopPropagation(); this.rerender();
    });
    root.addEventListener('click', async (event) => {
      const target = event.target.closest('button');
      if (!target || target.disabled) return;
      event.stopPropagation();
      if (this.ui.busy) return;
      try {
        if (target.dataset.batchMode) { this.update('mode', target.dataset.batchMode); }
        else if (target.dataset.batchRow !== undefined) this.ui.row = Number(target.dataset.batchRow);
        else switch (target.dataset.batchCommand) {
          case 'preview': this.preview(); break;
          case 'submit':
            if (!this.ui.preview || this.ui.submitted) return;
            if (this.ui.identity !== this.identity()) throw new Error('生图配置或接口已变化，请重新预览组合');
            this.ui.busy = true; this.rerender();
            try {
              const result = await this.submit(this.ui.preview);
              this.ui.ids = result.ids; this.ui.submitted = result.ids.length > 0;
              this.ui.error = result.error || '';
            } finally { this.ui.busy = false; }
            break;
          case 'save-candidate': {
            const name = root.querySelector('[data-batch-candidate-name]')?.value?.trim();
            if (!name) throw new Error('请填写画师组合名称');
            const row = this.ui.preview.rows[this.ui.row];
            this.saveCandidate(name, row, this.ui.preview);
            this.ui.error = '画师组合已保存'; break;
          }
          case 'pause': this.queue.pauseBatch(target.dataset.batchId); break;
          case 'resume': this.queue.resumeBatch(target.dataset.batchId); break;
          default: return;
        }
      } catch (error) { this.ui.error = error.message; }
      this.rerender(); paintIcons();
    });
  }
}
