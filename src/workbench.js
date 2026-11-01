import './styles/workbench.css';
import { icon, paintIcons } from './icons.js';
import { ACCENTS, DEFAULT_CONFIG, DEVICES, STORAGE_KEY, downloadJson, escapeHtml, normalizeConfig, readConfig } from './config.js';
import { CHARACTER_THEMES, characterThemeAccent } from './ui/appearance.js';

let config = readConfig();
let inspectorOpen = window.innerWidth > 900;
let lastSaved = '';
let toastTimer;
let characterTheme = null;
const root = document.getElementById('workbench');

const toolButton = (name, title, action, extra = '') => `<button type="button" class="lab-icon-button" data-action="${action}" aria-label="${title}" title="${title}" ${extra}>${icon(name)}</button>`;

root.innerHTML = `
  <header class="lab-toolbar">
    <div class="lab-brand">${icon('panels-top-left')}<div><strong>界面工作台</strong><span><span class="live-dot"></span>实时预览</span></div></div>
    <div class="lab-view-tabs" role="tablist" aria-label="预览场景">
      <button type="button" role="tab" data-surface="console">${icon('layout-dashboard')}<span>设置控制台</span></button>
      <button type="button" role="tab" data-surface="chat">${icon('message-square')}<span>聊天生图</span></button>
    </div>
    <div class="lab-toolbar-actions">
      ${toolButton('save', '保存布局', 'save')}
      ${toolButton('arrow-down-to-line', '导出布局', 'export')}
      ${toolButton('upload', '导入布局', 'import')}
      <span class="toolbar-divider"></span>
      ${toolButton('sliders-horizontal', '布局设置', 'inspector')}
      ${toolButton('external-link', '在新窗口打开预览', 'open')}
    </div>
  </header>
  <main class="lab-body">
    <section class="lab-stage-area">
      <div class="lab-preview-toolbar">
        <div class="lab-device-switch" role="group" aria-label="设备尺寸">
          ${Object.entries(DEVICES).map(([key, device]) => `<button type="button" data-device="${key}" aria-label="${device.label}" title="${device.label}">${icon(device.icon)}</button>`).join('')}
        </div>
        <span id="viewport-size" class="lab-viewport-size"></span>
        <div class="lab-preview-toolbar-right">
          <label class="lab-state-select"><span>状态</span><select id="preview-state" aria-label="生成状态">
            <option value="ready">就绪</option><option value="queued">排队中</option><option value="generating">生成中</option><option value="success">生成完成</option><option value="error">生成失败</option>
          </select></label>
          <span class="toolbar-divider"></span>
          ${toolButton('sun', '明亮主题', 'light')}
          ${toolButton('moon', '暗色主题', 'dark')}
        </div>
      </div>
      <div class="lab-stage">
        <div class="lab-device-frame"><iframe id="preview-frame" src="./preview.html" title="插件成品界面预览"></iframe></div>
      </div>
      <footer class="lab-statusbar"><span><span class="live-dot"></span><span id="save-status">修改会保留在当前浏览器</span></span><span id="scene-caption"></span></footer>
    </section>
    <aside class="lab-inspector" aria-label="布局设置">
      <div class="inspector-heading"><h2>${icon('sliders-horizontal')}布局设置</h2>${toolButton('rotate-ccw', '恢复默认布局', 'reset')}</div>
      <div class="inspector-section">
        <label class="lab-field"><span>插件名称</span><input id="plugin-name" type="text" maxlength="20" autocomplete="off" /></label>
        <div class="lab-field"><span>强调色</span><div class="lab-swatches" role="group" aria-label="强调色">
          ${ACCENTS.map((color) => `<button type="button" data-accent="${color}" style="--swatch:${color}" aria-label="强调色 ${color}" title="${color}">${icon('check')}</button>`).join('')}
        </div></div>
      </div>
      <div class="inspector-section">
        <div class="lab-field"><span>导航位置</span><div class="lab-segmented" role="group" aria-label="导航位置">
          <button type="button" data-navigation="left">${icon('panel-left')}侧边</button><button type="button" data-navigation="top">${icon('panel-top')}顶部</button>
        </div></div>
        <label class="lab-field"><span>侧栏宽度 <output id="sidebar-width-output"></output></span><input id="sidebar-width" type="range" min="120" max="200" step="4" /></label>
        <label class="lab-field"><span>内容间距</span><select id="density"><option value="compact">紧凑</option><option value="standard">标准</option><option value="relaxed">宽松</option></select></label>
      </div>
      <div class="inspector-section">
        <label class="lab-field"><span>正文大小 <output id="font-size-output"></output></span><input id="font-size" type="range" min="13" max="16" step="1" /></label>
        <label class="lab-field"><span>控件圆角 <output id="radius-output"></output></span><input id="radius" type="range" min="0" max="8" step="1" /></label>
        <label class="lab-field"><span>聊天图片宽度 <output id="image-width-output"></output></span><input id="image-width" type="range" min="55" max="100" step="5" /></label>
      </div>
      <div class="inspector-footer"><span class="lab-file-label">${icon('folder-open')}tavern-draw</span><span id="saved-time"></span></div>
    </aside>
  </main>
  <input id="layout-import" type="file" accept=".json,application/json" hidden />
  <div id="lab-toast" role="status" aria-live="polite"></div>
`;

const frame = document.getElementById('preview-frame');
const shell = document.querySelector('.lab-device-frame');

function pushConfig() {
  frame.contentWindow?.postMessage({ type: 'draw-lab:config', config }, location.origin);
}

