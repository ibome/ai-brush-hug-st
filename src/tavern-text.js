import { assistantModelNames } from './prompt-assistant.js';
import { withRequestTimeout } from './request-timeout.js';
import { hostEnvironment } from './host-compat.js';
import { assistantResponseParameters, extractAssistantResponse } from './assistant-response.js';

const STATUS_SOURCES = new Set(['openai', 'openrouter', 'mistralai', 'custom', 'cohere', 'chutes',
  'electronhub', 'nanogpt', 'deepseek', 'xai', 'aimlapi', 'pollinations', 'groq', 'moonshot',
  'fireworks', 'makersuite', 'siliconflow', 'workers_ai']);
const STATUS_FIELDS = ['reverse_proxy', 'proxy_password', 'custom_url', 'custom_include_headers',
  'siliconflow_endpoint', 'minimax_endpoint', 'workers_ai_account_id', 'moonshot_endpoint'];
const TAURI_STATUS_SOURCES = new Set(['claude', 'opencode']);
const TAURI_STATUS_FIELDS = ['custom_api_format', 'opencode_endpoint', 'opencode_api_format', 'secret_id'];
const signature = (context) => JSON.stringify([context.mainApi, context.chatCompletionSettings?.chat_completion_source,
  context.chatCompletionSettings?.custom_url, context.chatCompletionSettings?.reverse_proxy,
  context.chatCompletionSettings?.custom_api_format, context.chatCompletionSettings?.opencode_endpoint,
  context.chatCompletionSettings?.opencode_api_format]);
const loadTavernAPI = () => {
  const url = new URL('/scripts/openai.js', globalThis.location.href);
  return import(/* @vite-ignore */ url.href);
};

