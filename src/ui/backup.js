import { escapeHtml as esc, normalizeConfig, downloadJson } from '../config.js';
import { icon } from '../icons.js';
import { credentialRequest, currentAccount, isInstalled, storageRequest } from '../runtime.js';
import { BACKUP_SECTIONS, CONFIG_KEYS, cloneBackup, normalizeBackupConfig, mergeBackupConfig,
  restoreBackupCredentials, rewriteBackupAssets, scrubBackup, referencedAssets, credentialNodes } from '../backup-config.js';
import { createBackup, inspectBackup, backupIdentity, backupHash, archiveTasks } from '../backup.js';
import { BackupStore } from '../backup-store.js';
import { RELEASE, compareVersions } from '../release.js';
import { makeDrawing, saveBlob, formatBytes } from './drawings.js';
import { normalizeBackupChats } from '../../server/linghuashi-storage/backup-records.mjs';
import '../styles/backup.css';

const command = (glyph, label, action, disabled = false) => `<button type="button" class="ui-button secondary" data-backup-action="${action}" ${disabled ? 'disabled' : ''}>${icon(glyph)}<span>${label}</span></button>`;
const check = (name, label, checked, disabled = false) => `<label class="backup-check"><input type="checkbox" data-backup-field="${name}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} /><span>${label}</span></label>`;
const input = (label, body) => `<label class="ui-field"><span>${label}</span>${body}</label>`;
const options = (values, selected) => values.map(([id, title]) => `<option value="${id}" ${id === selected ? 'selected' : ''}>${title}</option>`).join('');
const SELECT_LIBRARIES = [['novelaiPresets', 'NovelAI 预设'], ['openaiPresets', 'OpenAI 预设'],
  ['comfyPresets', 'ComfyUI 工作流'], ['sdwebuiPresets', 'SDWebUI 预设'], ['artistLibrary', '画师串'], ['profiles', '角色档案']];

