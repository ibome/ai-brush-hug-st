import { randomUUID } from '../crypto-compat.js';
import { escapeHtml as esc } from '../config.js';
import { icon, paintIcons } from '../icons.js';
import { PROFILE_AI_FIELDS, manualProfileSource, buildProfileMessages, parseProfileResult, profileProposal, applyProfileDrafts } from '../profile-ai.js';
import { attachPromptTagButtons } from './tags.js';

const field = (label, input) => `<label class="ui-field"><span>${label}</span>${input}</label>`;
const button = (action, glyph, label, primary = false, disabled = false) =>
  `<button type="button" class="ui-button ${primary ? 'primary' : 'secondary'}" data-profile-ai-action="${action}" ${disabled ? 'disabled' : ''}>${icon(glyph)}<span>${label}</span></button>`;
const tool = (action, glyph, label, extra = '') =>
  `<button type="button" class="ui-icon-button" data-profile-ai-action="${action}" ${extra} title="${label}" aria-label="${label}">${icon(glyph)}</button>`;

export class ProfileAIPanel {
  constructor(options) { Object.assign(this, options); this.epoch = 0; }

  async open() {
    if (this.dialog) return;
    this.ui = { source: 'cards', cards: [], selected: new Set(), search: '', name: '', description: '',
      rows: [], index: 0, busy: false, loading: false, error: '' };
    this.baseline = structuredClone(this.library().profiles);
    this.returnFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'profile-ai-dialog'; dialog.setAttribute('aria-labelledby', 'profile-ai-title');
    this.dialog = dialog; document.body.append(dialog);
    dialog.addEventListener('click', (event) => { void this.click(event); });
    dialog.addEventListener('input', (event) => this.input(event));
    dialog.addEventListener('change', (event) => this.change(event));
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); this.close(); });
    this.render(); dialog.showModal(); await this.refresh();
  }

  async refresh() {
    const epoch = ++this.epoch;
    this.ui.loading = true; this.ui.error = ''; this.render();
    try {
      const data = await this.directory();
      if (!this.dialog || epoch !== this.epoch) return;
      this.ui.cards = data.characters;
      this.ui.selected = new Set(data.characters.filter((card) => card.current).slice(0, 6).map((card) => card.avatar));
    } catch (error) { if (this.dialog && epoch === this.epoch) this.ui.error = error.message; }
    finally { if (this.dialog && epoch === this.epoch) { this.ui.loading = false; this.render(); } }
  }

  close(saved = false) {
    if (!this.dialog) return;
    if (!saved && this.ui.rows.length && !window.confirm('关闭并放弃未保存的 AI 草稿？')) return;
    this.controller?.abort(); this.epoch++;
    this.dialog.close(); this.dialog.remove(); this.dialog = null;
    this.returnFocus?.isConnected && this.returnFocus.focus();
  }

  invalidate() {
    if (!this.dialog) return;
    this.controller?.abort(); this.epoch++;
    this.ui.busy = false; this.ui.loading = false; this.ui.rows = [];
    this.ui.error = '聊天已切换，请重新读取角色并生成草稿';
    this.render();
  }

  render() {
    if (!this.dialog) return;
    const ui = this.ui, options = this.settings();
    this.dialog.innerHTML = `<header><div><h2 id="profile-ai-title">${icon('wand-sparkles')}AI 创建档案</h2>
      <small>全局档案 · ${options.source === 'api' ? '独立 API' : '跟随酒馆'} · ${esc(options.source === 'api' ? options.model || '未选择模型' : options.tavernModel || '酒馆当前模型')} · ${options.maxTokens} Token</small></div>
      ${tool('close', 'x', '关闭角色草稿窗口')}</header>
      <div class="profile-ai-body">
        ${ui.rows.length ? this.preview() : this.sources()}
      </div>
      <div class="profile-ai-status" role="status" aria-live="polite">${ui.busy ? `${icon('loader-circle')}<span>${ui.saving ? '正在保存档案…' : '正在提取角色外观…'}</span>` : ''}
        <span class="assistant-error" role="alert">${esc(ui.error)}</span></div>
      <footer><span>${ui.rows.length ? `已勾选 ${ui.rows.filter((row) => row.included).length} / ${ui.rows.length} 个草稿` : `已选择 ${ui.source === 'manual' ? 1 : ui.selected.size} 个来源`}</span>
        <div class="assistant-actions">${ui.busy ? button('cancel', 'square', '取消') : ui.rows.length
          ? button('back', 'arrow-left', '返回来源') + button('save', 'save', '保存勾选的档案', true)
          : button('generate', 'wand-sparkles', '生成草稿', true, ui.loading || ui.source === 'cards' && !ui.selected.size)}</div></footer>`;
    paintIcons(this.dialog);
    if (ui.rows.length && !ui.busy) this.bindPromptTools();
  }

  sources() {
    const ui = this.ui;
    return `<div class="character-scope" role="group" aria-label="角色资料来源">${[['cards', '酒馆角色卡'], ['manual', '粘贴设定']].map(([value, label]) =>
      `<button type="button" data-profile-ai-source="${value}" aria-pressed="${ui.source === value}" ${ui.busy ? 'disabled' : ''}>${label}</button>`).join('')}</div>
      <fieldset ${ui.busy ? 'disabled' : ''} class="profile-ai-source-fields">
      ${ui.source === 'manual'
        ? field('角色名称', `<input data-profile-ai-manual="name" maxlength="120" value="${esc(ui.name)}" />`) +
          field('角色设定', `<textarea data-profile-ai-manual="description" maxlength="16000" rows="10">${esc(ui.description)}</textarea>`)
        : `<div class="profile-ai-card-toolbar"><label class="search-input">${icon('search')}<input type="search" data-profile-ai-search aria-label="搜索角色卡" placeholder="角色名称或标识" value="${esc(ui.search)}" /></label>
          ${button('refresh', 'refresh-cw', '重新读取', false, ui.loading)}${button('current', 'users-round', '选择当前角色', false, ui.loading)}</div>
          <div class="profile-ai-cards">${this.cardList()}</div>`}
      </fieldset>`;
  }

  cardList() {
    const ui = this.ui;
    return ui.cards.filter((card) => `${card.name} ${card.avatar}`.toLocaleLowerCase().includes(ui.search.toLocaleLowerCase())).map((card) =>
      `<label class="profile-ai-card"><input type="checkbox" data-profile-ai-card="${esc(card.avatar)}" ${ui.selected.has(card.avatar) ? 'checked' : ''} /><span><strong>${esc(card.name)}${card.current ? '<small>当前</small>' : ''}</strong><code>${esc(card.avatar)}</code></span></label>`).join('')
      || `<p class="assistant-context">${ui.loading ? '正在读取角色卡…' : '暂无匹配角色卡'}</p>`;
  }

  preview() {
    const ui = this.ui, row = ui.rows[ui.index], draft = row.draft;
    const targets = this.baseline.filter((profile) => !row.source.avatar || profile.avatar === row.source.avatar);
    const missing = ['hair', 'eyes', 'body', 'features'].filter((key) => !draft[key]).map((key) => PROFILE_AI_FIELDS[key][0]);
    return `<div class="profile-ai-preview">
      <aside class="profile-ai-candidates" aria-label="角色草稿列表">${ui.rows.map((item, index) => `<div>
        <input type="checkbox" data-profile-ai-include="${index}" aria-label="保存${esc(item.source.name)}草稿" ${item.included ? 'checked' : ''} ${ui.busy ? 'disabled' : ''} />
        <button type="button" data-profile-ai-index="${index}" aria-pressed="${index === ui.index}" ${ui.busy ? 'disabled' : ''}><strong>${esc(item.source.name)}</strong><small>${esc(item.source.avatar || '粘贴设定')}</small><small>${item.draft.outfits.length} 套服装</small></button></div>`).join('')}</aside>
      <section class="profile-ai-draft" aria-label="AI 角色草稿">
      <fieldset ${ui.busy ? 'disabled' : ''}>
        <div class="character-form-grid">
          ${field('保存方式', `<select data-profile-ai-mode>${[['new', '创建新档案'], ['fill', '仅补全空白'], ['update', '对比更新']].map(([value, label]) =>
            `<option value="${value}" ${row.mode === value ? 'selected' : ''}>${label}</option>`).join('')}</select>`)}
          ${row.mode !== 'new' ? field('目标全局档案', `<select data-profile-ai-target><option value="">请选择档案</option>${targets.map((profile) =>
            `<option value="${esc(profile.id)}" ${profile.id === row.targetId ? 'selected' : ''}>${esc(profile.name)} · ${esc(profile.id.slice(0, 8))}</option>`).join('')}</select>`)
            : `<div class="profile-ai-link"><span>关联角色卡</span><code>${esc(row.source.avatar || '不关联')}</code></div>`}
        </div>
        <details class="profile-ai-evidence"><summary>来源设定 · ${esc(row.source.name)}</summary><pre>${esc([row.source.description, row.source.personality, row.source.scenario].filter(Boolean).join('\n\n'))}</pre></details>
        ${missing.length ? `<p class="profile-ai-review">待核对：${esc(missing.join('、'))}</p>` : ''}
        ${row.notes.length ? `<ul class="profile-ai-notes">${row.notes.map((note) => `<li>${esc(note)}</li>`).join('')}</ul>` : ''}
        ${field('档案名称', `<input data-profile-ai-field="name" maxlength="120" value="${esc(draft.name)}" />`)}
        <div class="character-form-grid">${['hair', 'eyes', 'body', 'features'].map((key) => field(PROFILE_AI_FIELDS[key][0],
          `<input data-profile-ai-field="${key}" maxlength="${PROFILE_AI_FIELDS[key][1]}" value="${esc(draft[key])}" />`)).join('')}</div>
        ${['tags', 'negative'].map((key) => field(PROFILE_AI_FIELDS[key][0],
          `<textarea data-profile-ai-field="${key}" rows="2" maxlength="${PROFILE_AI_FIELDS[key][1]}">${esc(draft[key])}</textarea>`)).join('')}
        <div class="settings-band-heading"><h3>${icon('shirt')}服装方案</h3>${button('outfit-add', 'plus', '添加服装', false, draft.outfits.length >= 20)}</div>
        ${field('默认服装', `<select data-profile-ai-default><option value="">无服装</option>${draft.outfits.map((outfit) =>
          `<option value="${outfit.id}" ${draft.defaultOutfitId === outfit.id ? 'selected' : ''}>${esc(outfit.name)}</option>`).join('')}</select>`)}
        ${draft.outfits.map((outfit) => `<div class="character-outfit">
          ${field('服装名称', `<input data-profile-ai-outfit="${outfit.id}" data-outfit-key="name" maxlength="80" value="${esc(outfit.name)}" />`)}
          ${field('服装提示词', `<textarea data-profile-ai-outfit="${outfit.id}" data-outfit-key="prompt" rows="2" maxlength="4000">${esc(outfit.prompt)}</textarea>`)}
          ${tool('outfit-delete', 'trash-2', '删除草稿服装', `data-outfit-id="${outfit.id}"`)}</div>`).join('')}
        <div class="profile-ai-diff">${this.differences(row)}</div>
      </fieldset></section></div>`;
  }

  differences(row) {
    try {
      const proposal = profileProposal(row, this.baseline);
      return `<h3>${row.mode === 'new' ? '待保存内容' : '变更对比'}</h3>${proposal.changes.map((change) =>
        `<div class="profile-ai-change"><label>${row.mode === 'new' ? '' : `<input type="checkbox" data-profile-ai-change="${change.key}" ${row.selected.includes(change.key) ? 'checked' : ''} />`}<strong>${change.label}</strong></label>
          <div>${row.mode === 'new' ? '' : `<pre class="profile-ai-before">${esc(change.before || '空白')}</pre>`}<pre>${esc(change.after)}</pre></div></div>`).join('') || '<p class="assistant-context">没有需要写入的变更</p>'}`;
    } catch (error) { return `<p class="assistant-error">${esc(error.message)}</p>`; }
  }

  updateDiff() {
    const root = this.dialog?.querySelector('.profile-ai-diff');
    if (root) root.innerHTML = this.differences(this.ui.rows[this.ui.index]);
  }

  input(event) {
    const input = event.target, ui = this.ui;
    if (ui.busy || input.type === 'checkbox' || input.tagName === 'SELECT') return;
    if (input.matches('[data-profile-ai-search]')) {
      ui.search = input.value; this.dialog.querySelector('.profile-ai-cards').innerHTML = this.cardList(); return;
    }
    if (input.dataset.profileAiManual) { ui[input.dataset.profileAiManual] = input.value; return; }
    const row = ui.rows[ui.index]; if (!row) return;
    if (Object.hasOwn(PROFILE_AI_FIELDS, input.dataset.profileAiField || '')) row.draft[input.dataset.profileAiField] = input.value;
    if (input.dataset.profileAiOutfit) {
      const outfit = row.draft.outfits.find((item) => item.id === input.dataset.profileAiOutfit);
      if (outfit && ['name', 'prompt'].includes(input.dataset.outfitKey)) outfit[input.dataset.outfitKey] = input.value;
    }
    this.updateDiff();
  }

  change(event) {
    const input = event.target, ui = this.ui;
    if (ui.busy) return;
    if (input.dataset.profileAiCard) {
      if (input.checked && ui.selected.size >= 6) { input.checked = false; ui.error = '一次最多选择 6 张角色卡'; }
      else { input.checked ? ui.selected.add(input.dataset.profileAiCard) : ui.selected.delete(input.dataset.profileAiCard); ui.error = ''; }
      this.render(); return;
    }
    if (input.dataset.profileAiInclude !== undefined) {
      ui.rows[Number(input.dataset.profileAiInclude)].included = input.checked; this.render(); return;
    }
    const row = ui.rows[ui.index]; if (!row) return;
    if (input.matches('[data-profile-ai-mode]')) { row.mode = input.value; this.render(); }
    if (input.matches('[data-profile-ai-target]')) { row.targetId = input.value; this.render(); }
    if (input.matches('[data-profile-ai-default]')) { row.draft.defaultOutfitId = input.value; this.updateDiff(); }
    if (input.dataset.profileAiChange) row.selected = input.checked
      ? [...new Set([...row.selected, input.dataset.profileAiChange])]
      : row.selected.filter((key) => key !== input.dataset.profileAiChange);
  }

  async click(event) {
    const input = event.target.closest('button'); if (!input || input.disabled) return;
    const ui = this.ui, action = input.dataset.profileAiAction;
    if (action === 'close') { this.close(); return; }
    if (action === 'cancel') { this.controller?.abort(); return; }
    if (ui.busy) return;
    if (input.dataset.profileAiSource) { ui.source = input.dataset.profileAiSource; ui.error = ''; this.render(); return; }
    if (input.dataset.profileAiIndex !== undefined) { ui.index = Number(input.dataset.profileAiIndex); this.render(); return; }
    if (action === 'refresh') { await this.refresh(); return; }
    if (action === 'current') {
      ui.selected = new Set(ui.cards.filter((card) => card.current).slice(0, 6).map((card) => card.avatar)); this.render(); return;
    }
    if (action === 'back') {
      if (window.confirm('返回来源并放弃当前 AI 草稿？')) { ui.rows = []; ui.error = ''; this.render(); }
      return;
    }
    if (action === 'outfit-add') {
      const draft = ui.rows[ui.index].draft;
      if (draft.outfits.length < 20) draft.outfits.push({ id: randomUUID(), name: '新服装', prompt: '' });
      this.render(); return;
    }
    if (action === 'outfit-delete') {
      const draft = ui.rows[ui.index].draft;
      draft.outfits = draft.outfits.filter((outfit) => outfit.id !== input.dataset.outfitId);
      if (!draft.outfits.some((outfit) => outfit.id === draft.defaultOutfitId)) draft.defaultOutfitId = '';
      this.render(); return;
    }
    if (action === 'generate' || action === 'save') await this.run(action);
  }

  async run(action) {
    const ui = this.ui, epoch = ++this.epoch, controller = new AbortController();
    this.controller = controller; ui.busy = true; ui.saving = action === 'save'; ui.error = ''; this.render();
    const valid = () => { controller.signal.throwIfAborted(); if (!this.dialog || epoch !== this.epoch) throw new Error('角色草稿窗口已变化'); };
    try {
      if (action === 'generate') {
        const sources = ui.source === 'manual' ? [manualProfileSource(ui.name, ui.description)]
          : (await this.readSources([...ui.selected], controller.signal)).sources;
        valid();
        const contextKey = this.chatKey(), baseline = structuredClone(this.library().profiles);
        const messages = buildProfileMessages(sources, this.settings());
        const raw = await this.generate(messages, controller.signal);
        valid();
        if (this.chatKey() !== contextKey) throw new Error('聊天已切换，请重新生成草稿');
        await this.validateSources(sources, controller.signal); valid();
        const rows = parseProfileResult(raw, sources);
        for (const row of rows) {
          const matches = row.source.avatar ? baseline.filter((profile) => profile.avatar === row.source.avatar) : [];
          if (matches.length === 1) { row.mode = 'fill'; row.targetId = matches[0].id; }
        }
        this.sourcesSnapshot = sources; this.contextKey = contextKey;
        this.baseline = baseline; ui.rows = rows; ui.index = 0;
      } else {
        if (this.chatKey() !== this.contextKey) throw new Error('聊天已切换，请重新生成草稿');
        await this.validateSources(this.sourcesSnapshot, controller.signal); valid();
        const result = applyProfileDrafts(this.library(), ui.rows, this.baseline);
        await this.save(result); valid();
        this.close(true); return;
      }
    } catch (error) {
      if (this.dialog && epoch === this.epoch) ui.error = controller.signal.aborted ? '操作已取消' : error instanceof TypeError ? '文字接口连接失败，请检查地址和跨域设置' : error.message;
    } finally {
      if (this.dialog && epoch === this.epoch) { ui.busy = false; ui.saving = false; this.controller = null; this.render(); }
    }
  }

  async validateSources(sources, signal) {
    if (!sources.some((source) => source.avatar)) return;
    const live = await this.readSources(sources.map((source) => source.avatar), signal);
    if (live.sources.length !== sources.length || live.sources.some((source, index) => source.avatar !== sources[index].avatar || source.revision !== sources[index].revision)) {
      throw new Error('角色卡设定已变化，请重新读取并生成草稿');
    }
  }

  bindPromptTools() {
    // Use the same visual/tag editor against this candidate, never against saved profiles.
    const row = this.ui.rows[this.ui.index];
    this.dialog.querySelectorAll('[data-profile-ai-field="tags"], [data-profile-ai-field="negative"]').forEach((input) => {
      input.dataset.profileField = input.dataset.profileAiField;
    });
    this.dialog.querySelectorAll('[data-profile-ai-outfit][data-outfit-key="prompt"]').forEach((input) => {
      input.dataset.profileOutfit = input.dataset.profileAiOutfit;
    });
    attachPromptTagButtons(this.dialog, (target, input, visual) => {
      const outfit = input.dataset.profileAiOutfit ? row.draft.outfits.find((item) => item.id === input.dataset.profileAiOutfit) : null;
      this.promptTools({ target, visual, label: `${row.draft.name} · AI 草稿`, previewTitle: '角色草稿提示词', getPreview: null,
        getContext: () => ({ provider: 'novelai', params: { model: 'nai-diffusion-4-5-full', positive: outfit ? outfit.prompt : row.draft.tags,
          negative: outfit ? '' : row.draft.negative, artist: '' }, allowedTargets: outfit ? ['positive'] : ['positive', 'negative'],
          limits: { positive: 4000, negative: 2000 } }),
        insert: (params, fields) => {
          if (!this.dialog || !this.ui.rows.includes(row) || outfit && !row.draft.outfits.includes(outfit)) throw new Error('角色草稿已改变，请重新打开编辑');
          for (const key of Array.isArray(fields) ? fields : [fields]) {
            if (outfit) outfit.prompt = params.positive;
            else row.draft[key === 'positive' ? 'tags' : key] = params[key];
          }
        },
        closed: () => this.render(),
      });
    });
  }
}
