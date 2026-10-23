import { escapeHtml as esc } from '../config.js';
import { icon } from '../icons.js';
import { ASSISTANT_TEMPLATES } from '../prompt-assistant.js';
import { ASSISTANT_MAX_TOKENS } from '../assistant-limits.js';
import { currentChat } from '../runtime.js';
import { renderCharacterSelection } from './characters.js';
import { illustrationPlans, selectedIllustration } from '../assistant-workflow.js';

const field = (label, control) => `<label class="ui-field"><span>${label}</span>${control}</label>`;
const options = (key, value, items) => `<select data-assistant="${key}" aria-label="${esc({
  source: '文字模型来源', template: '提示词模板', format: '输出格式', frequency: '配图频率', composition: '画面偏好', aspect: '配图画幅',
  responseMode: '返回方式',
}[key])}">${items.map(([id, name]) => `<option value="${id}" ${id === value ? 'selected' : ''}>${name}</option>`).join('')}</select>`;
const number = (key, label, value, min, max, step = 1) => field(label,
  `<input type="number" data-assistant="${key}" aria-label="${label}" min="${min}" max="${max}" step="${step}" value="${value}" />`);
const toggle = (key, label, value) => `<label class="setting-switch-row"><span class="setting-switch-title">${label}</span><span class="ui-toggle"><input type="checkbox" data-assistant="${key}" aria-label="${label}" ${value ? 'checked' : ''} /><span></span></span></label>`;
const command = (action, glyph, label, disabled = false, primary = false, hidden = false) => `<button type="button" data-action="${action}" class="ui-button ${primary ? 'primary' : 'secondary'}" ${disabled ? 'disabled' : ''} ${hidden ? 'hidden' : ''}>${icon(glyph)}<span>${label}</span></button>`;

export function assistantModelChoices(settings, ui) {
  const query = (ui.modelsQuery || '').trim().toLocaleLowerCase();
  const matches = ui.models.map((name, index) => ({ name, index }))
    .filter(({ name }) => !query || name.toLocaleLowerCase().includes(query));
  const current = settings.source === 'api' ? settings.model : settings.tavernModel;
  return {
    count: matches.length,
    html: matches.slice(0, 100).map(({ name, index }) => `<button type="button" data-action="assistant-pick-model"
      data-assistant-model-index="${index}" aria-pressed="${name === current}" title="${esc(name)}"><span>${esc(name)}</span>
      ${name === current ? icon('check') : ''}</button>`).join('')
      || `<p class="assistant-context">${ui.modelsBusy ? '正在读取模型列表…' : ui.models.length ? '没有匹配的模型' : '尚未读取模型列表'}</p>`,
  };
}

