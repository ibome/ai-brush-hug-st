import './styles/plugin.css';
import { isWindowMessage, postWindowMessage } from './host-compat.js';

async function boot() {
  if (window.parent === window) throw new Error('酒馆连接未建立');
  const initial = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('酒馆连接超时，请重新打开'));
    }, 15000);
    function onMessage(event) {
      if (!isWindowMessage(event, window.parent)) return;
      if (event.data?.type !== 'linghuashi:init' || typeof event.data.account !== 'string' || !event.data.account) return;
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      resolve(event.data);
    }
    window.addEventListener('message', onMessage);
    postWindowMessage(window.parent, { type: 'linghuashi:ready' });
  });

  window.__LINGHUASHI_ENV__ = {
    mode: 'extension', account: initial.account, ui: initial.ui, chat: initial.chat, releaseState: initial.releaseState, host: initial.host,
  };
  const [{ normalizeConfig }, plugin] = await Promise.all([
    import('./config.js'), import('./ui/plugin.js'),
  ]);
  await plugin.restoreCredentials();
  plugin.mountPlugin(document.getElementById('plugin-root'), normalizeConfig({ ...initial.layout, surface: 'console', state: 'ready' }));
  if (initial.page) plugin.showPage(initial.page);

  window.addEventListener('message', (event) => {
    if (!isWindowMessage(event, window.parent)) return;
    if (event.data?.type === 'linghuashi:layout') {
      plugin.applyConfig(normalizeConfig({ ...event.data.layout, surface: 'console', state: 'ready' }));
    }
    if (event.data?.type === 'linghuashi:chat') plugin.applyHostContext(event.data.chat);
    if (event.data?.type === 'linghuashi:navigate') plugin.showPage(event.data.page);
    if (event.data?.type === 'linghuashi:floating' && typeof event.data.visible === 'boolean') plugin.setFloatingBall(event.data.visible);
    if (event.data?.type?.startsWith('linghuashi:chat-')) plugin.receiveChatCommand(event.data);
    if (['linghuashi:extension-request', 'linghuashi:extension-abort'].includes(event.data?.type)) plugin.receiveExtensionCommand(event.data);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || document.getElementById('overlay-root').childElementCount
      || document.querySelector('.tag-picker[open], .profile-ai-dialog[open], .novelai-processing-dialog[open], .network-diagnostic-dialog[open]')) return;
    event.preventDefault();
    postWindowMessage(window.parent, { type: 'linghuashi:close' });
  }, true);
  postWindowMessage(window.parent, { type: 'linghuashi:mounted' });
}

boot().catch((error) => {
  const message = document.createElement('p');
  message.textContent = error.message;
  message.setAttribute('role', 'alert');
  document.getElementById('plugin-root').replaceChildren(message);
  postWindowMessage(window.parent, { type: 'linghuashi:error', message: error.message });
});
