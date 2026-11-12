import { icon, paintIcons } from '../icons.js';
import { getCharacterTheme } from './appearance.js';
import { chatImagePrompt, chatImagePromptText } from '../chat-image-actions.js';
import { normalizeVersion } from '../../server/linghuashi-storage/image-versions.mjs';
import quickCSS from './chat-quick.css?inline';
import { generationTransitionState } from '../generation-transition.js';
import { renderGenerationTransition } from './generation-transition.js';

export { quickCSS };

export function quickTheme(node, theme) {
  const accent = getCharacterTheme(theme).accent || '#3672ce';
  const dark = document.getElementById('linghuashi-extension-host')?.dataset.theme === 'dark';
  node.style.setProperty('--chat-accent', accent);
  node.style.setProperty('--quick-bg', dark ? '#24262b' : '#fbfcff');
  node.style.setProperty('--quick-text', dark ? '#edf0f6' : '#293b56');
  node.style.setProperty('--quick-border', dark ? '#555b68' : '#c5cfdd');
}

export function quickButton(glyph, label, action, disabled = false) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'quick-icon'; button.title = label;
  button.setAttribute('aria-label', label); button.innerHTML = icon(glyph); button.disabled = disabled;
  button.addEventListener('click', (event) => { event.stopPropagation(); action(); });
  return button;
}

export function appendImageTools({ container, controlsContainer = container, row, versions, task, pending, theme, onAction, onVersion }) {
  const transition = generationTransitionState(task, { remote: task?.remote === true });
  if (transition) {
    const panel = document.createElement('div');
    panel.innerHTML = renderGenerationTransition({ theme, task, compact: true, remote: task?.remote === true });
    if (transition.cancellable || task.remote && task.id && task.phase !== 'saving') {
      const control = document.createElement('div'); control.className = 'generation-controls';
      control.append(quickButton('x', '取消此任务', () => onAction('cancel')));
      panel.firstElementChild.append(control);
    }
    container.append(panel.firstElementChild);
  }
  const tools = document.createElement('div'); tools.className = 'picture-tools';
  const actions = [
    ['refresh-cw', '再画一张', 'repeat', pending || !row.snapshot],
    ['pencil', '修改提示词', 'prompt', pending || !row.snapshot],
    ['star', row.favorite ? '取消收藏' : '收藏图片', 'favorite', false],
    ['arrow-down-to-line', '下载原图', 'download', false],
  ];
  for (const [glyph, label, action, disabled] of actions) {
    const button = quickButton(glyph, label, () => onAction(action), disabled);
    if (action === 'repeat') button.title = '再画一张：保留原图场景，使用当前预设的正向提示词、画师串和负面提示词';
    if (action === 'favorite') button.setAttribute('aria-pressed', String(Boolean(row.favorite)));
    tools.append(button);
  }
  const more = document.createElement('details'); more.className = 'quick-more';
  const summary = document.createElement('summary'); summary.className = 'quick-icon';
  summary.title = '更多操作'; summary.setAttribute('aria-label', '更多操作'); summary.innerHTML = icon('more-horizontal');
  const menu = document.createElement('div'); menu.setAttribute('role', 'group'); menu.setAttribute('aria-label', '更多图片操作');
  for (const [glyph, label, action, needsSnapshot] of [
    ['refresh-cw', '沿用原图画风再画一张', 'repeat-original', true],
    ['copy', '复制提示词', 'copy', true], ['replace', '导入生图参数', 'restore', true],
    ['sliders-horizontal', '完整参数编辑', 'edit', true], ['image-plus', '图生图', 'source', true],
    ['brush', '局部重绘', 'inpaint', true], ['wand-sparkles', '图片增强', 'enhance', false],
    ['images', '绘图管理', 'view', false],
  ]) {
    const button = document.createElement('button'); button.type = 'button';
    button.disabled = needsSnapshot && !row.snapshot || action === 'repeat-original' && pending;
    button.innerHTML = `${icon(glyph)}<span>${label}</span>`;
    button.addEventListener('click', () => { more.open = false; onAction(action); }); menu.append(button);
  }
  more.append(summary, menu); tools.append(more); controlsContainer.append(tools);
  if (versions.length > 1) {
    const bar = document.createElement('div'); bar.className = 'quick-version';
    const index = versions.findIndex((version) => version.id === row.id);
    const choice = document.createElement('select'); choice.setAttribute('aria-label', '聊天图片历史版本');
    for (const version of versions) {
      const option = document.createElement('option'); option.value = version.id;
      option.textContent = `版本 ${normalizeVersion(version.version, version.id).number}${version.id === row.id ? ' · 当前' : ''}`;
      option.selected = version.id === row.id; choice.append(option);
    }
    choice.addEventListener('change', () => onVersion(choice.value));
    bar.append(quickButton('chevron-left', '上一个版本', () => onVersion(versions[index - 1].id), index <= 0),
      choice, quickButton('chevron-right', '下一个版本', () => onVersion(versions[index + 1].id), index >= versions.length - 1));
    controlsContainer.append(bar);
  }
  if (task && !transition && !['completed', 'cancelled'].includes(task.status)) {
    const status = document.createElement('div'); status.className = 'quick-image-status'; status.setAttribute('role', 'status');
    const labels = { queued: '排队中', preparing: '准备生图', confirming: '等待确认', running: '正在生图', paused: '等待继续', failed: '生成失败', uncertain: '生成结果待核对' };
    const text = document.createElement('span'); text.textContent = task.error || labels[task.status] || '';
    status.append(text);
    if (task.recoverable) status.append(quickButton(task.execution ? 'download' : 'play',
      task.execution ? '继续取图 / 保存' : '继续此任务', () => onAction('recover')));
    else if (['running', 'queued', 'preparing', 'confirming'].includes(task.status)) {
      status.append(quickButton('x', '取消此任务', () => onAction('cancel')));
    }
    container.append(status);
  }
}

