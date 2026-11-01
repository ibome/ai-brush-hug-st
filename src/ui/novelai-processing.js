import { escapeHtml as esc } from '../config.js';
import { icon, paintIcons } from '../icons.js';
import { normalizeNovelAI, NOVELAI_MODELS, NOVELAI_SAMPLERS } from './novelai.js';
import { PROCESSING_KINDS, DIRECTOR_TOOLS, PROCESSING_EMOTIONS, ENHANCE_PRESETS,
  processingDraft, processingTitle, validateProcessingDraft } from '../novelai-processing.js';
import { attachPromptTagButtons } from './tags.js';

const options = (rows, value) => rows.map(([id, title]) => `<option value="${id}" ${value === id ? 'selected' : ''}>${esc(title)}</option>`).join('');
const field = (title, body) => `<label class="ui-field"><span>${title}</span>${body}</label>`;
const button = (action, glyph, label, disabled = false) => `<button type="button" class="ui-button" data-processing-action="${action}" ${disabled ? 'disabled' : ''}>${icon(glyph)}<span>${label}</span></button>`;

export class NovelAIProcessingPanel {
  constructor(options) { Object.assign(this, options); }
  open(item) {
    if (!item || this.dialog) return;
    this.item = { ...item }; this.location = this.storageLocation();
    this.ui = processingDraft(item, this.currentParams()); this.error = ''; this.busy = false;
    this.returnFocus = document.activeElement;
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'novelai-processing-dialog';
    this.dialog.setAttribute('aria-labelledby', 'novelai-processing-title');
    this.dialog.addEventListener('cancel', (event) => { event.preventDefault(); if (!this.busy) this.close(); });
    this.dialog.addEventListener('click', (event) => { void this.click(event); });
    this.dialog.addEventListener('input', (event) => this.input(event));
    this.dialog.addEventListener('change', (event) => {
      this.input(event);
      if (event.target.matches('select, input[type="checkbox"]')) this.render();
    });
    document.body.append(this.dialog); this.render(); this.dialog.showModal();
  }
  close() {
    if (!this.dialog || this.busy) return;
    this.closeTags?.(); this.dialog.close(); this.dialog.remove(); this.dialog = null;
    if (this.returnFocus?.isConnected) this.returnFocus.focus();
  }
  input(event) {
    const target = event.target, key = target.dataset.processingField, param = target.dataset.nai;
    if (!key && !param) return;
    const value = target.type === 'checkbox' ? target.checked : ['number', 'range'].includes(target.type) ? Number(target.value) : target.value;
    if (key) this.ui[key] = value;
    else this.ui.params[param] = value;
    if (target.type === 'range') target.closest('label').querySelector('output').value = target.value;
    this.updateSize();
  }
  updateSize() {
    if (!this.dialog) return;
    const ui = this.ui, w = ui.kind === 'upscale' ? this.item.width * 2 : ui.width, h = ui.kind === 'upscale' ? this.item.height * 2 : ui.height;
    this.dialog.querySelector('[data-processing-output]').textContent = `预计结果 ${w} × ${h}`;
  }
  number(key, label, min, max, step, params = false) {
    return field(label, `<input type="number" ${params ? 'data-nai' : 'data-processing-field'}="${key}" min="${min}" max="${max}" step="${step}" value="${params ? this.ui.params[key] : this.ui[key]}" />`);
  }
  render() {
    const ui = this.ui, params = ui.params, service = this.service();
    const range = (key, title) => field(`${title} <output>${ui[key]}</output>`,
      `<input type="range" data-processing-field="${key}" min="0" max="1" step="0.01" value="${ui[key]}" />`);
    this.dialog.innerHTML = `<header><h2 id="novelai-processing-title">${icon('wand-sparkles')}NovelAI 图片增强</h2>${button('close', 'x', '关闭', this.busy)}</header>
      <div class="processing-tabs" role="tablist" aria-label="图片处理方式">${PROCESSING_KINDS.map(([id, label]) =>
        `<button type="button" role="tab" data-processing-kind="${id}" aria-selected="${ui.kind === id}" ${this.busy ? 'disabled' : ''}>${label}</button>`).join('')}</div>
      <div class="processing-body"><aside><img src="${this.item.src}" alt="${esc(this.item.title)}" /><p>${esc(this.item.title)}</p>
        <p>原图 ${this.item.width} × ${this.item.height}</p><strong data-processing-output></strong>
        <p>${esc(service.label)}</p>${service.official ? '' : '<small>第三方图片增强兼容性待验证</small>'}</aside>
      <fieldset ${this.busy ? 'disabled' : ''}><section class="processing-fields" aria-label="${processingTitle(ui)}参数">
      ${ui.kind === 'upscale' ? `<p class="processing-note">长宽各放大 2 倍</p>` : `
        <div class="processing-grid">${this.number('width', '处理宽度', 64, 2048, 64)}${this.number('height', '处理高度', 64, 2048, 64)}</div>`}
      ${ui.kind === 'enhance' ? `
        <div class="processing-presets" role="group" aria-label="增强预设">${ENHANCE_PRESETS.map(([id, name, strength, noise]) =>
          `<button type="button" class="ui-button" data-processing-preset="${id}" aria-pressed="${ui.strength === strength && ui.noise === noise}">${name}</button>`).join('')}</div>
        <div class="processing-grid">${range('strength', '修改强度')}${range('noise', '增加噪声')}</div>
        ${field('增强模型', `<select data-nai="model">${options(NOVELAI_MODELS.filter((row) => !/diffusion-5/.test(row.id)).map((row) => [row.id, row.title]), params.model)}</select>`)}
        ${ui.characterScene?.characterPrompts?.length ? `<p class="processing-note">保留原图的 ${ui.characterScene.characterPrompts.length} 个角色分栏</p>` : ''}
        ${field('画师串', `<textarea rows="2" data-nai="artist" maxlength="4000">${esc(params.artist)}</textarea>`)}
        ${field('正向提示词', `<textarea rows="3" data-nai="positive" maxlength="12000">${esc(params.positive)}</textarea>`)}
        ${field('负面提示词', `<textarea rows="2" data-nai="negative" maxlength="12000">${esc(params.negative)}</textarea>`)}
        <details class="processing-advanced"><summary>其他增强参数</summary><div class="processing-grid">
        ${this.number('steps', '步数', 1, 50, 1, true)}${this.number('scale', 'CFG', 0, 10, 0.1, true)}
        ${this.number('cfgRescale', 'CFG Rescale', 0, 1, 0.01, true)}${this.number('seed', '随机种子（-1 随机）', -1, 4294967295, 1, true)}
        ${field('采样器', `<select data-nai="sampler">${options(NOVELAI_SAMPLERS.filter(([id]) => id !== 'ddim'), params.sampler)}</select>`)}
        ${field('噪声调度', `<select data-nai="noiseSchedule">${options([['karras', 'Karras'], ['exponential', 'Exponential'], ['polyexponential', 'Polyexponential']], params.noiseSchedule)}</select>`)}
        </div><label class="processing-check"><input type="checkbox" data-nai="qualityTags" ${params.qualityTags ? 'checked' : ''} />质量标签</label></details>` : ''}
      ${ui.kind === 'director' ? `
        ${field('导演工具', `<select data-processing-field="tool">${options(DIRECTOR_TOOLS, ui.tool)}</select>`)}
        ${ui.tool === 'colorize' || ui.tool === 'emotion' ? `
          ${ui.tool === 'emotion' ? field('表情', `<select data-processing-field="emotion">${options(PROCESSING_EMOTIONS, ui.emotion)}</select>`) : ''}
          ${field(ui.tool === 'emotion' ? '表情力度' : '颜色降噪（Defry）', `<select data-processing-field="defry">${options(Array.from({ length: 6 }, (_, index) => [String(index), ui.tool === 'emotion' ? ['正常', '稍弱', '较弱', '更弱', '很弱', '最弱'][index] : String(index)]), String(ui.defry))}</select>`)}
          ${field('补充提示词（可选）', `<textarea rows="3" data-processing-field="prompt" maxlength="12000">${esc(ui.prompt)}</textarea>`)}
        ` : ''}
        ${ui.tool === 'declutter' ? `<label class="processing-check"><input type="checkbox" data-processing-field="keepBubbles" ${ui.keepBubbles ? 'checked' : ''} />保留对话气泡</label>` : ''}
        ${ui.tool === 'bg-removal' ? '<p class="processing-note">返回的蒙版抠图、生成补全与混合结果分别保存。</p>' : ''}
      ` : ''}
      ${service.official ? '' : '<label class="processing-check"><input type="checkbox" data-processing-field="allowThirdParty" ' + (ui.allowThirdParty ? 'checked' : '') + ' />尝试当前第三方接口</label>'}
      </section></fieldset></div>
      <p class="processing-error" role="alert">${esc(this.error)}</p>
      <footer><span>${this.busy ? '正在准备底图与任务…' : '保存为新版本 · 按接口额度计费'}</span>${button('submit', this.busy ? 'loader-circle' : 'sparkles', '加入处理任务', this.busy)}</footer>`;
    this.updateSize(); paintIcons(this.dialog);
    if (ui.kind === 'enhance' && !this.busy) attachPromptTagButtons(this.dialog, (target, input, visual = false) =>
      this.openTags({ target, input, visual, params: () => this.ui.params,
        apply: (next) => { if (this.dialog && !this.busy) this.ui.params = next; },
        closed: () => { if (this.dialog) this.render(); } }));
  }
  async click(event) {
    const target = event.target.closest('[data-processing-action], [data-processing-kind], [data-processing-preset]');
    if (!target || this.busy) return;
    if (target.dataset.processingKind) { this.ui.kind = target.dataset.processingKind; this.error = ''; this.render(); return; }
    if (target.dataset.processingPreset) {
      const [, , strength, noise] = ENHANCE_PRESETS.find(([id]) => id === target.dataset.processingPreset);
      Object.assign(this.ui, { strength, noise }); this.render(); return;
    }
    if (target.dataset.processingAction === 'close') { this.close(); return; }
    if (target.dataset.processingAction !== 'submit') return;
    try {
      // Select values such as defry are numeric even though native selects expose strings.
      this.ui.defry = Number(this.ui.defry);
      validateProcessingDraft(this.ui, this.item);
      this.ui.params = normalizeNovelAI(this.ui.params);
      this.busy = true; this.error = ''; this.render();
      await this.submit(structuredClone(this.ui), this.item, this.location);
      this.busy = false; this.close();
    } catch (error) { this.busy = false; this.error = error.message; this.render(); }
  }
}
