import { icon, paintIcons } from '../icons.js';
import { getCharacterTheme } from './appearance.js';
import { updateMascots } from './update-mascots.js';
import noticeCSS from '../styles/update-notice.css?inline';

export function createUpdateNotice({ container, storage, account, onOpen }) {
  const key = `linghuashi:update-dismissed:${account}`;
  let dismissed = '';
  try { dismissed = storage.getItem(key) || ''; } catch {}
  const style = document.createElement('style');
  style.textContent = noticeCSS;
  const notice = document.createElement('aside');
  notice.className = 'floating-quick-menu update-mascot-notice';
  notice.setAttribute('aria-label', '灵画师更新提醒');
  notice.hidden = true;
  notice.innerHTML = `<button class="update-notice-open" type="button">
    <img width="256" height="256" alt="" decoding="async" draggable="false" />
    <span class="update-speech"><strong>插件更新啦！</strong><small></small><span>点击查看更新 ${icon('arrow-right')}</span></span>
    </button><button class="update-notice-close" type="button" title="关闭本次版本提醒" aria-label="关闭本次版本提醒">${icon('x')}</button>`;
  container.append(style, notice);
  paintIcons(notice);
  const image = notice.querySelector('img'), button = notice.querySelector('.update-notice-open');
  let state;
  function update(value = state) {
    state = value;
    if (!value) return;
    const selected = getCharacterTheme(value.characterTheme);
    notice.dataset.characterTheme = selected.id;
    notice.dataset.theme = value.theme === 'dark' ? 'dark' : 'light';
    const version = value.release?.newer ? value.release.version : '';
    notice.hidden = !version || value.hidden || dismissed === version;
    if (!notice.hidden) {
      if (image.dataset.theme !== selected.id) { image.src = updateMascots[selected.id]; image.dataset.theme = selected.id; }
      notice.querySelector('.update-speech small').textContent = `灵画师 v${version}`;
      button.setAttribute('aria-label', `插件更新啦！灵画师 v${version}，点击查看更新`);
    }
  }
  function dismiss() {
    dismissed = state?.release?.version || '';
    try { storage.setItem(key, dismissed); } catch {}
    update();
  }
  const open = () => { dismiss(); onOpen(); };
  button.addEventListener('click', open);
  notice.querySelector('.update-notice-close').addEventListener('click', dismiss);
  const onStorage = (event) => { if (event.key === key) { dismissed = event.newValue || ''; update(); } };
  window.addEventListener('storage', onStorage);
  return { update, dismiss, destroy() { window.removeEventListener('storage', onStorage); notice.remove(); style.remove(); } };
}