function openDialog({ title, theme, signal, build, submit, submitLabel = '生成新版本' }) {
  signal?.throwIfAborted();
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const host = document.createElement('div'); host.className = 'linghuashi-chat-dialog-host'; quickTheme(host, theme);
    const shadow = host.attachShadow({ mode: 'open' }), style = document.createElement('style'); style.textContent = quickCSS;
    const dialog = document.createElement('dialog'); dialog.className = 'quick-dialog'; dialog.setAttribute('aria-label', title);
    dialog.innerHTML = '<form><header><h2></h2></header><div class="quick-dialog-body"></div><footer></footer></form>';
    dialog.querySelector('h2').textContent = title;
    const close = quickButton('x', '关闭', () => dialog.close());
    dialog.querySelector('header').append(close);
    build(dialog.querySelector('.quick-dialog-body'));
    const button = document.createElement('button'); button.type = 'submit';
    button.innerHTML = `${icon(submit ? 'sparkles' : 'check')}<span></span>`; button.querySelector('span').textContent = submitLabel;
    dialog.querySelector('footer').append(button);
    let result = null;
    dialog.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      result = submit ? submit(new FormData(event.target)) : null;
      if (result !== false) dialog.close();
    });
    const abort = () => dialog.close();
    dialog.addEventListener('close', () => {
      signal?.removeEventListener('abort', abort); host.remove(); resolve(result);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    }, { once: true });
    signal?.addEventListener('abort', abort, { once: true });
    shadow.append(style, dialog); document.body.append(host); paintIcons(shadow); dialog.showModal();
  });
}

export function editChatPrompt(row, theme, signal) {
  const draft = chatImagePrompt(row);
  return openDialog({ title: '修改本图提示词', theme, signal, build(body) {
    for (const [key, title, rows] of [['positive', '正向提示词', 5], ['negative', '负面提示词', 3]]) {
      const label = document.createElement('label'); label.textContent = title;
      const input = document.createElement('textarea'); input.name = key; input.value = draft[key];
      input.maxLength = 32000; input.rows = rows; input.required = key === 'positive';
      label.append(input); body.append(label);
    }
  }, submit: (data) => {
    const positive = String(data.get('positive')).trim();
    return positive ? { positive, negative: String(data.get('negative')).trim() } : false;
  } });
}

export async function copyChatPrompt(row, theme, signal) {
  const text = chatImagePromptText(row);
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    await openDialog({ title: '复制提示词', theme, signal, submitLabel: '关闭', build(body) {
      const input = document.createElement('textarea'); input.readOnly = true; input.rows = 9; input.value = text; body.append(input);
      queueMicrotask(() => { input.focus(); input.select(); });
    } });
    return false;
  }
}

export function chooseChatSlots(entries, theme, signal) {
  return openDialog({ title: '给这条回复配图', theme, signal, submitLabel: '生成所选', build(body) {
    for (const [index, entry] of entries.entries()) {
      const label = document.createElement('label'); label.className = 'quick-choice';
      const input = document.createElement('input'); input.type = 'checkbox'; input.name = 'slots'; input.value = String(index);
      input.disabled = Boolean(entry.record); input.checked = !entry.record;
      const text = document.createElement('span'); text.textContent = `${index + 1}. ${entry.prompt}${entry.record ? '（已有任务或图片）' : ''}`;
      label.append(input, text); body.append(label);
    }
  }, submit: (data) => {
    const selected = data.getAll('slots').map((index) => entries[Number(index)]).filter(Boolean);
    return selected.length ? selected : false;
  } });
}
