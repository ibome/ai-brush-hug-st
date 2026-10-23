import { escapeHtml } from '../config.js';
import { icon } from '../icons.js';
import { CHARACTER_THEMES } from './appearance.js';
import { CHAT_DEFAULTS } from '../chat.js';
import { experienceFold } from './experience.js';

export const PROMPT_TRIGGER_FORMAT = Object.freeze({
  prefix: 'image###',
  suffix: '###',
});

export const GENERATION_MODES = Object.freeze([
  { id: 'novelai', title: 'NovelAI', subtitle: '用以Api对接生图', icon: 'sparkles' },
  { id: 'comfyui', title: 'ComfyUI', subtitle: '本地工作流', icon: 'plug' },
  { id: 'openai', title: 'OpenAI兼容', subtitle: '通用图片接口', icon: 'image-plus' },
  { id: 'sdwebui', title: 'SDWebUI', subtitle: 'Stable Diffusion 原生接口', icon: 'sliders-horizontal' },
]);

export const SETTINGS_DEFAULTS = Object.freeze({
  ...CHAT_DEFAULTS,
  enabled: true,
  floatingBall: true,
  externalAPI: true,
  provider: 'novelai',
  characterTheme: 'whale',
  generationMode: 'queue',
  queueInterval: 3,
  concurrency: 2,
  cacheLocation: 'browser',
  cacheDirectory: 'images/linghuashi',
  cleanupMode: 'manual',
  cleanupInterval: 7,
  cleanupUnit: 'days',
  cleanupMaxImages: 200,
  cleanupOlderThanDays: 7,
  triggerPrefix: PROMPT_TRIGGER_FORMAT.prefix,
  triggerSuffix: PROMPT_TRIGGER_FORMAT.suffix,
});

export const SETTING_LIMITS = {
  queueInterval: [0, 3600, false],
  concurrency: [1, 16, true],
  cleanupInterval: [1, 365, true],
  cleanupMaxImages: [1, 10000, true],
  cleanupOlderThanDays: [1, 3650, true],
};

export function normalizeSettings(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const result = { ...SETTINGS_DEFAULTS };
  for (const key of ['enabled', 'floatingBall', 'auto', 'confirm', 'inline', 'externalAPI']) {
    if (typeof source[key] === 'boolean') result[key] = source[key];
  }
  const choices = {
    provider: GENERATION_MODES.map((mode) => mode.id),
    characterTheme: CHARACTER_THEMES.map((theme) => theme.id),
    generationMode: ['queue', 'parallel'],
    cacheLocation: ['browser', 'server'],
    cleanupMode: ['manual', 'time', 'count'],
    cleanupUnit: ['hours', 'days'],
  };
  for (const [key, values] of Object.entries(choices)) {
    if (values.includes(source[key])) result[key] = source[key];
  }
  if (source.cacheLocation === 'local') result.cacheLocation = 'server';
  for (const [key, [min, max, integer]] of Object.entries(SETTING_LIMITS)) {
    const value = Number(source[key] ?? result[key]);
    if (Number.isFinite(value)) {
      result[key] = Math.max(min, Math.min(max, integer ? Math.round(value) : value));
    }
  }
  if (typeof source.cacheDirectory === 'string') {
    result.cacheDirectory = source.cacheDirectory.trim().slice(0, 160) || result.cacheDirectory;
  }
  for (const key of ['triggerPrefix', 'triggerSuffix']) {
    if (typeof source[key] === 'string' && source[key].trim()) {
      result[key] = source[key].slice(0, 160);
    }
  }
  return result;
}

const switchRow = (key, title, checked, description = '') => `<label class="setting-switch-row${description ? ' has-description' : ''}"><span class="setting-switch-copy"><span class="setting-switch-title">${title}</span>${description ? `<small id="setting-${key}-help">${escapeHtml(description)}</small>` : ''}</span><span class="ui-toggle"><input type="checkbox" data-setting="${key}" aria-label="${title}" ${description ? `aria-describedby="setting-${key}-help"` : ''} ${checked ? 'checked' : ''} /><span></span></span></label>`;
const segmented = (key, label, value, options) => `<div class="settings-segmented" role="group" aria-label="${label}">${options.map(([id, title, name]) => `<button type="button" data-choice="${key}" data-value="${id}" aria-pressed="${value === id}" class="${value === id ? 'selected' : ''}">${icon(name)}<span>${title}</span></button>`).join('')}</div>`;
const numeric = (key, label, value, unit, step = '1') => `<label class="setting-number"><span>${label}</span><span class="number-unit"><input type="number" data-setting="${key}" aria-label="${label}" min="${SETTING_LIMITS[key][0]}" max="${SETTING_LIMITS[key][1]}" step="${step}" value="${value}" /><span>${unit}</span></span></label>`;

