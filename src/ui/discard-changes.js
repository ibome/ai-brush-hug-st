import { escapeHtml as esc } from '../config.js';
import { icon, paintIcons } from '../icons.js';

let pending = false;

export function confirmDiscardChanges(title, detail) {
  return confirmChoice(title, detail, { keepLabel: '继续编辑', discardLabel: '放弃修改并继续', keepIcon: 'pencil', discardIcon: 'arrow-right' });
}

export function confirmProfileDeletion(name) {
  return confirmChoice('删除角色档案？', `将删除“${name}”及其聊天覆盖。已保存图片的角色快照会保留。`, {
    keepLabel: '保留档案', discardLabel: '删除档案', keepIcon: 'x', discardIcon: 'trash-2',
  });
}

function confirmChoice(title, detail, { keepLabel, discardLabel, keepIcon, discardIcon }) {
  if (pending) return Promise.resolve(false);
  pending = true;
  const focus = document.activeElement;
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'nai-preset-dialog discard-changes-dialog';
    dialog.setAttribute('aria-label', title);
    dialog.innerHTML = `<header><h2>${esc(title)}</h2></header><p>${esc(detail)}</p>
      <footer><button type="button" class="ui-button primary" data-discard-choice="keep" autofocus>${icon(keepIcon)}<span>${esc(keepLabel)}</span></button>
      <button type="button" class="ui-button secondary" data-discard-choice="discard">${icon(discardIcon)}<span>${esc(discardLabel)}</span></button></footer>`;
    let discard = false;
    const finish = () => {
      pending = false;
      dialog.remove();
      if (focus?.isConnected) focus.focus({ preventScroll: true });
      resolve(discard);
    };
    dialog.addEventListener('click', (event) => {
      const choice = event.target.closest('[data-discard-choice]');
      if (!choice) return;
      discard = choice.dataset.discardChoice === 'discard';
      dialog.close();
    });
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); dialog.close(); });
    dialog.addEventListener('close', finish, { once: true });
    document.body.append(dialog);
    try { paintIcons(dialog); dialog.showModal(); }
    catch { finish(); }
  });
}
