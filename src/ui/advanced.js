import { randomUUID } from '../crypto-compat.js';
import { escapeHtml as esc, downloadJson } from '../config.js';
import { icon, paintIcons } from '../icons.js';
import { ADVANCED_MODES, normalizeAdvanced, advancedOf, modelCapabilities, vibeModelKey, parseVibeFile, exportVibeFile } from '../advanced-generation.js';
import { normalizeReferenceImage, assetBase64, assetBytes } from '../reference-assets.js';
import { COMFY_TEMPLATES, comfyTemplate, comfyLoras, addComfyLora, removeComfyLora } from '../comfy-advanced.js';
import { newComfyConfig, normalizeComfyParams, autoMapWorkflow } from './comfyui.js';
import { searchVibes, saveVibe } from '../vibe-library.js';

const button = (glyph, label, command, attributes = '') => `<button type="button" class="ui-button secondary" data-advanced-command="${command}" ${attributes}>${icon(glyph)}<span>${label}</span></button>`;
const tool = (glyph, label, command, attributes = '') => `<button type="button" class="ui-icon-button" title="${label}" aria-label="${label}" data-advanced-command="${command}" ${attributes}>${icon(glyph)}</button>`;
const field = (label, body) => `<label class="ui-field"><span>${label}</span>${body}</label>`;
const range = (key, label, value) => field(`${label} · ${value}`, `<input type="range" min="0" max="1" step="0.01" data-advanced-field="${key}" value="${value}" aria-label="${label}" />`);
const vibeStatus = (entry, key) => {
  if (key === 'v3') return entry.image ? '当前模型可用' : '请添加原图';
  if (!key) return '当前模型不支持编码';
  if (entry.encodings[key]?.information === entry.information) return '当前模型可用';
  if (!entry.image) return '缺少匹配编码，请重新添加原图';
  return entry.encodings[key] ? '提取量已变更，请重新编码' : '需为当前模型编码参考图';
};

