import { INVALID_IMAGE_RESPONSE } from './generation-recovery.js';

const recent = [];
const PHASES = {
  preparing: '准备参考素材', submitting: '提交生图', retrieving: '取回图片',
  'response-cache': '保存任务响应', 'image-processing': '处理图片与缩略图',
  saving: '保存图片', refreshing: '刷新图库', 'task-state': '同步任务记录',
};
const NAMES = new Set(['Error', 'TypeError', 'RangeError', 'GenerationError', 'QuotaExceededError',
  'NS_ERROR_DOM_QUOTA_REACHED', 'SecurityError', 'InvalidStateError', 'TransactionInactiveError',
  'AbortError', 'NotFoundError', 'NotSupportedError', 'EncodingError', 'UnknownError', 'TimeoutError', 'DataCloneError']);

export function storageFailureInfo(error) {
  return {
    name: NAMES.has(error?.name) ? error.name : 'Error',
    status: Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? error.status : 0,
    ...(error?.scope === 'tavern-storage' ? { scope: 'tavern-storage' } : {}),
    ...(error?.code === 'ENOSPC' ? { code: 'ENOSPC' } : {}),
  };
}

export function restoreStorageFailure(message, details) {
  return Object.assign(new Error(typeof message === 'string' ? message : '酒馆存储请求失败'), storageFailureInfo(details));
}

export function classifyGenerationFailure(error, job, trustedMessage = false) {
  const phase = Object.hasOwn(PHASES, job.failurePhase) ? job.failurePhase
    : Object.hasOwn(PHASES, job.phase) ? job.phase : 'task-state';
  const name = NAMES.has(error?.name) ? error.name : 'Error';
  const status = Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? error.status : 0;
  const raw = String(error?.message || '');
  const storage = job.plan?.storageLocation === 'server' ? 'server' : 'browser';
  let code = 'UNCLASSIFIED_FAILURE', message = `${PHASES[phase]}失败，请到调试工具检测并复制日志`;
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
    code = 'BROWSER_QUOTA';
    message = '浏览器存储配额不足，图片或任务响应未能保存，请到调试工具检查存储'
      + (job.execution ? '；本页已保留响应，可尝试继续保存' : '');
  } else if (error?.code === 'ENOSPC' || status === 507) {
    code = 'SERVER_DISK_FULL'; message = '酒馆服务器报告存储空间不足，请联系管理员检查服务器磁盘';
  } else if (/randomUUID|subtle.*(?:undefined|digest)|getRandomValues.*(?:function|undefined)/i.test(raw)) {
    code = 'CRYPTO_UNAVAILABLE'; message = '浏览器加密接口不可用，请更新插件与浏览器后重试';
  } else if (error?.scope === 'tavern-storage') {
    code = status === 413 ? 'SERVER_UPLOAD_LIMIT' : status === 403 || status === 401 ? 'SERVER_STORAGE_PERMISSION'
      : !status && ['TypeError', 'TimeoutError'].includes(name) ? 'STORAGE_NETWORK' : 'SERVER_STORAGE_HTTP';
    message = status === 413 ? '酒馆拒绝图片上传：请求超过服务器或反向代理大小限制，请联系管理员调整'
      : status === 401 || status === 403 ? '酒馆图片存储访问被拒绝，请核对登录状态、账号权限或服务器插件授权'
        : `酒馆存储请求失败${status ? `（HTTP ${status}）` : ''}，请到调试工具检测并复制日志`;
  } else if (trustedMessage && error?.code === INVALID_IMAGE_RESPONSE) {
    code = INVALID_IMAGE_RESPONSE; message = raw;
  } else if (trustedMessage) {
    code = status ? 'GENERATION_HTTP' : 'GENERATION_REJECTED'; message = raw;
  } else if (name === 'TypeError') {
    code = ['saving', 'refreshing', 'response-cache', 'task-state'].includes(phase) ? 'STORAGE_NETWORK' : 'PROVIDER_NETWORK';
    message = `${PHASES[phase]}时网络请求失败，请检查服务访问、HTTPS 和跨域设置，可到调试工具检测`;
  } else if (name === 'SecurityError') {
    code = 'STORAGE_BLOCKED'; message = '浏览器拒绝了存储访问，请检查站点权限或隐私模式，并到调试工具检测';
  } else if (phase === 'image-processing' && ['EncodingError', 'InvalidStateError', 'NotSupportedError', 'RangeError'].includes(name)) {
    code = 'IMAGE_PROCESSING'; message = '图片解码或缩略图处理失败，请降低尺寸或并行数量，并到调试工具检测';
  } else if (['TransactionInactiveError', 'InvalidStateError', 'NotFoundError', 'UnknownError', 'DataCloneError'].includes(name)) {
    code = 'BROWSER_DATABASE'; message = '浏览器图片或任务数据库操作失败，请关闭重复页面并到调试工具检测';
  } else if (/最多保存 500 张/.test(raw)) {
    code = 'BROWSER_RECORD_LIMIT'; message = '浏览器图库已达到 500 张上限，请先导出并整理，或切换为酒馆服务器存图';
  } else if (/最多保存 10000 张|账号图片超过 10000 张/.test(raw)) {
    code = 'SERVER_RECORD_LIMIT'; message = '酒馆图库已达到 10000 张上限，请先分批备份整理';
  } else if (/秘钥无法读取/.test(raw)) {
    code = 'CREDENTIAL_UNAVAILABLE'; message = '原任务秘钥无法读取，请在原设备恢复该秘钥';
  }
  return { code, message, phase, errorName: name, httpStatus: status, storageLocation: storage,
    provider: ['novelai', 'openai', 'comfyui', 'sdwebui'].includes(job.plan?.provider) ? job.plan.provider : 'unknown',
    responseRetained: Boolean(job.execution), imageSaved: job.saved === true };
}

export function rememberGenerationFailure(error, job, trustedMessage = false) {
  const result = classifyGenerationFailure(error, job, trustedMessage);
  recent.push({ ...result, createdAt: new Date().toISOString(),
    durationMs: Math.max(0, Math.round(Date.now() - (job.startedAt || Date.now()))) });
  if (recent.length > 20) recent.shift();
  return result;
}

export const recentGenerationFailures = () => recent.map((row) => ({ ...row }));
export const debugPhaseTitle = (phase) => PHASES[phase] || '任务处理';