export class BackupPanel {
  constructor({ getState, applyState, getLayout, applyLayout, importParameters, assets, library, ready, flush, active, reload, render, notify, tasks, exportDrafts, importDrafts, exportComicChapters, restoreComicChapters }) {
    Object.assign(this, { getState, applyState, getLayout, applyLayout, importParameters, assets, library, ready, flush, active, reload, rerender: render, notify, tasks, exportDrafts, importDrafts, exportComicChapters, restoreComicChapters });
    this.journal = new BackupStore();
    this.ui = { open: false, busy: false, restoring: false, kind: 'config', keys: false, password: '',
      mode: 'merge', location: '', preserveChat: false, importKeys: true, importImages: true, importTasks: true,
      sections: new Set(BACKUP_SECTIONS.map(([id]) => id)), selected: null, shareCurrent: false,
      error: '', status: '', inspected: null, source: null, rollback: false, taskArchive: [] };
    void Promise.all([this.journal.get('rollback'), this.journal.get('taskArchive')]).then(([rollback, tasks]) => {
      this.ui.rollback = Boolean(rollback); this.ui.taskArchive = tasks || [];
      if (document.querySelector('[data-backup-fold]')) this.rerender();
    }).catch(() => {});
  }
  html() {
    const ui = this.ui, state = this.getState(), file = ui.inspected, share = ui.kind === 'share';
    return `<details class="settings-band backup-band" data-backup-fold ${ui.open ? 'open' : ''}>
      <summary>${icon('archive')}<span>备份与迁移</span>${icon('chevron-down')}</summary>
      <fieldset ${ui.busy ? 'disabled' : ''}>
        <div class="backup-controls">${input('导出类型', `<select data-backup-field="kind">${options([['config', '配置备份'], ['full', '完整备份'], ['share', '分享包']], ui.kind)}</select>`)}
          ${ui.kind === 'full' ? input('图片来源', `<select data-backup-field="location">${options([['', '当前存储位置'], ['browser', '浏览器'], ...(isInstalled() ? [['server', '酒馆服务器']] : [])], ui.location)}</select>`) : ''}</div>
        <div class="backup-sections">${BACKUP_SECTIONS.filter(([id]) => !share || ['parameters', 'artists', 'tags', 'characters'].includes(id)).map(([id, title]) =>
          check(`section:${id}`, title, ui.sections.has(id))).join('')}</div>
        ${share ? this.shareHTML(state) : `<div class="backup-secrets">${this.exportDrafts ? check('drafts', '包含“草稿与恢复”中勾选的记录（含剧情正文）', ui.drafts) : ''}${check('keys', '包含秘钥并加密整个备份', ui.keys)}
          ${ui.keys ? input('备份密码', `<input type="password" data-backup-field="password" value="${esc(ui.password)}" autocomplete="new-password" minlength="8" maxlength="1024" placeholder="至少 8 个字符" />`) : ''}</div>`}
        <div class="backup-actions">${command('download', '导出备份', 'export')}${command('upload', '选择备份文件', 'choose')}
          ${command('rotate-ccw', '撤回上次配置恢复', 'rollback', !ui.rollback)}</div>
        <input type="file" data-backup-file accept=".zip,.lhbackup,application/zip,application/octet-stream" hidden />
        ${ui.source && !file ? `<div class="backup-unlock">${input('解密密码', `<input type="password" data-backup-field="password" value="${esc(ui.password)}" autocomplete="off" maxlength="1024" />`)}${command('folder-open', '读取备份', 'inspect')}</div>` : ''}
        ${file ? this.inspectHTML(file) : ''}
        ${ui.taskArchive.length ? `<details><summary>任务归档 · ${ui.taskArchive.length} 条</summary><div class="backup-share-list">${ui.taskArchive.slice(-20).reverse().map((row) =>
          `<div><span>${esc(row.snapshot?.params?.positive?.slice(0, 70) || row.snapshot?.config?.params?.positive?.slice(0, 70) || row.id)} · ${row.status === 'completed' ? '已完成' : '暂停归档'}</span>
          ${row.snapshot ? `<button type="button" class="ui-button secondary" data-backup-task="${esc(row.id)}">${icon('replace')}载入参数</button>` : ''}</div>`).join('')}</div>
          ${command('download', '导出归档记录', 'archive-export')}</details>` : ''}
      </fieldset>
      <p class="backup-status" role="status" aria-live="polite">${esc(ui.error || ui.status)}</p>
    </details>`;
  }
  shareHTML(state) {
    const ui = this.ui;
    return `<div class="backup-share">${ui.sections.has('parameters') ? check('shareCurrent', '包含当前生图参数', ui.shareCurrent) : ''}
      <div class="backup-share-list">${SELECT_LIBRARIES.filter(([key]) => ui.sections.has(key === 'artistLibrary' ? 'artists' : key === 'profiles' ? 'characters' : 'parameters'))
        .map(([key, title]) => {
          const rows = key === 'profiles' ? state.characterProfiles.profiles : state[key];
          return `<div><strong>${title}</strong>${rows.length ? rows.map((row) => check(`item:${key}:${row.id}`, row.name,
            !ui.selected || ui.selected.has(`${key}:${row.id}`))).join('') : '<span>暂无保存条目</span>'}</div>`;
        }).join('')}</div></div>`;
  }
  inspectHTML({ manifest: m, encrypted, secrets, size }) {
    const ui = this.ui;
    return `<div class="backup-inspection"><h3>${esc(ui.source.name)}</h3>
      <dl class="backup-version"><div><dt>插件版本</dt><dd>${esc(m.pluginVersion)}</dd></div><div><dt>备份时间</dt><dd>${esc(m.exportedAt)}</dd></div>
        <div><dt>包大小</dt><dd>${formatBytes(size)}${encrypted ? ' · 已解密' : ''}</dd></div>
        <div><dt>作品与记录</dt><dd>${m.images.length} 张图片 · ${m.files.filter((row) => row.kind === 'asset').length} 份素材 · ${m.tasks.length} 条任务</dd></div></dl>
      <div class="backup-sections">${m.sections.map((id) => check(`restore:${id}`, BACKUP_SECTIONS.find(([key]) => key === id)[1], ui.restoreSections.has(id))).join('')}
        ${m.images.length ? check('importImages', '恢复图片与历史版本', ui.importImages) : ''}
        ${m.tasks.length ? check('importTasks', '归档任务记录（不执行）', ui.importTasks) : ''}
        ${m.drafts?.rows.length ? check('importDrafts', `导入 ${m.drafts.rows.length} 项草稿到待恢复列表`, ui.importDrafts) : ''}
        ${secrets.length ? check('importKeys', `恢复 ${secrets.length} 份加密秘钥`, ui.importKeys) : ''}
        ${m.kind !== 'share' ? check('preserveChat', '恢复原聊天关联与聊天档案覆盖', ui.preserveChat, !ui.importImages && m.images.length > 0) : ''}</div>
      <div class="backup-controls">${input('配置恢复方式', `<select data-backup-field="mode">${options([['merge', '合并库项目'], ['replace', '覆盖所选配置']], ui.mode)}</select>`)}
        ${m.images.length ? input('图片与素材保存到', `<select data-backup-field="restoreLocation">${options([['browser', '浏览器'], ...(isInstalled() ? [['server', '酒馆服务器']] : [])], ui.restoreLocation)}</select>`) : ''}</div>
      <p class="backup-decision">${ui.mode === 'merge' ? '合并保留当前参数与开关，同名不同内容另存。' : '覆盖只替换勾选配置，已有图片保留。'}${ui.preserveChat ? '聊天关联要求原角色卡、聊天和消息分支仍存在。' : ''}</p>
      <div class="backup-actions">${command('replace', '确认恢复', 'restore')}${command('x', '取消导入', 'cancel')}</div>
    </div>`;
  }
  bind(container) {
    const root = container.querySelector('[data-backup-fold]');
    if (!root) return;
    root.addEventListener('toggle', () => { this.ui.open = root.open; });
    for (const section of [root]) {
      section.addEventListener('click', (event) => {
        const task = event.target.closest('[data-backup-task]')?.dataset.backupTask;
        if (task) {
          event.stopPropagation();
          try { this.importParameters(uiTask(this.ui.taskArchive, task)); } catch (error) { this.notify(error.message); }
          return;
        }
        const action = event.target.closest('[data-backup-action]')?.dataset.backupAction;
        if (action) { event.stopPropagation(); void this.command(action); }
      });
      section.addEventListener('input', (event) => {
        if (event.target.dataset.backupField === 'password') this.ui.password = event.target.value;
      });
      section.addEventListener('change', (event) => {
        const target = event.target, name = target.dataset.backupField, ui = this.ui;
        if (target.matches('[data-backup-file]')) {
          ui.source = target.files[0] || null; ui.inspected = null; ui.password = '';
          if (ui.source) void this.command('inspect');
        } else if (name && name !== 'password') {
          if (name.startsWith('section:') || name.startsWith('restore:')) {
            const set = name.startsWith('restore:') ? ui.restoreSections : ui.sections, value = name.split(':')[1];
            target.checked ? set.add(value) : set.delete(value);
          } else if (name.startsWith('item:')) {
            ui.selected ||= new Set(SELECT_LIBRARIES.flatMap(([key]) => (key === 'profiles' ? this.getState().characterProfiles.profiles : this.getState()[key])
              .map((row) => `${key}:${row.id}`)));
            const value = name.slice(5); target.checked ? ui.selected.add(value) : ui.selected.delete(value);
          } else ui[name] = target.type === 'checkbox' ? target.checked : target.value;
          if (name === 'kind') ui.keys = false;
          if (name === 'importImages' && !target.checked) ui.preserveChat = false;
          this.rerender();
        }
      });
    }
  }
  async operation(work, restoring = false) {
    if (this.ui.busy) return;
    this.ui.busy = true; this.ui.restoring = restoring; this.ui.error = ''; this.ui.status = '正在处理'; this.rerender();
    try { await work(); }
    catch (error) { this.ui.error = error.message || '备份操作失败'; }
    finally { this.ui.busy = false; this.ui.restoring = false; this.ui.password = ''; this.rerender(); }
  }
  async command(action) {
    const ui = this.ui;
    if (action === 'choose') { document.querySelector('[data-backup-file]')?.click(); return; }
    if (action === 'cancel') { ui.inspected = null; ui.source = null; ui.password = ''; this.rerender(); return; }
    await this.operation(async () => {
      if (action === 'export') await this.export();
      if (action === 'archive-export') {
        downloadJson('linghuashi-task-archive.json', { format: 'linghuashi-task-archive', version: 1, rows: this.ui.taskArchive });
        ui.status = '已导出归档记录';
      }
      if (action === 'inspect') {
        if (!ui.source) throw new Error('请选择备份文件');
        try {
          ui.inspected = await inspectBackup(ui.source, ui.password);
        } catch (error) {
          if (!ui.password && error.message.includes('密码')) { ui.status = '请输入备份密码'; return; }
          throw error;
        }
        const { manifest } = ui.inspected;
        if (compareVersions(manifest.pluginVersion, RELEASE.version) > 0) throw new Error('备份来自较新版本，请更新插件后再恢复');
        ui.restoreSections = new Set(manifest.sections); ui.restoreLocation = this.getState().cacheLocation;
        ui.preserveChat = manifest.identity === await backupIdentity(currentAccount(), location.origin);
        ui.mode = 'merge'; ui.importImages = true; ui.importTasks = true; ui.importKeys = true; ui.importDrafts = Boolean(manifest.drafts);
        ui.status = '备份校验通过，请选择恢复内容';
      }
      if (action === 'restore') await this.restore();
      if (action === 'rollback') {
        await this.assertIdle();
        const previous = await this.journal.get('rollback');
        if (!previous) throw new Error('没有可撤回的配置');
        const current = { state: cloneBackup(this.getState()), layout: this.getLayout() };
        await this.applyState(previous.state); await this.applyLayout(previous.layout);
        await this.journal.put('rollback', current); await this.reload();
        ui.status = '已撤回配置恢复，导入图片和素材仍保留';
      }
    }, action === 'restore' || action === 'rollback');
  }
  async assertIdle() {
    await this.flush();
    if (this.active()) throw new Error('请等待当前生图、助手和编辑任务结束，再恢复配置');
    await this.ready();
    const records = await this.tasks();
    if (records.rows.some((row) => row.status === 'running')) throw new Error('同账号仍有执行中的任务，请完成后再恢复');
  }
  async export() {
    const ui = this.ui;
    await this.flush(); await this.ready();
    let state = cloneBackup(this.getState());
    const sections = [...ui.sections].filter((id) => ui.kind !== 'share' || ['parameters', 'artists', 'tags', 'characters'].includes(id));
    if (!sections.length) throw new Error('请至少选择一个配置分区');
    if (ui.kind === 'share') {
      const original = state; state = {};
      for (const [key] of SELECT_LIBRARIES) {
        const values = (key === 'profiles' ? original.characterProfiles.profiles : original[key]).filter((row) => !ui.selected || ui.selected.has(`${key}:${row.id}`));
        if (key === 'profiles') state.characterProfiles = { profiles: values };
        else state[key] = values;
      }
      if (ui.shareCurrent) for (const key of ['novelai', 'openai', 'comfyui', 'sdwebui']) state[key] = original[key];
      if (sections.includes('tags')) state.tagLibrary = original.tagLibrary;
    }
    if (ui.kind === 'full' && this.active()) throw new Error('请等待当前任务完成后导出完整备份');
    const source = ui.location || this.getState().cacheLocation;
    const rows = ui.kind === 'full' ? await this.library.list(source, true) : [];
    const drawings = [];
    for (const row of rows) drawings.push(await this.library.materialize(row));
    const chats = ui.kind === 'full' ? await this.library.backupChats(source) : [];
    const tasks = ui.kind === 'full' ? [...new Map([...(await this.journal.get('taskArchive') || []), ...(await this.tasks()).rows]
      .map((row) => [row.id, row])).values()] : [];
    const blob = await createBackup({ state, sections, layout: normalizeConfig(this.getLayout()), kind: ui.kind, includeKeys: ui.keys, password: ui.password,
      drafts: ui.kind !== 'share' && ui.drafts ? await this.exportDrafts?.() : null,
      comicChapters: sections.includes('comics') ? await this.exportComicChapters?.() : [],
      identity: await backupIdentity(currentAccount(), location.origin), assets: this.assets, drawings, chats, tasks,
      readKey: (provider, ref) => credentialRequest('read', provider, { ref }),
      progress: (message) => { ui.status = message; const status = document.querySelector('.backup-status'); if (status) status.textContent = message; } });
    const date = new Date().toISOString().slice(0, 10);
    saveBlob(blob, `linghuashi-${ui.kind}-${date}.${ui.keys ? 'lhbackup' : 'zip'}`);
    ui.status = `已导出 ${formatBytes(blob.size)}`;
  }
  async restore() {
    const ui = this.ui, pack = ui.inspected;
    if (!pack) throw new Error('请先读取备份文件');
    await this.assertIdle();
    const sections = [...ui.restoreSections];
    if (!sections.length && !(ui.importImages && pack.manifest.images.length) && !(ui.importTasks && pack.manifest.tasks.length) && !(ui.importDrafts && pack.manifest.drafts?.rows.length)) throw new Error('请至少选择一项恢复内容');
    const before = { state: cloneBackup(this.getState()), layout: this.getLayout() };
    const destination = ui.restoreLocation || before.state.cacheLocation;
    if (destination === 'server') {
      const backend = await storageRequest('backup/status');
      if (backend.protocol !== RELEASE.storageProtocol) throw new Error('请先更新服务器组件，再向酒馆服务器恢复');
    }
    const locations = new Map();
    let imported = normalizeBackupConfig(pack.manifest.config, sections);
    const slots = new Set(credentialNodes(imported).map(({ provider, value }) => `${provider}:${value.keyRef}`));
    const secrets = ui.importKeys ? pack.secrets.filter((row) => slots.has(`${row.provider}:${row.slot}`)) : [];
    await restoreBackupCredentials(imported, before.state, secrets,
      (provider, key) => credentialRequest('write', provider, { key }),
      (provider, ref) => credentialRequest('read', provider, { ref }));
    // Validate the whole configuration before any image or reference writes.
    mergeBackupConfig(before.state, imported, sections, ui.mode, ui.preserveChat);
    const images = [];
    if (ui.importImages) for (const entry of pack.manifest.images) images.push(await makeDrawing(pack.contents.get(entry.file), entry));
    const neededAssets = new Set(referencedAssets({ config: imported, images: ui.importImages ? pack.manifest.images : [],
      tasks: ui.importTasks ? pack.manifest.tasks : [], comicChapters: sections.includes('comics') ? pack.manifest.comicChapters : [] }).map((row) => row.id));
    const selectedAssets = pack.manifest.files.filter((row) => row.kind === 'asset' && neededAssets.has(row.asset.id));
    for (const item of selectedAssets) if (item.asset.mime.startsWith('image/')) {
      const bitmap = await createImageBitmap(pack.contents.get(item.path));
      try {
        if (bitmap.width !== item.asset.width || bitmap.height !== item.asset.height || bitmap.width * bitmap.height > 32000000) throw new Error('参考素材尺寸与清单不一致');
      } finally { bitmap.close(); }
    }
    for (const item of selectedAssets) {
      const asset = await this.assets.put(pack.contents.get(item.path), item.asset, destination);
      locations.set(asset.id, destination);
    }
    imported = rewriteBackupAssets(imported, locations);
    const next = mergeBackupConfig(before.state, imported, sections, ui.mode, ui.preserveChat);
    const existing = await this.library.list(destination), imageIds = new Map(), add = [];
    const imageFiles = new Map(pack.manifest.files.filter((item) => item.kind === 'image').map((item) => [item.path, item.sha256]));
    for (const [index, row] of images.entries()) {
      const old = existing.find((item) => item.id === row.id);
      let id = row.id;
      if (old) {
        const loaded = await this.library.materialize(old);
        const equal = await backupHash(await loaded.blob.arrayBuffer()) === imageFiles.get(pack.manifest.images[index].file)
          && JSON.stringify(scrubBackup(old.snapshot)) === JSON.stringify(scrubBackup(row.snapshot));
        if (equal) { imageIds.set(row.id, row.id); continue; }
        id = `import-${(await backupHash(new TextEncoder().encode(`${row.id}:${imageFiles.get(pack.manifest.images[index].file)}`))).slice(0, 32)}`;
      }
      imageIds.set(row.id, id); add.push({ ...row, originalId: row.id, id });
    }
    for (const row of add) {
      row.snapshot = rewriteBackupAssets(row.snapshot, locations);
      row.chatBinding = ui.preserveChat ? row.chatBinding : null;
      row.version.groupId = imageIds.get(row.version.groupId) || row.version.groupId;
      row.version.parentId = imageIds.get(row.version.parentId) || row.version.parentId;
      delete row.originalId;
    }
    if (destination === 'browser' && existing.length + add.filter((row) => !existing.some((old) => old.id === row.id)).length > 500) throw new Error('恢复后浏览器图片超过 500 张');
    const ordered = add.sort((a, b) => a.version.number - b.version.number || a.createdAt - b.createdAt);
    const previousSelections = existing.filter((row) => row.versionCurrent !== false).map((row) => row.id);
    await this.journal.put('rollback', before); ui.rollback = true;
    await this.library.add(ordered, destination);
    // Merge must retain a current version the user has already selected.
    for (const id of previousSelections) {
      if (destination === 'server') await this.library.server.selectVersion(id);
      else {
        const oldMode = this.library.mode; this.library.mode = () => 'browser';
        try { await this.library.selectVersion(id); } finally { this.library.mode = oldMode; }
      }
    }
    if (ui.preserveChat && ui.importImages) {
      const available = new Set([...existing, ...ordered].map((row) => row.id));
      const chats = normalizeBackupChats(pack.manifest.chats.map((row) => ({ ...row,
        savedIds: (row.savedIds || []).map((id) => imageIds.get(id) || id) })), available);
      await this.library.restoreChats(chats, destination);
    }
    if (ui.importTasks && pack.manifest.tasks.length) {
      const archived = await this.journal.get('taskArchive') || [];
      const incoming = archiveTasks(pack.manifest.tasks).map((row) => ({ ...row,
        savedIds: (row.savedIds || []).map((id) => imageIds.get(id) || id),
        snapshot: rewriteBackupAssets(row.snapshot, locations), status: row.status === 'completed' ? 'completed' : 'paused' }));
      const unique = new Map([...archived, ...incoming].map((row) => [row.id, row]));
      ui.taskArchive = [...unique.values()].slice(-500);
      await this.journal.put('taskArchive', ui.taskArchive);
    }
    if (images.length) next.cacheLocation = destination;
    if (sections.includes('comics') && this.restoreComicChapters) {
      next.comicLibrary = await this.restoreComicChapters(next.comicLibrary, rewriteBackupAssets(pack.manifest.comicChapters || [], locations), imageIds, destination);
    }
    await this.applyState(next);
    if (ui.importDrafts && pack.manifest.drafts) await this.importDrafts?.(pack.manifest.drafts);
    if (sections.includes('general') && ui.mode === 'replace' && pack.manifest.layout) await this.applyLayout(normalizeConfig(pack.manifest.layout));
    await this.reload();
    ui.status = `恢复完成：${ordered.length} 张新图片，配置${ui.mode === 'merge' ? '已合并' : '已覆盖'}；任务记录仅归档`;
    ui.inspected = null; ui.source = null; this.notify('备份恢复完成');
  }
}

function uiTask(rows, id) {
  const snapshot = rows.find((row) => row.id === id)?.snapshot;
  if (!snapshot) throw new Error('归档没有生图参数');
  return snapshot;
}
