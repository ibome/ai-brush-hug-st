import { escapeHtml as esc } from '../config.js';
import { icon } from '../icons.js';
import { CREATION_MODES } from '../creation-workflow.js';
import { POSITION_OPTIONS } from '../character-profiles.js';
import '../styles/creation-workflow.css';

export function renderCreationModes(page) {
  if (!CREATION_MODES.some(([id]) => id === page)) return '';
  return `<nav class="creation-modes" aria-label="创作方式">${CREATION_MODES.map(([id, title, glyph]) =>
    `<button type="button" data-creation-page="${id}" aria-current="${id === page ? 'page' : 'false'}">${icon(glyph)}<span>${title}</span></button>`).join('')}</nav>`;
}

export function renderCreationPreview(preview, stale = false) {
  if (!preview) return '';
  return `<section class="creation-preview" aria-label="本次生图预览">
    <div class="settings-band-heading"><h2>${icon('scan-eye')}本次生图预览</h2><span data-creation-preview-state role="status">${stale ? '参数已改变，请重新预览' : '本地预览 · 尚未提交生图'}</span></div>
    <p>${esc(preview.model)} · ${esc(preview.mode)} · ${preview.width} × ${preview.height} · ${preview.count} 张</p>
    ${preview.model !== preview.selectedModel ? `<p>所选模型：${esc(preview.selectedModel)}；本次使用上方对应的重绘模型。</p>` : ''}
    ${preview.transparent ? '<p>透明背景 PNG 已开启</p>' : preview.transparencyUnavailable ? '<p>本次实际模型不支持透明背景，将按普通图片生成。</p>' : ''}
    ${preview.pendingOutfits?.length ? `<p role="status">尚未应用的服装：${preview.pendingOutfits.map(esc).join('、')}。下方显示已应用配置。</p>` : ''}
    <details class="prompt-sources" open><summary>提示词组成与来源</summary>
      <dl>${(preview.components || []).map((row) => `<div><dt>${esc(row.label)}<small>${esc(row.source)}</small></dt><dd>${esc(row.text || '未设置')}</dd></div>`).join('')}
      ${(preview.roles || []).map((row) => `<div><dt>${esc(row.name)}<small>${esc(row.source)}</small></dt><dd>
        <p>外貌：${esc(row.appearance || '未指定')}</p><p>服装：${esc(row.outfit)}</p>${row.action ? `<p>动作 / 表情：${esc(row.action)}</p>` : ''}</dd></div>`).join('')}</dl></details>
    <label class="ui-field"><span>合并正向提示词</span><textarea rows="4" readonly aria-label="预览合并正向提示词">${esc(preview.positive)}</textarea></label>
    <label class="ui-field"><span>合并负面提示词</span><textarea rows="3" readonly aria-label="预览合并负面提示词">${esc(preview.negative)}</textarea></label>
    ${preview.characters.map((entry) => `<details><summary>${esc(entry.name)} · ${esc(POSITION_OPTIONS.find(([id]) => id === entry.position)?.[1] || '自动')}</summary><p>${esc(entry.positive)}</p>${entry.negative ? `<p>负面：${esc(entry.negative)}</p>` : ''}</details>`).join('')}
  </section>`;
}
