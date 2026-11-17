import { escapeHtml as esc } from '../config.js';
import { icon } from '../icons.js';
import { START_GOALS, CHAT_DRAWING_MODES, guideSteps, guideStepComplete } from '../start-guide.js';
import '../styles/start-guide.css';

const glyph = (code) => ({ ready: 'circle-check', configured: 'circle-check', missing: 'circle', error: 'circle-alert',
  checking: 'loader-circle', unverified: 'circle-help' })[code] || 'circle';
export const guideCommand = (action, label, name = 'arrow-right', extra = '') =>
  `<button type="button" class="ui-button secondary" data-guide-action="${action}" ${extra}>${icon(name)}<span>${esc(label)}</span></button>`;

export function readinessBadge(row, attribute = '') {
  return `<span class="ui-status ${row.code === 'error' ? 'danger' : row.code === 'ready' ? 'accent' : 'neutral'}"
    ${attribute} role="status" title="${esc(row.detail)}">${icon(glyph(row.code), row.code === 'checking' ? 'spin' : '')}${esc(row.label)}</span>`;
}

export function renderStartGuide(state, readiness) {
  const experience = state.experience;
  const verification = `<div data-first-success-root>${renderFirstSuccess(readiness.verification, experience.goal)}</div>`;
  if (experience.dismissed || experience.completed) return `<section class="start-guide-entry" aria-label="使用引导">
    <span>${icon('compass')}使用引导</span>${guideCommand('open', experience.completed ? '重新查看' : experience.goal ? '继续设置' : '开始设置', 'arrow-right')}</section>${verification}`;
  const steps = guideSteps(experience, { ...readiness, chat: state });
  const done = steps.filter(guideStepComplete).length;
  const ready = Boolean(experience.goal) && steps.every(guideStepComplete);
  const next = { manual: ['generate', '前往生图工坊'], chat: ['chat-settings', '核对聊天配图设置'], comic: ['comic', '前往漫画工坊'] }[experience.goal];
  return `<section class="start-guide" aria-label="首次使用引导"><div class="start-guide-heading">
    <h2>${icon('compass')}开始使用灵画师</h2>${guideCommand('dismiss', '暂时收起', 'chevron-up')}</div>
    <div class="start-goals" role="group" aria-label="想先做什么">${START_GOALS.map(([id, name, symbol]) =>
      `<button type="button" data-guide-goal="${id}" aria-pressed="${experience.goal === id}">${icon(symbol)}<span>${name}</span>${experience.goal === id ? icon('check') : ''}</button>`).join('')}</div>
    ${experience.goal === 'chat' ? `<div class="start-chat-modes" role="group" aria-label="聊天配图来源">${CHAT_DRAWING_MODES.map(([id, name]) =>
      `<button type="button" data-guide-chat-mode="${id}" aria-pressed="${Boolean(state.assistant.autoPrompt) === (id === 'assistant')}">${icon(id === 'tags' ? 'braces' : 'sparkles')}<span>${name}</span></button>`).join('')}</div>
      <p class="storage-scope">${state.assistant.autoPrompt ? '由文字模型分析聊天剧情，需要配置提示词助手。' : '在酒馆导入并启用生图世界书，识别回复里的提示词块；只需配置生图接口，无需配置文字模型。'}</p>` : ''}
    ${experience.goal ? `<div class="start-guide-progress"><span>配置进度 ${done} / ${steps.length}</span><progress max="${steps.length}" value="${done}" aria-label="首次配置进度"></progress></div>
      <ol class="start-checklist">${steps.map((row) => `<li data-readiness="${row.result.code}">
        <div><strong>${esc(row.label)}${row.optional ? '<small>提示词块模式可跳过</small>' : ''}</strong>
          <span>${esc(row.result.label)}</span><small>${esc(row.result.detail)}</small></div>
        ${guideCommand(row.page, row.result.canSubmit ? '查看' : '去设置', row.result.canSubmit ? 'settings-2' : 'arrow-right')}</li>`).join('')}</ol>
      <div class="start-guide-actions">${guideCommand(next[0], next[1], 'arrow-right')}
      ${ready ? guideCommand('complete', '配置完成，收起引导', 'check-check') : ''}</div>` : ''}
    ${verification}
  </section>`;
}

