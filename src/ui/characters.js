import { escapeHtml as esc } from '../config.js';
import { icon } from '../icons.js';
import { effectiveProfiles, POSITION_OPTIONS, resolveCharacterScene } from '../character-profiles.js';

const command = (action, glyph, label, disabled = false, primary = false) =>
  `<button type="button" class="ui-button ${primary ? 'primary' : 'secondary'}" data-action="${action}" ${disabled ? 'disabled' : ''}>${icon(glyph)}<span>${label}</span></button>`;
const field = (label, content) => `<label class="ui-field"><span>${label}</span>${content}</label>`;
const input = (key, label, value, limit = 800) => field(label,
  `<input data-profile-field="${key}" aria-label="${label}" maxlength="${limit}" value="${esc(value)}" />`);
const area = (key, label, value, rows = 2, limit = 4000) => field(label,
  `<textarea data-profile-field="${key}" aria-label="${label}" rows="${rows}" maxlength="${limit}">${esc(value)}</textarea>`);
const toggle = (key, label, checked) => `<label class="setting-switch-row"><span class="setting-switch-title">${label}</span>
  <span class="ui-toggle"><input type="checkbox" data-profile-field="${key}" aria-label="${label}" ${checked ? 'checked' : ''} /><span></span></span></label>`;

export function renderCharacterSelection(state, chat, { compact = false, frozen = false } = {}) {
  const db = state.characterProfiles;
  const profiles = effectiveProfiles(db, chat?.key);
  const scene = resolveCharacterScene(db, chat?.key, chat?.avatars || []);
  const automatic = Boolean(chat?.key && db.chats.find((item) => item.chatKey === chat.key)?.selection == null);
  return `<section class="character-selection ${compact ? 'compact' : ''}" aria-label="出场人物">
    <div class="settings-band-heading"><h2>${icon('users-round')}出场人物</h2>
      <span class="settings-label">${chat?.key ? esc(chat.name) : '生图工坊'} · ${scene.entries.length} / 6</span></div>
    ${frozen ? `<div class="character-frozen"><span>${icon('history')}已载入图片角色快照</span>${command('profile-live-scene', 'rotate-ccw', '使用当前档案')}</div>` : ''}
    ${chat?.key ? `<label class="character-auto"><input type="checkbox" data-profile-auto aria-label="自动关联当前聊天角色" ${automatic ? 'checked' : ''} />自动关联当前聊天角色</label>` : ''}
    <div class="character-checks">${profiles.filter((profile) => profile.enabled).map((profile) =>
      `<label><input type="checkbox" data-profile-participant="${profile.id}" aria-label="出场：${esc(profile.name)}" ${scene.entries.some((entry) => entry.profileId === profile.id) ? 'checked' : ''} /><span>${esc(profile.name)}</span></label>`).join('') || '<p class="assistant-context">暂无已启用的角色档案</p>'}</div>
    ${!compact ? scene.entries.map((entry) => `<div class="character-scene-row" data-scene-row="${entry.profileId}">
      <strong>${esc(entry.profile.name)}</strong>
      <div class="character-form-grid">
        ${field('服装', `<select data-participant-field="outfitId" data-profile-id="${entry.profileId}" aria-label="${esc(entry.profile.name)}服装"><option value="">无服装</option>${entry.profile.outfits.map((outfit) => `<option value="${outfit.id}" ${entry.outfitId === outfit.id ? 'selected' : ''}>${esc(outfit.name)}</option>`).join('')}</select>`)}
        ${field('画面位置', `<select data-participant-field="position" data-profile-id="${entry.profileId}" aria-label="${esc(entry.profile.name)}画面位置">${POSITION_OPTIONS.map(([id, title]) => `<option value="${id}" ${entry.position === id ? 'selected' : ''}>${title}</option>`).join('')}</select>`)}
        ${field('动作', `<input data-participant-field="action" data-profile-id="${entry.profileId}" aria-label="${esc(entry.profile.name)}动作" maxlength="1000" value="${esc(entry.action)}" />`)}
        ${field('表情', `<input data-participant-field="expression" data-profile-id="${entry.profileId}" aria-label="${esc(entry.profile.name)}表情" maxlength="500" value="${esc(entry.expression)}" />`)}
      </div>
      ${field('本次正向标签', `<input data-participant-field="positive" data-profile-id="${entry.profileId}" aria-label="${esc(entry.profile.name)}本次正向标签" maxlength="2000" value="${esc(entry.positive)}" />`)}
      ${field('本次负面标签', `<input data-participant-field="negative" data-profile-id="${entry.profileId}" aria-label="${esc(entry.profile.name)}本次负面标签" maxlength="1000" value="${esc(entry.negative)}" />`)}
    </div>`).join('') : ''}
    ${compact ? command('profiles-open', 'users-round', '编辑角色档案') : ''}
  </section>`;
}