export function renderAssistant(state, ui, presetPanel = '', workflowPanel = '', tools = {}) {
  const a = state.assistant;
  const draft = state.assistantDraft;
  const shots = illustrationPlans(draft);
  const index = Math.min(ui.illustrationIndex || 0, Math.max(0, shots.length - 1));
  const plan = draft ? selectedIllustration(draft, index) : null;
  const busy = ui.busy;
  const full = state.experience?.level !== 'common';
  const modelChoices = assistantModelChoices(a, ui);
  return `<div class="page-heading"><div><h1>提示词助手</h1><p>${state.provider === 'novelai' ? 'NovelAI' : state.provider === 'comfyui' ? 'ComfyUI' : state.provider === 'sdwebui' ? 'SDWebUI' : 'OpenAI兼容'}</p></div>
    ${tools.status || `<span class="ui-status neutral" data-assistant-state="${busy}" role="status">${busy ? '正在处理' : '配置待核对'}</span>`}</div>
    ${tools.prompts || ''}
    <div class="assistant-workspace">
      <section class="settings-band assistant-editor" aria-label="提示词编辑">
        <div class="settings-band-heading"><h2>${icon('pencil')}画面描述</h2>${ui.binding ? '<span class="settings-label">已关联聊天消息</span>' : ''}</div>
        ${field('输入描述或提示词', `<textarea rows="5" data-assistant-input maxlength="32000" aria-label="输入描述或提示词">${esc(state.assistantInput || '')}</textarea>`)}
        <div class="assistant-grid">
          ${field('提示词模板', options('template', a.template, ASSISTANT_TEMPLATES))}
          ${field('输出格式', options('format', a.format, [['auto', '跟随生图模型'], ['tags', '英文标签'], ['natural', '英文自然语言']]))}
        </div>
        ${a.template === 'custom' ? field('自定义模板', `<textarea rows="3" data-assistant="customTemplate" maxlength="8000">${esc(a.customTemplate)}</textarea>`) : ''}
        <div class="assistant-actions">
          ${command('assistant-generate', 'sparkles', '生成提示词', busy || !state.enabled, true)}
          ${command('assistant-translate', 'arrow-left-right', '翻译', busy || !state.enabled)}
          ${command('assistant-polish', 'wand-sparkles', '润色', busy || !state.enabled)}
          ${command('assistant-use-current', 'copy', '读取当前提示词', busy)}
          ${!state.assistantInput ? command('assistant-example', 'lightbulb', '填入示例', busy) : ''}
          ${command('assistant-illustrate', 'message-square', '当前消息配图', busy || !state.enabled)}
          ${command('assistant-cancel', 'x', '取消', false, false, !busy)}
        </div>
        <p class="assistant-error" data-assistant-error role="alert" ${ui.error ? '' : 'hidden'}>${esc(ui.error)}</p>
        <div data-assistant-error-actions>${ui.error ? tools.repairs || '' : ''}</div>
        ${ui.truncated ? `<div class="assistant-actions">${command('assistant-budget-increase', 'arrow-up', '提高输出上限', busy)}
          ${command('assistant-compat-text', 'braces', '改用普通 JSON 回复', busy)}</div>` : ''}
        ${ui.failureResponse ? `<details class="assistant-failure" data-assistant-failure ${ui.failureOpen ? 'open' : ''}>
          <summary>查看最近失败的模型回复 · ${ui.failureResponse.length} 字符</summary>
          <p class="assistant-context">保存在本设备当前账号，可在“插件设置 → 草稿与恢复”中导出；开始新分析后清除。</p>
          <textarea rows="6" readonly spellcheck="false" aria-label="失败的模型回复">${esc(ui.failureResponse)}</textarea>
          ${tools.recovery || ''}
        </details>` : ''}
        ${ui.summary ? `<p class="assistant-context">上下文 ${ui.summary.messages} 条 · 角色 ${ui.summary.characters} 个 · 世界书 ${ui.summary.worldCharacters} 字</p>` : ''}
        ${renderCharacterSelection(state, currentChat(), { compact: true })}
        ${plan ? `<div class="assistant-result">
          <div class="settings-band-heading"><h2>${icon('image')}画面与提示词</h2><span class="settings-label">${plan.shouldDraw ? '可生成' : '无需配图'}</span></div>
          ${shots.length > 1 ? `<div class="assistant-shot-tabs" role="tablist" aria-label="配图画面">${shots.map((shot, shotIndex) =>
            `<button type="button" role="tab" data-action="assistant-select-shot" data-shot-index="${shotIndex}" aria-selected="${index === shotIndex}" title="${esc(shot.scene || `画面 ${shotIndex + 1}`)}">画面 ${shotIndex + 1}</button>`).join('')}</div>` : ''}
          ${field('画面', `<textarea rows="2" data-assistant-result="scene" maxlength="2000" aria-label="画面">${esc(plan.scene || '')}</textarea>`)}
          ${ui.binding || plan.anchor ? field('原文定位句', `<textarea rows="2" data-assistant-result="anchor" maxlength="1000" aria-label="原文定位句">${esc(plan.anchor || '')}</textarea>`) : ''}
          ${field('正向提示词', `<textarea rows="5" data-assistant-result="positive" maxlength="32000" aria-label="助手正向提示词">${esc(plan.positive || '')}</textarea>`)}
          ${field('负面提示词', `<textarea rows="3" data-assistant-result="negative" maxlength="32000" aria-label="助手负面提示词">${esc(plan.negative || '')}</textarea>`)}
          ${(plan.characters || []).map((entry) => {
            const sceneEntry = plan.characterScene?.entries?.find((item) => item.profileId === entry.profileId);
            const profile = sceneEntry?.profile;
            const name = profile?.name || entry.profileId;
            const appearance = profile?.lockAppearance ? [profile.tags, profile.hair, profile.eyes, profile.body, profile.features].filter(Boolean).join(', ') : entry.appearance;
            const outfit = profile?.lockOutfit ? profile.outfits.find((item) => item.id === sceneEntry.outfitId)?.prompt || '' : entry.outfit;
            return `<div class="character-scene-row"><strong>${esc(name)}</strong><div class="assistant-grid">
              ${field('角色动作', `<input data-assistant-character="${entry.profileId}" data-character-result="action" aria-label="${esc(name)}助手动作" maxlength="1000" value="${esc(entry.action)}" />`)}
              ${field('角色表情', `<input data-assistant-character="${entry.profileId}" data-character-result="expression" aria-label="${esc(name)}助手表情" maxlength="500" value="${esc(entry.expression)}" />`)}
            </div><details><summary>角色外貌与服装</summary>
              ${field('角色外貌', `<textarea data-assistant-character="${entry.profileId}" data-character-result="appearance" aria-label="${esc(name)}助手外貌" rows="2" maxlength="4000" ${profile?.lockAppearance ? 'readonly' : ''}>${esc(appearance)}</textarea>`)}
              ${field('角色服装', `<textarea data-assistant-character="${entry.profileId}" data-character-result="outfit" aria-label="${esc(name)}助手服装" rows="2" maxlength="4000" ${profile?.lockOutfit ? 'readonly' : ''}>${esc(outfit)}</textarea>`)}
              ${field('角色负面词', `<input data-assistant-character="${entry.profileId}" data-character-result="negative" aria-label="${esc(name)}助手负面词" maxlength="1000" value="${esc(entry.negative)}" />`)}
            </details></div>`;
          }).join('')}
          ${plan.reason ? `<p class="assistant-context">${esc(plan.reason)}</p>` : ''}
          ${tools.lint || ''}
          ${tools.scene || ''}
          <div class="assistant-actions">${command('assistant-apply', 'replace', '载入生图参数', busy || !plan.positive)}
            ${command('assistant-workshop', 'arrow-right', '带入生图工坊', busy || !plan.positive)}
            ${command('assistant-comic', 'panels-top-left', '带入漫画剧情', busy)}
            ${command('assistant-draw', 'image-plus', '生成图片', busy || !plan.positive || !state.enabled, true)}
            ${shots.length > 1 && ui.binding?.slot === 0 ? command('assistant-draw-all', 'images', '生成全部配图', busy || !state.enabled) : ''}
            ${command('assistant-copy', 'copy', '复制提示词', !plan.positive)}
            ${ui.binding ? command('assistant-save-draft', 'save', '保存聊天草稿', busy) : ''}
          </div>
        </div>` : ''}
        ${tools.history || ''}
        ${tools.diagnostics || ''}
      </section>
      <section class="settings-band assistant-configuration" aria-label="助手配置">
        ${tools.schemes || ''}
        <div class="settings-band-heading"><h2>${icon('plug')}文字模型</h2></div>
        ${field('文字模型来源', options('source', a.source, [['tavern', '跟随酒馆'], ['api', '独立 API']]))}
        ${a.source === 'api' ? `
          ${field('连接方式', options('apiTransport', a.apiTransport, [['direct', '设备直连'], ['tavern', '酒馆转发']]))}
          <p class="assistant-context">${a.apiTransport === 'tavern' ? '由酒馆连接下方接口，使用这里的密钥和模型。请确认酒馆所在设备或服务器能访问接口。' : '由当前设备直接连接下方接口。'}</p>
          ${field('文字接口地址', `<input type="url" data-assistant="endpoint" aria-label="文字接口地址" maxlength="512" placeholder="https://你的域名/v1" value="${esc(a.endpoint)}" />`)}
          ${field('API Key', `<div class="input-with-button"><input type="${ui.keyVisible ? 'text' : 'password'}" data-assistant-key aria-label="助手 API Key" autocomplete="off" maxlength="4096" value="${esc(ui.key)}" /><button type="button" class="ui-icon-button" data-action="assistant-toggle-key" title="${ui.keyVisible ? '隐藏秘钥' : '显示秘钥'}" aria-label="${ui.keyVisible ? '隐藏助手秘钥' : '显示助手秘钥'}">${icon(ui.keyVisible ? 'eye-off' : 'eye')}</button></div>`)}
          <p class="assistant-context" data-assistant-key-status>${esc(ui.keyStatus || '')}</p>
          ${number('temperature', '温度', a.temperature, 0, 2, 0.1)}
          ` : ''}
        <div class="ui-field assistant-model-field"><label for="assistant-model-input">文字模型</label>
          <div class="input-with-button"><input id="assistant-model-input" data-assistant="${a.source === 'api' ? 'model' : 'tavernModel'}" aria-label="助手文字模型" maxlength="200" autocomplete="off" autocapitalize="off" spellcheck="false"
            placeholder="${esc(a.source === 'api' ? '输入或选择模型' : ui.tavernCurrent ? `跟随当前模型：${ui.tavernCurrent}` : '跟随酒馆当前模型')}" value="${esc(a.source === 'api' ? a.model : a.tavernModel)}" />
            <button type="button" class="ui-icon-button" data-action="assistant-toggle-models" title="选择文字模型" aria-label="选择文字模型" aria-expanded="${Boolean(ui.modelsOpen)}" aria-controls="assistant-model-picker">${icon('chevron-down')}</button>
            <button type="button" class="ui-icon-button" data-action="assistant-models" title="获取文字模型列表" aria-label="获取文字模型列表" ${ui.modelsBusy ? 'disabled' : ''}>${icon('refresh-cw', ui.modelsBusy ? 'spin' : '')}</button></div>
          <div class="assistant-model-picker" id="assistant-model-picker" ${ui.modelsOpen ? '' : 'hidden'}>
            <input type="search" data-assistant-model-search aria-label="搜索助手模型" placeholder="搜索模型" maxlength="200" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(ui.modelsQuery || '')}" />
            <p class="assistant-context" data-assistant-model-count>匹配 ${modelChoices.count} 个${modelChoices.count > 100 ? ' · 显示前 100 个' : ''}</p>
            <div class="assistant-model-list" data-assistant-model-list role="group" aria-label="助手模型列表">${modelChoices.html}</div>
          </div>
        </div>
        <p class="assistant-context" data-assistant-model-status role="status">${esc(ui.modelsStatus || '')}</p>
        <p class="assistant-error" data-assistant-model-error role="alert" ${ui.modelsError ? '' : 'hidden'}>${esc(ui.modelsError || '')}</p>
        ${a.source === 'api' ? `<div class="assistant-actions">${command('assistant-network', 'scan', '检测助手网络')}</div>` : ''}
        <div class="assistant-grid">${number('maxTokens', '最大输出 Token', a.maxTokens, 256, ASSISTANT_MAX_TOKENS)}${number('timeout', '超时（秒）', a.timeout, 15, 300)}</div>
        <div data-assistant-budget role="status">${tools.budget || ''}</div>
        <div class="assistant-actions">${command('assistant-budget-preview', 'list-checks', '估算本次请求', busy)}</div>
        ${field('返回方式', options('responseMode', a.responseMode, [['text', '普通 JSON 回复'], ['json', '接口 JSON 模式'], ['tool', '工具调用']]))}
        ${tools.compatibility || ''}
        ${presetPanel}
        <details class="assistant-expert" data-experience-fold="workflow" ${full ? 'open' : ''}><summary>高级消息编排</summary>${workflowPanel}</details>
        <details class="assistant-expert" data-experience-fold="context" ${full ? 'open' : ''}><summary>上下文与角色状态</summary>
        <div class="settings-band-heading"><h2>${icon('message-square')}上下文</h2></div>
        <div class="assistant-grid">${number('contextMessages', '最近消息数', a.contextMessages, 1, 40)}${number('contextCharacters', '聊天字符上限', a.contextCharacters, 2000, 60000)}</div>
        ${toggle('includeCharacters', '参考角色卡', a.includeCharacters)}
        ${toggle('includeWorld', '参考世界书', a.includeWorld)}
        ${toggle('rememberState', '记录动态角色状态', a.rememberState)}
        ${tools.context || ''}
        ${ui.stateWarning ? `<p class="assistant-error" role="status">${esc(ui.stateWarning)}</p>` : ''}
        ${field('补充固定外貌', `<textarea rows="3" data-assistant="appearance" maxlength="4000">${esc(a.appearance)}</textarea>`)}
        </details>
        <div class="settings-band-heading"><h2>${icon('wand-sparkles')}智能配图</h2></div>
        ${toggle('autoPrompt', '自动准备配图提示词', a.autoPrompt)}
        ${toggle('autoImage', '准备后自动生图', a.autoImage)}
        ${field('配图频率', options('frequency', a.frequency, [['scene', '仅有适合画面的剧情'], ['each', '每条新回复'], ['interval', '每隔指定回复数']]))}
        ${a.frequency === 'interval' ? number('every', '回复间隔', a.every, 1, 50) : ''}
        ${field('画面偏好', options('composition', a.composition, [['balanced', '剧情构图'], ['closeup', '人物特写'], ['fullbody', '人物全身'], ['environment', '环境全景']]))}
        ${number('illustrationCount', '每条回复规划画面数', a.illustrationCount, 1, 4)}
        <div class="assistant-grid">${number('count', '每个画面生图张数', a.count, 1, 4)}
          ${field('配图画幅', options('aspect', a.aspect, [['keep', '保留接口尺寸'], ['auto', '由助手规划'], ['portrait', '竖图'], ['landscape', '横图'], ['square', '方图']]))}</div>
      </section>
    </div>`;
}
