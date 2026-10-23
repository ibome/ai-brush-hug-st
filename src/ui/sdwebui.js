import { randomUUID } from '../crypto-compat.js';
import { escapeHtml as esc } from '../config.js';
import { icon } from '../icons.js';
import { SDWEBUI_DEFAULTS, SDWEBUI_LIMITS, normalizeSDWebUI } from '../sdwebui.js';
import { applyPresetConnection, connectionDirty, presetConnection, savePresetBinding, resolvePresetConnection } from '../connections.js';

export function normalizeSDWebUIState(state) {
  state.sdwebui = normalizeSDWebUI(state.sdwebui);
  const ids = new Set(['default']), names = new Set(['默认配置']);
  state.sdwebuiPresets = (Array.isArray(state.sdwebuiPresets) ? state.sdwebuiPresets : []).slice(0, 50).flatMap((item) => {
    if (!item || !/^[A-Za-z0-9_-]{1,64}$/.test(item.id) || ids.has(item.id) || typeof item.name !== 'string') return [];
    const name = item.name.trim().slice(0, 40);
    if (!name || names.has(name.toLocaleLowerCase())) return [];
    ids.add(item.id); names.add(name.toLocaleLowerCase());
    return [{ id: item.id, name, params: normalizeSDWebUI(item.params), ...presetConnection('sdwebui', item) }];
  });
  if (!['default', ...state.sdwebuiPresets.map((item) => item.id)].includes(state.sdwebuiPresetId)) state.sdwebuiPresetId = 'default';
}
export const selectedSDWebUIPreset = (state) => state.sdwebuiPresets.find((item) => item.id === state.sdwebuiPresetId)
  || { id: 'default', name: '默认配置', params: normalizeSDWebUI() };
export const sdwebuiPresetDirty = (state) => JSON.stringify(normalizeSDWebUI(state.sdwebui)) !== JSON.stringify(selectedSDWebUIPreset(state).params)
  || connectionDirty(state, 'sdwebui', selectedSDWebUIPreset(state));