export function renderCharacters(state, ui, chat) {
  const db = state.characterProfiles, draft = ui.draft;
  const profiles = ui.scope === 'chat' ? effectiveProfiles(db, chat?.key) : db.profiles;
  const overridden = db.chats.find((item) => item.chatKey === chat?.key)?.overrides.some((item) => item.id === draft?.id);
  const options = [...ui.characters];
  if (draft?.avatar && !options.some((item) => item.avatar === draft.avatar)) options.push({ avatar: draft.avatar, name: '已关联角色卡' });
  return `<div class="page-heading"><div><h1>多角色档案</h1><p>${profiles.length} 个档案${ui.dirty ? ' · 有未保存的修改' : ''}</p></div>
    <div class="assistant-actions">${command('profile-ai-open', 'wand-sparkles', 'AI 创建档案', false, true)}
    ${command('new-character', 'plus', '新建角色', db.profiles.length >= 100 || ui.scope === 'chat')}</div></div>
    <div class="character-toolbar">
      <div class="character-scope" role="group" aria-label="档案范围">
        <button type="button" data-profile-scope="global" aria-pressed="${ui.scope === 'global'}">全局档案</button>
        <button type="button" data-profile-scope="chat" aria-pressed="${ui.scope === 'chat'}" ${chat?.key ? '' : 'disabled'}>当前聊天覆盖</button>
      </div>
      <div class="assistant-actions">${command('profile-refresh-cards', 'refresh-cw', '读取酒馆角色', ui.busy)}
        ${command('profile-export', 'download', '导出档案', !profiles.length)}
        ${command('profile-import', 'upload', '导入档案')}
        <input type="file" data-profile-import accept=".json,application/json" hidden /></div>
    </div>
    ${ui.error ? `<p class="assistant-error" role="alert">${esc(ui.error)}</p>` : ''}
    <div class="character-workspace">
      <aside class="character-directory" aria-label="档案列表">${profiles.map((profile) => {
        const linked = options.find((item) => item.avatar === profile.avatar);
        return `<button type="button" data-profile-select="${profile.id}" aria-pressed="${draft?.id === profile.id}">
          ${icon(profile.avatar ? 'user-round-check' : 'user-round')}<span><strong>${esc(profile.name)}</strong><small>${profile.enabled ? linked?.name || (profile.avatar ? '已关联角色卡' : '未关联角色卡') : '已停用'}</small></span></button>`;
      }).join('') || '<p class="assistant-context">暂无角色档案</p>'}</aside>
      <section class="character-editor" aria-label="角色档案编辑">
        ${draft ? `
          <div class="settings-band-heading"><h2>${icon('user-round')}${esc(draft.name)}</h2><span class="settings-label">${ui.scope === 'chat' ? overridden ? '聊天覆盖' : '继承全局' : '全局'}</span></div>
          <div class="character-form-grid">
            ${input('name', '档案名称', draft.name, 120)}
            ${field('关联酒馆角色卡', `<select data-profile-field="avatar" aria-label="关联酒馆角色卡"><option value="">不关联</option>${options.map((item) => `<option value="${esc(item.avatar)}" ${draft.avatar === item.avatar ? 'selected' : ''}>${esc(item.name)}${item.current ? ' · 当前' : ''}</option>`).join('')}</select>`)}
          </div>
          ${toggle('enabled', '启用此档案', draft.enabled)}
          <div class="character-form-grid">${input('hair', '头发', draft.hair)}${input('eyes', '眼睛', draft.eyes)}${input('body', '体型', draft.body)}${input('features', '辨识特征', draft.features, 1600)}</div>
          ${area('tags', '固定外貌标签', draft.tags, 3)}
          ${area('negative', '角色负面标签', draft.negative, 2, 2000)}
          <div class="profile-reference"><div class="settings-band-heading"><h2>${icon('image')}人物参考图</h2></div>
            ${draft.reference ? `<p>${esc(draft.reference.name)} · ${draft.reference.width} × ${draft.reference.height}</p>` : ''}
            <div class="assistant-actions">${command('profile-reference-upload', 'image-plus', '上传参考图')}
              ${command('profile-reference-use', 'user-round-check', '设为人物参考', !draft.reference)}
              ${command('profile-reference-remove', 'x', '移除参考图', !draft.reference)}</div>
            <input type="file" data-profile-reference-file accept="image/png,image/jpeg,image/webp" hidden />
          </div>
          ${toggle('lockAppearance', '锁定固定外貌', draft.lockAppearance)}
          <div class="settings-band-heading"><h2>${icon('shirt')}服装方案</h2>${command('profile-new-outfit', 'plus', '添加服装', draft.outfits.length >= 20)}</div>
          ${field('默认服装', `<select data-profile-field="defaultOutfitId" aria-label="默认服装"><option value="">无服装</option>${draft.outfits.map((outfit) => `<option value="${outfit.id}" ${outfit.id === draft.defaultOutfitId ? 'selected' : ''}>${esc(outfit.name)}</option>`).join('')}</select>`)}
          ${draft.outfits.map((outfit) => `<div class="character-outfit">
            ${field('服装名称', `<input data-profile-outfit="${outfit.id}" data-outfit-field="name" aria-label="服装名称" maxlength="80" value="${esc(outfit.name)}" />`)}
            ${field('服装提示词', `<textarea data-profile-outfit="${outfit.id}" data-outfit-field="prompt" aria-label="服装提示词" rows="2" maxlength="4000">${esc(outfit.prompt)}</textarea>`)}
            <button type="button" class="ui-icon-button" data-action="profile-delete-outfit" data-outfit-id="${outfit.id}" title="删除服装" aria-label="删除服装">${icon('trash-2')}</button>
          </div>`).join('')}
          ${toggle('lockOutfit', '锁定所选服装', draft.lockOutfit)}
          <div class="assistant-actions">
            ${command('save-character', 'save', ui.scope === 'chat' ? '保存聊天覆盖' : '保存档案', false, true)}
            ${command('profile-discard', 'rotate-ccw', '撤销修改', !ui.dirty)}
            ${ui.scope === 'chat' ? command('profile-clear-override', 'unlink', '恢复全局档案', !overridden) : command('profile-delete', 'trash-2', '删除档案', !db.profiles.some((profile) => profile.id === draft.id))}
          </div>` : ''}
      </section>
    </div>
    ${renderCharacterSelection(state, chat, { frozen: Boolean(state.characterSceneOverride?.entries?.length) })}`;
}
