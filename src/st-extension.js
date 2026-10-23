import { icon, paintIcons } from './icons.js';
import { pluginIcon } from './ui/branding.js';
import { getCharacterTheme } from './ui/appearance.js';
import { DEFAULT_CONFIG } from './config.js';
import { createFloatingMenu } from './ui/floating-menu.js';
import { createChatLink } from './chat-link.js';
import { createCredentialVault } from './credential-vault.js';
import { SETTINGS_DEFAULTS } from './ui/settings.js';
import { createStorageRequest, STORAGE_ACTIONS } from './server-storage.js';
import { storageFailureInfo } from './debug-errors.js';
import { createAssistantHost } from './assistant-host.js';
import { normalizeAssistantHistory } from './assistant-history.js';
import { chatIdentity } from './chat.js';
import { RELEASE } from './release.js';
import { createReleaseMonitor, RELEASE_CACHE_KEY } from './release-monitor.js';
import { createExtensionUpdater } from './extension-update.js';
import { createUpdateNotice } from './ui/update-notice.js';
import { createExtensionAPI, apiError } from './extension-api.js';
import { getBrowserStorage } from './browser-cache.js';
import { hostEnvironment, resolveHostAccount, isWindowMessage, postWindowMessage, showExtensionSurface } from './host-compat.js';

const VERSION = RELEASE.version;
const BUILD = RELEASE.build;
const SETTINGS_KEY = 'linghuashi';
const baseURL = new URL('.', import.meta.url).href;
const getContext = () => window.SillyTavern?.getContext?.();
const plainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const clone = (value) => JSON.parse(JSON.stringify(value));

