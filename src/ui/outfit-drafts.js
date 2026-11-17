import { escapeHtml as esc } from '../config.js';
import { icon, paintIcons } from '../icons.js';

export function confirmOutfitDrafts(choices) {
  const overlay = document.getElementById('overlay-root');
  if (overlay.childElementCount) throw new Error('请先处理当前窗口');
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'nai-preset-dialog outfit-draft-dialog';
    dialog.setAttribute('aria-label', '有服装修改尚未应用');
    dialog.innerHTML = `<header><h2>有服装修改尚未应用</h2><button type="button" data-outfit-decision="cancel" aria-label="关闭">${icon('x')}</button></header>
      <ul>${choices.map((row) => `<li>${esc(row.name)} · ${esc({ global: '全局默认', chat: '当前聊天', project: '当前漫画项目', once: '仅下一次生图' }[row.scope])}</li>`).join('')}</ul>
      <footer>${[['cancel', 'x', '取消'], ['original', 'history', '使用原配置'], ['apply', 'check', '应用后生成']].map(([id, glyph, text]) =>
        `<button type="button" class="ui-button ${id === 'apply' ? 'primary' : 'secondary'}" data-outfit-decision="${id}">${icon(glyph)}<span>${text}</span></button>`).join('')}</footer>`;
    let decision = 'cancel';
    dialog.addEventListener('click', (event) => {
      const button = event.target.closest('[data-outfit-decision]');
      if (button) { decision = button.dataset.outfitDecision; dialog.close(); }
    });
    dialog.addEventListener('close', () => { dialog.remove(); resolve(decision); }, { once: true });
    overlay.append(dialog); paintIcons(dialog); dialog.showModal();
  });
}