export function renderSettings(state, additions = '', guide = '') {
  const count = state.history.length;
  const queue = state.generationMode === 'queue';
  const cleanupOptions = [['manual', '不自动清理'], ['time', '定时清空'], ['count', '达到数量清理']];
  return `<div class="page-heading settings-page-heading"><div><h1>插件设置</h1><p>灵画师</p></div><span class="settings-save-status" data-workspace-save role="status"></span></div>
    ${guide}
    <div class="plugin-settings">
      <section class="settings-band" aria-labelledby="activation-heading">
        <div class="settings-band-heading"><h2 id="activation-heading">${icon('sliders-horizontal')}启用设置</h2><span class="settings-state ${state.enabled ? 'on' : ''}"><span></span>${state.enabled ? '已启用' : '已关闭'}</span></div>
        <div class="activation-grid">
          ${switchRow('enabled', '插件开关', state.enabled)}
          ${switchRow('floatingBall', '显示悬浮球', state.floatingBall)}
          ${switchRow('externalAPI', '允许其他扩展调用生图', state.externalAPI, '使用当前账号的接口与任务队列，调用记录显示来源扩展。')}
        </div>
        <div class="plugin-appearance-row">
          <label class="plugin-mode-select"><span>模式</span><select data-setting="provider" aria-label="模式">${GENERATION_MODES.map((mode) => `<option value="${mode.id}" ${state.provider === mode.id ? 'selected' : ''}>${mode.title}</option>`).join('')}</select></label>
          <label class="plugin-mode-select"><span>主题</span><select data-setting="characterTheme" aria-label="主题">${CHARACTER_THEMES.map((theme) => `<option value="${theme.id}" ${state.characterTheme === theme.id ? 'selected' : ''}>${theme.title}</option>`).join('')}</select></label>
        </div>
      </section>
      ${experienceFold(state, 'settings-schedule', '生图调度', `<section class="settings-band" aria-labelledby="generation-heading">
        <div class="settings-band-heading"><h2 id="generation-heading">${icon('wand-sparkles')}生图调度</h2><span class="settings-label">${queue ? '依次生成' : '同时生成'}</span></div>
        <div class="settings-control-row">
          <div class="setting-control"><span>生图模式</span>${segmented('generationMode', '生图模式', state.generationMode, [['queue', '排队生图', 'list-filter'], ['parallel', '并发生图', 'layout-dashboard']])}</div>
          ${queue ? numeric('queueInterval', '排队生图间隔', state.queueInterval, '秒', '0.5') : numeric('concurrency', '并发数量', state.concurrency, '个')}
        </div>
        <div class="settings-rule-summary">${icon('clock-3')}<span>${queue ? `每次完成后间隔 ${state.queueInterval} 秒开始下一个任务` : `最多同时执行 ${state.concurrency} 个生图任务`}</span></div>
      </section>`)}
      <section class="settings-band" aria-labelledby="display-heading">
        <div class="settings-band-heading"><h2 id="display-heading">${icon('message-square')}触发与展示</h2></div>
        <div class="activation-grid trigger-display-grid">
          ${switchRow('auto', '自动生图', state.auto, '角色新回复完成后识别指定格式中的提示词并生成图片。关闭后可点击提示词位置的按钮手动生成；旧消息不会自动补图。')}
          ${switchRow('confirm', '生成前确认提示词', state.confirm, '生图前可检查、修改本次任务的提示词，确认后再生成。关闭后直接提交。')}
          ${switchRow('inline', '在聊天中显示图片', state.inline, '将正文中的提示词块替换为对应图片。关闭后恢复提示词原文，图片仍保存到绘图管理。')}
        </div>
        ${experienceFold(state, 'settings-trigger', '自定义触发格式', `<div class="prompt-trigger-format">
          <div class="field-heading"><h3>提示词生图触发格式</h3><span>自定义格式</span></div>
          <div class="trigger-wrapper-fields">
            <label class="ui-field"><span>包裹前缀</span><input data-setting="triggerPrefix" aria-label="包裹前缀" value="${escapeHtml(state.triggerPrefix)}" maxlength="160" spellcheck="false" autocomplete="off" /></label>
            <label class="ui-field"><span>包裹后缀</span><input data-setting="triggerSuffix" aria-label="包裹后缀" value="${escapeHtml(state.triggerSuffix)}" maxlength="160" spellcheck="false" autocomplete="off" /></label>
          </div>
          <div class="trigger-format-example"><span>完整格式</span><code data-trigger-format-example>${escapeHtml(state.triggerPrefix)}图片提示词${escapeHtml(state.triggerSuffix)}</code></div>
        </div>`, state.triggerPrefix !== PROMPT_TRIGGER_FORMAT.prefix || state.triggerSuffix !== PROMPT_TRIGGER_FORMAT.suffix)}
        <div class="cache-footer"><span>${icon('sparkles')}智能配图 · ${state.assistant?.autoPrompt ? '自动准备已开启' : '手动配图'}</span><button type="button" class="ui-button secondary" data-page="assistant">${icon('sliders-horizontal')}<span>提示词助手设置</span></button></div>
      </section>
      <section class="settings-band" aria-labelledby="cache-heading">
        <div class="settings-band-heading"><h2 id="cache-heading">${icon('images')}图片存储</h2><span class="settings-label">绘图管理</span></div>
        <div class="settings-control-row">
          <div class="setting-control"><span>存储位置</span>${segmented('cacheLocation', '存储位置', state.cacheLocation, [['browser', '浏览器', 'panels-top-left'], ['server', '酒馆服务器', 'server']])}</div>
          <div class="cache-count"><span>图片数量</span><strong>${count}<small>张</small></strong></div>
        </div>
        <p class="storage-scope">${state.cacheLocation === 'server'
          ? '<strong>当前酒馆账号</strong> · 同账号换设备可读取服务器图片。'
          : '<strong>仅当前设备与站点</strong> · 换浏览器、清理站点数据或更换域名后，不会自动带走图片。'}
          <span> 当前图片占用：${escapeHtml(state.storageUsage || '待读取')}</span></p>
        <div class="cache-footer"><div>
          <button type="button" class="ui-button secondary" data-guide-action="storage-check">${icon('hard-drive')}<span>检测存储与容量</span></button>
          <button type="button" class="ui-button secondary" data-guide-action="backup-settings">${icon('archive')}<span>备份与迁移</span></button>
        </div></div>
        ${state.cacheLocation === 'server' ? `<div class="settings-rule-summary">${icon('hard-drive')}<span>占用空间：${escapeHtml(state.storageUsage || '0 B')} · 当前账号目录：user/images/linghuashi</span></div>
          <div class="cache-footer"><span>${escapeHtml(state.storageStatus || '')}</span><div><button type="button" class="ui-button secondary" data-page="components">${icon('plug')}<span>扩展组件</span></button><button type="button" class="ui-button secondary" data-action="storage-audit">${icon('list-checks')}<span>检查存储</span></button><button type="button" class="ui-button secondary" data-action="storage-migrate">${icon('upload')}<span>迁移浏览器图片</span></button></div></div>` : ''}
        ${experienceFold(state, 'settings-cleanup', '清理与空间管理', `<div class="cache-cleanup-row">
          <label class="ui-field cleanup-mode"><span>自动清理</span><select data-setting="cleanupMode" aria-label="自动清理">${cleanupOptions.map(([value, title]) => `<option value="${value}" ${state.cleanupMode === value ? 'selected' : ''}>${title}</option>`).join('')}</select></label>
          ${state.cleanupMode === 'time' ? `<div class="cleanup-time">${numeric('cleanupInterval', '自动清空间隔', state.cleanupInterval, '')}<label class="cleanup-unit"><span>时间单位</span><select data-setting="cleanupUnit" aria-label="时间单位"><option value="hours" ${state.cleanupUnit === 'hours' ? 'selected' : ''}>小时</option><option value="days" ${state.cleanupUnit === 'days' ? 'selected' : ''}>天</option></select></label></div>` : ''}
          ${state.cleanupMode === 'count' ? `<div class="cleanup-count">${numeric('cleanupMaxImages', '达到缓存数量', state.cleanupMaxImages, '张')}${numeric('cleanupOlderThanDays', '清理多少天前的图片', state.cleanupOlderThanDays, '天')}</div>` : ''}
        </div>
        ${state.cleanupMode !== 'manual' ? `<div class="settings-rule-summary">${icon('clock-3')}<span>${state.cleanupMode === 'time' ? `每 ${state.cleanupInterval} ${state.cleanupUnit === 'hours' ? '小时' : '天'}清理未收藏图片` : `达到 ${state.cleanupMaxImages} 张时，清理 ${state.cleanupOlderThanDays} 天前的未收藏图片`}${state.cacheLocation === 'server' ? '；保留聊天配图。内置存储在打开酒馆时执行清理；增强组件可在后台清理其保存的图片。' : ''}</span></div>` : ''}
        <div class="cache-footer"><span>${icon('images')}${count ? `${count} 张${state.cacheLocation === 'server' ? '服务器图片' : '浏览器图片'}` : '暂无图片'}</span><button type="button" class="ui-button cache-clear" data-action="clear-cache" ${count ? '' : 'disabled'}>${icon('trash-2')}<span>一键清空</span></button></div>`, state.cleanupMode !== 'manual')}
      </section>
      ${additions}
    </div>`;
}