async function start() {
  if (document.getElementById('linghuashi-extension-host')) return;
  const context = getContext();
  if (!context?.extensionSettings || typeof context.saveSettingsDebounced !== 'function') {
    throw new Error('酒馆设置尚未就绪');
  }
  const hostInfo = hostEnvironment();
  const account = await resolveHostAccount();
  const browserStorage = getBrowserStorage();
  const releaseMonitor = createReleaseMonitor({ storage: browserStorage });
  const storageScope = new AbortController();
  let leavingPage = false;
  const storageRequest = createStorageRequest(() => getContext()?.getRequestHeaders?.(), {
    account, enhancedSupported: hostInfo.serverPlugins, signal: storageScope.signal, isActive: () => !leavingPage,
  });
  const credentialVault = createCredentialVault({
    account, storage: browserStorage,
    request: async (action, body) => {
      const headers = getContext()?.getRequestHeaders?.();
      if (!headers) throw new Error('酒馆请求验证尚未就绪');
      const response = await fetch(`/api/secrets/${action}`, {
        method: 'POST', headers, credentials: 'same-origin', cache: 'no-store',
        body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(response.status === 403
        ? '酒馆禁止读取秘钥，请重新填写' : '酒馆秘钥存储失败，请重试');
      return response.status === 204 ? {} : response.json();
    },
  });
  const saved = context.extensionSettings[SETTINGS_KEY];
  let ui = plainObject(saved?.ui) ? clone(saved.ui) : {};
  let assistantArchive = saved?.assistantArchive?.version === 1 ? clone(saved.assistantArchive) : null;
  let layout = { ...DEFAULT_CONFIG, ...(plainObject(saved?.layout) ? clone(saved.layout) : {}), surface: 'console', state: 'ready' };
  let frame;
  let mounted = false;
  let previousFocus;
  let sizeTimer;
  let drag;
  let skipClick = false;
  let destroyed = false;
  let requestedPage = null;
  let pendingFloatingBall = null;
  let activeChat = chatContext();
  let chatLink;
  const extensionAPI = createExtensionAPI({ version: VERSION, ensureReady: () => ensureFrame(), send: post });
  let frameReady;
  let resolveFrame;
  let rejectFrame;
  let textGenerating = Boolean(context.streamingProcessor && !context.streamingProcessor.isFinished && !context.streamingProcessor.isStopped);
  let extensionUpdateResult;
  const extensionUpdater = createExtensionUpdater({ moduleURL: import.meta.url,
    getHeaders: () => getContext()?.getRequestHeaders?.(), isBusy: () => textGenerating,
    nativeUpdates: hostInfo.kind === 'tauritavern' });
  const assistantHost = createAssistantHost({ getContext, settings: () => ui.assistant,
    post, isBusy: () => textGenerating, reader: (action, data, signal) => chatLink.read(action, data, signal) });
  const textStarted = (type, _options, dryRun) => {
    if (!dryRun && type !== 'quiet') textGenerating = true;
  };
  const textEnded = () => { textGenerating = false; };
  const textEvents = [['GENERATION_STARTED', textStarted], ['GENERATION_ENDED', textEnded], ['GENERATION_STOPPED', textEnded]]
    .map(([key, handler]) => [context.eventTypes?.[key], handler]).filter(([type]) => type);
  for (const [type, handler] of textEvents) context.eventSource?.on?.(type, handler);

  function chatContext() {
    const current = getContext();
    const count = Array.isArray(current?.chat) ? current.chat.length : 0;
    const group = current?.groupId ? current.groups?.find((item) => String(item.id) === String(current.groupId)) : null;
    return { name: count ? String(group?.name || current?.name2 || '当前聊天').slice(0, 120) : '未打开聊天', count,
      key: chatIdentity(current), avatars: group ? group.members || [] : [current?.characters?.[current.characterId]?.avatar].filter(Boolean) };
  }

  const host = document.createElement('div');
  host.id = 'linghuashi-extension-host';
  document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host { all: initial; position: fixed; inset: 0; width: 100vw; height: 100vh; height: 100dvh; margin: 0; padding: 0; border: 0; background: transparent; pointer-events: none; font: 14px "Segoe UI","Microsoft YaHei",sans-serif; color: #26334b; }
    *, *::before, *::after { box-sizing: border-box; }
    [hidden] { display: none !important; }
    button { font: inherit; cursor: pointer; }
    svg { width: 19px; height: 19px; pointer-events: none; }
    button:focus-visible { outline: 3px solid #3672ce; outline-offset: 2px; }
    .ball { position: fixed; z-index: 30000; right: 12px; bottom: 104px; display: grid; place-items: center; width: 76px; height: 76px; border: 0; border-radius: 50%; padding: 4px; background: transparent; box-shadow: none; overflow: visible; touch-action: none; pointer-events: auto; }
    .ball:hover img { filter: brightness(1.06); }
    .ball img { display: block; width: 100%; height: 100%; object-fit: contain; object-position: center; pointer-events: none; }
    .backdrop { position: fixed; inset: 0; z-index: 30001; display: grid; place-items: center; padding: 20px; background: #12172488; pointer-events: auto; }
    .window { width: min(1200px,100%); height: min(900px,calc(100vh - 40px)); height: min(900px,calc(100dvh - 40px)); display: flex; flex-direction: column; background: #fbfcff; border: 1px solid #ced8e8; border-radius: 8px; overflow: hidden; }
    .window.fullscreen { width: 100%; height: 100vh; height: 100dvh; border-radius: 0; }
    .backdrop:has(.fullscreen) { padding: 0; }
    .toolbar { min-height: 40px; display: flex; align-items: center; gap: 8px; padding: 4px 8px 4px 14px; border-bottom: 1px solid #d4deed; background: #f3f6fc; }
    .toolbar strong { font-size: 14px; font-weight: 600; }
    .badge { font-size: 11px; color: #65728a; }
    .toolbar .actions { display: flex; margin-left: auto; gap: 3px; }
    .toolbar button { display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: inherit; }
    .toolbar button:hover { background: #dfe7f4; }
    iframe { display: block; flex: 1; min-width: 0; min-height: 0; width: 100%; border: 0; background: #fbfcff; }
    .status { margin: 12px; color: #65728a; font-size: 13px; }
    :host([data-theme="dark"]) .window { background: #1b1c20; border-color: #3a3d49; color: #e8ecf5; }
    :host([data-theme="dark"]) .toolbar { background: #23242b; border-color: #3a3d49; }
    :host([data-theme="dark"]) .badge { color: #a2aabc; }
    :host([data-theme="dark"]) .toolbar button:hover { background: #343641; }
    @media (max-width: 720px) { .backdrop { padding: 0; } .window { width: 100%; height: 100vh; height: 100dvh; border-radius: 0; } .ball { width: 64px; height: 64px; padding: 3px; } }
  </style>
  <button class="ball" type="button" title="打开灵画师菜单" aria-label="打开灵画师菜单"></button>
  <div class="backdrop" hidden>
    <section class="window" role="dialog" aria-modal="true" aria-label="灵画师">
      <header class="toolbar"><strong>灵画师</strong><span class="badge">生图工坊 · ${VERSION}</span>
        <div class="actions">
          <button type="button" data-action="theme" title="切换明暗主题" aria-label="切换明暗主题">${icon('moon')}</button>
          <button type="button" data-action="fullscreen" title="切换全屏" aria-label="切换全屏">${icon('maximize-2')}</button>
          <button type="button" data-action="close" title="关闭灵画师" aria-label="关闭灵画师">${icon('x')}</button>
        </div>
      </header>
      <p class="status" role="status">正在载入…</p>
    </section>
  </div>`;
  const ball = shadow.querySelector('.ball');
  const backdrop = shadow.querySelector('.backdrop');
  const dialog = shadow.querySelector('.window');
  const status = shadow.querySelector('.status');
  const floatingMenu = createFloatingMenu({
    button: ball, container: shadow,
    onSettings: () => open('settings'),
    onHide: () => {
      pendingFloatingBall = false;
      ui.floatingBall = false;
      persist();
      post('linghuashi:floating', { visible: false });
      updateAppearance();
      shadow.activeElement?.blur();
      if (openButton.getClientRects().length) openButton.focus({ preventScroll: true });
    },
  });
  const updateNotice = createUpdateNotice({ container: shadow, storage: browserStorage, account, onOpen: () => open('updates') });
  function updateReleaseAppearance() {
    updateNotice.update({ release: releaseMonitor.getState().release, characterTheme: ui.characterTheme,
      theme: layout.theme, hidden: !backdrop.hidden || ui.enabled === false || Boolean(extensionUpdateResult) });
  }

  const entry = document.createElement('div');
  entry.id = 'linghuashi-settings-entry';
  entry.className = 'extension_container';
  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'menu_button menu_button_icon';
  openButton.setAttribute('aria-label', '打开灵画师控制台');
  openButton.innerHTML = `${icon('palette')}<span>灵画师</span>`;
  const updateBadge = document.createElement('span');
  updateBadge.dataset.releaseBadge = '';
  updateBadge.hidden = true;
  updateBadge.style.cssText = 'color:#9a281c;background:#ffe4c6;border:1px solid #d98f50;border-radius:4px;font-size:11px;line-height:1.4;padding:1px 5px;white-space:nowrap;font-weight:600';
  openButton.append(updateBadge);
  openButton.style.cssText = 'max-width:100%;flex-wrap:wrap';
  entry.append(openButton);
  paintIcons(entry);
  openButton.querySelector('svg').style.cssText = 'width:18px;height:18px;flex:none';
  const entryTarget = document.getElementById('extensions_settings') || document.getElementById('extensions_settings2');
  if (entryTarget) entryTarget.append(entry);
  else document.getElementById('extensionsMenu')?.append(entry);
  function showReleaseState(value) {
    const newer = value.release?.newer === true;
    updateBadge.hidden = !newer;
    updateBadge.textContent = newer ? `有更新 v${value.release.version}` : '';
    openButton.setAttribute('aria-label', newer ? `打开灵画师控制台，有更新 v${value.release.version}` : '打开灵画师控制台');
    openButton.title = newer ? `当前 v${VERSION}，新版本 v${value.release.version}，点击查看更新` : `灵画师 v${VERSION}`;
    updateReleaseAppearance();
    post('linghuashi:release-state', { value });
  }
  const unsubscribeRelease = releaseMonitor.subscribe(showReleaseState);
  showReleaseState(releaseMonitor.getState());
  function checkForUpdates() {
    if (!destroyed && document.visibilityState !== 'hidden' && navigator.onLine !== false) void releaseMonitor.check();
  }
  function releaseCacheChanged(event) {
    if (event.key === RELEASE_CACHE_KEY) releaseMonitor.refreshCache();
  }
  const releaseStartTimer = setTimeout(checkForUpdates, 5000);
  const releaseTimer = setInterval(checkForUpdates, 15 * 60 * 1000);
  window.addEventListener('focus', checkForUpdates);
  window.addEventListener('online', checkForUpdates);
  window.addEventListener('storage', releaseCacheChanged);
  document.addEventListener('visibilitychange', checkForUpdates);

  function persist() {
    if (destroyed) return;
    const current = getContext();
    current.extensionSettings[SETTINGS_KEY] = {
      ...(plainObject(current.extensionSettings[SETTINGS_KEY]) ? current.extensionSettings[SETTINGS_KEY] : {}),
      schemaVersion: 1, version: VERSION, ui: clone(ui), layout: clone(layout),
      ...(assistantArchive ? { assistantArchive } : {}),
    };
    current.saveSettingsDebounced();
  }

  function updateAppearance() {
    host.dataset.theme = layout.theme === 'dark' ? 'dark' : 'light';
    const theme = getCharacterTheme(ui.characterTheme).id;
    const selected = ball.querySelector('img')?.dataset.iconTheme;
    if (selected !== theme) ball.innerHTML = pluginIcon(theme);
    ball.hidden = ui.enabled === false || ui.floatingBall === false || !backdrop.hidden;
    const themeButton = shadow.querySelector('[data-action="theme"]');
    themeButton.innerHTML = icon(layout.theme === 'dark' ? 'sun' : 'moon');
    paintIcons(shadow);
    positionBall();
    floatingMenu.update({ characterTheme: theme, theme: layout.theme });
    updateReleaseAppearance();
  }

  function positionBall() {
    const position = layout.ballPosition;
    if (!plainObject(position) || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
    const box = ball.getBoundingClientRect();
    const width = box.width || (window.innerWidth <= 720 ? 64 : 76);
    const height = box.height || (window.innerWidth <= 720 ? 64 : 76);
    const x = Math.max(4, Math.min(window.innerWidth - width - 4, position.x));
    const y = Math.max(4, Math.min(window.innerHeight - height - 4, position.y));
    ball.style.cssText = `left:${x}px;top:${y}px;right:auto;bottom:auto`;
  }

  function post(type, value = {}) {
    postWindowMessage(frame?.contentWindow, { type, ...value });
  }

  function ensureFrame() {
    if (mounted) return Promise.resolve();
    if (!frameReady) {
      frameReady = new Promise((resolve, reject) => { resolveFrame = resolve; rejectFrame = reject; });
      frameReady.catch(() => {});
      frame = document.createElement('iframe');
      frame.title = '灵画师控制台';
      frame.id = 'linghuashi-extension-frame';
      frame.src = `${baseURL}extension-ui.html?ver=${VERSION}&build=${BUILD}`;
      frame.setAttribute('allow', 'clipboard-write');
      frame.addEventListener('load', () => {
        if (destroyed) return;
        frame.contentWindow.addEventListener('pointerdown', onPageResume, true);
        frame.contentWindow.addEventListener('keydown', onPageResume, true);
      });
      dialog.append(frame);
      sizeTimer = setTimeout(() => {
        if (!mounted && !destroyed) {
          status.textContent = '载入超时，请刷新酒馆后重试';
          rejectFrame(new Error('控制台载入超时'));
        }
      }, 20000);
    }
    return frameReady;
  }

  function open(page) {
    if (destroyed) return;
    if (['settings', 'updates', 'generate', 'batch', 'gallery', 'reader', 'assistant', 'characters', 'styles', 'tags', 'connection', 'components', 'debug', 'changelog'].includes(page)) requestedPage = page;
    floatingMenu.close();
    previousFocus = shadow.activeElement || document.activeElement;
    backdrop.hidden = false;
    activeChat = chatContext();
    ensureFrame();
    post('linghuashi:chat', { chat: activeChat });
    if (mounted && requestedPage) {
      post('linghuashi:navigate', { page: requestedPage });
      requestedPage = null;
    }
    updateAppearance();
    checkForUpdates();
    shadow.querySelector('[data-action="close"]').focus({ preventScroll: true });
  }

  function close() {
    backdrop.hidden = true;
    updateAppearance();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }

  function onMessage(event) {
    if (destroyed || !isWindowMessage(event, frame?.contentWindow)) return;
    const data = event.data;
    if (!plainObject(data)) return;
    if (data.type === 'linghuashi:release-check' && typeof data.requestId === 'string' && data.requestId.length <= 64) {
      void releaseMonitor.check({ force: true }).then((value) => {
        if (!destroyed) post('linghuashi:release-result', { requestId: data.requestId, value });
      });
      return;
    }
    if (data.type === 'linghuashi:extension-manager') {
      const manager = document.getElementById('extensions_details');
      if (manager) { close(); manager.click(); }
      return;
    }
    if (data.type === 'linghuashi:update' && typeof data.requestId === 'string' && data.requestId.length <= 64) {
      const latest = releaseMonitor.getState().release;
      if (!latest?.newer || data.version !== latest.version) {
        post('linghuashi:update-result', { requestId: data.requestId, error: '版本状态已变化，请重新检查版本' });
        return;
      }
      void (extensionUpdateResult ? Promise.resolve(extensionUpdateResult) : extensionUpdater.update(latest.version)).then(
        (value) => {
          extensionUpdateResult = value; updateNotice.dismiss(); updateReleaseAppearance();
          post('linghuashi:update-result', { requestId: data.requestId, value });
        },
        (error) => post('linghuashi:update-result', { requestId: data.requestId, error: error.message }),
      );
      return;
    }
    if (data.type === 'linghuashi:update-reload') {
      if (extensionUpdateResult?.reloadRequired && !textGenerating) location.reload();
      return;
    }
    if (data.type === 'linghuashi:extension-response' || data.type === 'linghuashi:extension-task') {
      extensionAPI.receive(data); return;
    }
    if (data.type === 'linghuashi:extension-chat-request' && typeof data.requestId === 'string' && data.requestId.length <= 64) {
      void chatLink.prepareExternal(data).then(
        (value) => post('linghuashi:extension-chat-result', { requestId: data.requestId, value }),
        (error) => post('linghuashi:extension-chat-result', { requestId: data.requestId,
          error: { code: error.code || 'CHAT_TARGET_INVALID', message: error.message } }),
      );
      return;
    }
    if (data.type === 'linghuashi:ready') {
      activeChat = chatContext();
      post('linghuashi:init', { account, ui: clone(ui), assistantArchive, layout: clone(layout), chat: activeChat,
        host: hostInfo, page: requestedPage, releaseState: releaseMonitor.getState() });
      requestedPage = null;
    } else if (data.type === 'linghuashi:mounted') {
      mounted = true;
      post('linghuashi:release-state', { value: releaseMonitor.getState() });
      resolveFrame();
      clearTimeout(sizeTimer);
      status.hidden = true;
      if (requestedPage) {
        post('linghuashi:navigate', { page: requestedPage });
        requestedPage = null;
      }
      if (pendingFloatingBall !== null) post('linghuashi:floating', { visible: pendingFloatingBall });
    } else if (data.type === 'linghuashi:assistant-archive' && data.value?.version === 1
      && Array.isArray(data.value.rows) && JSON.stringify(data.value).length <= 650000) {
      assistantArchive = { version: 1, updatedAt: Date.now(), rows: normalizeAssistantHistory(data.value.rows) };
      delete ui.assistantHistory;
      persist();
    } else if (data.type === 'linghuashi:state' && plainObject(data.ui)) {
      const requestId = typeof data.requestId === 'string' ? data.requestId.slice(0, 64) : '';
      try {
        const serialized = JSON.stringify(data.ui);
        if (serialized.length > 2000000) throw new Error('设置容量已满');
        ui = JSON.parse(serialized);
        if (assistantArchive) delete ui.assistantHistory;
        if (pendingFloatingBall !== null) {
          const acknowledged = ui.floatingBall === pendingFloatingBall;
          ui.floatingBall = pendingFloatingBall;
          if (acknowledged) pendingFloatingBall = null;
        }
        persist();
        post('linghuashi:state-result', { requestId });
        updateAppearance();
        chatLink?.refresh();
      } catch {
        post('linghuashi:state-result', { requestId, error: '酒馆未能接收设置' });
      }
    } else if (data.type === 'linghuashi:restore-layout' && plainObject(data.layout)) {
      layout = { ...layout, theme: data.layout.theme === 'dark' ? 'dark' : 'light',
        density: ['compact', 'standard', 'relaxed'].includes(data.layout.density) ? data.layout.density : layout.density };
      persist(); updateAppearance(); post('linghuashi:layout', { layout: clone(layout) });
      chatLink?.refresh();
    } else if (data.type === 'linghuashi:close') close();
    else if (data.type === 'linghuashi:attention') open(data.page || 'generate');
    else if (data.type === 'linghuashi:images-changed') chatLink?.refresh();
    else if (['linghuashi:chat-task', 'linghuashi:chat-validate', 'linghuashi:chat-draft', 'linghuashi:chat-draft-submit', 'linghuashi:chat-current-assist'].includes(data.type)) {
      void chatLink?.receive(data);
    }
    else if (data.type === 'linghuashi:assistant-request') void assistantHost.receive(data);
    else if (data.type === 'linghuashi:secret-request' && typeof data.requestId === 'string' && data.requestId.length <= 64) {
      void (async () => {
        try {
          let value;
          if (data.action === 'read') value = await credentialVault.read(data.provider, data.ref);
          else if (data.action === 'write') value = await credentialVault.write(data.provider, data.key, data.ref);
          else throw new Error('未知秘钥操作');
          post('linghuashi:secret-result', { requestId: data.requestId, value });
        } catch {
          post('linghuashi:secret-result', { requestId: data.requestId, error: '秘钥无法保存或读取，请重新填写后重试' });
        }
      })();
    }
    else if (data.type === 'linghuashi:storage-request' && typeof data.requestId === 'string'
      && data.requestId.length <= 64 && STORAGE_ACTIONS.has(data.action)) {
      void storageRequest(data.action, data.body).then(
        (value) => { if (!destroyed) post('linghuashi:storage-result', { requestId: data.requestId, value }); },
        (error) => { if (!destroyed) post('linghuashi:storage-result', { requestId: data.requestId, error: error.message, failure: storageFailureInfo(error) }); },
      );
    }
    else if (data.type === 'linghuashi:error') {
      clearTimeout(sizeTimer);
      status.hidden = false;
      status.textContent = typeof data.message === 'string' ? data.message.slice(0, 200) : '界面无法载入';
      rejectFrame?.(new Error(status.textContent));
    }
  }

  function updateChat() {
    activeChat = chatContext();
    post('linghuashi:chat', { chat: activeChat });
  }
  function onResize() { positionBall(); floatingMenu.reposition(); }
  function onBeforeUnload() { leavingPage = true; }
  function onPageResume() { leavingPage = false; }
  function onPageHide(event) { if (!event.persisted) destroy(); }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    storageScope.abort();
    clearTimeout(sizeTimer);
    clearTimeout(releaseStartTimer);
    clearInterval(releaseTimer);
    unsubscribeRelease();
    releaseMonitor.destroy();
    window.removeEventListener('focus', checkForUpdates);
    window.removeEventListener('online', checkForUpdates);
    window.removeEventListener('storage', releaseCacheChanged);
    document.removeEventListener('visibilitychange', checkForUpdates);
    floatingMenu.destroy();
    updateNotice.destroy();
    chatLink?.destroy();
    assistantHost.destroy();
    extensionAPI.destroy();
    window.removeEventListener('message', onMessage);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('pageshow', onPageResume);
    window.removeEventListener('pointerdown', onPageResume, true);
    window.removeEventListener('keydown', onPageResume, true);
    frame?.contentWindow?.removeEventListener('pointerdown', onPageResume, true);
    frame?.contentWindow?.removeEventListener('keydown', onPageResume, true);
    for (const type of events) context.eventSource?.removeListener?.(type, updateChat);
    for (const [type, handler] of textEvents) context.eventSource?.removeListener?.(type, handler);
    entry.remove();
    host.remove();
    delete window.Linghuashi;
  }

  ball.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const rect = ball.getBoundingClientRect();
    drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: rect.x, y: rect.y, moved: false };
    ball.setPointerCapture(event.pointerId);
  });
  ball.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 5) drag.moved = true;
    if (!drag.moved) return;
    floatingMenu.close();
    layout.ballPosition = { x: drag.x + dx, y: drag.y + dy };
    positionBall();
  });
  function finishDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved) {
      skipClick = true;
      persist();
      setTimeout(() => { skipClick = false; }, 0);
    }
    drag = null;
  }
  ball.addEventListener('pointerup', finishDrag);
  ball.addEventListener('pointercancel', finishDrag);
  ball.addEventListener('click', () => {
    if (skipClick) { skipClick = false; return; }
    floatingMenu.toggle();
  });
  openButton.addEventListener('click', () => open(releaseMonitor.getState().release?.newer ? 'updates' : undefined));
  shadow.addEventListener('click', (event) => {
    const action = event.target.closest('button')?.dataset.action;
    if (action === 'close' || event.target === backdrop) close();
    if (action === 'theme') {
      layout.theme = layout.theme === 'dark' ? 'light' : 'dark';
      persist();
      post('linghuashi:layout', { layout });
      updateAppearance();
      chatLink?.refresh();
    }
    if (action === 'fullscreen') {
      const fullscreen = dialog.classList.toggle('fullscreen');
      shadow.querySelector('[data-action="fullscreen"]').innerHTML = icon(fullscreen ? 'minimize-2' : 'maximize-2');
      paintIcons(shadow);
    }
  });
  shadow.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !backdrop.hidden) { event.preventDefault(); close(); }
    if (event.key === 'Tab' && !backdrop.hidden && event.shiftKey && shadow.activeElement === shadow.querySelector('[data-action="theme"]')) {
      event.preventDefault();
      frame?.focus();
    }
  });
  window.addEventListener('message', onMessage);
  window.addEventListener('resize', onResize);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('pageshow', onPageResume);
  window.addEventListener('pointerdown', onPageResume, true);
  window.addEventListener('keydown', onPageResume, true);
  const events = ['CHAT_CHANGED', 'MESSAGE_SENT', 'MESSAGE_RECEIVED', 'MESSAGE_DELETED']
    .map((key) => context.eventTypes?.[key]).filter(Boolean);
  for (const type of events) context.eventSource?.on?.(type, updateChat);
  chatLink = createChatLink({
    account, getContext, storageRequest,
    settings: () => ({ ...SETTINGS_DEFAULTS, ...ui, enabled: ui.enabled !== false, triggerPrefix: ui.triggerPrefix || 'image###', triggerSuffix: ui.triggerSuffix || '###' }),
    send: async (type, value) => {
      await ensureFrame();
      if (!destroyed) post(type, value);
    },
    open,
    notice: (message) => window.toastr?.info(message, '灵画师'),
  });
  // The top layer avoids transformed Tavern themes changing fixed positioning.
  showExtensionSurface(host);
  updateAppearance();
  window.Linghuashi = Object.freeze({
    ...extensionAPI.api, open, close,
    getChatTarget: (messageId, slot = 0) => {
      if (!Number.isSafeInteger(messageId) || messageId < 0 || !Number.isSafeInteger(slot) || slot < 0 || slot > 15) {
        throw apiError('INVALID_OPTIONS', '消息编号或配图位置无效');
      }
      return { chatKey: chatIdentity(getContext()), messageId, slot };
    },
    capabilities: Object.freeze({ ui: true, generate: true, extensionAPI: 1, chatImages: true, serverImages: true, promptAssistant: true, smartIllustration: true, characterProfiles: true,
      host: hostInfo.kind, serverEnhancement: hostInfo.serverPlugins, backends: Object.freeze(['novelai', 'comfyui', 'openai', 'sdwebui']) }),
  });
  window.dispatchEvent(new CustomEvent('linghuashi:api-ready', { detail: { version: VERSION, apiVersion: 1 } }));
}

$(async () => {
  try { await start(); }
  catch (error) {
    console.error('[灵画师]', error);
    window.toastr?.error(error.message, '灵画师无法载入');
  }
});
