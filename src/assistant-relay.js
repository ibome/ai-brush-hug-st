import { assistantURLs, assistantModelNames, normalizeAssistant } from './prompt-assistant.js';
import { validateAssistantMessages } from './assistant-presets.js';
import { assistantResponseParameters, extractAssistantResponse } from './assistant-response.js';
import { withRequestTimeout } from './request-timeout.js';
import { assistantRequestParameters } from './assistant-compatibility.js';

const failure = (message) => Object.assign(new Error(message), { assistantRelay: true });

export function createAssistantRelay({ getContext, fetcher = fetch }) {
  async function request(action, value, { signal, onExecution } = {}) {
    if (!['models', 'text', 'probe'].includes(action)) throw failure('未知酒馆转发操作');
    const settings = normalizeAssistant(value.settings);
    if (settings.source !== 'api' || settings.apiTransport !== 'tavern') throw failure('请先选择独立 API 的酒馆转发');
    const base = assistantURLs(settings.endpoint).base;
    const key = typeof value.key === 'string' ? value.key.trim() : '';
    if (key.length > 4096 || /[^\u0020-\u00ff]/.test(key)) throw failure('助手秘钥包含无效的认证字符，请重新填写');
    if (action === 'text' && (!key || !settings.model.trim())) throw failure('请填写提示词助手的 API Key 和文字模型');
    if (action === 'text' && !validateAssistantMessages(value.messages)) throw failure('提示词助手请求格式无效');
    const context = getContext();
    if (typeof context?.getRequestHeaders !== 'function') throw failure('酒馆请求验证尚未就绪，请刷新后重试');
    // Override even an empty public probe so Tavern never lends its saved custom API key.
    const body = { chat_completion_source: 'custom', custom_api_format: 'openai_compat', custom_url: base,
      custom_include_headers: JSON.stringify({ Authorization: key ? `Bearer ${key}` : '' }) };
    if (action === 'text') {
      const parameters = { ...assistantResponseParameters(settings.responseMode), ...assistantRequestParameters(settings) };
      Object.assign(body, { model: settings.model.trim(), messages: structuredClone(value.messages),
        max_tokens: settings.maxTokens, stream: false,
        ...(settings.omitTemperature ? { custom_exclude_body: '["temperature"]' } : {}),
        custom_include_body: JSON.stringify(parameters), ...parameters });
      if (settings.outputParameter === 'max_completion_tokens') body.custom_exclude_body = JSON.stringify([
        ...(settings.omitTemperature ? ['temperature'] : []), 'max_tokens']);
    }
    const execution = (extra = {}) => {
      try { onExecution?.({ model: settings.model.trim(), source: 'openai-compatible', route: 'independent-tavern', ...extra }); } catch {}
    };
    if (action === 'text') execution();
    return withRequestTimeout(signal, (action === 'text' ? settings.timeout : action === 'probe' ? 6 : 15) * 1000,
      '酒馆转发请求超时，请检查酒馆服务器网络后手动重试', async (requestSignal) => {
        let response;
        try {
          response = await fetcher(`/api/backends/chat-completions/${action === 'text' ? 'generate' : 'status'}`, {
            method: 'POST', headers: { ...context.getRequestHeaders(), 'Content-Type': 'application/json' },
            credentials: 'same-origin', cache: 'no-store', body: JSON.stringify(body), signal: requestSignal,
          });
        } catch (error) {
          if (requestSignal.aborted) throw error;
          throw failure('无法连接酒馆转发接口，请检查酒馆连接后重试');
        }
        if (action === 'text') execution({ httpStatus: response.status });
        const status = response.status;
        if (!response.ok) {
          if (action === 'probe') return { outcome: 'relay-error', httpStatus: status,
            detail: `酒馆转发入口返回 HTTP ${status}，尚未确认上游接口状态；请核对酒馆权限与宿主版本` };
          throw failure(status === 404 ? '当前酒馆未提供转发接口，请更新宿主或选择设备直连'
            : `酒馆转发入口请求失败（HTTP ${status}），请核对酒馆连接与权限`);
        }
        let data;
        try { data = await response.json(); }
        catch {
          if (requestSignal.aborted) requestSignal.throwIfAborted();
          if (action === 'probe') return { outcome: 'relay-error', httpStatus: status, detail: '酒馆转发入口未返回 JSON，请核对宿主版本与登录状态' };
          throw failure('酒馆转发返回格式不正确，请核对接口地址与宿主版本');
        }
        requestSignal.throwIfAborted();
        if (data?.error || data?.cancelled) {
          if (action === 'probe') return { outcome: 'relay-error', httpStatus: status,
            detail: '酒馆已响应，但未能读取上游模型列表；宿主未提供上游状态码，请核对独立 API 的地址、秘钥及酒馆服务器网络' };
          throw failure('酒馆转发未成功，请核对独立 API 的地址、秘钥、模型权限及酒馆服务器网络；可点击“检测助手网络”定位');
        }
        if (action === 'text') return extractAssistantResponse(data);
        const models = assistantModelNames(data);
        if (action === 'probe') return { outcome: models.length ? 'relay-ok' : 'relay-empty', httpStatus: status,
          modelCount: models.length, detail: models.length
            ? '酒馆转发已读取上游模型列表；不代表所选模型支持聊天补全，也未提交文字生成'
            : '酒馆转发已返回 JSON，但未读取到模型；请核对地址，或手动填写模型名后测试文字功能' };
        if (!models.length) throw failure('酒馆转发的模型列表为空，可手动填写模型名');
        return models;
      });
  }
  return { request };
}
