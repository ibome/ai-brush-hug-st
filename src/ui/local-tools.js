import { escapeHtml as esc } from '../config.js';
import { icon, paintIcons } from '../icons.js';
import { credentialRequest } from '../runtime.js';
import { LOCAL_MODELS, localToolsBase, normalizeLocalTools, localToolsClient, localOutputSize,
  localTaskOptions, localTagsText, localImageMime } from '../local-tools.js';
import { assetBase64 } from '../reference-assets.js';
import { formatBytes } from './drawings.js';
import bundleURL from 'virtual:linghuashi-local-tools-package';
import { LOCAL_ENV_CHECKS, readLocalEnvironment, localInstallationCommands, localToolsDiagnostic } from '../local-tools-diagnostics.js';

const button = (action, glyph, text, disabled = false) => `<button type="button" class="ui-button secondary" data-local-action="${action}" ${disabled ? 'disabled' : ''}>${icon(glyph)}<span>${text}</span></button>`;
const field = (label, input) => `<label class="ui-field"><span>${label}</span>${input}</label>`;

async function decodedImage(blob) {
  try { return await createImageBitmap(blob); } catch {}
  const url = URL.createObjectURL(blob), image = new Image();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve; image.onerror = () => reject(new Error('图片解码失败，请尝试 PNG 或 JPG'));
      image.src = url;
    });
    return { width: image.naturalWidth, height: image.naturalHeight, close() {} };
  } finally { URL.revokeObjectURL(url); }
}