export class AdvancedPanel {
  constructor({ id = 'main', assets, getSnapshot, update, render, encode, gallery = () => [], useDrawing, disabled = () => false, getVibeLibrary, setVibeLibrary }) {
    Object.assign(this, { id, assets, getSnapshot, update, rerender: render, encode, gallery, useDrawing, disabled, getVibeLibrary, setVibeLibrary });
    this.ui = { busy: false, error: '', encodingId: '', brush: 48, eraser: false, sourceId: '', maskId: '', painting: false, strokes: [], redo: [], dirty: false, bitmap: null };
    this.urls = new Set();
  }
  html() {
    const snapshot = this.getSnapshot(), provider = snapshot.provider, params = snapshot.params || snapshot.config.params;
    const advanced = advancedOf(snapshot), caps = modelCapabilities(provider, params.model, advanced), ui = this.ui;
    const modes = ADVANCED_MODES.filter(([mode]) => (mode !== 'upscale' || provider === 'sdwebui')
      && (!['comfyui', 'sdwebui'].includes(provider) || mode !== 'reference'));
    const unsupported = advanced.mode !== 'text' && (['image', 'inpaint', 'upscale'].includes(advanced.mode)
      ? !caps[advanced.mode] : provider === 'openai' && !caps.image);
    const references = provider === 'openai' && advanced.mode === 'reference';
    const source = ['image', 'inpaint', 'upscale'].includes(advanced.mode);
    const hasVibes = provider === 'novelai' && advanced.mode === 'reference' && advanced.referenceKind === 'vibe';
    return `<section class="advanced-generation" data-advanced-panel="${this.id}" aria-label="高级生图能力">
      <div class="field-heading"><h2>高级生图</h2>${ui.busy ? `<span role="status">${icon('loader-circle', 'spin')}处理中</span>` : ''}</div>
      ${provider === 'openai' ? `<label class="advanced-check"><input type="checkbox" data-advanced-field="openAIEditEnabled" ${advanced.openAIEditEnabled ? 'checked' : ''} />此接口支持图片编辑</label>
        ${advanced.openAIEditEnabled ? field('图片编辑路径', `<input data-advanced-field="editPath" value="${esc(advanced.editPath)}" maxlength="200" />`) : ''}` : ''}
      <fieldset ${ui.busy || this.disabled() ? 'disabled' : ''}>
        <div class="advanced-modes" role="group" aria-label="生成方式">${modes.map(([mode, title]) => `<button type="button" data-advanced-mode="${mode}" aria-pressed="${advanced.mode === mode}" ${mode !== 'text'
          && (['image', 'inpaint', 'upscale'].includes(mode) ? !caps[mode] : provider === 'openai' && !caps.image || provider === 'novelai' && !caps.vibe && !caps.character) ? 'disabled' : ''}>${title}</button>`).join('')}</div>
        ${unsupported ? '<p class="advanced-error">当前模型或接口尚未开放所选能力，请切换生成方式。</p>' : ''}
        ${provider === 'comfyui' ? this.comfyHTML(snapshot.config) : ''}
        ${source ? `<div class="advanced-upload-actions">${button('image-plus', '上传底图', 'source-upload')}${this.gallerySelect()}${advanced.source ? tool('x', '移除底图', 'source-remove') : ''}</div>
          ${advanced.source ? `<div class="advanced-source"><img data-advanced-preview="source" alt="底图预览" /><div><strong>${esc(advanced.source.name)}</strong><span>${advanced.source.width} × ${advanced.source.height}</span>${button('maximize', '使用底图尺寸', 'source-size')}</div></div>` : ''}
          ${advanced.mode === 'upscale' ? '' : range('strength', '重绘强度', advanced.strength)}
          ${provider === 'novelai' ? range('noise', '额外噪声', advanced.noise) : ''}
          ${advanced.mode === 'inpaint' && advanced.source ? this.maskHTML(advanced) : ''}` : ''}
        ${references ? `<div class="advanced-upload-actions">${button('images', '添加参考图', 'reference-upload')}${this.gallerySelect('reference')}</div><div class="advanced-reference-list">${advanced.references.map((asset, index) => `<div><img data-advanced-reference="${index}" alt="参考图 ${index + 1}" /><span>${esc(asset.name)}</span>${tool('x', '移除参考图', 'reference-remove', `data-index="${index}"`)}</div>`).join('')}</div>` : ''}
        ${provider === 'novelai' && advanced.mode === 'reference' ? `
          ${field('参考用途', `<select data-advanced-field="referenceKind"><option value="vibe" ${advanced.referenceKind === 'vibe' ? 'selected' : ''}>画风参考 · Vibe</option><option value="character" ${advanced.referenceKind === 'character' ? 'selected' : ''} ${caps.character ? '' : 'disabled'}>人物参考 · V4.5</option></select>`)}
          ${hasVibes ? this.vibeHTML(advanced, params.model) : `<div class="advanced-upload-actions">${button('user-round-plus', '上传人物参考', 'character-upload')}${this.gallerySelect('character')}${advanced.character ? tool('x', '移除人物参考', 'character-remove') : ''}</div>
            ${advanced.character ? `<div class="advanced-source"><img data-advanced-preview="character" alt="人物参考预览" /><span>${esc(advanced.character.name)}</span></div>` : ''}
            ${range('referenceStrength', '参考强度', advanced.referenceStrength)}${range('fidelity', '人物保真度', advanced.fidelity)}
            <label class="advanced-check"><input type="checkbox" data-advanced-field="characterStyle" ${advanced.characterStyle ? 'checked' : ''} />同时参考画风</label>`}` : ''}
      </fieldset>
      <p class="advanced-error" role="status">${esc(ui.error)}</p>
      <input type="file" data-advanced-file="source" accept="image/png,image/jpeg,image/webp" hidden />
      <input type="file" data-advanced-file="reference" accept="image/png,image/jpeg,image/webp" multiple hidden />
      <input type="file" data-advanced-file="character" accept="image/png,image/jpeg,image/webp" hidden />
      <input type="file" data-advanced-file="vibe" accept="image/png,image/jpeg,image/webp" multiple hidden />
      <input type="file" data-advanced-file="vibefile" accept=".naiv4vibe,application/json" hidden />
    </section>`;
  }
  gallerySelect(kind = 'source') {
    const drawings = this.gallery();
    return drawings.length ? `<select data-advanced-gallery="${kind}" aria-label="从绘图管理选择${kind === 'source' ? '底图' : '参考图'}"><option value="">从绘图管理选择</option>${drawings.slice(0, 100).map((row) => `<option value="${esc(row.id)}">${esc(row.title)}</option>`).join('')}</select>` : '';
  }
  vibeHTML(advanced, model) {
    const key = vibeModelKey(model);
    return `<div class="advanced-upload-actions">${button('image-plus', '添加画风参考', 'vibe-upload')}${button('upload', '导入 .naiv4vibe', 'vibefile-upload')}</div>
      ${this.getVibeLibrary ? `<details class="vibe-library" ${this.ui.vibeOpen ? 'open' : ''}><summary>Vibe 素材库 · ${this.getVibeLibrary().length}</summary>
        <div class="vibe-library-tools"><input type="search" data-vibe-library-search aria-label="搜索 Vibe 素材" maxlength="200" value="${esc(this.ui.vibeSearch || '')}" placeholder="名称、分类、模型" />
          <label><input type="checkbox" data-vibe-library-favorites ${this.ui.vibeFavorites ? 'checked' : ''} />收藏</label>
          <label><input type="checkbox" data-vibe-library-model ${this.ui.vibeModel ? 'checked' : ''} />当前模型</label></div>
        <div class="vibe-library-list">${searchVibes(this.getVibeLibrary(), this.ui.vibeSearch, this.ui.vibeFavorites, this.ui.vibeModel ? model : '').map((row) =>
          `<div><span><strong>${esc(row.name)}</strong><small>${esc(row.category)} · ${esc(row.model || Object.keys(row.encodings).join(' / '))} · 强度 ${row.strength}</small></span>
            ${tool('plus', '载入 Vibe 素材', 'vibe-library-load', `data-vibe-id="${row.id}"`)}
            ${tool('star', row.favorite ? '取消收藏' : '收藏', 'vibe-library-favorite', `data-vibe-id="${row.id}" aria-pressed="${row.favorite}"`)}
            ${tool('trash-2', '删除素材库条目', 'vibe-library-delete', `data-vibe-id="${row.id}"`)}</div>`).join('') || '<p>暂无匹配素材</p>'}</div></details>` : ''}
      <label class="advanced-check"><input type="checkbox" data-advanced-field="normalizeStrength" ${advanced.normalizeStrength ? 'checked' : ''} />总参考强度超过 1 时自动归一化</label>
      <div class="vibe-list">${advanced.vibes.map((entry) => {
        const encoding = this.ui.encodingId === entry.id;
        return `<div class="vibe-item" data-vibe-row="${entry.id}"><img data-vibe-preview="${entry.id}" alt="画风参考预览" />
          <div><label class="advanced-check"><input type="checkbox" data-vibe-field="enabled" data-vibe-id="${entry.id}" ${entry.enabled ? 'checked' : ''} /><input aria-label="参考名称" data-vibe-field="name" data-vibe-id="${entry.id}" maxlength="80" value="${esc(entry.name)}" /></label>
            <div class="two-field-row">${field('参考强度', `<input type="number" min="0" max="1" step="0.01" data-vibe-field="strength" data-vibe-id="${entry.id}" value="${entry.strength}" />`)}
            ${field('信息提取量', `<input type="number" min="0" max="1" step="0.01" data-vibe-field="information" data-vibe-id="${entry.id}" value="${entry.information}" />`)}</div>
            <div class="vibe-actions"><span class="vibe-status" role="status">${encoding ? '正在编码参考图…' : vibeStatus(entry, key)}</span>${key === 'v3' ? '' : button(encoding ? 'loader-circle' : 'scan', encoding ? '正在编码…' : '编码参考图', 'vibe-encode', `title="编码参考图（可能消耗额度）" data-vibe-id="${entry.id}" ${entry.image && key ? '' : 'disabled'}`)}
              ${this.setVibeLibrary ? tool('bookmark-plus', '保存当前名称、强度和编码到素材库', 'vibe-library-save', `data-vibe-id="${entry.id}"`) : ''}
              ${tool('download', '导出 .naiv4vibe', 'vibe-export', `data-vibe-id="${entry.id}" ${Object.keys(entry.encodings).length ? '' : 'disabled'}`)}${tool('trash-2', '移除画风参考', 'vibe-remove', `data-vibe-id="${entry.id}"`)}</div>
          </div></div>`;
      }).join('')}</div>`;
  }
  maskHTML(advanced) {
    const ui = this.ui;
    return `<div class="mask-toolbar">${tool('brush', '绘制修改区域', 'mask-brush', `aria-pressed="${!ui.eraser}"`)}${tool('eraser', '擦除修改区域', 'mask-eraser', `aria-pressed="${ui.eraser}"`)}
      ${field('笔刷大小', `<input type="range" min="4" max="200" step="2" data-mask-brush value="${ui.brush}" aria-label="笔刷大小" />`)}
      ${tool('undo-2', '撤销笔画', 'mask-undo', ui.strokes.length ? '' : 'disabled')}${tool('redo-2', '恢复笔画', 'mask-redo', ui.redo.length ? '' : 'disabled')}${tool('trash-2', '清空蒙版', 'mask-clear')}${tool('save', '保存蒙版', 'mask-save')}</div>
      <div class="mask-stage" style="aspect-ratio:${advanced.source.width}/${advanced.source.height};max-width:${520 * advanced.source.width / advanced.source.height}px"><img data-advanced-mask-source alt="底图" /><canvas data-mask-canvas aria-label="局部重绘蒙版" width="${advanced.source.width}" height="${advanced.source.height}"></canvas></div>
      <div class="mask-state"><span>${ui.dirty ? '蒙版有未保存修改' : advanced.mask ? '蒙版已保存' : '尚未绘制蒙版'}</span><label class="advanced-check"><input type="checkbox" data-advanced-field="keepOutside" ${advanced.keepOutside ? 'checked' : ''} />保留蒙版外原图</label></div>`;
  }
  comfyHTML(config) {
    const info = this.objectInfo, loras = comfyLoras(config.graph);
    const loraChoices = info?.LoraLoader?.input?.required?.lora_name?.[0] || [];
    return `<div class="advanced-upload-actions">${field('常用工作流模板', `<select data-comfy-template><option value="">选择模板</option>${COMFY_TEMPLATES.map(([id, name]) => `<option value="${id}">${name}</option>`).join('')}</select>`)}
      ${button('plus', '添加 LoRA', 'comfy-lora-add')}</div>
      ${loras.map((lora) => `<div class="advanced-lora"><strong>#${esc(lora.id)}</strong>${field('LoRA 文件', loraChoices.length ? `<select data-lora-node="${esc(lora.id)}" data-lora-field="lora_name"><option value="">请选择</option>${[...new Set([lora.name, ...loraChoices])].filter(Boolean).map((name) => `<option value="${esc(name)}" ${lora.name === name ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>` : `<input data-lora-node="${esc(lora.id)}" data-lora-field="lora_name" value="${esc(lora.name)}" maxlength="500" />`)}
        <div class="two-field-row">${field('模型权重', `<input type="number" min="-100" max="100" step="0.05" data-lora-node="${esc(lora.id)}" data-lora-field="strength_model" value="${lora.model}" />`)}
        ${lora.modelOnly ? '' : field('CLIP 权重', `<input type="number" min="-100" max="100" step="0.05" data-lora-node="${esc(lora.id)}" data-lora-field="strength_clip" value="${lora.clip}" />`)}</div>${tool('trash-2', '移除 LoRA 节点', 'comfy-lora-remove', `data-node="${esc(lora.id)}"`)}</div>`).join('')}
      <details class="advanced-node-list"><summary>${icon('workflow')}工作流节点</summary>${Object.entries(config.graph).map(([id, node]) => `<div data-node-row="${esc(id)}"><strong>#${esc(id)}</strong><span>${esc(node._meta?.title || node.class_type)}</span><small>${Object.entries(config.mapping).filter(([, value]) => value.node === id).map(([key]) => esc(key)).join(' · ')}</small></div>`).join('')}</details>`;
  }
  apply(advanced) {
    const snapshot = this.getSnapshot();
    if (snapshot.provider === 'comfyui') snapshot.config.advanced = normalizeAdvanced(advanced);
    else snapshot.params.advanced = normalizeAdvanced(advanced);
    this.update(snapshot);
  }
  bind(container) {
    this.disposeURLs();
    const root = container.querySelector(`[data-advanced-panel="${this.id}"]`);
    if (!root) return;
    this.root = root;
    root.addEventListener('toggle', (event) => { if (event.target.matches('.vibe-library')) this.ui.vibeOpen = event.target.open; }, true);
    root.addEventListener('click', (event) => {
      const mode = event.target.closest('[data-advanced-mode]')?.dataset.advancedMode;
      if (mode) {
        const advanced = advancedOf(this.getSnapshot());
        advanced.mode = mode; this.apply(advanced); this.ui.error = ''; this.rerender(); return;
      }
      const target = event.target.closest('[data-advanced-command]');
      if (target) void this.command(target.dataset.advancedCommand, target);
    });
    root.addEventListener('input', (event) => {
      const target = event.target, advanced = advancedOf(this.getSnapshot());
      if (target.hasAttribute('data-mask-brush')) { this.ui.brush = Number(target.value); return; }
      if (target.dataset.advancedField) {
        advanced[target.dataset.advancedField] = target.type === 'checkbox' ? target.checked
          : ['range', 'number'].includes(target.type) ? Number(target.value) : target.value;
        this.apply(advanced);
        if (target.type === 'range') target.closest('label').querySelector('span').textContent = `${target.getAttribute('aria-label')} · ${target.value}`;
      } else if (target.dataset.vibeField) {
        const entry = advanced.vibes.find((entry) => entry.id === target.dataset.vibeId);
        if (!entry) return;
        entry[target.dataset.vibeField] = target.type === 'checkbox' ? target.checked : target.type === 'number' ? Number(target.value) : target.value;
        this.apply(advanced);
      } else if (target.dataset.loraNode) {
        const snapshot = this.getSnapshot(), key = target.dataset.loraField, node = snapshot.config.graph[target.dataset.loraNode];
        if (!node || !['lora_name', 'strength_model', 'strength_clip'].includes(key)) return;
        node.inputs[key] = target.type === 'number' ? Math.max(-100, Math.min(100, Number(target.value))) : target.value;
        for (const [mappedKey, mapped] of Object.entries(snapshot.config.mapping)) {
          if (mapped.node === target.dataset.loraNode && mapped.input === key) snapshot.config.params[mappedKey] = node.inputs[key];
        }
        this.update(snapshot);
      }
    });
    root.addEventListener('change', (event) => {
      const target = event.target;
      if (target.hasAttribute('data-vibe-library-search')) { this.ui.vibeSearch = target.value; this.rerender(); }
      else if (target.hasAttribute('data-vibe-library-favorites')) { this.ui.vibeFavorites = target.checked; this.rerender(); }
      else if (target.hasAttribute('data-vibe-library-model')) { this.ui.vibeModel = target.checked; this.rerender(); }
      else if (target.dataset.advancedFile) void this.perform(() => this.upload(target.dataset.advancedFile, [...target.files]));
      else if (target.dataset.advancedGallery && target.value) void this.perform(async () => {
        const item = await this.useDrawing(target.value);
        await this.attach(target.dataset.advancedGallery, item);
      });
      else if (target.hasAttribute('data-comfy-template') && target.value) void this.perform(async () => {
        const snapshot = this.getSnapshot(), previous = snapshot.config;
        if (!confirm('载入模板会替换当前工作流。已保存的工作流预设保留。')) return;
        const config = newComfyConfig(comfyTemplate(target.value, previous.params.checkpoint), COMFY_TEMPLATES.find(([id]) => id === target.value)[1]);
        const advanced = advancedOf(snapshot);
        advanced.mode = target.value; config.advanced = advanced;
        config.params = normalizeComfyParams({ ...config.params, positive: previous.params.positive, negative: previous.params.negative });
        snapshot.config = config; this.update(snapshot);
      });
      else if (target.dataset.vibeField && ['text', 'number'].includes(target.type)) {
        const snapshot = this.getSnapshot(), entry = advancedOf(snapshot).vibes.find((row) => row.id === target.dataset.vibeId);
        if (entry) {
          target.value = entry[target.dataset.vibeField];
          const status = target.closest('[data-vibe-row]')?.querySelector('.vibe-status');
          if (status) status.textContent = vibeStatus(entry, vibeModelKey(snapshot.params.model));
        }
      }
      else if (target.dataset.advancedField && ['text', 'number', 'range'].includes(target.type)) return;
      else if (target.dataset.advancedField || target.dataset.vibeField) this.rerender();
    });
    void this.previews(root);
    if (root.querySelector('[data-mask-canvas]')) void this.bindMask(root);
  }
  async perform(operation, { encodingId = '' } = {}) {
    if (this.ui.busy || this.disabled()) return;
    this.ui.busy = true; this.ui.error = ''; this.ui.encodingId = encodingId; this.rerender();
    try { await operation(); }
    catch (error) {
      this.ui.error = encodingId && error?.name === 'TimeoutError' ? '编码服务识别超时，请检查当前设备网络，或在接口配置填写服务地址'
        : error?.message || (encodingId ? '参考图编码未完成，请核对 NovelAI 接口配置后重试' : '操作失败，请重试');
    }
    finally { this.ui.busy = false; this.ui.encodingId = ''; this.rerender(); }
  }
  async command(command, target) {
    if (/-upload$/.test(command)) { this.root.querySelector(`[data-advanced-file="${command.replace('-upload', '')}"]`)?.click(); return; }
    if (command.startsWith('mask-')) {
      if (command === 'mask-save') { await this.perform(() => this.saveMask()); return; }
      if (command === 'mask-brush') this.ui.eraser = false;
      if (command === 'mask-eraser') this.ui.eraser = true;
      if (command === 'mask-undo' && this.ui.strokes.length) { this.ui.redo.push(this.ui.strokes.pop()); this.ui.dirty = true; }
      if (command === 'mask-redo' && this.ui.redo.length) { this.ui.strokes.push(this.ui.redo.pop()); this.ui.dirty = true; }
      if (command === 'mask-clear') { this.ui.strokes = []; this.ui.redo = []; this.ui.bitmap = null; this.ui.dirty = true; }
      this.rerender(); return;
    }
    await this.perform(async () => {
      const snapshot = this.getSnapshot(), advanced = advancedOf(snapshot);
      const entry = advanced.vibes.find((entry) => entry.id === target.dataset.vibeId);
      if (command.startsWith('vibe-library-') && this.getVibeLibrary) {
        const library = this.getVibeLibrary(), saved = library.find((row) => row.id === target.dataset.vibeId);
        if (command === 'vibe-library-save') {
          if (!entry) throw new Error('参考图已改变');
          const category = window.prompt('Vibe 分类', library.find((row) => row.id === entry.id)?.category || '我的参考');
          if (category === null) return;
          this.setVibeLibrary(saveVibe(library, { ...entry, category, model: snapshot.params.model,
            favorite: library.find((row) => row.id === entry.id)?.favorite || false })); return;
        }
        if (!saved) throw new Error('素材库条目已删除');
        if (command === 'vibe-library-favorite') { this.setVibeLibrary(saveVibe(library, { ...saved, favorite: !saved.favorite })); return; }
        if (command === 'vibe-library-delete') {
          if (window.confirm(`删除素材库中的“${saved.name}”？`)) this.setVibeLibrary(library.filter((row) => row.id !== saved.id));
          return;
        }
        if (command === 'vibe-library-load') {
          if (advanced.vibes.length >= 8) throw new Error('最多使用 8 份画风参考');
          if (advanced.vibes.some((row) => row.id === saved.id)) throw new Error('当前已载入此素材');
          advanced.vibes.push(structuredClone(saved)); this.apply(advanced); return;
        }
      }
      if (command === 'source-remove') { advanced.source = null; advanced.mask = null; this.resetMask(); }
      else if (command === 'source-size') { this.useSourceSize(snapshot, advanced); this.update(snapshot); return; }
      else if (command === 'reference-remove') advanced.references.splice(Number(target.dataset.index), 1);
      else if (command === 'character-remove') advanced.character = null;
      else if (command === 'vibe-remove') advanced.vibes = advanced.vibes.filter((value) => value.id !== entry?.id);
      else if (command === 'vibe-encode' && entry) {
        const model = snapshot.params.model, modelKey = vibeModelKey(model);
        if (!entry.image || !modelKey || modelKey === 'v3') throw new Error('此参考图或模型无法编码');
        const encoded = await this.encode(entry, model);
        const asset = await this.assets.put(encoded, { name: `${entry.name} · ${modelKey}` });
        entry.encodings[modelKey] = { asset, information: entry.information };
      } else if (command === 'vibe-export' && entry) {
        const data = {};
        for (const [key, encoding] of Object.entries(entry.encodings)) data[key] = assetBase64(new Uint8Array(await (await this.assets.get(encoding.asset)).arrayBuffer()));
        if (entry.image) data.image = assetBase64(new Uint8Array(await (await this.assets.get(entry.image)).arrayBuffer()));
        downloadJson(`${entry.name.replace(/[\\/:*?"<>|]/g, '_')}.naiv4vibe`, exportVibeFile(entry, data));
      } else if (command === 'comfy-lora-add' || command === 'comfy-lora-remove') {
        const graph = command === 'comfy-lora-add' ? addComfyLora(snapshot.config.graph) : removeComfyLora(snapshot.config.graph, target.dataset.node);
        snapshot.config.graph = graph;
        const automatic = autoMapWorkflow(graph);
        snapshot.config.mapping = { ...snapshot.config.mapping, ...automatic };
        for (const key of ['lora', 'loraModel', 'loraClip']) {
          if (!automatic[key]) delete snapshot.config.mapping[key];
          else snapshot.config.params[key] = graph[automatic[key].node].inputs[automatic[key].input];
        }
        this.update(snapshot); return;
      }
      this.apply(advanced);
    }, { encodingId: command === 'vibe-encode' ? target.dataset.vibeId : '' });
  }
  async upload(kind, files) {
    if (kind === 'vibefile') {
      const file = files[0];
      if (!file || file.size > 24 * 1024 * 1024) throw new Error('请选择 24 MB 内的 .naiv4vibe 文件');
      const parsed = parseVibeFile(await file.text()), advanced = advancedOf(this.getSnapshot());
      if (advanced.vibes.length >= 8) throw new Error('最多使用 8 份画风参考');
      const entry = { id: randomUUID(), name: parsed.name, enabled: true, strength: parsed.strength,
        information: parsed.encodings[0].information, image: null, encodings: {} };
      if (parsed.image) {
        const normalized = await normalizeReferenceImage(new Blob([assetBytes(parsed.image)], { type: 'image/png' }));
        entry.image = await this.assets.put(normalized.blob, normalized);
      }
      for (const encoding of parsed.encodings) {
        if (entry.encodings[encoding.modelKey]) continue;
        const asset = await this.assets.put(new Blob([assetBytes(encoding.data)], { type: 'application/octet-stream' }), { name: `${entry.name} · ${encoding.modelKey}` });
        entry.encodings[encoding.modelKey] = { asset, information: encoding.information, fileKey: encoding.fileKey };
      }
      advanced.vibes.push(entry); this.apply(advanced); return;
    }
    for (const file of files.slice(0, kind === 'source' || kind === 'character' ? 1 : 8)) {
      await this.attach(kind, await normalizeReferenceImage(file));
    }
  }
  async attach(kind, image) {
    const snapshot = this.getSnapshot(), advanced = advancedOf(snapshot);
    if (kind === 'vibe' && advanced.vibes.length >= 8) throw new Error('最多使用 8 份画风参考');
    if (kind === 'reference' && advanced.references.length >= 4) throw new Error('最多使用 4 张参考图');
    const asset = await this.assets.put(image.blob, image);
    if (kind === 'source') {
      advanced.source = asset; advanced.mask = null; this.resetMask(); this.useSourceSize(snapshot, advanced);
    } else if (kind === 'character') advanced.character = asset;
    else if (kind === 'reference') advanced.references.push(asset);
    else advanced.vibes.push({ id: randomUUID(), name: asset.name, image: asset, enabled: true, information: 1, strength: 0.6, encodings: {} });
    if (snapshot.provider === 'comfyui') snapshot.config.advanced = normalizeAdvanced(advanced);
    else snapshot.params.advanced = normalizeAdvanced(advanced);
    this.update(snapshot);
  }
  useSourceSize(snapshot, advanced) {
    if (!advanced.source) return;
    const params = snapshot.params || snapshot.config.params;
    params.width = advanced.source.width; params.height = advanced.source.height;
    if (snapshot.provider === 'openai') params.size = 'custom';
  }
  resetMask() {
    this.ui.bitmap?.close?.();
    Object.assign(this.ui, { sourceId: '', maskId: '', painting: false, strokes: [], redo: [], dirty: false, bitmap: null });
  }
  async previews(root) {
    const advanced = advancedOf(this.getSnapshot());
    const previews = [['[data-advanced-preview="source"]', advanced.source], ['[data-advanced-mask-source]', advanced.source],
      ['[data-advanced-preview="character"]', advanced.character],
      ...advanced.references.map((asset, index) => [`[data-advanced-reference="${index}"]`, asset]),
      ...advanced.vibes.map((entry) => [`[data-vibe-preview="${entry.id}"]`, entry.image])];
    for (const [selector, asset] of previews) {
      const img = root.querySelector(selector);
      if (!img || !asset) continue;
      try {
        const blob = await this.assets.get(asset);
        if (!root.isConnected) return;
        const url = URL.createObjectURL(blob); this.urls.add(url); img.src = url;
      } catch { if (root.isConnected) img.alt = '此设备缺少参考图'; }
    }
  }
  async bindMask(root) {
    const advanced = advancedOf(this.getSnapshot()), ui = this.ui, canvas = root.querySelector('[data-mask-canvas]');
    if (ui.sourceId !== advanced.source.id || ui.maskId !== (advanced.mask?.id || '')) {
      this.resetMask(); ui.sourceId = advanced.source.id; ui.maskId = advanced.mask?.id || '';
      if (advanced.mask) {
        try { ui.bitmap = await this.maskBitmap(await this.assets.get(advanced.mask)); }
        catch { ui.error = '蒙版无法读取，请重新绘制'; }
      }
    }
    if (!root.isConnected) return;
    this.drawMask(canvas);
    let stroke;
    const point = (event) => {
      const rect = canvas.getBoundingClientRect();
      return [(event.clientX - rect.left) / rect.width * canvas.width, (event.clientY - rect.top) / rect.height * canvas.height];
    };
    canvas.addEventListener('pointerdown', (event) => {
      if (ui.busy || this.disabled() || event.button && event.button !== 0) return;
      if (ui.strokes.length >= 100) { ui.error = '请保存蒙版后继续绘制'; this.rerender(); return; }
      canvas.setPointerCapture(event.pointerId);
      ui.painting = true;
      stroke = { eraser: ui.eraser, size: ui.brush, points: [point(event)] };
      ui.strokes.push(stroke); ui.redo = []; ui.dirty = true; this.drawMask(canvas);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!stroke) return;
      if (stroke.points.length < 2000) stroke.points.push(point(event));
      this.drawMask(canvas);
    });
    const finish = () => {
      if (!stroke) return;
      stroke = null;
      ui.painting = false;
      const label = root.querySelector('.mask-state > span');
      if (label) label.textContent = '蒙版有未保存修改';
      root.querySelector('[data-advanced-command="mask-undo"]').disabled = false;
      this.rerender();
    };
    canvas.addEventListener('pointerup', finish); canvas.addEventListener('pointercancel', finish);
  }
  drawMask(canvas) {
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (this.ui.bitmap) context.drawImage(this.ui.bitmap, 0, 0, canvas.width, canvas.height);
    for (const stroke of this.ui.strokes) {
      context.globalCompositeOperation = stroke.eraser ? 'destination-out' : 'source-over';
      context.strokeStyle = '#ffffff'; context.fillStyle = '#ffffff';
      context.lineWidth = stroke.size; context.lineCap = 'round'; context.lineJoin = 'round';
      context.beginPath(); context.moveTo(...stroke.points[0]);
      if (stroke.points.length === 1) {
        context.arc(stroke.points[0][0], stroke.points[0][1], stroke.size / 2, 0, Math.PI * 2); context.fill();
      } else {
        for (const point of stroke.points.slice(1)) context.lineTo(...point);
        context.stroke();
      }
    }
    context.globalCompositeOperation = 'source-over';
  }
  async saveMask() {
    const advanced = advancedOf(this.getSnapshot());
    if (!advanced.source) throw new Error('请先选择底图');
    const canvas = document.createElement('canvas');
    canvas.width = advanced.source.width; canvas.height = advanced.source.height;
    this.drawMask(canvas);
    const context = canvas.getContext('2d'), pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    let selected = false;
    for (let index = 0; index < pixels.data.length; index += 4) {
      const white = pixels.data[index] >= 128 && pixels.data[index + 3] >= 128;
      selected ||= white;
      pixels.data[index] = white ? 255 : 0; pixels.data[index + 1] = white ? 255 : 0;
      pixels.data[index + 2] = white ? 255 : 0; pixels.data[index + 3] = 255;
    }
    if (!selected) throw new Error('请先涂出需要修改的区域');
    context.putImageData(pixels, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    advanced.mask = await this.assets.put(blob, { name: '局部重绘蒙版', width: canvas.width, height: canvas.height });
    this.ui.maskId = advanced.mask.id;
    this.ui.bitmap?.close?.(); this.ui.bitmap = await this.maskBitmap(blob);
    this.ui.strokes = []; this.ui.redo = []; this.ui.dirty = false;
    this.apply(advanced);
  }
  async beforeGenerate() {
    if (this.ui.busy) throw new Error('参考素材正在处理，请稍后生成');
    if (advancedOf(this.getSnapshot()).mode === 'inpaint' && this.ui.dirty) await this.saveMask();
  }
  async maskBitmap(blob) {
    const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0); bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      if (pixels.data[index] < 128) pixels.data[index + 3] = 0;
    }
    context.putImageData(pixels, 0, 0);
    return createImageBitmap(canvas);
  }
  disposeURLs() {
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}
