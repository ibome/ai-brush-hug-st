import { estimateTokens } from './assistant-context.js';
import { ASSISTANT_MAX_TOKENS } from './assistant-limits.js';

const modes = ['text', 'json', 'tool'];
const limit = (value, max) => Math.max(0, Math.min(max, Math.round(Number(value) || 0)));
export function normalizeCompatibilityProfiles(value) {
  const rows = [], seen = new Set();
  for (const row of (Array.isArray(value) ? value : []).slice(-40)) {
    if (typeof row?.identity !== 'string' || row.identity.length > 1500 || seen.has(row.identity)) continue;
    let parts;
    try { parts = JSON.parse(row.identity); } catch { continue; }
    if (!Array.isArray(parts) || parts.length !== 3 || !['api', 'tavern'].includes(parts[0])
      || parts.some((part) => typeof part !== 'string') || !parts[2].trim()) continue;
    seen.add(row.identity);
    rows.push({ identity: row.identity, responseMode: modes.includes(row.responseMode) ? row.responseMode : 'text',
      outputParameter: row.outputParameter === 'max_completion_tokens' ? 'max_completion_tokens' : 'max_tokens',
      omitTemperature: row.omitTemperature === true, contextWindow: limit(row.contextWindow, 4000000),
      outputLimit: limit(row.outputLimit, ASSISTANT_MAX_TOKENS) });
  }
  return rows;
}
export function compatibilityIdentity(options, { currentModel = '', tavernIdentity = '' } = {}) {
  let endpoint = tavernIdentity;
  if (options.source === 'api') {
    try {
      const url = new URL(options.endpoint);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return '';
      let path = url.pathname.replace(/\/+$/, '').replace(/\/(?:chat\/completions|models)$/, '');
      if (!/\/v\d+(?:beta\d*)?$/.test(path)) path += '/v1';
      endpoint = `${url.origin}${path}`;
    } catch { return ''; }
  }
  const model = (options.source === 'api' ? options.model : options.tavernModel || currentModel)?.trim();
  return model && endpoint ? JSON.stringify([options.source, endpoint, model]) : '';
}
export function compatibilityFor(options, target) {
  const identity = compatibilityIdentity(options, target);
  return normalizeCompatibilityProfiles(options.compatibilityProfiles).find((row) => row.identity === identity) || null;
}
export function resolveAssistantCompatibility(options, target) {
  const profile = compatibilityFor(options, target);
  const result = profile ? { ...options, ...profile, compatibilityProfiles: options.compatibilityProfiles } : { ...options };
  if (options.responseModeOverride) result.responseMode = options.responseModeOverride;
  return result;
}
export function saveCompatibility(options, target, values) {
  const identity = compatibilityIdentity(options, target);
  if (!identity) throw new Error('请先填写接口和文字模型；跟随酒馆时先读取模型列表');
  const rows = normalizeCompatibilityProfiles(options.compatibilityProfiles).filter((row) => row.identity !== identity);
  return normalizeCompatibilityProfiles([...rows, { ...values, identity }]);
}
export function assistantRequestParameters(options) {
  return { [options.outputParameter === 'max_completion_tokens' ? 'max_completion_tokens' : 'max_tokens']: options.maxTokens,
    ...(options.omitTemperature ? {} : { temperature: options.temperature }) };
}
export function assistantBudget(messages, options, { operation = '', units = 1 } = {}) {
  const input = messages.reduce((sum, row) => sum + estimateTokens(row.content) + 4, 3);
  const total = input + options.maxTokens, warnings = [];
  const recommended = operation === 'comic' ? 500 + Math.max(1, units) * 650
    : ['illustrate', 'generate'].includes(operation) ? 500 + Math.max(1, units) * 450 : 0;
  if (options.contextWindow && total > options.contextWindow) warnings.push(`输入估算与输出上限合计 ${total}，超过所填上下文窗口 ${options.contextWindow}；可减少上下文或输出预算。`);
  if (recommended && options.maxTokens < recommended) warnings.push(`本次 ${units} 个画面建议预留约 ${recommended} 输出 Token，当前预算可能截断。`);
  const error = options.outputLimit && options.maxTokens > options.outputLimit
    ? `最大输出 ${options.maxTokens} 超过此模型保存的输出限制 ${options.outputLimit}，请调整后再提交` : '';
  return { input, output: options.maxTokens, total, warnings, error };
}
