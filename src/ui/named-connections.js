import { escapeHtml as esc } from '../config.js';
import { icon } from '../icons.js';
import { normalizeConnection } from '../connections.js';

export function renderNamedConnections(state, manage = false) {
  const provider = state.provider, entries = state.connectionProfiles[provider], id = state.connectionProfileIds[provider];
  const selected = entries.find((entry) => entry.id === id);
  const dirty = selected && JSON.stringify(selected.connection) !== JSON.stringify(normalizeConnection(provider, state.connections[provider]));
  const command = (name, title, action, disabled = false) => `<button type="button" class="ui-icon-button" data-action="${action}" title="${title}" aria-label="${title}" ${disabled ? 'disabled' : ''}>${icon(name)}</button>`;
  return `<div class="named-connections">
    <label class="ui-field"><span>命名接口${dirty ? '<small> · 当前连接有修改</small>' : ''}</span><select data-connection-profile><option value="" ${!selected ? 'selected' : ''}>未保存的当前接口</option>${entries.map((entry) => `<option value="${esc(entry.id)}" ${entry.id === id ? 'selected' : ''}>${esc(entry.name)}</option>`).join('')}</select></label>
    ${manage ? `<div class="named-connection-actions">${command('plus', '新增接口', 'connection-new')}${command('save', '保存当前接口', 'connection-save', !selected)}${command('copy-plus', '复制当前连接', 'connection-copy')}${command('pencil', '重命名接口', 'connection-rename', !selected)}${command('trash-2', '删除接口配置', 'connection-delete', !selected)}</div>` : ''}
  </div>`;
}

export function renderPresetBinding(state) {
  const provider = state.provider, binding = state.presetBindings[provider];
  return `<label class="ui-field preset-binding"><span>预设关联接口</span><select data-preset-binding><option value="" ${!binding ? 'selected' : ''}>仅保存参数 · 保留当前接口</option>
    <option value="legacy" ${binding === 'legacy' ? 'selected' : ''}>保存当前接口与秘钥快照</option>
    ${state.connectionProfiles[provider].map((entry) => `<option value="${esc(entry.id)}" ${binding === entry.id ? 'selected' : ''}>绑定：${esc(entry.name)}</option>`).join('')}</select></label>`;
}