export class LocalToolsPanel {
  constructor(options) {
    Object.assign(this, options);
    this.settings = normalizeLocalTools(this.getSettings());
    this.key = ''; this.loaded = false; this.busy = false; this.error = ''; this.message = '';
    this.model = 'wd-vit-v3'; this.threshold = 0.35; this.characterThreshold = 0.85;
    this.showKey = false; this.steps = false; this.source = null; this.result = null; this.tags = '';
    this.wizardStep = 1; this.installSystem = /Win/i.test(navigator.platform) ? 'windows' : 'unix'; this.installDevice = 'same';
  }
  html() {
    return `<article class="component-entry" data-local-tools><div class="component-symbol">${icon('scan-eye')}</div>
      <div class="component-copy"><div class="component-title"><h2>本地反推与超分</h2>
      <span class="component-status ${this.status ? 'is-installed' : ''}">${this.status ? `已连接 · v${esc(this.status.version)} · CPU` : '可选 · 需启动独立组件'}</span></div>
      <p>WD 标签反推 · FSRCNN 2× / 4× 超分</p>
      <div class="component-actions"><a class="ui-button secondary" href="${bundleURL}" download="linghuashi-local-tools.zip">${icon('download')}<span>下载本地组件</span></a>
      ${button('steps', 'folder-open', '安装向导')}${button('diagnostic', 'clipboard-list', '复制组件诊断')}</div>
      ${this.steps ? this.wizardHTML() : ''}
      <input type="file" data-local-environment-file accept=".json,application/json" hidden>
      ${this.environmentHTML()}
      ${this.steps && this.wizardStep === 3 ? '' : this.connectionHTML()}
      ${this.status ? `<div class="local-start-status" role="status">服务已启动 · 令牌验证通过${Number.isFinite(this.status.uptimeSeconds) ? ` · 运行 ${this.status.uptimeSeconds} 秒` : ''} · ${this.status.missingDependencies?.length ? '推理依赖待安装' : '依赖已就绪'}</div>
      <div class="local-model-list" aria-label="本地模型">${LOCAL_MODELS.map(([id, title]) => {
        const model = this.status.models.find((row) => row.id === id);
        return `<div><span>${esc(title)}<small>${model?.ready ? '已就绪' : `未下载 · ${formatBytes(model?.bytes || 0)}`}</small></span>
        ${button(`download:${id}`, 'download', model?.ready ? '重新校验 / 下载' : '下载模型', this.busy)}</div>`;
      }).join('')}</div>${this.status.missingDependencies?.length ? `<p class="component-error">组件缺少推理依赖，请重新运行 install 安装脚本。</p>` : ''}` : ''}
      <fieldset class="local-tools-workspace" ${this.busy ? 'disabled' : ''}>
        <div class="local-tools-grid">
        ${field('图库图片', `<select data-local-field="drawing"><option value="">选择图片</option>${this.gallery().slice(0, 500).map((row) =>
          `<option value="${esc(row.id)}" ${this.source?.id === row.id ? 'selected' : ''}>${esc(row.title)}</option>`).join('')}</select>`)}
        ${field('或上传图片', '<input type="file" data-local-field="file" accept="image/png,image/jpeg,image/webp" />')}
        ${field('处理模型', `<select data-local-field="model">${LOCAL_MODELS.map(([id, title]) => `<option value="${id}" ${this.model === id ? 'selected' : ''}>${title}</option>`).join('')}</select>`)}
        ${this.model === 'wd-vit-v3' ? `${field('普通标签阈值', `<input type="number" data-local-field="threshold" min="0.05" max="0.95" step="0.05" value="${this.threshold}" />`)}
        ${field('角色标签阈值', `<input type="number" data-local-field="characterThreshold" min="0.05" max="0.95" step="0.05" value="${this.characterThreshold}" />`)}` : ''}
        </div>
        ${this.source ? `<figure class="local-source"><img src="${this.source.url}" alt="待处理原图" /><figcaption>${esc(this.source.title)} · ${this.source.width} × ${this.source.height}${this.expectedSize()}</figcaption></figure>` : ''}
        <div class="component-actions">${button('run', this.model === 'wd-vit-v3' ? 'scan-eye' : 'maximize-2', this.model === 'wd-vit-v3' ? '开始反推' : '开始超分', !this.status || !this.source || this.status.missingDependencies?.length || !this.status.models.some((row) => row.id === this.model && row.ready))}</div>
      </fieldset>
      <div class="local-tools-progress" role="status" aria-live="polite"><span data-local-progress>${esc(this.message)}</span>
      ${this.busy ? button('cancel', 'x', '取消任务') : ''}</div>
      ${this.error && this.errorScope !== 'connection' ? `<p class="component-error" role="alert" tabindex="-1" data-local-error>${esc(this.error)}</p><div class="component-actions">${button('check', 'refresh-cw', '重试连接')}${button('import-environment', 'file-json', '导入环境报告')}</div>` : ''}
      ${this.diagnostic ? field('组件脱敏诊断', `<textarea data-local-diagnostic readonly rows="7">${esc(this.diagnostic)}</textarea>`) : ''}
      ${this.result?.tags ? `<div class="local-tools-result">${field('反推标签（可编辑）', `<textarea data-local-field="tags" rows="5" maxlength="12000">${esc(this.tags)}</textarea>`)}
        ${this.result?.characters?.length ? `<label class="local-character-switch"><input type="checkbox" data-local-field="characters" ${this.characters ? 'checked' : ''} />包含识别到的角色名</label>` : ''}
        <div class="component-actions">${button('copy', 'copy', '复制标签')}${button('append', 'plus', '追加到正向提示词')}${button('replace', 'replace', '替换正向提示词')}</div></div>` : ''}
      ${this.result?.url ? `<figure class="local-result"><img src="${this.result.url}" alt="超分结果" /><figcaption>超分结果 · ${this.result.width} × ${this.result.height}</figcaption></figure>
      <div class="component-actions">${button('store', 'save', this.source?.id ? '保存为新版本' : '保存到绘图管理', this.busy || this.result.saved)}${button('download-result', 'download', '下载结果')}</div>` : ''}
      </div></article>`;
  }
  connectionHTML() {
    const failed = this.error && this.errorScope === 'connection';
    const pending = this.busy && this.operationScope === 'connection';
    const message = failed ? this.error : pending ? '正在检查组件连接…' : this.connectionMessage || '';
    const invalid = (name) => failed && this.errorField === name ? 'aria-invalid="true" aria-describedby="local-connection-feedback"' : '';
    return `<div class="local-connection">
      <fieldset class="local-tools-settings" ${this.busy ? 'disabled' : ''}>
        ${field('组件地址', `<input data-local-field="endpoint" type="url" value="${esc(this.settings.endpoint)}" placeholder="http://127.0.0.1:8765" autocomplete="off" ${invalid('endpoint')} />`)}
        ${field('组件访问令牌', `<div class="input-with-button credential-input"><input data-local-field="key" type="${this.showKey ? 'text' : 'password'}" value="${esc(this.key)}" autocomplete="off" maxlength="4096" ${invalid('key')} />
        <button type="button" class="ui-icon-button" data-local-action="eye" title="${this.showKey ? '隐藏令牌' : '显示令牌'}" aria-label="${this.showKey ? '隐藏令牌' : '显示令牌'}">${icon(this.showKey ? 'eye-off' : 'eye')}</button></div>`)}
        <div class="component-actions">${button('save', 'check', '保存连接')}${button('check', 'refresh-cw', failed ? '重试连接' : '检测连接')}</div>
      </fieldset>
      ${message ? `<p id="local-connection-feedback" class="local-connection-feedback ${failed ? 'component-error' : ''}" role="${failed ? 'alert' : 'status'}" tabindex="-1" ${failed ? 'data-local-error' : ''}>${esc(message)}</p>` : ''}
      ${failed ? `<div class="component-actions">${button('import-environment', 'file-json', '导入环境报告')}${button('diagnostic', 'clipboard-list', '复制组件诊断')}</div>` : ''}
    </div>`;
  }
  wizardHTML() {
    const commands = localInstallationCommands(this.installSystem, this.installDevice, window.location.origin);
    const code = (key, label) => `<div class="local-install-command"><span>${label}</span><code>${esc(commands[key])}</code>${button(`copy-command:${key}`, 'copy', '复制')}</div>`;
    return `<section class="local-install-wizard" aria-label="本地组件安装向导">
      <div class="local-wizard-tabs" role="tablist">${['安装环境', '启动组件', '连接验证', '准备模型'].map((title, index) =>
        `<button type="button" role="tab" data-local-action="wizard:${index + 1}" aria-selected="${this.wizardStep === index + 1}">${index + 1}. ${title}</button>`).join('')}</div>
      <div class="local-tools-grid">${field('组件主机系统', `<select data-local-field="installSystem"><option value="windows" ${this.installSystem === 'windows' ? 'selected' : ''}>Windows</option><option value="unix" ${this.installSystem === 'unix' ? 'selected' : ''}>Linux / macOS</option></select>`)}
      ${field('组件运行位置', `<select data-local-field="installDevice"><option value="same" ${this.installDevice === 'same' ? 'selected' : ''}>与当前浏览器同一台电脑</option><option value="other" ${this.installDevice === 'other' ? 'selected' : ''}>另一台电脑 / 服务器</option></select>`)}</div>
      ${this.wizardStep === 1 ? `<p>在组件主机安装 Python 3.12，解压下载包，在解压目录打开 ${this.installSystem === 'windows' ? 'PowerShell' : '终端'}。手机浏览器需连接另一台电脑上运行的组件。</p>
        ${code('install', '安装依赖')}${code('check', '检查环境')}
        <div class="component-actions">${button('import-environment', 'file-json', '导入 environment-diagnostics.json')}</div>` : ''}
      ${this.wizardStep === 2 ? `<p>运行后保持启动窗口打开。启动参数已使用当前酒馆的来源地址。</p>${code('start', '启动服务')}${code('token', '在另一个窗口查看令牌')}
        ${this.installDevice === 'other' ? '<p>组件地址填写主机的局域网 IP 或 HTTPS 域名。127.0.0.1 指当前浏览器所在设备；远程连接需开放组件端口。</p>' : ''}` : ''}
      ${this.wizardStep === 3 ? `<p>填写组件地址与访问令牌后检测连接。HTTPS 酒馆访问 HTTP 组件可能被浏览器拦截，可使用 HTTPS 反向代理。</p>
        ${this.connectionHTML()}${this.error && this.errorScope === 'connection' ? '' : `<div class="component-actions">${button('import-environment', 'file-json', '导入环境报告')}</div>`}` : ''}
      ${this.wizardStep === 4 ? `<p>连接通过后，在下方下载所需模型。WD 反推模型约 379 MB；FSRCNN 每个约 40 KB，推理依赖另占空间。</p>
        <p>${this.status ? `${this.status.models.filter((row) => row.ready).length} 个模型已就绪${this.status.missingDependencies?.length ? '，但推理依赖仍缺失' : ''}` : '尚未验证组件连接'}</p>` : ''}
      <div class="component-actions">${button('wizard-prev', 'chevron-left', '上一步', this.wizardStep <= 1)}${button('wizard-next', 'chevron-right', '下一步', this.wizardStep >= 4)}</div></section>`;
  }
  environmentHTML() {
    let report;
    try { report = readLocalEnvironment(this.environment || this.status?.environment); } catch { return ''; }
    return `<section class="local-environment" aria-label="组件环境检查"><strong>环境报告 · Python ${esc(report.python)} · ${esc(report.system)}</strong>
      <ul>${report.checks.map((row) => `<li data-ok="${row.ok}">${icon(row.ok ? 'circle-check' : 'circle-alert')}<span>${LOCAL_ENV_CHECKS[row.id]}：${row.ok ? '通过' : row.id === 'port' && this.status ? '服务正在使用端口' : '需检查'}</span></li>`).join('')}</ul>
      ${report.dependencies.filter((row) => !row.installed).length ? `<p>缺少：${report.dependencies.filter((row) => !row.installed).map((row) => esc(row.name)).join('、')}</p>` : ''}
      <small>空间 ${report.freeBytes === null ? '未知' : formatBytes(report.freeBytes)} · ${report.virtualenv ? '独立虚拟环境' : '系统 Python'}</small></section>`;
  }
  expectedSize() {
    try { const size = localOutputSize(this.source.width, this.source.height, this.model);
      return size.scale > 1 ? ` → ${size.width} × ${size.height}` : '';
    } catch (error) { return ` · ${esc(error.message)}`; }
  }
  refresh() {
    const root = document.querySelector('[data-local-tools]');
    if (!root) return;
    const parent = root.closest('.plugin-content'), scrollTop = parent?.scrollTop || 0;
    const template = document.createElement('template'); template.innerHTML = this.html();
    root.innerHTML = template.content.firstElementChild.innerHTML; paintIcons(root);
    if (parent) parent.scrollTop = scrollTop;
  }
  async load() {
    if (this.loaded) return;
    this.loaded = true;
    try { this.key = await credentialRequest('read', 'localtools', { ref: this.settings.keyRef }); }
    catch { this.error = '保存的组件令牌无法读取，请重新填写'; this.errorScope = 'connection'; this.errorField = 'key'; }
    this.refresh();
  }
  async restore() {
    this.settings = normalizeLocalTools(this.getSettings()); this.status = null;
    this.key = ''; this.loaded = false; await this.load();
  }
  bind(container) {
    const root = container.querySelector('[data-local-tools]');
    if (!root || root.dataset.bound) return;
    root.dataset.bound = 'true';
    root.addEventListener('input', (event) => {
      const key = event.target.dataset.localField;
      if (key === 'endpoint') { this.settings.endpoint = event.target.value; this.status = null; this.connectionMessage = ''; }
      if (key === 'key') { this.key = event.target.value; this.status = null; this.connectionMessage = ''; }
      if (['threshold', 'characterThreshold', 'tags'].includes(key)) this[key] = event.target.value;
    });
    root.addEventListener('change', (event) => {
      const key = event.target.dataset.localField;
      if (['installSystem', 'installDevice'].includes(key)) { this[key] = event.target.value; this.refresh(); }
      if (event.target.matches('[data-local-environment-file]') && event.target.files[0]) {
        const file = event.target.files[0];
        void this.perform(async () => {
          if (file.size > 24000) throw new Error('环境报告超过 24 KB');
          this.environment = readLocalEnvironment(JSON.parse(await file.text())); this.message = '环境报告已读取';
        }, false);
      }
      if (key === 'model') { this.model = event.target.value; this.refresh(); }
      if (key === 'characters') { this.characters = event.target.checked; this.tags = localTagsText(this.result, this.characters); this.refresh(); }
      if (key === 'file' && event.target.files[0]) {
        const file = event.target.files[0];
        // Keep the file input mounted until Safari has finished reading its File.
        void this.perform(async () => {
          if (!file.size || file.size > 12 * 1024 * 1024) throw new Error('请选择 12 MB 以内的图片');
          const blob = new Blob([await file.arrayBuffer()], { type: file.type });
          await this.setSource(blob, { title: file.name });
        }, false);
      }
      if (key === 'drawing' && event.target.value) {
        const item = this.gallery().find((row) => row.id === event.target.value);
        if (item) void this.perform(async () => this.setSource((await this.materialize(item)).blob, item));
      }
    });
    root.addEventListener('click', (event) => {
      const action = event.target.closest('[data-local-action]')?.dataset.localAction;
      if (!action) return;
      if (action === 'cancel') { this.controller?.abort(); return; }
      if (this.busy) return;
      if (action === 'eye') { this.showKey = !this.showKey; this.refresh(); return; }
      if (action === 'steps') { this.steps = !this.steps; this.refresh(); return; }
      if (action === 'import-environment') { root.querySelector('[data-local-environment-file]').click(); return; }
      if (action.startsWith('wizard:')) { this.wizardStep = Number(action.slice(7)); this.refresh(); return; }
      if (action === 'wizard-prev' || action === 'wizard-next') { this.wizardStep = Math.min(4, Math.max(1, this.wizardStep + (action === 'wizard-next' ? 1 : -1))); this.refresh(); return; }
      void this.perform(() => this.action(action), true, ['save', 'check'].includes(action) ? 'connection' : 'task');
    });
    void this.load();
  }
  async useDrawing(item) {
    if (this.busy) throw new Error('请等待本地组件任务完成');
    await this.perform(async () => this.setSource((await this.materialize(item)).blob, item));
  }
  clearResult() {
    if (this.result?.url) URL.revokeObjectURL(this.result.url);
    this.result = null; this.tags = ''; this.characters = false;
  }
  async setSource(blob, item) {
    if (!blob?.size || blob.size > 12 * 1024 * 1024) {
      throw new Error('请选择 12 MB 以内的 PNG、JPG 或 WebP 图片');
    }
    const title = item?.title || blob.name || '上传图片';
    const mime = localImageMime(new Uint8Array(await blob.slice(0, 12).arrayBuffer()));
    if (blob.type !== mime) blob = new Blob([blob], { type: mime });
    const bitmap = await decodedImage(blob);
    try { localOutputSize(bitmap.width, bitmap.height, 'wd-vit-v3'); }
    catch (error) { bitmap.close(); throw error; }
    if (this.source?.url) URL.revokeObjectURL(this.source.url);
    this.clearResult();
    this.source = { blob, url: URL.createObjectURL(blob), width: bitmap.width, height: bitmap.height,
      title, id: item?.id || '', location: this.storageLocation() };
    bitmap.close(); this.message = '';
  }
  async perform(work, repaint = true, scope = 'task') {
    if (this.busy) return;
    this.busy = true; this.error = ''; this.errorField = ''; this.operationScope = scope; this.controller = new AbortController();
    if (scope === 'connection') { this.connectionMessage = ''; this.message = ''; }
    if (repaint) this.refresh();
    else document.querySelectorAll('[data-local-tools] fieldset').forEach((node) => { node.disabled = true; });
    try { await work(); }
    catch (error) {
      this.error = error.message; this.errorScope = scope;
      this.errorField = error.field || (error.category === 'auth' ? 'key' : '');
      this.failure = { category: error.category, status: error.status };
      if (scope === 'connection') this.message = '';
    }
    finally {
      this.busy = false; this.controller = null; this.refresh();
      const node = this.error && document.querySelector('[data-local-tools] [data-local-error]');
      if (node) {
        node.focus({ preventScroll: true });
        const parent = node.closest('.plugin-content');
        if (parent) {
          const box = node.getBoundingClientRect(), outer = parent.getBoundingClientRect();
          if (box.top < outer.top) parent.scrollTop += box.top - outer.top - 16;
          else if (box.bottom > outer.bottom) parent.scrollTop += box.bottom - outer.bottom + 16;
        }
      }
    }
  }
  client() { return localToolsClient({ endpoint: this.settings.endpoint, key: this.key }); }
  updateProgress(task) {
    this.message = task.status === 'queued' ? '排队等待组件处理…'
      : task.status === 'completed' ? '组件处理完成'
      : task.kind === 'download' ? `下载模型 ${task.progress}%`
      : '本地模型处理中…';
    const node = document.querySelector('[data-local-progress]');
    if (node) node.textContent = this.message;
  }
  async action(action) {
    if (action.startsWith('copy-command:')) {
      const commands = localInstallationCommands(this.installSystem, this.installDevice, window.location.origin);
      await navigator.clipboard.writeText(commands[action.slice(13)] || ''); this.message = '命令已复制'; return;
    }
    if (action === 'diagnostic') {
      this.diagnostic = JSON.stringify(localToolsDiagnostic({ endpoint: this.settings.endpoint, status: this.status, environment: this.environment, failure: this.failure }), null, 2);
      try { await navigator.clipboard.writeText(this.diagnostic); this.message = '脱敏诊断已复制'; }
      catch { this.message = '请在下方文本框中复制诊断'; }
      return;
    }
    if (['save', 'check'].includes(action)) {
      let endpoint;
      try { endpoint = localToolsBase(this.settings.endpoint); }
      catch (error) { throw Object.assign(error, { field: 'endpoint' }); }
      if (action === 'check' && !this.key.trim()) throw Object.assign(new Error('请填写本地组件访问令牌'), { field: 'key' });
      const keyRef = await credentialRequest('write', 'localtools', { key: this.key, ref: this.settings.keyRef });
      const saved = normalizeLocalTools({ endpoint, keyRef });
      this.setSettings(saved); this.settings = saved; this.message = '组件连接已保存';
      if (action === 'check') {
        this.status = null;
        this.status = await this.client().status(this.controller.signal); this.failure = null; this.environment = null;
        this.message = this.status.missingDependencies?.length ? '组件连接正常，推理依赖待安装' : '组件连接正常';
        if (this.steps) this.wizardStep = 4;
      }
      this.connectionMessage = this.message;
    } else if (action.startsWith('download:')) {
      const model = action.slice(9);
      await this.client().run({ kind: 'download', model }, { signal: this.controller.signal, progress: (task) => this.updateProgress(task) });
      this.status = await this.client().status(this.controller.signal); this.message = '模型下载并校验完成';
    } else if (action === 'run') {
      if (!this.source) throw new Error('请先选择图片');
      const options = localTaskOptions(this.model, this);
      localOutputSize(this.source.width, this.source.height, this.model);
      const client = this.client(); this.status = await client.status(this.controller.signal);
      if (!this.status.models.find((model) => model.id === this.model)?.ready) throw new Error('请先在上方下载所选模型');
      this.clearResult();
      const result = await client.run({ ...options, image: assetBase64(new Uint8Array(await this.source.blob.arrayBuffer())) },
        { signal: this.controller.signal, progress: (task) => this.updateProgress(task) });
      if (options.kind === 'tags') {
        this.result = result; this.tags = localTagsText(result);
        this.message = this.tags ? '反推完成，请检查标签后再使用' : '没有达到阈值的标签，可调低阈值重试';
      } else {
        const bitmap = await decodedImage(result);
        const expected = localOutputSize(this.source.width, this.source.height, this.model);
        if (bitmap.width !== expected.width || bitmap.height !== expected.height) { bitmap.close(); throw new Error('组件返回的图片尺寸不符合预期'); }
        bitmap.close();
        this.result = { blob: result, url: URL.createObjectURL(result), ...expected, model: this.model };
        this.message = '超分完成，预览后可保存';
      }
    } else if (action === 'copy') {
      await navigator.clipboard.writeText(this.tags); this.message = '标签已复制';
    } else if (action === 'append' || action === 'replace') {
      this.applyTags(this.tags, action === 'append'); this.message = '已更新正向提示词';
    } else if (action === 'store') {
      await this.store(this.result, this.source); this.result.saved = true; this.message = this.source.id ? '已保存为原图的新版本' : '已保存到绘图管理';
    } else if (action === 'download-result') {
      const anchor = document.createElement('a'); anchor.href = this.result.url;
      anchor.download = `linghuashi-${this.result.model}.png`; anchor.click();
    }
  }
}
