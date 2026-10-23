import { escapeHtml as esc } from '../config.js';
import { icon } from '../icons.js';
import { compatibilityFor } from '../assistant-compatibility.js';
import { ASSISTANT_MAX_TOKENS } from '../assistant-limits.js';

export function renderAssistantCompatibility(state, ui) {
  const a = state.assistant, profile = compatibilityFor(a, { currentModel: ui.tavernCurrent, tavernIdentity: ui.tavernIdentity });
  const field = (label, name, max) => `<label class="ui-field"><span>${label}</span><input type="number" data-assistant="${name}" aria-label="${label}" min="0" max="${max}" value="${a[name]}" placeholder="0 为未知"></label>`;
  return `<details class="assistant-expert" data-experience-fold="assistant-compatibility" ${state.experience?.level === 'full' ? 'open' : ''}>
    <summary>模型兼容与输出预算 · ${profile ? '已保存此模型方案' : '通用设置'}</summary>
    <div class="assistant-grid">${field('模型上下文窗口（0 为未知）', 'contextWindow', 4000000)}${field('模型最大输出（0 为未知）', 'outputLimit', ASSISTANT_MAX_TOKENS)}</div>
    ${a.source === 'api' ? `<label class="ui-field"><span>输出参数</span><select data-assistant="outputParameter" aria-label="输出参数">
      <option value="max_tokens" ${a.outputParameter === 'max_tokens' ? 'selected' : ''}>max_tokens</option><option value="max_completion_tokens" ${a.outputParameter === 'max_completion_tokens' ? 'selected' : ''}>max_completion_tokens</option></select></label>
      <label class="backup-check"><input type="checkbox" data-assistant="omitTemperature" ${a.omitTemperature ? 'checked' : ''}><span>不发送温度参数</span></label>` : ''}
    <p class="assistant-context">限制由你按接口资料填写，0 表示未知。Token 为粗略估算；切换模型后按保存的方案调用。</p>
    <div class="assistant-actions"><button type="button" class="ui-button secondary" data-action="assistant-compat-save">${icon('save')}保存此模型兼容设置</button>
      <button type="button" class="ui-button secondary" data-action="assistant-compat-remove" ${profile ? '' : 'disabled'}>${icon('trash-2')}清除此模型方案</button>
      <button type="button" class="ui-button secondary" data-action="assistant-compat-text">${icon('braces')}改用普通 JSON 回复</button></div>
    </details>`;
}
export function renderAssistantBudget(budget) {
  return budget ? `<p>最近请求估算：输入 ${budget.input} + 输出上限 ${budget.output} = ${budget.total} Token</p>
    ${[budget.error, ...budget.warnings].filter(Boolean).map((text) => `<p class="assistant-error">${esc(text)}</p>`).join('')}` : '';
}