export function renderFirstSuccess(value, goal) {
  if (!goal) return '';
  const result = value || {}, chat = goal === 'chat';
  const rows = [[chat ? '识别提示词 / 助手画面' : '已准备提示词', result.recognized],
    ['图片实际返回', result.generated], ['图片成功保存', result.saved], ...(chat ? [['聊天图片加载成功', result.inserted]] : [])];
  return `<section class="first-success" aria-label="实际出图验证"><h3>实际出图验证 <small>本次打开 · 当前接口、模型与存储</small></h3>
    <ol>${rows.map(([label, done]) => `<li data-verified="${Boolean(done)}">${icon(done ? 'circle-check' : 'circle')}${esc(label)}<span>${done ? '已完成' : '待验证'}</span></li>`).join('')}</ol>
    <p role="status">${result.failure ? esc(result.failure) : result.status === 'queued' ? '任务已排队，等待生成。'
      : result.status === 'running' ? result.saved ? '图片已保存，正在同步显示。' : result.generated ? '图片已返回，正在保存。' : '正在生成图片，请稍候。'
      : result.complete ? '本次流程已验证成功。'
      : result.saved && chat ? '图片已保存，等待原聊天中的图片加载；可返回聊天查看。'
        : result.recognized ? '提示词已识别或准备，可按自己的需要生成第一张图。'
          : chat ? '返回聊天完成一条带提示词的回复，或使用助手准备画面。' : '在工坊准备提示词并生成一张图片。'}</p>
    ${guideCommand('task-records', '查看任务记录', 'list-todo')}${result.saved ? guideCommand('gallery', '查看已存图片', 'images') : ''}
  </section>`;
}

export function renderReadiness(readiness, summary, open = false) {
  return `<details class="setup-readiness" data-setup-readiness ${open ? 'open' : ''}><summary>${icon('list-checks')}当前配置
    <span>${esc(summary.image)} · ${esc(summary.model)} · ${esc(summary.storage)}</span>${icon('chevron-down')}</summary>
    <dl class="setup-facts">${Object.entries({ 生图接口: summary.image, 生图模型: summary.model, 出图参数预设: summary.preset,
      文字接口: summary.text, 文字模型: summary.textModel, 文字任务规则: summary.textPreset, 图片存储: summary.storage }).map(([key, value]) =>
      `<div><dt>${key}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>
    <ul class="setup-checklist">${[['image', '生图接口'], ['assistant', '文字接口'], ['storage', '图片存储']].map(([id, name]) => {
      const row = readiness[id];
      return `<li><span><strong>${name}</strong>${readinessBadge(row)}</span>${guideCommand(row.action, row.code === 'missing' ? '去设置' : '查看 / 检查', 'arrow-right')}</li>`;
    }).join('')}</ul></details>`;
}

const actionNames = {
  'task-retry': ['download', '继续取图 / 保存'], gallery: ['images', '查看已存图片'], connection: ['plug', '检查生图接口'],
  'image-network': ['scan', '检测生图网络'], 'storage-check': ['hard-drive', '检测存储与缓存'],
  'storage-settings': ['settings-2', '图片存储设置'], 'backup-settings': ['archive', '备份与迁移'],
  'task-records': ['list-todo', '查看待处理任务'], 'assistant-response': ['file-json', '查看回复并本地修复'],
  'assistant-config': ['settings-2', '检查文字配置'], 'assistant-network': ['scan', '检测文字网络'],
  'assistant-diagnostic': ['list-checks', '查看调用诊断'],
  'outfit-settings': ['shirt', '检查服装草稿'],
};
export function renderFailureActions(actions, jobId = '') {
  return `<div class="failure-actions">${actions.map((action) => {
    const [symbol, name] = actionNames[action] || ['arrow-right', action];
    return guideCommand(action, name, symbol, jobId ? `data-guide-task="${esc(jobId)}"` : '');
  }).join('')}</div>`;
}
