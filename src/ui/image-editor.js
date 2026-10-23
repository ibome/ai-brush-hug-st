import { escapeHtml as esc } from '../config.js';
import { icon } from '../icons.js';
import { normalizeNovelAIState, renderNovelAIParameters } from './novelai.js';
import { renderOpenAIParameters } from './openai.js';
import { renderComfyParameters } from './comfyui.js';
import { renderSDWebUIParameters } from './sdwebui.js';
import { normalizeVersion } from '../../server/linghuashi-storage/image-versions.mjs';

const command = (name, label, action, disabled = false) => `<button type="button" class="ui-button" data-action="${action}" ${disabled ? 'disabled' : ''}>${icon(name)}<span>${label}</span></button>`;

export function renderImageEditor(item, ui, advancedHTML = '') {
  const snapshot = ui.draft;
  const local = { novelai: snapshot.params, novelaiPresets: [], novelaiPresetId: 'default', openai: snapshot.params, comfyui: snapshot.config,
    sdwebui: snapshot.params, sdwebuiPresets: [], sdwebuiPresetId: 'default' };
  let parameters;
  if (snapshot.provider === 'novelai') {
    normalizeNovelAIState(local);
    parameters = renderNovelAIParameters(local, ui.advanced);
  } else if (snapshot.provider === 'openai') parameters = renderOpenAIParameters(local, [], ui.advanced);
  else if (snapshot.provider === 'sdwebui') parameters = renderSDWebUIParameters(local, null, ui.advanced);
  else parameters = renderComfyParameters(local, null, ui.advanced);
  const version = normalizeVersion(item.version, item.id);
  const roles = snapshot.characterScene?.characterPrompts || [];
  return `<dialog class="image-editor" data-image-id="${esc(item.id)}" aria-labelledby="image-editor-title">
    <header><div><h2 id="image-editor-title">单图编辑</h2><span>版本 ${version.number} · ${esc(({ novelai: 'NovelAI', openai: 'OpenAI兼容', comfyui: 'ComfyUI', sdwebui: 'SDWebUI' })[snapshot.provider])}</span></div>
    ${command('x', '关闭', 'image-edit-close')}</header>
    <div class="image-editor-body"><aside><img src="${item.src}" alt="${esc(item.title)}" /><p>${esc(item.title)}</p>
      <div class="advanced-upload-actions">${command('image-plus', '以这张图继续画', 'image-edit-source', ui.busy || ui.submitting)}${command('brush', '局部重绘', 'image-edit-inpaint', ui.busy || ui.submitting)}${command('wand-sparkles', '图片增强', 'image-edit-enhance', ui.busy || ui.submitting)}</div>
      <label class="ui-field"><span>版本备注</span><textarea data-image-edit-note rows="2" maxlength="1000">${esc(ui.note)}</textarea></label>
      <section class="image-edit-assistant"><label class="ui-field"><span>想怎么修改</span><textarea data-image-edit-instruction rows="3" maxlength="8000" placeholder="例如：换成白色裙子，保留发型和场景">${esc(ui.instruction)}</textarea></label>
        ${command(ui.busy ? 'loader-circle' : 'wand-sparkles', ui.busy ? '处理中' : 'AI 修改提示词', 'image-edit-rewrite', ui.busy)}
        ${ui.busy ? command('x', '取消处理', 'image-edit-cancel') : ''}
      </section></aside>
      <fieldset ${ui.busy || ui.submitting ? 'disabled' : ''}><div class="image-edit-parameters">${advancedHTML}${parameters}</div>
      ${roles.length ? `<section class="image-edit-roles"><h3>本图角色提示词</h3>${roles.map((role, index) => `<div>
        <label class="ui-field"><span>${esc(role.name)} · 正向提示词</span><textarea rows="3" maxlength="12000" data-image-edit-role="${index}" data-role-field="positive">${esc(role.positive)}</textarea></label>
        <label class="ui-field"><span>${esc(role.name)} · 负面提示词</span><textarea rows="2" maxlength="4000" data-image-edit-role="${index}" data-role-field="negative">${esc(role.negative)}</textarea></label>
        <label class="ui-field"><span>${esc(role.name)} · 画面位置</span><select data-image-edit-role="${index}" data-role-field="position">${['auto', 'left', 'center', 'right', 'top', 'bottom'].map((position) => `<option value="${position}" ${role.position === position ? 'selected' : ''}>${({ auto: '自动', left: '左侧', center: '中央', right: '右侧', top: '上方', bottom: '下方' })[position]}</option>`).join('')}</select></label>
      </div>`).join('')}</section>` : ''}</fieldset></div>
    <footer><span class="image-edit-status" role="status">${esc(ui.error)}</span><div>${command('rotate-ccw', '恢复原参数', 'image-edit-reset', ui.busy || ui.submitting)}${command('sparkles', ui.submitting ? '正在加入任务' : '重绘为新版本', 'image-edit-generate', ui.busy || ui.submitting)}</div></footer>
  </dialog>`;
}
