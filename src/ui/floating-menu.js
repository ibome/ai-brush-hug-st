import { icon, paintIcons } from '../icons.js';
import { pluginIcon } from './branding.js';
import { getCharacterTheme } from './appearance.js';
import { floatingMenuPosition } from './floating-menu-position.js';
import { FLOATING_QUOTES } from './floating-quotes.js';
import menuCSS from './floating-menu.css?inline';

export function createFloatingMenu({ button, container, onSettings, onHide }) {
  const style = document.createElement('style');
  style.textContent = menuCSS;
  const menu = document.createElement('div');
  menu.className = 'floating-quick-menu';
  menu.id = 'linghuashi-floating-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '\u7075\u753b\u5e08\u5feb\u6377\u83dc\u5355');
  menu.hidden = true;
  menu.innerHTML = `<div class="floating-menu-header" aria-hidden="true">
    <span class="floating-menu-avatar"></span>
    <div class="floating-menu-title"><strong>\u7075\u753b\u5e08</strong><small></small></div>
  </div>
  <button class="floating-menu-item" type="button" role="menuitem" data-menu-action="settings">${icon('settings-2')}<span>\u8bbe\u7f6e</span></button>
  <div class="floating-menu-divider" role="separator"></div>
  <button class="floating-menu-item danger" type="button" role="menuitem" data-menu-action="hide">${icon('x')}<span>\u5173\u95ed\u60ac\u6d6e\u7403</span></button>`;
  container.append(style, menu);
  paintIcons(menu);
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-controls', menu.id);
  button.setAttribute('aria-expanded', 'false');
  const items = [...menu.querySelectorAll('[role="menuitem"]')];
  const subtitle = menu.querySelector('.floating-menu-title small');
  let quoteIndex = -1;

  function reposition() {
    if (menu.hidden) return;
    const anchor = button.getBoundingClientRect();
    const rect = menu.getBoundingClientRect();
    const position = floatingMenuPosition(anchor, rect, { width: window.innerWidth, height: window.innerHeight });
    menu.style.left = `${position.x}px`;
    menu.style.top = `${position.y}px`;
  }

  function close(returnFocus = false) {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (returnFocus && !button.hidden && button.isConnected) button.focus({ preventScroll: true });
  }

  function open(last = false) {
    if (button.hidden) return;
    if (menu.hidden) {
      quoteIndex = quoteIndex < 0
        ? Math.floor(Math.random() * FLOATING_QUOTES.length)
        : (quoteIndex + 1 + Math.floor(Math.random() * (FLOATING_QUOTES.length - 1))) % FLOATING_QUOTES.length;
      subtitle.textContent = FLOATING_QUOTES[quoteIndex];
    }
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    reposition();
    items[last ? items.length - 1 : 0].focus({ preventScroll: true });
  }

  function toggle() {
    if (menu.hidden) open();
    else close(true);
  }

  function update({ characterTheme, theme }) {
    const selected = getCharacterTheme(characterTheme);
    if (menu.dataset.characterTheme !== selected.id) {
      menu.dataset.characterTheme = selected.id;
      menu.querySelector('.floating-menu-avatar').innerHTML = pluginIcon(selected.id);
    }
    menu.dataset.theme = theme === 'dark' ? 'dark' : 'light';
    if (button.hidden) close();
    else reposition();
  }

  function onOutside(event) {
    const path = event.composedPath();
    if (!path.includes(menu) && !path.includes(button)) close();
  }

  function onButtonKey(event) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    open(event.key === 'ArrowUp');
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') close(true);
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const index = items.indexOf(menu.getRootNode().activeElement || document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next].focus({ preventScroll: true });
    }
  }

  function onClick(event) {
    const action = event.target.closest('[data-menu-action]')?.dataset.menuAction;
    if (!action) return;
    event.stopPropagation();
    close(action === 'settings');
    if (action === 'settings') onSettings();
    else onHide();
  }

  menu.addEventListener('click', onClick);
  menu.addEventListener('keydown', onKey);
  button.addEventListener('keydown', onButtonKey);
  document.addEventListener('pointerdown', onOutside, true);
  window.addEventListener('resize', reposition);
  return {
    toggle, close, update, reposition,
    destroy() {
      close();
      document.removeEventListener('pointerdown', onOutside, true);
      window.removeEventListener('resize', reposition);
      button.removeEventListener('keydown', onButtonKey);
      menu.remove();
      style.remove();
    },
  };
}
