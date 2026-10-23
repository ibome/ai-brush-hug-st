import { randomUUID } from './crypto-compat.js';
import { bindImageSlots, bindSmartSlot, bindingIsCurrent, chatIdentity, CHAT_PENDING } from './chat.js';
import { normalizeAssistant } from './prompt-assistant.js';
import { createChatSync, openChatStore } from './chat-storage.js';
import { getCharacterTheme } from './ui/appearance.js';
import { icon, paintIcons } from './icons.js';
import { locatePromptRanges, replacePromptRange, restorePromptRange, locateSmartAnchors } from './chat-render.js';
import { illustrationPlans, selectedIllustration } from './assistant-workflow.js';
import { versionGroupId } from '../server/linghuashi-storage/image-versions.mjs';
import { chatImageBelongsTo } from './chat-image-actions.js';
import { quickCSS, quickTheme, quickButton, appendImageTools, editChatPrompt, copyChatPrompt, chooseChatSlots } from './ui/chat-quick.js';
import { renderGenerationTransition, transitionCSS } from './ui/generation-transition.js';
import { generationTransitionState } from './generation-transition.js';
import { apiError } from './extension-api.js';
import { createChatReader } from './chat-reader.js';

const labels = {
  preparing: '准备生图', confirming: '等待确认提示词', queued: '排队中', running: '正在生图',
  completed: '图片已保存', failed: '生成失败', cancelled: '已取消',
  drafted: '提示词已准备', skipped: '本条无需配图',
};
const phases = { submitting: '正在提交', retrieving: '正在取图', downloading: '正在下载', saving: '正在保存' };

