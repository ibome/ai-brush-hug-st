import { ASSISTANT_MAX_TOKENS } from './assistant-limits.js';

const operations = new Set(['generate', 'translate', 'polish', 'illustrate', 'profile', 'edit', 'comic']);
const stages = new Set(['context', 'preset', 'request', 'parse', 'validate', 'save']);
const roles = new Set(['system', 'user', 'assistant']);
const bounded = (value, max = 250000) => Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : 0;
const label = (value, max = 200) => typeof value === 'string'
  ? value.replace(/\b(?:sk-|pst-|STD-)[A-Za-z0-9_-]{8,}/g, '[redacted]').replace(/Bearer\s+\S+/gi, '[redacted]').slice(0, max) : '';

export function safeAssistantEndpoint(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return '';
    const privateHost = /^(?:localhost|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|\[)/i.test(url.hostname);
    return `${url.protocol}//${privateHost ? '[本地地址]' : label(url.host, 255)}`;
  } catch { return ''; }
}

export function assistantExecution(value = {}) {
  return {
    model: label(value.model),
    source: label(value.source, 60),
    route: ['native', 'tavern-backend', 'independent-api', 'independent-tavern'].includes(value.route) ? value.route : '',
    ...(Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599 ? { httpStatus: value.httpStatus } : {}),
  };
}

export function assistantErrorCategory(error, stage) {
  const message = String(error?.message || '');
  if (/abort|取消/i.test(`${error?.name} ${message}`)) return 'cancelled';
  if (/timeout|超时/i.test(`${error?.name} ${message}`)) return 'timeout';
  if (stage === 'parse' || error?.comicParseFailure || error?.assistantDiagnostic) return 'response';
  if (/鉴权|401|Key|秘钥/i.test(message)) return 'authentication';
  if (/限流|429/.test(message)) return 'rate-limit';
  if (/网络|连接|跨域|fetch/i.test(message)) return 'network';
  if (/预设|任务消息/.test(message)) return 'preset';
  if (/JSON|解析|格式|截断|拒绝|回复|工具|画面数量/.test(message)) return 'response';
  if (/原消息|聊天|配置已改变|设置已变化/.test(message)) return 'changed';
  return 'local-or-upstream';
}

export function createAssistantTrace(operation, settings, { version = '', build = '', now = () => Date.now(), changed = () => {} } = {}) {
  const started = now();
  const record = {
    type: 'linghuashi-assistant-diagnostics', formatVersion: 1, version: label(version), build: label(build),
    createdAt: new Date(started).toISOString(), operation: operations.has(operation) ? operation : 'generate',
    source: settings.source === 'api' ? 'api' : 'tavern', endpoint: settings.source === 'api' ? safeAssistantEndpoint(settings.endpoint) : '',
    apiTransport: settings.apiTransport === 'tavern' ? 'tavern' : 'direct',
    responseMode: ['json', 'tool'].includes(settings.responseMode) ? settings.responseMode : 'text',
    requestedModel: label(settings.source === 'api' ? settings.model : settings.tavernModel),
    maxTokens: bounded(settings.maxTokens, ASSISTANT_MAX_TOKENS), status: 'running', durationMs: 0,
    presetMode: ['current', 'named'].includes(settings.presetMode) ? settings.presetMode : 'none',
    presetOrder: [], messages: [], stages: [], execution: assistantExecution(), context: {},
  };
  let active, finished = false;
  const closeStage = () => { if (active && !finished) active.durationMs = bounded(now() - active.started, 3600000); };
  return {
    record, presetNames: [],
    step(stage) {
      if (finished || !stages.has(stage)) return;
      closeStage();
      active = { stage, started: now(), durationMs: 0 };
      record.stages.push(active); changed();
    },
    context(summary) {
      record.context = Object.fromEntries(['messages', 'characters', 'worldCharacters']
        .map((key) => [key, bounded(summary?.[key])]));
    },
    request(messages, entries = []) {
      record.messages = messages.slice(0, 144).map((row, index) => ({
        order: index + 1, role: roles.has(row.role) ? row.role : 'system', characters: bounded(row.content?.length),
      }));
      record.presetOrder = entries.slice(0, 128).map((row, index) => ({
        order: index + 1, role: roles.has(row.role) ? row.role : 'system', characters: bounded(row.content?.length),
      }));
      this.presetNames = entries.map((row) => label(row.name, 120));
    },
    execution(value) { record.execution = assistantExecution({ ...record.execution, ...value }); },
    finish(error, scenes = 0) {
      if (finished) return;
      closeStage(); finished = true;
      record.status = error ? assistantErrorCategory(error, active?.stage) === 'cancelled' ? 'cancelled' : 'failed' : 'success';
      if (error) record.errorCategory = assistantErrorCategory(error, active?.stage);
      record.durationMs = bounded(now() - started, 3600000);
      record.scenes = bounded(scenes, operation === 'comic' ? 12 : 4); changed();
    },
    report() {
      closeStage();
      // Export only fields assembled here; never serialize request bodies or upstream errors.
      return { ...structuredClone(record), durationMs: finished ? record.durationMs : bounded(now() - started, 3600000),
        stages: record.stages.map(({ stage, durationMs }) => ({ stage, durationMs })),
        limits: '不包含秘钥、认证头、聊天正文、提示词、模型回复、预设名称或接口路径；仅保留当前页面。' };
    },
  };
}
