export const ASSISTANT_RESULT_TOOL = 'submit_linghuashi_result';
const failure = (message) => Object.assign(new Error(message), { assistantDiagnostic: true });

export function assistantResponseParameters(mode) {
  if (mode === 'json') return { response_format: { type: 'json_object' } };
  if (mode !== 'tool') return {};
  return {
    tools: [{ type: 'function', function: {
      name: ASSISTANT_RESULT_TOOL,
      description: 'Submit the complete JSON result required by this utility task. No reasoning or commentary.',
      parameters: { type: 'object', properties: {
        result: { type: 'string', description: 'The complete result JSON object, serialized as a string.' },
      }, required: ['result'], additionalProperties: false },
    } }],
    tool_choice: { type: 'function', function: { name: ASSISTANT_RESULT_TOOL } },
    parallel_tool_calls: false,
  };
}

function textContent(content) {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.filter((row) => ['text', 'output_text'].includes(row?.type))
    .map((row) => typeof row.text === 'string' ? row.text : row.text?.value || '').join('') : '';
}

export function extractAssistantResponse(data) {
  if (!data || typeof data !== 'object' || data.error) throw failure('文字接口返回错误，请检查模型、额度与接口配置');
  const choice = data.choices?.[0], message = choice?.message || {};
  const calls = message.tool_calls || (message.function_call ? [{ function: message.function_call }] : []);
  let raw = '';
  if (calls.length) {
    if (calls.length !== 1 || calls[0]?.function?.name !== ASSISTANT_RESULT_TOOL) {
      throw failure('文字模型返回未知或多个工具结果，请切换普通 JSON 回复后重试');
    }
    try {
      const args = JSON.parse(calls[0].function.arguments);
      if (typeof args.result !== 'string') throw new Error();
      raw = args.result;
    } catch { throw failure('文字模型返回的工具参数不完整，请检查输出上限'); }
  } else {
    raw = textContent(message.content) || textContent(choice?.text) || textContent(data.output_text)
      || textContent(data.content) || textContent(data.text)
      || (Array.isArray(data.output) ? data.output.map((row) => textContent(row.content)).join('') : '');
  }
  if (choice?.finish_reason === 'length' || data.status === 'incomplete') {
    const error = Object.assign(failure('文字模型输出达到上限，结果可能被截断；请减少配图数量或上下文，或提高最大输出 Token'), { assistantTruncated: true });
    if (raw && raw.length <= 100000) Object.defineProperty(error, 'assistantResponse', { value: raw });
    throw error;
  }
  if (message.refusal || choice?.finish_reason === 'content_filter') throw failure('文字模型未提供绘图结果，请查看模型限制或调整输入');
  if (!raw.trim() || raw.length > 100000) throw failure('文字模型没有返回有效结果');
  return raw;
}
