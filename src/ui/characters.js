import { escapeHtml as esc } from '../config.js';
import { icon } from '../icons.js';
import { effectiveProfiles, POSITION_OPTIONS, resolveCharacterScene, OUTFIT_MODES, effectiveOutfit } from '../character-profiles.js';
import { pendingOutfitDrafts } from '../outfit-drafts.js';
import { POSITION_GRID, characterLimit, characterPositionLabel } from '../character-layout.js';
import { draftCharacterScene } from '../character-scene-editor.js';

const command = (action, glyph, label, disabled = false, primary = false) =>
  `<button type="button" class="ui-button ${primary ? 'primary' : 'secondary'}" data-action="${action}" ${disabled ? 'disabled' : ''}>${icon(glyph)}<span>${label}</span></button>`;
const field = (label, content) => `<label class="ui-field"><span>${label}</span>${content}</label>`;
const input = (key, label, value, limit = 800) => field(label,
  `<input data-profile-field="${key}" aria-label="${label}" maxlength="${limit}" value="${esc(value)}" />`);
const area = (key, label, value, rows = 2, limit = 4000) => field(label,
  `<textarea data-profile-field="${key}" aria-label="${label}" rows="${rows}" maxlength="${limit}">${esc(value)}</textarea>`);
const toggle = (key, label, checked) => `<label class="setting-switch-row"><span class="setting-switch-title">${label}</span>
  <span class="ui-toggle"><input type="checkbox" data-profile-field="${key}" aria-label="${label}" ${checked ? 'checked' : ''} /><span></span></span></label>`;

export function refreshOutfitDraftFeedback(row, entry, draft) {
  const pending = pendingOutfitDrafts({ entries: entry ? [entry] : [] }, { [entry?.profileId]: draft }).length > 0;
  const status = row.querySelector('[data-outfit-pending]');
  if (status) status.hidden = !pending;
  const apply = row.querySelector('[data-outfit-apply]');
  if (apply) apply.disabled = !pending;
  const discard = row.querySelector('[data-outfit-discard]');
  if (discard) discard.disabled = !draft;
}

export function renderOutfitControls(entry, draft, { chat = false, project = false } = {}) {
  const hasDraft = Boolean(draft), pending = pendingOutfitDrafts({ entries: [entry] }, { [entry.profileId]: draft }).length > 0;
  draft ||= {};
  const mode = draft.mode || entry.outfitMode || 'inherit', outfitId = draft.outfitId ?? entry.outfitId;
  const scope = draft.scope || 'once', prompt = draft.prompt ?? entry.outfitPrompt ?? '';
  const selected = (id, value) => id === value ? 'selected' : '';
  const outfit = effectiveOutfit(entry);
  const scopeName = { once: '仅下一次生图', chat: '当前聊天', global: '全局默认', project: '当前漫画项目' }[entry.outfitScope] || '当前场景';
  return `<div class="outfit-controls" data-outfit-row="${entry.profileId}" ${project ? 'data-outfit-project' : ''}>
    <div class="character-form-grid">
      ${field('服装方式', `<select data-outfit-field="mode" aria-label="${esc(entry.profile.name)}服装方式">${OUTFIT_MODES.map(([id, title]) => `<option value="${id}" ${selected(id, mode)}>${title}</option>`).join('')}</select>`)}
      ${project ? '' : field('应用范围', `<select data-outfit-field="scope" aria-label="${esc(entry.profile.name)}服装应用范围"><option value="once" ${selected('once', scope)}>仅下一次生图</option>${chat ? `<option value="chat" ${selected('chat', scope)}>当前聊天</option>` : ''}<option value="global" ${selected('global', scope)}>全局默认</option></select>`)}
      ${mode === 'wardrobe' ? field('服装库', `<select data-outfit-field="outfitId" aria-label="${esc(entry.profile.name)}选择服装"><option value="">请选择服装</option>${entry.profile.outfits.map((row) => `<option value="${row.id}" ${selected(row.id, outfitId)}>${esc(row.name)}</option>`).join('')}</select>`) : ''}
    </div>
    ${mode === 'custom' ? field('自定义服装提示词', `<textarea data-outfit-field="prompt" rows="2" maxlength="4000" aria-label="${esc(entry.profile.name)}自定义服装提示词">${esc(prompt)}</textarea>`) : ''}
    <div class="assistant-actions"><button type="button" class="ui-button secondary" data-outfit-apply ${project ? 'data-comic-action="outfit-apply"' : 'data-action="profile-apply-outfit"'} data-profile-id="${entry.profileId}" ${pending ? '' : 'disabled'}>${icon('shirt')}<span>应用服装</span></button>
      <button type="button" class="ui-icon-button" data-outfit-discard ${project ? 'data-comic-action="outfit-discard"' : 'data-action="profile-discard-outfit"'} data-profile-id="${entry.profileId}" title="撤销未应用的服装修改" aria-label="${esc(entry.profile.name)}撤销未应用服装" ${hasDraft ? '' : 'disabled'}>${icon('undo-2')}</button>
      <span class="outfit-pending" data-outfit-pending role="status" ${pending ? '' : 'hidden'}>有未应用修改</span></div>
    <p class="outfit-effective" data-outfit-effective>${esc(scopeName)} · ${outfit.locked ? '固定服装' : '可随剧情变化'}：${esc(outfit.prompt || (outfit.mode === 'ai' ? '由 AI 决定' : '未指定'))}</p>
  </div>`;
}

