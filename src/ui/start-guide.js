import { escapeHtml as esc } from '../config.js';
import { icon } from '../icons.js';
import { START_GOALS, guideSteps, guideStepComplete } from '../start-guide.js';
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
  if (experience.dismissed || experience.completed) return `<section class="start-guide-entry" aria-label="使用引导">
    <span>${icon('compass')}使用引导</span>${guideCommand('open', experience.completed ? '重新查看' : experience.goal ? '继续设置' : '开始设置', 'arrow-right')}</section>`;
  const steps = guideSteps(experience, { ...readiness, chat: state });
  const done = steps.filter(guideStepComplete).length;
  const ready = Boolean(experience.goal) && steps.every(guideStepComplete);
  const next = { manual: ['generate', '前往生图工坊'], chat: ['chat-settings', '核对聊天配图设置'], comic: ['comic', '前往漫画工坊'] }[experience.goal];
  return `<section class="start-guide" aria-label="首次使用引导"><div class="start-guide-heading">
    <h2>${icon('compass')}开始使用灵画师</h2>${guideCommand('dismiss', '暂时收起', 'chevron-up')}</div>
    <div class="start-goals" role="group" aria-label="想先做什么">${START_GOALS.map(([id, name, symbol]) =>
      `<button type="button" data-guide-goal="${id}" aria-pressed="${experience.goal === id}">${icon(symbol)}<span>${name}</span>${experience.goal === id ? icon('check') : ''}</button>`).join('')}</div>
    ${experience.goal ? `<div class="start-guide-progress"><span>配置进度 ${done} / ${steps.length}</span><progress max="${steps.length}" value="${done}" aria-label="首次配置进度"></progress></div>
      <ol class="start-checklist">${steps.map((row) => `<li data-readiness="${row.result.code}">
        <div><strong>${esc(row.label)}${row.optional ? '<small>提示词块模式可跳过</small>' : ''}</strong>
          <span>${esc(row.result.label)}</span><small>${esc(row.result.detail)}</small></div>
        ${guideCommand(row.page, row.result.canSubmit ? '查看' : '去设置', row.result.canSubmit ? 'settings-2' : 'arrow-right')}</li>`).join('')}</ol>
      <div class="start-guide-actions">${guideCommand(next[0], next[1], 'arrow-right')}
      ${ready ? guideCommand('complete', '完成引导', 'check-check') : ''}</div>` : ''}
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
  'task-records': ['list-todo', '核对任务记录'], 'assistant-response': ['file-json', '查看回复并本地修复'],
  'assistant-config': ['settings-2', '检查文字配置'], 'assistant-network': ['scan', '检测文字网络'],
  'assistant-diagnostic': ['list-checks', '查看调用诊断'],
};
export function renderFailureActions(actions, jobId = '') {
  return `<div class="failure-actions">${actions.map((action) => {
    const [symbol, name] = actionNames[action] || ['arrow-right', action];
    return guideCommand(action, name, symbol, jobId ? `data-guide-task="${esc(jobId)}"` : '');
  }).join('')}</div>`;
}
