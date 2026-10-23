import { localToolsBase, LOCAL_MODELS } from './local-tools.js';

export const LOCAL_ENV_CHECKS = { python: 'Python 版本（3.10—3.12）', dependencies: '推理依赖',
  'data-writable': '数据目录可写', 'disk-space': '可用空间至少 1 GB', port: '启动端口空闲' };
const packageNames = new Set(['numpy', 'Pillow', 'onnxruntime', 'opencv-contrib-python-headless']);
export function readLocalEnvironment(value) {
  if (value?.type !== 'linghuashi-local-tools-environment' || value.formatVersion !== 1
    || !Array.isArray(value.checks) || value.checks.length > 8 || !Array.isArray(value.dependencies)) throw new Error('请选择组件生成的 environment-diagnostics.json');
  const safe = (value, max = 60) => typeof value === 'string' && /^[A-Za-z0-9_.+ -]*$/.test(value) ? value.slice(0, max) : '';
  return { type: value.type, formatVersion: 1, python: safe(value.python), system: safe(value.system),
    architecture: safe(value.architecture), virtualenv: value.virtualenv === true,
    freeBytes: Number.isSafeInteger(value.freeBytes) && value.freeBytes >= 0 ? value.freeBytes : null,
    port: Number.isInteger(value.port) && value.port > 0 && value.port <= 65535 ? value.port : null,
    dependencies: value.dependencies.filter((row) => packageNames.has(row?.name)).slice(0, 4)
      .map((row) => ({ name: row.name, installed: row.installed === true, version: safe(row.version) })),
    checks: value.checks.filter((row) => Object.hasOwn(LOCAL_ENV_CHECKS, row?.id))
      .map((row) => ({ id: row.id, ok: row.ok === true })) };
}
export function localInstallationCommands(system, device, origin) {
  let url;
  try { url = new URL(origin); } catch { throw new Error('酒馆页面地址无效'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('酒馆页面地址无效');
  const windows = system === 'windows', host = device === 'other' ? '0.0.0.0' : '127.0.0.1';
  const quoted = windows ? `'${url.origin.replace(/'/g, "''")}'` : `'${url.origin.replace(/'/g, "'\\''")}'`;
  return windows ? { install: '.\\install.ps1', check: '.\\check-env.ps1',
    start: `.\\start.ps1 -TavernOrigin ${quoted}${host === '0.0.0.0' ? " -ListenAddress '0.0.0.0'" : ''}`, token: '.\\start.ps1 -ShowToken' }
    : { install: 'sh install.sh', check: 'sh check-env.sh',
      start: `sh start.sh --allow-origin ${quoted} --host ${host}`, token: 'sh start.sh --show-token' };
}
export function localToolsDiagnostic({ endpoint, status, environment, failure } = {}) {
  let target;
  try {
    const url = new URL(localToolsBase(endpoint));
    target = { protocol: url.protocol, kind: ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ? 'loopback' : 'custom-host' };
  } catch { target = { kind: 'invalid' }; }
  let checked = null;
  try { checked = readLocalEnvironment(environment || status?.environment); } catch {}
  return { type: 'linghuashi-local-tools-diagnostics', formatVersion: 1, createdAt: new Date().toISOString(),
    target, connection: status ? 'authenticated' : 'not-verified',
    failure: ['network', 'timeout', 'cancelled', 'auth', 'origin', 'protocol', 'http'].includes(failure?.category) ? failure.category : '',
    httpStatus: Number.isInteger(failure?.status) ? failure.status : 0,
    componentVersion: /^\d+\.\d+\.\d+$/.test(status?.version) ? status.version : '',
    uptimeSeconds: Number.isFinite(status?.uptimeSeconds) ? Math.max(0, Math.round(status.uptimeSeconds)) : null,
    environment: checked, models: LOCAL_MODELS.map(([id]) => ({ id, ready: status?.models?.some((row) => row.id === id && row.ready === true) || false })),
    limits: '仅包含环境、组件状态与错误类别；不包含地址、路径、令牌、图片、提示词或环境变量；不会自动发送。' };
}
