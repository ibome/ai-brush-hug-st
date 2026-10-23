import { escapeHtml as esc } from '../config.js';
import { icon } from '../icons.js';

export function experienceFold(state, id, title, body, active = false) {
  return `<details class="experience-options" data-experience-fold="${esc(id)}" ${active ? 'data-experience-active' : ''} ${active || state.experience?.level === 'full' ? 'open' : ''}>
    <summary>${icon('sliders-horizontal')}<span>${esc(title)}</span>${active ? '<small>当前已启用</small>' : ''}${icon('chevron-down')}</summary>
    <div class="experience-options-body">${body}</div></details>`;
}