export function loadSDWebUIPreset(state, id) {
  const preset = id === 'default' ? { id, params: normalizeSDWebUI() } : state.sdwebuiPresets.find((item) => item.id === id);
  if (!preset) throw new Error('找不到该 SDWebUI 预设');
  resolvePresetConnection(state, 'sdwebui', preset);
  state.sdwebui = structuredClone(preset.params); state.sdwebuiPresetId = id;
  applyPresetConnection(state, 'sdwebui', preset);
  return preset;
}
export function saveSDWebUIPreset(state, name) {
  if (name === undefined) {
    const preset = state.sdwebuiPresets.find((item) => item.id === state.sdwebuiPresetId);
    if (!preset) throw new Error('请将默认配置另存为新预设');
    preset.params = normalizeSDWebUI(state.sdwebui);
    return savePresetBinding(state, 'sdwebui', preset);
  }
  const title = String(name).trim();
  if (!title || title.length > 40) throw new Error('预设名称需为 1 至 40 个字符');
  if (title === '默认配置' || state.sdwebuiPresets.some((item) => item.name.toLocaleLowerCase() === title.toLocaleLowerCase())) throw new Error('已有同名预设');
  if (state.sdwebuiPresets.length >= 50) throw new Error('最多保存 50 个 SDWebUI 预设');
  const preset = savePresetBinding(state, 'sdwebui', { id: randomUUID(), name: title, params: normalizeSDWebUI(state.sdwebui) });
  state.sdwebuiPresets.push(preset); state.sdwebuiPresetId = preset.id;
  return preset;
}
const field = (label, body) => `<label class="ui-field"><span>${label}</span>${body}</label>`;
const options = (items, value) => [...new Set(items)].map((item) => `<option value="${esc(item)}" ${item === value ? 'selected' : ''}>${esc(item)}</option>`).join('');
const command = (glyph, title, action) => `<button type="button" class="ui-button secondary" data-action="${action}">${icon(glyph)}<span>${title}</span></button>`;
export function renderSDWebUIPresets(state, actions = '') {
  return `<div class="nai-presets">${field('参数预设', `<select data-sdwebui-preset><option value="default" ${state.sdwebuiPresetId === 'default' ? 'selected' : ''}>默认配置</option>${state.sdwebuiPresets.map((item) => `<option value="${esc(item.id)}" ${state.sdwebuiPresetId === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select>`)}
    <div class="nai-preset-actions">${command('folder-open', '载入预设', 'sdwebui-load-preset')}${command('save', '保存预设', 'sdwebui-save-preset')}${command('copy-plus', '另存为', 'sdwebui-save-as')}${actions}
    <button type="button" class="ui-icon-button" data-action="sdwebui-delete-preset" title="删除当前预设" aria-label="删除当前预设" ${state.sdwebuiPresetId === 'default' ? 'disabled' : ''}>${icon('trash-2')}</button></div></div>`;
}
export function renderSDWebUIConnection(connection, keyInput) {
  return `${field('SDWebUI 服务地址', `<input type="url" data-transient="endpoint" value="${esc(connection.endpoint)}" maxlength="512" placeholder="https://你的域名/sdwebui" />`)}
    <div class="two-field-row">${field('鉴权方式', `<select data-sdwebui-connection="auth"><option value="none" ${connection.auth === 'none' ? 'selected' : ''}>无鉴权</option><option value="basic" ${connection.auth === 'basic' ? 'selected' : ''}>账号密码 · Basic</option><option value="bearer" ${connection.auth === 'bearer' ? 'selected' : ''}>访问令牌 · Bearer</option></select>`)}
    ${field('请求超时 (秒)', `<input type="number" min="5" max="600" step="1" data-sdwebui-connection="timeout" value="${connection.timeout}" />`)}</div>
    ${connection.auth === 'basic' ? field('账号', `<input data-sdwebui-connection="username" autocomplete="off" maxlength="200" value="${esc(connection.username)}" />`) : ''}
    ${connection.auth !== 'none' ? field(connection.auth === 'basic' ? '密码' : '访问令牌', keyInput) : ''}
    <p class="credential-status" data-credential-status role="status" aria-live="polite"></p>
    <p class="comfy-note">服务需启用 --api；支持根地址或 /sdapi/v1 地址。127.0.0.1 指当前浏览器所在电脑，远程服务需允许当前酒馆跨域访问。</p>
    ${command('refresh-cw', '获取模型与参数列表', 'sdwebui-fetch-models')}`;
}
export function renderSDWebUIParameters(state, probe, expanded = false) {
  const p = state.sdwebui;
  const numeric = (key, title) => {
    const [min, max, step] = SDWEBUI_LIMITS[key];
    return field(title, `<input type="number" data-sdwebui="${key}" min="${min}" max="${max}" step="${step}" value="${p[key]}" />`);
  };
  const choice = (key, title, entries, fallback = []) => field(title,
    `<input data-sdwebui="${key}" list="sdwebui-${key}" maxlength="500" value="${esc(p[key])}" placeholder="${key === 'model' ? '留空跟随服务当前模型' : ''}" /><datalist id="sdwebui-${key}">${options(entries?.length ? entries : fallback, p[key])}</datalist>`);
  const toggle = (key, title) => `<label class="nai-toggle"><span>${title}</span><input type="checkbox" data-sdwebui="${key}" ${p[key] ? 'checked' : ''} /><span class="nai-toggle-track" aria-hidden="true"></span></label>`;
  return `<section class="novelai-parameters sdwebui-parameters" aria-label="SDWebUI 参数配置">
    <div class="field-heading"><h2>SDWebUI 参数</h2><span data-sdwebui-dirty>${sdwebuiPresetDirty(state) ? '有未保存修改' : '已保存'}</span></div>
    ${choice('model', '大模型 · Checkpoint', probe?.models)}
    ${field('画师串', `<textarea rows="2" data-sdwebui="artist" maxlength="4000" spellcheck="false">${esc(p.artist)}</textarea>`)}
    ${field('正向提示词', `<textarea rows="3" data-sdwebui="positive" maxlength="12000" spellcheck="false">${esc(p.positive)}</textarea>`)}
    ${field('负面提示词', `<textarea rows="2" data-sdwebui="negative" maxlength="12000" spellcheck="false">${esc(p.negative)}</textarea>`)}
    <div class="nai-dimensions">${numeric('width', '宽度 (px)')}<button type="button" class="ui-icon-button" data-action="sdwebui-swap-size" title="交换宽高" aria-label="交换宽高">${icon('arrow-left-right')}</button>${numeric('height', '高度 (px)')}</div>
    ${numeric('steps', '步数')}
    <details class="advanced-options sdwebui-advanced" data-experience-fold="sdwebui-parameters" ${expanded || state.experience?.level === 'full' ? 'open' : ''}><summary>${icon('settings-2')}其他参数设置${icon('chevron-down')}</summary>
      <div class="two-field-row">${numeric('cfg', '提示词引导 (CFG)')}${choice('vae', 'VAE', ['Automatic', 'None', ...(probe?.vaes || [])])}
      ${choice('sampler', '采样器', probe?.samplers, ['Euler', 'Euler a', 'DPM++ 2M'])}${choice('scheduler', '调度器', ['Automatic', ...(probe?.schedulers || [])])}
      ${numeric('seed', '随机种子 · -1 随机')}${numeric('batch', '每次生成张数')}${numeric('clipSkip', 'CLIP Skip')}</div>
      <div class="nai-toggle-grid">${toggle('restoreFaces', '面部修复')}${toggle('tiling', '无缝平铺')}</div>
      <div class="field-heading"><h3>高清修复 · 文生图</h3></div>${toggle('highres', '启用高清修复')}
      <div class="two-field-row">${choice('hrUpscaler', '高清修复放大算法', [...(probe?.latentUpscalers || ['Latent']), ...(probe?.upscalers || [])])}
      ${numeric('hrScale', '放大倍数')}${numeric('hrSteps', '二次步数 · 0 跟随')}${numeric('hrDenoise', '二次重绘强度')}</div>
      <div class="field-heading"><h3>LoRA</h3></div>
      <div class="two-field-row">${field('LoRA 名称', `<input data-sdwebui-lora list="sdwebui-loras" maxlength="500" /><datalist id="sdwebui-loras">${options(probe?.loras || [], '')}</datalist>`)}
      ${field('LoRA 权重', '<input data-sdwebui-lora-weight type="number" min="-2" max="2" step="0.05" value="1" />')}</div>
      ${command('plus', '加入正向提示词', 'sdwebui-insert-lora')}
      <div class="field-heading"><h3>局部重绘</h3></div><div class="two-field-row">${numeric('maskBlur', '蒙版模糊')}
      ${field('蒙版区域填充', `<select data-sdwebui="inpaintFill">${[['0', '填充'], ['1', '原图'], ['2', '潜空间噪声'], ['3', '潜空间空白']].map(([id, title]) => `<option value="${id}" ${p.inpaintFill === Number(id) ? 'selected' : ''}>${title}</option>`).join('')}</select>`)}
      ${numeric('inpaintPadding', '局部重绘边距')}</div>${toggle('inpaintFullRes', '仅处理蒙版区域')}
      <div class="field-heading"><h3>图片放大</h3></div><div class="two-field-row">${choice('upscaler', '图片放大算法', probe?.upscalers, ['Lanczos', 'Nearest'])}${numeric('upscaleFactor', '图片放大倍数')}</div>
    </details>
    ${probe ? `<p class="comfy-note">已获取 ${probe.models.length} 个大模型、${probe.loras.length} 个 LoRA${probe.unavailable.length ? '，部分可选列表暂不可用' : ''}。</p>` : ''}
    <p class="comfy-note">取消已提交任务会停止本地等待，服务端可能继续生成。</p>
  </section>`;
}