export function renderCharacterSelection(state, chat, { compact = false, frozen = false, outfitDrafts = {}, manage = true } = {}) {
  const db = state.characterProfiles;
  const profiles = effectiveProfiles(db, chat?.key).filter((profile) => profile.enabled);
  frozen = frozen && Boolean(state.characterSceneOverride);
  const scene = frozen ? draftCharacterScene(state.characterSceneOverride) : resolveCharacterScene(db, chat?.key, chat?.avatars || []);
  const recorded = frozen ? scene.entries.filter((entry) => !profiles.some((profile) => profile.id === entry.profileId)) : [];
  const choices = [...profiles, ...recorded.map((entry) => entry.profile)];
  const temporary = frozen && scene.entries.some((entry) => entry.outfitScope === 'once');
  const automatic = !frozen && Boolean(chat?.key && db.chats.find((item) => item.chatKey === chat.key)?.selection == null);
  const params = state.provider === 'comfyui' ? state.comfyui.params : state[state.provider];
  const limit = characterLimit(state.provider, params?.model);
  return `<section class="character-selection ${compact ? 'compact' : ''}" aria-label="出场人物">
    <div class="settings-band-heading"><h2>${icon('users-round')}出场人物</h2>
      <span class="settings-label">${chat?.key ? esc(chat.name) : '生图工坊'} · ${scene.entries.length} / ${limit}</span></div>
    ${frozen ? `<div class="character-frozen"><span>${icon(temporary ? 'shirt' : 'history')}${temporary ? '本次人物配置 · 含临时服装' : '本次人物配置 · 与档案库独立'}</span>${command('profile-live-scene', 'rotate-ccw', temporary ? '清除本次人物调整' : '使用当前档案')}</div>` : ''}
    ${chat?.key ? `<label class="character-auto"><input type="checkbox" data-profile-auto aria-label="自动关联当前聊天角色" ${automatic ? 'checked' : ''} />自动关联当前聊天角色</label>` : ''}
    <div class="character-checks">${choices.map((profile) =>
      `<label><input type="checkbox" data-profile-participant="${profile.id}" aria-label="出场：${esc(profile.name)}" ${scene.entries.some((entry) => entry.profileId === profile.id) ? 'checked' : ''} /><span>${esc(profile.name)}${recorded.some((entry) => entry.profileId === profile.id) ? ' · 图片记录' : ''}</span></label>`).join('') || '<p class="assistant-context">暂无已启用的角色档案</p>'}</div>
    ${manage && !compact && !choices.length ? `<div class="assistant-actions">${command('profiles-open', 'users-round', db.profiles.length ? '管理角色档案' : '创建角色档案')}${!db.profiles.length ? command('profile-ai-open', 'wand-sparkles', 'AI 创建档案') : ''}</div>` : ''}
    ${frozen && !scene.entries.length ? '<p class="assistant-context" role="status">本次未附加角色档案</p>' : ''}
    ${scene.entries.length > limit ? `<p class="assistant-error" role="alert">已选人数超过当前模型的 ${limit} 人上限，请减少出场角色。</p>` : ''}
    ${!compact && scene.entries.length > 1 ? `<div class="assistant-actions" aria-label="人物布局">
      <button type="button" class="ui-button secondary" data-action="profile-layout" data-layout="row">${icon('columns-3')}<span>并排站位</span></button>
      <button type="button" class="ui-icon-button" data-action="profile-layout" data-layout="reverse" title="交换人物站位" aria-label="交换人物站位">${icon('arrow-left-right')}</button>
      <button type="button" class="ui-icon-button" data-action="profile-layout" data-layout="auto" title="恢复自动站位" aria-label="恢复自动站位">${icon('rotate-ccw')}</button></div>` : ''}
    ${!compact ? scene.entries.map((entry) => `<div class="character-scene-row" data-scene-row="${entry.profileId}">
      <strong>${esc(entry.profile.name)}</strong>
      <div class="character-form-grid">
        ${field('出场方式', `<select data-participant-field="participation" data-profile-id="${entry.profileId}" aria-label="${esc(entry.profile.name)}出场方式"><option value="story" ${entry.participation !== 'always' ? 'selected' : ''}>随剧情出场</option><option value="always" ${entry.participation === 'always' ? 'selected' : ''}>固定出场</option></select>`)}
        ${field('画面位置', `<select data-participant-field="position" data-profile-id="${entry.profileId}" aria-label="${esc(entry.profile.name)}画面位置">${[...POSITION_OPTIONS, ...(POSITION_GRID.includes(entry.position) ? [[entry.position, `网格 ${entry.position}`]] : [])].map(([id, title]) => `<option value="${id}" ${entry.position === id ? 'selected' : ''}>${title}</option>`).join('')}</select>`)}
        ${field('动作', `<input data-participant-field="action" data-profile-id="${entry.profileId}" aria-label="${esc(entry.profile.name)}动作" maxlength="1000" value="${esc(entry.action)}" />`)}
        ${field('表情', `<input data-participant-field="expression" data-profile-id="${entry.profileId}" aria-label="${esc(entry.profile.name)}表情" maxlength="500" value="${esc(entry.expression)}" />`)}
      </div>
      <details class="character-position-picker" data-experience-fold="profile-grid-${entry.profileId}"><summary>${icon('map-pin')}位置网格 · ${esc(characterPositionLabel(entry.position))}</summary><div class="character-position-grid" role="group" aria-label="${esc(entry.profile.name)}位置网格">${POSITION_GRID.map((position) =>
        `<button type="button" data-action="profile-position" data-profile-id="${entry.profileId}" data-position="${position}" aria-label="${esc(entry.profile.name)}放在 ${position}" aria-pressed="${entry.position === position}">${position}</button>`).join('')}</div></details>
      ${scene.entries.length > 1 ? `<details class="character-interaction" data-experience-fold="profile-interaction-${entry.profileId}"><summary>${icon('handshake')}人物互动</summary><div class="character-form-grid">
        ${field('互动对象', `<select data-participant-field="interaction.targetId" data-profile-id="${entry.profileId}" aria-label="${esc(entry.profile.name)}互动对象"><option value="">无指定互动</option>${entry.interaction?.targetId && !scene.entries.some((other) => other.profileId !== entry.profileId && other.profileId === entry.interaction.targetId) ? `<option value="${esc(entry.interaction.targetId)}" selected disabled>原互动对象未出场</option>` : ''}${scene.entries.filter((other) => other.profileId !== entry.profileId).map((other) => `<option value="${other.profileId}" ${entry.interaction?.targetId === other.profileId ? 'selected' : ''}>${esc(other.profile.name)}</option>`).join('')}</select>`)}
        ${field('互动方式', `<select data-participant-field="interaction.mode" data-profile-id="${entry.profileId}" aria-label="${esc(entry.profile.name)}互动方式"><option value="source" ${entry.interaction?.mode !== 'mutual' ? 'selected' : ''}>此角色发起</option><option value="mutual" ${entry.interaction?.mode === 'mutual' ? 'selected' : ''}>双方共同动作</option></select>`)}
        ${field('互动动作', `<input data-participant-field="interaction.action" data-profile-id="${entry.profileId}" aria-label="${esc(entry.profile.name)}互动动作" maxlength="500" placeholder="hugging, holding hands" value="${esc(entry.interaction?.action || '')}" />`)}
      </div></details>` : ''}
      ${renderOutfitControls(entry, outfitDrafts[entry.profileId], { chat: Boolean(chat?.key) })}
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
    ${command('new-character', 'plus', ui.scope === 'chat' ? '创建全局档案' : '新建角色', db.profiles.length >= 100)}</div></div>
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
            ${input('aliases', '人物别名（用 | 分隔）', Array.isArray(draft.aliases) ? draft.aliases.join(' | ') : draft.aliases || '', 2500)}
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
            ${command('save-character-use', 'user-round-check', '保存并加入出场', !draft.enabled, true)}
            ${command('save-character', 'save', ui.scope === 'chat' ? '仅保存聊天覆盖' : '仅保存档案')}
            ${command('profile-discard', 'rotate-ccw', '撤销修改', !ui.dirty)}
            ${ui.scope === 'chat' ? command('profile-clear-override', 'unlink', '恢复全局档案', !overridden) : command('profile-delete', 'trash-2', '删除档案', !db.profiles.some((profile) => profile.id === draft.id))}
          </div>` : `<div class="character-empty" role="status"><h2>${ui.scope === 'chat' ? '当前聊天暂无可覆盖的档案' : '尚未创建全局档案'}</h2>
            <div class="assistant-actions">${command('new-character', 'plus', '创建全局档案', db.profiles.length >= 100, true)}${command('profile-ai-open', 'wand-sparkles', 'AI 创建档案')}</div></div>`}
      </section>
    </div>
    ${renderCharacterSelection(state, chat, { frozen: Boolean(state.characterSceneOverride), outfitDrafts: ui.outfitDrafts, manage: false })}`;
}