export function createTavernTextAccess({ getContext, fetcher = fetch,
  loadAPI = loadTavernAPI, document = globalThis.document }) {
  async function models({ refresh = false, signal } = {}) {
    const context = getContext();
    const tauri = hostEnvironment().kind === 'tauritavern';
    const before = signature(context);
    if (context.mainApi !== 'openai') {
      return { models: [], current: '', source: context.mainApi || '', signature: signature(context),
        message: '当前酒馆使用文本补全接口，请切换到聊天补全接口后独立选择模型' };
    }
    const api = await loadAPI();
    const settings = context.chatCompletionSettings || api.oai_settings || {};
    const source = settings.chat_completion_source;
    const current = (context.getChatCompletionModel || api.getChatCompletionModel)?.(settings) || '';
    const selector = { makersuite: 'google', azure_openai: 'azure_openai' }[source] || source;
    const options = document?.querySelectorAll?.(`#model_${selector}_select option`) || [];
    const cached = assistantModelNames([...(api.model_list || []),
      ...Array.from(options, (option) => option.value), current].filter(Boolean));
    let list = cached, message = '';
    if (refresh && (STATUS_SOURCES.has(source) || tauri && TAURI_STATUS_SOURCES.has(source))) {
      const body = { chat_completion_source: source };
      for (const key of [...STATUS_FIELDS, ...(tauri ? TAURI_STATUS_FIELDS : [])]) {
        if (typeof settings[key] === 'string') body[key] = settings[key];
      }
      const data = await withRequestTimeout(signal, 15000, '酒馆模型列表读取超时，请手动重试', async (requestSignal) => {
        const response = await fetcher('/api/backends/chat-completions/status', {
          method: 'POST', headers: context.getRequestHeaders(), credentials: 'same-origin', cache: 'no-store',
          body: JSON.stringify(body), signal: requestSignal,
        });
        if (!response.ok) throw new Error(`酒馆模型列表读取失败（${response.status}）`);
        return response.json();
      });
      if (data.error) throw new Error('酒馆模型列表读取失败，请检查酒馆接口连接');
      const received = assistantModelNames(data);
      if (received.length) list = assistantModelNames([...received, current].filter(Boolean));
      else message = '接口未返回模型列表，已保留酒馆可用模型';
    } else if (refresh) message = '已读取酒馆模型选项；该接口未提供独立模型列表查询';
    signal?.throwIfAborted();
    if (signature(getContext()) !== before) throw new Error('酒馆接口已切换，请重新获取模型列表');
    return { models: list, current, source, signature: before, message };
  }

  async function generate(messages, options, signal, { onExecution } = {}) {
    signal?.throwIfAborted();
    const context = getContext();
    const execution = (value) => { try { onExecution?.(value); } catch {} };
    if (!options.tavernModel.trim() && !['tool', 'json'].includes(options.responseMode)) {
      if (onExecution) {
        let api = {};
        if (context.mainApi === 'openai' && !context.getChatCompletionModel) {
          try { api = await loadAPI(); } catch {}
        }
        const settings = context.chatCompletionSettings || api.oai_settings || {};
        execution({ model: (context.getChatCompletionModel || api.getChatCompletionModel)?.(settings) || '',
          source: settings.chat_completion_source || context.mainApi || '', route: 'native' });
      }
      signal?.throwIfAborted();
      const request = { prompt: messages, responseLength: options.maxTokens, trimNames: false, quietToLoud: false };
      if (context.mainApi === 'openai' && typeof context.generateRawData === 'function'
        && typeof context.extractMessageFromData === 'function') {
        // Utility JSON must not pass through chat display cleanup and regex replacements.
        const data = await context.generateRawData(request);
        signal?.throwIfAborted();
        if (data?.choices || data?.output_text || data?.output) return extractAssistantResponse(data);
        return context.extractMessageFromData(data, 'openai');
      }
      if (typeof context.generateRaw !== 'function') throw new Error('当前酒馆不支持跟随文字模型，请改用独立 API');
      return context.generateRaw(request);
    }
    if (context.mainApi !== 'openai') throw new Error('独立选模与结构化返回需要酒馆使用聊天补全接口');
    const api = await loadAPI();
    if (typeof api.createGenerationParameters !== 'function') throw new Error('当前酒馆版本不支持助手独立选模');
    signal?.throwIfAborted();
    // Build with a snapshot so model-specific parameters never alter the chat configuration.
    const settings = structuredClone(context.chatCompletionSettings || api.oai_settings);
    settings.openai_max_tokens = options.maxTokens;
    settings.request_images = false;
    const model = options.tavernModel.trim() || (context.getChatCompletionModel || api.getChatCompletionModel)?.(settings);
    if (!model) throw new Error('无法读取酒馆当前模型，请选择助手文字模型后重试');
    execution({ model, source: settings.chat_completion_source, route: 'tavern-backend' });
    const { generate_data } = await api.createGenerationParameters(settings, model, 'quiet', structuredClone(messages));
    const body = { ...generate_data, model, stream: false };
    delete body.tools;
    delete body.tool_choice;
    Object.assign(body, assistantResponseParameters(options.responseMode));
    // Tavern's backend exposes JSON mode through its json_schema parameter.
    if (options.responseMode === 'json') body.json_schema = { name: 'linghuashi_result', strict: false, value: { type: 'object' } };
    signal?.throwIfAborted();
    const data = await withRequestTimeout(signal, options.timeout * 1000, '酒馆文字请求超时，请手动重试', async (requestSignal) => {
      const response = await fetcher('/api/backends/chat-completions/generate', {
        method: 'POST', headers: context.getRequestHeaders(), credentials: 'same-origin', cache: 'no-store',
        body: JSON.stringify(body), signal: requestSignal,
      });
      execution({ httpStatus: response.status });
      if (!response.ok) throw new Error(`酒馆文字请求失败（${response.status}）`);
      return response.json();
    });
    if (data.error) throw new Error('酒馆文字接口返回错误，请检查模型权限');
    if (options.responseMode === 'tool' || data?.choices || data?.output_text || data?.output) return extractAssistantResponse(data);
    const content = typeof api.getStreamingReply === 'function'
      ? api.getStreamingReply(data, {}, { chatCompletionSource: settings.chat_completion_source, overrideShowThoughts: false })
      : data.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : Array.isArray(content)
      ? content.filter((part) => part.type === 'text').map((part) => part.text).join('') : '';
  }
  return { models, generate };
}