function applyAppearance() {
  if (!characterTheme) return;
  root.dataset.characterTheme = characterTheme;
  root.style.setProperty('--accent-selected', characterThemeAccent(characterTheme, config.accent));
  root.querySelectorAll('[data-accent]').forEach((button) => {
    const color = characterThemeAccent(characterTheme, button.dataset.accent);
    button.style.setProperty('--swatch', color);
    button.title = color;
    button.setAttribute('aria-label', `强调色 ${color}`);
  });
}

function updateView() {
  root.classList.toggle('inspector-open', inspectorOpen);
  root.dataset.theme = config.theme;
  root.dataset.device = config.device;
  applyAppearance();
  root.style.colorScheme = config.theme;
  document.querySelectorAll('[data-surface]').forEach((button) => {
    const active = button.dataset.surface === config.surface;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('[data-device]').forEach((button) => {
    const active = button.dataset.device === config.device;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-navigation]').forEach((button) => {
    const active = button.dataset.navigation === config.navigation;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-accent]').forEach((button) => {
    const active = button.dataset.accent === config.accent;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-action="light"], [data-action="dark"]').forEach((button) => {
    button.classList.toggle('active', button.dataset.action === config.theme);
  });
  document.querySelector('[data-action="inspector"]').classList.toggle('active', inspectorOpen);
  document.getElementById('plugin-name').value = config.name;
  document.getElementById('preview-state').value = config.state;
  document.getElementById('density').value = config.density;
  [
    ['sidebar-width', 'sidebarWidth', 'px'],
    ['font-size', 'fontSize', 'px'],
    ['radius', 'radius', 'px'],
    ['image-width', 'imageWidth', '%'],
  ].forEach(([id, key, unit]) => {
    document.getElementById(id).value = config[key];
    document.getElementById(`${id}-output`).textContent = `${config[key]}${unit}`;
  });
  document.getElementById('sidebar-width').disabled = config.navigation === 'top';
  shell.style.setProperty('--device-width', `${DEVICES[config.device].width}px`);
  shell.style.setProperty('--device-height', `${DEVICES[config.device].height}px`);
  document.getElementById('scene-caption').textContent = `${config.name} / ${config.surface === 'console' ? '设置控制台' : '聊天生图卡片'}`;
  document.getElementById('saved-time').textContent = lastSaved ? `已保存 ${lastSaved}` : '布局 01';
  pushConfig();
}

function change(patch) {
  config = normalizeConfig({ ...config, ...patch });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  updateView();
}

function toast(message) {
  const element = document.getElementById('lab-toast');
  element.innerHTML = `${icon('circle-check')}<span>${escapeHtml(message)}</span>`;
  element.classList.add('visible');
  paintIcons();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('visible'), 2400);
}

root.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.surface) return change({ surface: button.dataset.surface });
  if (button.dataset.device) return change({ device: button.dataset.device });
  if (button.dataset.navigation) return change({ navigation: button.dataset.navigation });
  if (button.dataset.accent) return change({ accent: button.dataset.accent });
  switch (button.dataset.action) {
    case 'light': case 'dark': change({ theme: button.dataset.action }); break;
    case 'inspector': inspectorOpen = !inspectorOpen; updateView(); break;
    case 'save':
      lastSaved = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      updateView();
      document.getElementById('save-status').textContent = '当前布局已保存';
      toast('当前布局已保存');
      break;
    case 'export':
      downloadJson(`${config.name}-布局.json`, { type: 'tavern-draw-layout', version: 1, config });
      toast('布局已导出');
      break;
    case 'import': document.getElementById('layout-import').click(); break;
    case 'reset': change(DEFAULT_CONFIG); toast('已恢复默认布局'); break;
    case 'open': window.open(new URL('./preview.html', location.href), '_blank', 'noopener'); break;
  }
});

document.getElementById('plugin-name').addEventListener('input', (event) => {
  config.name = event.target.value;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeConfig(config)));
  document.getElementById('scene-caption').textContent = `${config.name || DEFAULT_CONFIG.name} / ${config.surface === 'console' ? '设置控制台' : '聊天生图卡片'}`;
  pushConfig();
});
document.getElementById('plugin-name').addEventListener('blur', () => change({ name: config.name }));
document.getElementById('preview-state').addEventListener('change', (event) => change({ state: event.target.value }));
document.getElementById('density').addEventListener('change', (event) => change({ density: event.target.value }));
[
  ['sidebar-width', 'sidebarWidth'], ['font-size', 'fontSize'],
  ['radius', 'radius'], ['image-width', 'imageWidth'],
].forEach(([id, key]) => document.getElementById(id).addEventListener('input', (event) => change({ [key]: Number(event.target.value) })));

document.getElementById('layout-import').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 32000) throw new Error('布局文件过大');
    const data = JSON.parse(await file.text());
    if (data.type !== 'tavern-draw-layout' || data.version !== 1 || !data.config) throw new Error('请选择工作台导出的布局文件');
    change(data.config);
    toast('布局已导入');
  } catch (error) {
    toast(error.message || '布局导入失败');
  }
  event.target.value = '';
});

window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
  if (event.data?.type === 'draw-lab:ready') pushConfig();
  if (event.data?.type === 'draw-lab:appearance' && CHARACTER_THEMES.some((theme) => theme.id === event.data.characterTheme)) {
    characterTheme = event.data.characterTheme;
    applyAppearance();
  }
  if (event.data?.type === 'draw-lab:surface' && ['console', 'chat'].includes(event.data.surface)) {
    change({ surface: event.data.surface });
  }
});
frame.addEventListener('load', pushConfig);
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY) {
    config = readConfig();
    updateView();
  }
});
new ResizeObserver(() => {
  document.getElementById('viewport-size').textContent = `${Math.round(frame.clientWidth)} × ${Math.round(frame.clientHeight)}`;
}).observe(frame);

updateView();
paintIcons();
