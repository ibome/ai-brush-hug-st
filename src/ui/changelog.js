import changelog from '../../CHANGELOG.md?raw';
import { escapeHtml as esc } from '../config.js';
import { icon } from '../icons.js';
import { RELEASE } from '../release.js';
import '../styles/changelog.css';

const entries = [];
for (const line of changelog.split(/\r?\n/)) {
  const heading = /^##\s+(\d+\.\d+\.\d+)\s*$/.exec(line);
  if (heading) entries.push({ version: heading[1], notes: [] });
  else if (entries.length && /^-\s+/.test(line)) entries.at(-1).notes.push(line.replace(/^-\s+/, ''));
  else if (line.trim() && entries.at(-1)?.notes.length) entries.at(-1).notes[entries.at(-1).notes.length - 1] += ` ${line.trim()}`;
}

const noteHTML = (text) => text.split(/(`[^`]+`)/g).map((part) =>
  part.startsWith('`') && part.endsWith('`') ? `<code>${esc(part.slice(1, -1))}</code>` : esc(part)).join('');

export class ChangelogPanel {
  constructor(releasePanel) {
    this.releasePanel = releasePanel;
    this.expanded = new Set(entries.slice(0, 1).map((entry) => entry.version));
  }
  html() {
    return `<section class="changelog-page" data-changelog-root aria-label="版本更新记录">
      <div class="page-heading"><div><h1>更新日志</h1><p>当前安装 v${esc(RELEASE.version)} · 共 ${entries.length} 个版本</p></div></div>
      ${this.releasePanel.html()}
      <div class="changelog-toolbar" role="group" aria-label="日志展开操作">
        <button type="button" class="ui-button secondary" data-changelog-action="expand">${icon('expand')}<span>展开全部</span></button>
        <button type="button" class="ui-button secondary" data-changelog-action="collapse">${icon('minimize-2')}<span>收起全部</span></button>
      </div>
      <div class="changelog-entries">${entries.map((entry) => `<details class="changelog-entry" data-changelog-version="${esc(entry.version)}" ${this.expanded.has(entry.version) ? 'open' : ''}>
        <summary><strong>v${esc(entry.version)}</strong>${entry.version === RELEASE.version ? '<span class="changelog-current">当前版本</span>' : ''}
          <span class="changelog-count">${entry.notes.length} 项</span>${icon('chevron-down')}</summary>
        <ul>${entry.notes.map((note) => `<li>${noteHTML(note)}</li>`).join('')}</ul>
      </details>`).join('')}</div>
    </section>`;
  }
  capture(container) {
    const root = container.querySelector('[data-changelog-root]');
    if (root) this.expanded = new Set([...root.querySelectorAll('[data-changelog-version][open]')].map((node) => node.dataset.changelogVersion));
  }
  bind(container) {
    const root = container.querySelector('[data-changelog-root]');
    if (!root) return;
    this.releasePanel.bind(root);
    const folds = [...root.querySelectorAll('[data-changelog-version]')];
    for (const fold of folds) fold.addEventListener('toggle', () => {
      if (!root.isConnected) return;
      fold.open ? this.expanded.add(fold.dataset.changelogVersion) : this.expanded.delete(fold.dataset.changelogVersion);
    });
    root.addEventListener('click', (event) => {
      const action = event.target.closest('[data-changelog-action]')?.dataset.changelogAction;
      if (!action) return;
      for (const fold of folds) fold.open = action === 'expand';
      this.capture(container);
    });
  }
}
