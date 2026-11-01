import { generationTransitionState } from '../generation-transition.js';
import { getCharacterTheme } from './appearance.js';
import whale from '../assets/themes/whale/whale-running.webp';
import claude from '../assets/themes/claude/claude-running.webp';
import gemini from '../assets/themes/gemini/gemini-running.webp';
import gpt from '../assets/themes/gpt/gpt-running.webp';
import glm from '../assets/themes/glm/glm-running.webp';
import kimi from '../assets/themes/kimi/kimi-running.webp';
import grok from '../assets/themes/grok/grok-running.webp';
import doubao from '../assets/themes/doubao/doubao-running.webp';
import ancient from '../assets/themes/ancient/ancient-running.webp';
import transitionCSS from '../styles/generation-transition.css?inline';

export { transitionCSS };
const themes = { whale, claude, gemini, gpt, glm, kimi, grok, doubao, ancient };
const esc = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function renderGenerationTransition({ theme, task, compact = false, remote = false, actions = '' }) {
  const status = generationTransitionState(task, { remote });
  if (!status) return '';
  const selected = getCharacterTheme(theme), mascot = themes[selected.id];
  // Rebuilt chat cards resume the same animation phase instead of jumping to the start.
  const delay = -(Date.now() % 7200);
  return `<div class="generation-transition${compact ? ' generation-transition--compact' : ''}" data-generation-theme="${selected.id}" data-stage="${status.stage}" data-animated="${status.animated}" data-running-direction="left" role="status" aria-live="polite" style="--generation-delay:${delay}ms">
    <div class="generation-scene" aria-hidden="true">
      <span class="generation-trail"></span>
      <span class="generation-runner"><span class="generation-sprite"><img class="generation-mascot" src="${mascot}" alt="" width="512" height="128" decoding="async" draggable="false" /></span></span>
    </div>
    <div class="generation-copy"><strong>${esc(status.title)}</strong><span class="generation-detail">${esc(status.detail)}</span>
      ${status.progress ? `<div class="generation-progress" role="progressbar" aria-label="当前节点进度" aria-valuemin="0" aria-valuemax="${status.progress.max}" aria-valuenow="${status.progress.value}"><span style="width:${status.progress.percent}%"></span></div>` : ''}
    </div>${actions ? `<div class="generation-controls">${actions}</div>` : ''}
  </div>`;
}