export function createChatLink({ account, getContext, settings, send, open, notice, storageRequest }) {
  const entries = new Map();
  const requests = new Map();
  const listeners = [];
  const objectURLs = new Set();
  const pendingReplies = new Set();
  const replacements = [];
  const anchorSplits = [];
  let store;
  let destroyed = false;
  let revision = 0;
  let stopped = false;
  const processor = getContext().streamingProcessor;
  let generating = processor?.isFinished === false && !processor.isStopped;
  let renderTimer;
  let observer;
  let channel;
  let dialogSession;
  const imageOperations = new Set();
  const versionSelections = new Map();
  const ready = openChatStore(account, {
    mode: () => ['server', 'local'].includes(settings().cacheLocation) ? 'server' : 'browser', request: storageRequest,
    ownsRequest: (id) => requests.has(id),
  }).then((value) => { store = value; return value; }).catch(() => {
    notice('聊天任务存储不可用，请检查浏览器存储权限');
  });
  const syncRecords = createChatSync((chatKey) => store.sync(chatKey));
  const reader = createChatReader({
    getContext, settings, isBusy: () => generating,
    load: async (key) => {
      await ready;
      return store ? store.readerData(key) : { records: [], images: [], warnings: ['图片存储不可用，只能读取正文'] };
    },
    image: async (id, location) => store?.image(id, location),
    preview: (row) => row?.thumbnailURL || (row?.thumbnail instanceof Blob ? URL.createObjectURL(row.thumbnail) : ''),
  });

  const isCurrent = (entry) => bindingIsCurrent(entry, getContext(), settings());
  const scheduledRender = () => {
    clearTimeout(renderTimer);
    if (destroyed || generating) return;
    renderTimer = setTimeout(() => { void reconcileSafely(); }, 60);
  };
  async function reconcileSafely() {
    try { await reconcile(); }
    catch {
      if (destroyed) return;
      for (const card of document.querySelectorAll('.linghuashi-chat-images')) {
        const status = card.shadowRoot?.querySelector('header .status');
        if (status) status.textContent = '配图暂时无法读取，已有内容保留';
      }
    }
  }

  function removeCards() {
    for (const { left, right, card, before, after } of anchorSplits.reverse()) {
      if (left.isConnected && right.isConnected && left.nextSibling === card && card.nextSibling === right
        && left.data === before && right.data === after) {
        left.data += right.data; right.remove();
      }
    }
    anchorSplits.length = 0;
    for (const replacement of replacements.reverse()) restorePromptRange(replacement);
    replacements.length = 0;
    document.querySelectorAll('.linghuashi-chat-images,.linghuashi-smart-entry,.linghuashi-message-quick').forEach((node) => node.remove());
    for (const url of objectURLs) URL.revokeObjectURL(url);
    objectURLs.clear();
  }

  async function updateRecord(entry, value) {
    if (!store || !entry.requestId) return;
    const result = await store.update(entry.binding.id, entry.requestId, value);
    if (result) {
      entry.record = result;
      channel?.postMessage({ id: entry.binding.id });
    }
  }

  async function reconcile() {
    if (destroyed || generating) return;
    const turn = ++revision;
    await ready;
    if (turn !== revision || destroyed || generating || !store) return;
    const context = getContext();
    const options = settings();
    const chatKey = chatIdentity(context);
    if (options.enabled && chatKey && !await syncRecords(chatKey,
      ['server', 'local'].includes(options.cacheLocation) ? 'server' : 'browser')) return;
    if (turn !== revision || destroyed) return;
    const assistant = normalizeAssistant(options.assistant);
    if (!options.auto && !assistant.autoPrompt) pendingReplies.clear();
    const visible = new Map();
    if (options.enabled && chatIdentity(context)) {
      const nodes = [...document.querySelectorAll('#chat .mes[mesid]')];
      await Promise.all(nodes.map(async (node) => {
        const message = context.chat[Number(node.getAttribute('mesid'))];
        const text = message?.mes;
        const slots = await bindImageSlots(context, message, options.triggerPrefix, options.triggerSuffix);
        if (!slots.length) {
          const smart = await bindSmartSlot(context, message);
          if (smart) {
            slots.push(smart);
            const parent = await store.get(smart.binding.id);
            for (let index = 1; index < illustrationPlans(parent?.assistant).length; index++) {
              const child = await bindSmartSlot(context, message, index);
              if (child) slots.push(child);
            }
          }
        }
        for (const slot of slots) {
          let entry = entries.get(slot.binding.id);
          if (!entry || entry.message !== message) {
            entry = { ...slot, message, text, record: await store.get(slot.binding.id) };
            entries.set(slot.binding.id, entry);
          } else entry.record = await store.get(slot.binding.id);
          if (entry.binding.kind === 'smart') entry.prompt = entry.record?.assistant?.positive || '';
          if (bindingIsCurrent(entry, context, options)) visible.set(entry.binding.id, { entry, node });
        }
      }));
    }
    if (turn !== revision || destroyed) return;
    if (dialogSession && !isCurrent(dialogSession.entry)) dialogSession.controller.abort();
    for (const entry of requests.values()) {
      if (!isCurrent(entry) && !entry.invalidated) {
        entry.invalidated = true;
        send('linghuashi:chat-cancel', { requestId: entry.requestId, pendingOnly: true });
      }
    }
    for (const [id] of entries) {
      if (!visible.has(id) && ![...requests.values()].some((entry) => entry.binding.id === id)) entries.delete(id);
    }
    const byNode = new Map();
    for (const value of visible.values()) {
      if (!byNode.has(value.node)) byNode.set(value.node, []);
      byNode.get(value.node).push(value.entry);
    }
    const urls = new Set();
    const cards = new Map(await Promise.all([...visible.values()].map(async ({ entry }) =>
      [entry.binding.id, await createCard(entry, options, urls, turn)])));
    if (turn !== revision || destroyed) {
      for (const url of urls) URL.revokeObjectURL(url);
      return;
    }
    // Build asynchronously, then change the message DOM in one pass so our own
    // replacements do not trigger the observer or interrupt Tavern rendering.
    observer?.disconnect();
    try {
      const openedMenus = new Set([...document.querySelectorAll('.linghuashi-chat-images')].flatMap((card) =>
        [...card.shadowRoot.querySelectorAll('.picture-entry[data-image]')].filter((picture) =>
          picture.querySelector('.quick-more')?.open).map((picture) => picture.dataset.image)));
      for (const card of cards.values()) {
        for (const picture of card.shadowRoot.querySelectorAll('.picture-entry[data-image]')) {
          if (openedMenus.has(picture.dataset.image)) picture.querySelector('.quick-more').open = true;
        }
      }
      removeCards();
      for (const url of urls) objectURLs.add(url);
      for (const [node, rows] of byNode) {
        if (!node.isConnected) continue;
        const current = rows.filter(isCurrent).sort((left, right) => left.binding.slot - right.binding.slot);
        const located = options.inline !== false
          ? locatePromptRanges(node.querySelector('.mes_text'), current.filter((entry) => entry.binding.kind !== 'smart'), options.triggerPrefix, options.triggerSuffix) : [];
        const placed = new Set();
        for (const { entry, range } of located.reverse()) {
          const card = cards.get(entry.binding.id);
          card.dataset.placement = 'inline';
          replacements.push(replacePromptRange(range, card));
          placed.add(entry.binding.id);
        }
        const anchors = options.inline !== false
          ? locateSmartAnchors(node.querySelector('.mes_text'), current.filter((entry) => entry.binding.kind === 'smart')) : [];
        for (const { entry, block, range } of anchors.reverse()) {
          const card = cards.get(entry.binding.id);
          card.dataset.placement = 'anchor';
          if (block) block.after(card);
          else if (range.startContainer.nodeType === 3) {
            const left = range.startContainer, offset = range.startOffset;
            if (offset === left.length) left.after(card);
            else if (offset === 0) left.before(card);
            else {
              const right = left.splitText(offset);
              left.after(card);
              anchorSplits.push({ left, right, card, before: left.data, after: right.data });
            }
          } else range.insertNode(card);
          placed.add(entry.binding.id);
        }
        for (const entry of current) {
          if (placed.has(entry.binding.id)) continue;
          const card = cards.get(entry.binding.id);
          card.dataset.placement = 'footer';
          const target = entry.binding.kind === 'smart' && options.inline !== false
            ? node.querySelector('.mes_text') : node.querySelector('.mes_block');
          target?.append(card);
        }
        if (current.length) {
          const quick = document.createElement('span'); quick.className = 'linghuashi-message-quick';
          const shadow = quick.attachShadow({ mode: 'open' }), style = document.createElement('style');
          style.textContent = `:host{display:inline-flex;color:inherit;font:inherit}svg{width:17px;height:17px}button{cursor:pointer;font:inherit}${quickCSS}`;
          const tools = document.createElement('span'); tools.className = 'message-quick';
          tools.append(quickButton('image-plus', '给这条配图', () => { void illustrateMessage(current); }));
          shadow.append(style, tools); quickTheme(quick, options.characterTheme); paintIcons(shadow);
          (node.querySelector('.mes_buttons') || node.querySelector('.mes_block'))?.append(quick);
        }
      }
      for (const [key, selection] of versionSelections) {
        if (selection.saving) continue;
        const displayed = [...cards.values()].some((card) =>
          [...card.shadowRoot.querySelectorAll('.picture-entry')].some((picture) =>
            picture.dataset.versionGroup === key && picture.dataset.image === selection.id));
        if (displayed) versionSelections.delete(key);
      }
    } finally {
      observeChat();
    }
    if ((options.auto || assistant.autoPrompt) && !stopped) {
      for (const { entry } of visible.values()) {
        const smart = entry.binding.kind === 'smart';
        const eligible = smart ? assistant.autoPrompt && !generating : options.auto;
        if (eligible && pendingReplies.has(entry.message) && !entry.record) {
          if (smart && assistant.frequency === 'interval') {
            const count = context.chat.slice(0, context.chat.indexOf(entry.message) + 1).filter((item) =>
              !item.is_user && !item.is_system && typeof item.mes === 'string').length;
            if (count % assistant.every !== 0) continue;
          }
          if (smart) entry.previous = [...visible.values()].map((item) => item.entry)
            .filter((item) => context.chat.indexOf(item.message) < context.chat.indexOf(entry.message) && item.record?.assistant?.shouldDraw)
            .at(-1)?.record?.assistant || null;
          void request(entry, true);
        }
      }
    }
    if (!generating) pendingReplies.clear();
  }

  async function createCard(entry, options, urls, turn) {
    const container = document.createElement('span');
    const smart = entry.binding.kind === 'smart';
    container.className = smart && !entry.record ? 'linghuashi-smart-entry' : 'linghuashi-chat-images';
    const shadow = container.attachShadow({ mode: 'open' });
    quickTheme(container, options.characterTheme);
    const accent = getCharacterTheme(options.characterTheme).accent || '#3672ce';
    shadow.innerHTML = `<style>
      :host { display:block; max-width:100%; margin:10px 0; color:inherit; font:inherit; text-indent:0; }
      *,*::before,*::after { box-sizing:border-box; } button { font:inherit; cursor:pointer; }
      .slot { padding:8px 0; }
      header { display:flex; flex-wrap:wrap; align-items:center; gap:8px; font-size:13px; }
      strong { font-weight:600; } .status { opacity:.8; flex:1; min-width:100px; }
      .actions { display:flex; gap:6px; flex-wrap:wrap; }
      button { display:inline-flex; align-items:center; justify-content:center; gap:5px; border:1px solid color-mix(in srgb,${accent} 55%,transparent); background:color-mix(in srgb,${accent} 12%,transparent); color:inherit; border-radius:5px; padding:5px 9px; }
      button:disabled { cursor:default; opacity:.55; } button:focus-visible { outline:2px solid ${accent}; outline-offset:2px; }
      svg { width:15px; height:15px; flex:none; pointer-events:none; }
      details { margin-top:6px; font-size:12px; } summary { cursor:pointer; opacity:.8; }
      .prompt,.error { overflow-wrap:anywhere; white-space:pre-wrap; margin:6px 0; font-size:12px; }
      .error { color:inherit; opacity:.85; } .pictures { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:9px; }
      .picture { display:block; padding:0; max-width:100%; width:min(360px,100%); border:0; background:transparent; }
      .picture-entry { width:min(360px,100%); max-width:100%; }
      .generation-placeholder { width:min(360px,100%); }
      .picture-edit { display:inline-flex; align-items:center; gap:5px; margin-top:5px; }
      img { display:block; max-width:100%; width:100%; height:auto; max-height:480px; object-fit:contain; border-radius:5px; }
      ${quickCSS}
      ${transitionCSS}
    </style>`;
    const section = document.createElement('section');
    section.className = 'slot';
    section.dataset.slot = entry.binding.id;
    const record = entry.record;
    const owned = requests.has(record?.requestId);
    const pending = CHAT_PENDING.has(record?.status);
    section.innerHTML = `<header><strong>${smart ? `灵画师 · 智能配图${entry.binding.slot ? ` ${entry.index + 1}` : ''}` : `灵画师 · 配图 ${entry.index + 1}`}</strong><span class="status"></span><div class="actions"></div></header><details><summary>提示词</summary><p class="prompt"></p></details>`;
    section.querySelector('.prompt').textContent = entry.prompt;
    if (smart && !record) {
      section.querySelector('strong').hidden = true;
      section.querySelector('.status').hidden = true;
      section.querySelector('details').hidden = true;
    }
    if (record?.assistant?.scene) section.querySelector('.prompt').textContent =
      `${record.assistant.scene}\n\n${record.assistant.positive}\n\n负面：${record.assistant.negative || '未填写'}`;
    section.querySelector('.status').textContent = pending && !owned
      ? record?.taskId ? '其他页面执行中，等待同步' : '任务记录待核对'
      : (record?.status === 'preparing' ? generationTransitionState(record)?.title : pending ? phases[record?.phase] : '')
        || labels[record?.status] || '等待生成';
    const command = (label, glyph, action, disabled = false) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = `${icon(glyph)}<span></span>`;
      button.querySelector('span').textContent = label;
      button.disabled = disabled;
      button.addEventListener('click', action);
      section.querySelector('.actions').append(button);
    };
    if (pending && !owned && record?.taskId) command('查看任务', 'list-checks', () => open('generate'));
    else if (pending && owned) command('取消', 'x', () => send('linghuashi:chat-cancel', { requestId: record.requestId }), record.phase === 'saving');
    else if (record?.status === 'failed' && record.recoverable) {
      command('继续取图', 'download', () => send('linghuashi:chat-recover', { requestId: record.requestId }));
    } else if (smart && record?.assistant?.shouldDraw && record.status === 'drafted') {
      command('编辑提示词', 'pencil', () => openDraft(entry));
      command('生成图片', 'sparkles', () => generateDraft(entry));
    } else if (record?.status !== 'completed') {
      if (smart) command(record ? '重新分析' : '给这条配图', 'sparkles', () => { entry.openEditor = true; void request(entry, false); });
      else
      command(pending ? '核对后重试' : record ? '重新生成' : '生成图片', 'sparkles', () => { void request(entry, false); });
    }
    if (record?.assistant?.reason && !record.error) {
      const explanation = document.createElement('p');
      explanation.className = 'prompt'; explanation.textContent = record.assistant.reason; section.append(explanation);
    }
    if (record?.error) {
      const error = document.createElement('p');
      error.className = 'error';
      error.textContent = record.error;
      section.append(error);
    }
    if (record?.savedIds?.length) {
      command('绘图管理', 'images', () => { open('gallery'); send('linghuashi:chat-view', { id: record.savedIds[0] }); });
      if (options.inline !== false) {
        const pictures = document.createElement('div');
        pictures.className = 'pictures';
        section.prepend(pictures);
        let imageReadFailed = false;
        const displayed = new Set();
        for (const id of record.savedIds.slice(0, 32)) {
          let row;
          let versions;
          try {
            row = await store.image(id, record.storageLocation);
            if (row) versions = await store.versions(row.id, record.storageLocation);
          }
          catch { imageReadFailed = true; break; }
          if (turn !== revision || destroyed) return container;
          if (!row?.blob) continue;
          const groupId = versionGroupId(row);
          if (displayed.has(groupId)) continue;
          displayed.add(groupId);
          const url = row.thumbnailURL || URL.createObjectURL(row.thumbnail || row.blob);
          if (url.startsWith('blob:')) urls.add(url);
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'picture';
          button.setAttribute('aria-label', '查看配图大图和生图参数');
          const image = document.createElement('img');
          image.src = url; image.alt = row.title; image.loading = 'lazy'; image.decoding = 'async';
          image.width = row.width; image.height = row.height;
          button.append(image);
          button.addEventListener('click', () => { void imageAction(entry, row, 'view'); });
          const picture = document.createElement('div'); picture.className = 'picture-entry'; picture.dataset.image = row.id;
          const versionKey = `${row.storageLocation}:${groupId}`;
          picture.dataset.versionGroup = versionKey; picture.append(button);
          const active = [...requests.values()].find((request) => request.quickImage && request.groupId === groupId
            && request.storageLocation === record.storageLocation && CHAT_PENDING.has(request.record?.status));
          const savedTask = store.imageTask(entry.binding.id, groupId, record.storageLocation);
          const task = active?.record || (savedTask && { ...savedTask, requestId: savedTask.plan.chatRequestId,
            remote: savedTask.status === 'running',
            recoverable: ['paused', 'failed', 'uncertain'].includes(savedTask.status) && (Boolean(savedTask.execution) || savedTask.stage === 'waiting') });
          const taskPending = Boolean(active || savedTask && ['running', 'paused'].includes(savedTask.status)
            || savedTask?.status === 'uncertain' || savedTask?.execution && savedTask.status === 'failed');
          appendImageTools({ container: picture, row, versions, task, pending: taskPending || pending, theme: options.characterTheme,
            onAction: (action) => { void imageAction(entry, row, action, task); },
            onVersion: (versionId) => { void selectImageVersion(entry, row, versionId); } });
          const selection = versionSelections.get(versionKey);
          if (selection && (selection.saving || selection.id !== row.id)) markVersionPending(picture);
          pictures.append(picture);
        }
        if (imageReadFailed) {
          section.querySelector('.status').textContent = '图片记录暂时无法读取，请稍后刷新';
        } else if (!pictures.childElementCount) {
          section.querySelector('.status').textContent = record.storageLocation === 'server'
            ? '服务器图片已删除或文件缺失' : '浏览器图片已清理或位于其他设备';
          command('重新生成', 'sparkles', () => { void request(entry, false); });
        }
      }
    }
    if (pending && !section.querySelector('.picture-entry')) {
      const placeholder = document.createElement('div');
      placeholder.className = 'generation-placeholder';
      placeholder.innerHTML = renderGenerationTransition({ theme: options.characterTheme,
        task: { ...record, progress: owned ? entry.progress : undefined }, remote: !owned });
      section.prepend(placeholder);
    }
    shadow.append(section);
    paintIcons(shadow);
    return container;
  }

  async function withDialog(entry, show) {
    dialogSession?.controller.abort();
    const controller = new AbortController(), session = { entry, controller };
    dialogSession = session;
    try { return await show(controller.signal); }
    finally { if (dialogSession === session) dialogSession = null; }
  }

  async function illustrateMessage(rows) {
    const current = rows.filter(isCurrent);
    if (!current.length) return;
    if (current[0].binding.kind === 'smart') {
      current[0].openEditor = true;
      void request(current[0], false);
    } else if (current.length === 1 && !current[0].record) void request(current[0], false);
    else {
      const selected = await withDialog(current[0], (signal) => chooseChatSlots(current, settings().characterTheme, signal));
      for (const entry of selected || []) if (isCurrent(entry)) void request(entry, false);
    }
  }

  function markVersionPending(picture) {
    picture.setAttribute('aria-busy', 'true');
    picture.querySelectorAll('button,select').forEach((control) => { control.disabled = true; });
    if (picture.querySelector('.version-pending')) return;
    const status = document.createElement('p');
    status.className = 'prompt version-pending'; status.setAttribute('role', 'status');
    status.textContent = '正在切换图片版本…'; picture.append(status);
  }

  async function selectImageVersion(entry, row, id) {
    const key = `${row.storageLocation}:${versionGroupId(row)}`;
    if (!isCurrent(entry) || versionSelections.has(key) || id === row.id) return;
    const selection = { id, saving: true };
    versionSelections.set(key, selection);
    for (const card of document.querySelectorAll('.linghuashi-chat-images')) {
      for (const picture of card.shadowRoot.querySelectorAll('.picture-entry')) {
        if (picture.dataset.versionGroup === key) markVersionPending(picture);
      }
    }
    try {
      const versions = await store.versions(row.id, row.storageLocation);
      if (!versions.some((item) => item.id === id && chatImageBelongsTo(item, entry.binding))) throw new Error('图片版本或原消息已变化，请刷新聊天');
      if (!isCurrent(entry)) { versionSelections.delete(key); return; }
      await store.selectVersion(id, row.storageLocation);
      selection.saving = false;
      channel?.postMessage({ type: 'images-changed' }); scheduledRender();
    } catch (error) {
      versionSelections.delete(key); notice(error.message); scheduledRender();
    }
  }

  async function imageAction(entry, row, action, task) {
    const operation = `${row.storageLocation}:${row.id}:${action}`;
    if (!isCurrent(entry) || imageOperations.has(operation)) return;
    if (versionSelections.has(`${row.storageLocation}:${versionGroupId(row)}`)) return;
    imageOperations.add(operation);
    try {
      if (!chatImageBelongsTo(row, entry.binding)) throw new Error('配图与原消息的关联已变化，请刷新聊天');
      if (action === 'favorite') {
        const latest = (await store.versions(row.id, row.storageLocation)).find((item) => item.id === row.id);
        if (!latest || !isCurrent(entry)) return;
        await store.favorite(row.id, !latest.favorite, row.storageLocation);
        channel?.postMessage({ type: 'images-changed' }); scheduledRender();
      } else if (action === 'download') {
        let blob = row.blob;
        if (!(blob instanceof Blob)) {
          const response = await fetch(row.srcURL, { credentials: 'same-origin' });
          if (!response.ok) throw new Error('原图读取失败，请稍后重试');
          blob = await response.blob();
        }
        const url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url; link.download = `linghuashi-${row.id}.${({ 'image/jpeg': 'jpg', 'image/webp': 'webp' })[blob.type] || 'png'}`;
        link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      } else if (action === 'copy') {
        const copied = await withDialog(entry, (signal) => copyChatPrompt(row, settings().characterTheme, signal));
        if (copied) notice('提示词已复制');
      } else if (action === 'repeat' || action === 'prompt') {
        const edits = action === 'prompt'
          ? await withDialog(entry, (signal) => editChatPrompt(row, settings().characterTheme, signal)) : undefined;
        if (action === 'prompt' && !edits || !isCurrent(entry)) return;
        void requestImageVersion(entry, row, edits);
      } else if (action === 'recover' || action === 'cancel') {
        if (task?.id) await send('linghuashi:chat-image-control', { taskId: task.id, action, binding: entry.binding });
        else if (task?.requestId) await send(action === 'recover' ? 'linghuashi:chat-recover' : 'linghuashi:chat-cancel', { requestId: task.requestId });
      } else {
        open(action === 'restore' ? 'generate' : 'gallery');
        await send('linghuashi:chat-image-open', { id: row.id, action, binding: entry.binding, storageLocation: row.storageLocation });
      }
    } catch (error) { notice(error.message); }
    finally { imageOperations.delete(operation); }
  }

  async function requestImageVersion(entry, row, edits) {
    const groupId = versionGroupId(row);
    const run = async (lock) => {
      if (!lock || destroyed || !isCurrent(entry)) return;
      await store.sync(entry.binding.chatKey);
      const previous = store.imageTask(entry.binding.id, groupId, row.storageLocation);
      if (previous && (['running', 'paused', 'uncertain'].includes(previous.status) || previous.status === 'failed' && previous.execution)) {
        notice('这张图已有待处理任务，请先继续或取消原任务'); scheduledRender(); return;
      }
      const latest = (await store.versions(row.id, row.storageLocation)).find((item) => item.id === row.id);
      if (!latest || !chatImageBelongsTo(latest, entry.binding) || !isCurrent(entry)) return;
      const requestId = randomUUID();
      const current = { ...entry, requestId, quickImage: true, groupId, storageLocation: row.storageLocation,
        record: { status: 'preparing', requestId }, invalidated: false };
      requests.set(requestId, current); scheduledRender();
      await new Promise((resolve) => {
        current.release = resolve;
        Promise.resolve(send('linghuashi:chat-image-generate', { requestId, binding: entry.binding,
          imageId: row.id, edits, randomize: !edits, automatic: false, storageLocation: row.storageLocation }))
          .catch(() => { current.record.status = 'failed'; resolve(); notice('控制台未能载入，请重试'); scheduledRender(); });
      });
    };
    try {
      if (navigator.locks) await navigator.locks.request(`linghuashi:${account}:image:${row.storageLocation}:${groupId}`, { ifAvailable: true }, run);
      else if (![...requests.values()].some((item) => item.quickImage && item.groupId === groupId && CHAT_PENDING.has(item.record?.status))) await run(true);
    } catch (error) { notice(error.message); }
  }

  async function request(entry, automatic, draftPlan) {
    const smart = entry.binding.kind === 'smart';
    const assistant = normalizeAssistant(settings().assistant);
    if (!store || !isCurrent(entry) || (automatic && !(smart ? assistant.autoPrompt : settings().auto))) return;
    if ([...requests.values()].some((item) => item.binding.id === entry.binding.id && CHAT_PENDING.has(item.record?.status))) return;
    const execute = async (lock) => {
      if (destroyed || !isCurrent(entry)) return;
      if (!lock && navigator.locks) { notice('这个配图任务已在其他标签页运行'); return; }
      const previous = await store.get(entry.binding.id);
      if (previous && automatic && !draftPlan) return;
      if (draftPlan && previous?.status !== 'drafted') { notice('配图草稿已变化，请刷新消息后重试'); return; }
      if (previous && (!navigator.locks && CHAT_PENDING.has(previous.status))) {
        notice('任务记录待核对，请先检查服务端任务'); return;
      }
      if (previous && !draftPlan && !window.confirm('这张配图有任务记录。请先核对服务端是否已经生成；继续会重新提交生图请求，可能再次计费。')) return;
      const requestId = randomUUID();
      const record = await store.reserve(entry.binding, requestId, Boolean(previous));
      if (!record) return;
      if (!isCurrent(entry)) {
        await store.update(entry.binding.id, requestId, { status: 'cancelled' });
        return;
      }
      const current = { ...entry, requestId, record, invalidated: false };
      if (draftPlan) await store.update(entry.binding.id, requestId, { status: 'preparing', assistant: draftPlan });
      requests.set(requestId, current);
      channel?.postMessage({ id: entry.binding.id });
      scheduledRender();
      await new Promise((resolve) => {
        current.release = resolve;
        Promise.resolve(send(draftPlan ? 'linghuashi:chat-draft-generate' : smart ? 'linghuashi:chat-assist' : 'linghuashi:chat-generate', {
          requestId, prompt: entry.prompt, binding: entry.binding, automatic,
          plan: draftPlan,
          previous: smart ? entry.previous : undefined,
          openEditor: entry.openEditor === true,
          storageLocation: record.storageLocation,
        })).catch(async () => {
          await updateRecord(current, { status: 'failed', error: '控制台未能载入，请重试' });
          resolve(); scheduledRender();
        });
      });
    };
    if (navigator.locks) {
      await navigator.locks.request(`linghuashi:${account}:${entry.binding.id}`, { ifAvailable: true }, execute);
    } else await execute(true);
  }

  function openDraft(entry) {
    if (!isCurrent(entry) || !entry.record?.assistant) return;
    open('assistant');
    void send('linghuashi:chat-assistant-open', {
      requestId: entry.record.requestId, binding: entry.binding,
      plan: entry.record.assistant, storageLocation: entry.record.storageLocation,
    });
  }

  function generateDraft(entry) {
    if (!isCurrent(entry) || !entry.record?.assistant?.shouldDraw) return;
    void request(entry, false, entry.record.assistant);
  }

  async function prepareSmartChildren(entry, plan, { reset = false, start = false, automatic = false } = {}) {
    if (entry.binding.kind !== 'smart' || entry.binding.slot !== 0) return;
    const shots = illustrationPlans(plan);
    for (let index = 1; index < shots.length; index++) {
      const slot = await bindSmartSlot(getContext(), entry.message, index);
      if (!slot || !isCurrent(entry)) break;
      const previous = await store.get(slot.binding.id);
      if (previous && (CHAT_PENDING.has(previous.status) || previous.status === 'completed' && !reset)) continue;
      const requestId = randomUUID();
      const record = await store.reserve(slot.binding, requestId, Boolean(previous));
      if (!record) continue;
      const shot = selectedIllustration(plan, index);
      const child = { ...slot, message: entry.message, text: entry.text, prompt: shot.positive, requestId, record };
      await updateRecord(child, { status: 'drafted', assistant: shot });
      entries.set(slot.binding.id, child);
      if (start) void request(child, automatic, shot);
    }
  }

  async function receive(data) {
    if (data.type === 'linghuashi:chat-current-assist') {
      const context = getContext();
      const message = [...context.chat].reverse().find((item) => !item.is_user && !item.is_system && typeof item.mes === 'string');
      const entry = [...entries.values()].find((item) => item.message === message && item.binding.kind === 'smart');
      if (!entry) { notice('请打开角色回复；已有生图标签的消息可直接使用原生图入口'); return; }
      entry.openEditor = true;
      void request(entry, false);
      return;
    }
    const restored = data.binding ? entries.get(data.binding.id) : null;
    const entry = requests.get(data.requestId) || (restored?.record?.requestId === data.requestId
      || restored && store?.hasImageRequest(restored.binding.id, data.requestId) ? restored : null);
    if (entry && data.type === 'linghuashi:chat-draft-submit') {
      if (data.illustrationIndex > 0 && entry.binding.kind === 'smart' && entry.binding.slot === 0) {
        const child = await bindSmartSlot(getContext(), entry.message, data.illustrationIndex);
        const target = child && entries.get(child.binding.id);
        if (!target || !isCurrent(target) || target.record?.status !== 'drafted') {
          notice('这张配图已变化或正在生成，请在聊天中核对'); return;
        }
        await updateRecord({ ...target, requestId: target.record.requestId }, { status: 'drafted', assistant: data.plan });
        void request(target, false, data.plan); return;
      }
      if (!isCurrent(entry) || !['drafted', 'skipped'].includes(entry.record?.status)) {
        notice('原消息或草稿状态已变化，请在消息上重新操作'); return;
      }
      await updateRecord(entry, { status: 'drafted', assistant: data.plan, savedIds: [] });
      if (data.allIllustrations) await prepareSmartChildren(entry, data.plan, { start: true });
      void request(entry, false, data.plan);
      return;
    }
    if (data.type === 'linghuashi:chat-validate') {
      send('linghuashi:chat-valid', { validationId: data.validationId,
        valid: Boolean(entry && !entry.invalidated && isCurrent(entry)
          && (!data.automatic || (entry.binding.kind === 'smart'
            ? normalizeAssistant(settings().assistant).autoPrompt : settings().auto))) });
      return;
    }
    if (data.type === 'linghuashi:chat-task' && (data.imageId || entry?.quickImage)) {
      if (entry?.quickImage) {
        entry.record = { ...data };
        if (!CHAT_PENDING.has(data.status)) { entry.release?.(); requests.delete(data.requestId); }
      }
      scheduledRender(); return;
    }
    if (entry && data.type === 'linghuashi:chat-draft' && data.plan) {
      if (!isCurrent(entry) || ['queued', 'running', 'completed'].includes(entry.record?.status)) return;
      entry.requestId = data.requestId;
      await updateRecord(entry, { status: data.generating ? 'preparing' : data.plan.shouldDraw ? 'drafted' : 'skipped', assistant: data.plan, savedIds: [] });
      await prepareSmartChildren(entry, data.plan, { reset: data.analysis === true,
        start: data.generating && normalizeAssistant(settings().assistant).autoImage, automatic: true });
      if (!data.generating) entry.release?.();
      scheduledRender(); return;
    }
    if (!entry || data.type !== 'linghuashi:chat-task' || !Object.hasOwn(labels, data.status)) return;
    entry.progress = data.progress;
    entry.requestId = data.requestId;
    await updateRecord(entry, {
      status: data.status, phase: typeof data.phase === 'string' ? data.phase.slice(0, 30) : '',
      error: typeof data.error === 'string' ? data.error.slice(0, 500) : '',
      recoverable: data.recoverable === true,
      savedIds: Array.isArray(data.savedIds) ? data.savedIds.filter((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id)).slice(0, 32) : [],
    });
    if (!CHAT_PENDING.has(data.status)) {
      entry.release?.();
      const finished = [...requests.values()].filter((item) => !CHAT_PENDING.has(item.record?.status));
      for (const old of finished.slice(0, Math.max(0, finished.length - 50))) requests.delete(old.requestId);
    }
    scheduledRender();
  }

  const context = getContext();
  const on = (key, handler) => {
    const type = context.eventTypes[key];
    if (type) { context.eventSource.on(type, handler); listeners.push([type, handler]); }
  };
  on('GENERATION_STARTED', (type, _options, dryRun) => {
    if (!dryRun && type !== 'quiet') {
      stopped = false; generating = true;
      // Tavern owns the message DOM while streaming. Invalidate any in-flight
      // render so a late storage response cannot replace its text or images.
      revision++; clearTimeout(renderTimer);
    }
  });
  on('GENERATION_STOPPED', () => { stopped = true; generating = false; pendingReplies.clear(); scheduledRender(); });
  on('GENERATION_ENDED', () => { generating = false; scheduledRender(); });
  on('MESSAGE_RECEIVED', (id, type) => {
    const current = getContext();
    if (type !== 'first_message' && !stopped && !current.streamingProcessor?.isStopped
      && (settings().auto || normalizeAssistant(settings().assistant).autoPrompt)) {
      pendingReplies.add(current.chat[Number(id)]);
    }
    scheduledRender();
  });
  for (const key of ['CHAT_CHANGED', 'CHAT_LOADED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED',
    'MESSAGE_DELETED', 'MORE_MESSAGES_LOADED', 'CHARACTER_MESSAGE_RENDERED',
    'MESSAGE_SWIPE_DELETED']) on(key, scheduledRender);
  for (const key of ['CHAT_CHANGED', 'CHAT_LOADED']) on(key, () => reader.reset());
  const chat = document.getElementById('chat');
  function observeChat() {
    if (chat && !destroyed) observer?.observe(chat, { childList: true, characterData: true, subtree: true });
  }
  if (chat) {
    observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => {
        const target = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
        return target?.closest('.mes_text') || [...mutation.addedNodes, ...mutation.removedNodes].some((node) =>
          node.nodeType === 1 && (node.matches?.('.mes,.mes_text') || node.querySelector?.('.mes,.mes_text')));
      })) scheduledRender();
    });
    observeChat();
  }
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(`linghuashi-chat:${account}`);
    channel.onmessage = scheduledRender;
  }
  void reconcileSafely();
  const syncTimer = setInterval(() => {
    if (settings().enabled && document.visibilityState === 'visible') scheduledRender();
  }, 15000);
  return {
    receive,
    read: (action, data, signal) => reader.receive(action, data, signal),
    async prepareExternal({ chat, taskId, storageLocation }) {
      await ready;
      const context = getContext(), options = settings();
      if (!store || !options.enabled || options.externalAPI === false || chat?.chatKey !== chatIdentity(context)
        || !Number.isSafeInteger(chat.messageId) || !Number.isSafeInteger(chat.slot)
        || !/^[a-f0-9-]{36}$/.test(taskId || '') || storageLocation !== options.cacheLocation) {
        throw apiError('CHAT_TARGET_INVALID', '聊天目标已变化或存储位置与当前聊天配置不一致');
      }
      const message = context.chat[chat.messageId], text = message?.mes;
      const slots = await bindImageSlots(context, message, options.triggerPrefix, options.triggerSuffix);
      const slot = slots[chat.slot] || (!slots.length && chat.slot === 0 ? await bindSmartSlot(context, message) : null);
      if (!slot) throw apiError('CHAT_TARGET_INVALID', '未找到对应角色消息或配图位置');
      const entry = { ...slot, message, text };
      if (!isCurrent(entry)) throw apiError('CHAT_TARGET_INVALID', '原消息或回复分支已变化');
      const previous = await store.get(slot.binding.id);
      if (previous && previous.requestId !== taskId) throw apiError('CHAT_TARGET_BUSY', '此配图位置已有记录，请使用其他位置或聊天图片的再画一张');
      const record = previous || await store.reserve(slot.binding, taskId, false);
      if (!record) throw apiError('CHAT_TARGET_BUSY', '此配图位置已由其他任务占用');
      const current = { ...entry, requestId: taskId, record, invalidated: false };
      entries.set(entry.binding.id, current); requests.set(taskId, current);
      if (!isCurrent(current)) {
        await updateRecord(current, { status: 'cancelled' });
        requests.delete(taskId);
        throw apiError('CHAT_TARGET_INVALID', '聊天目标已变化');
      }
      scheduledRender();
      return { binding: slot.binding };
    },
    refresh: scheduledRender,
    destroy() {
      destroyed = true; revision++; clearTimeout(renderTimer); clearInterval(syncTimer); observer?.disconnect(); removeCards();
      reader.destroy();
      dialogSession?.controller.abort();
      channel?.close(); store?.close();
      for (const [type, handler] of listeners) context.eventSource.removeListener(type, handler);
      for (const entry of requests.values()) entry.release?.();
    },
  };
}
