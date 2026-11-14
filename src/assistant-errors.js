const failures = {
  cancelled: ['cancelled', '提示词助手操作已取消'],
  timeout: ['timeout', '酒馆文字请求超时，请稍后手动重试'],
  busy: ['busy', '酒馆文字模型正在使用，请等待当前文字任务结束后重试'],
  authentication: ['authentication', '酒馆文字接口认证失败，请检查酒馆中的秘钥与连接配置'],
  permission: ['permission', '酒馆文字接口拒绝访问，请检查账号与模型权限'],
  quota: ['quota', '酒馆文字接口额度不足，请检查服务余额或配额'],
  'rate-limit': ['rate-limit', '酒馆文字接口请求过于频繁，请稍后手动重试'],
  model: ['model', '酒馆文字接口不支持所选模型或当前账号无权使用，请核对模型名称与权限'],
  parameters: ['parameters', '酒馆文字接口拒绝请求参数，请检查最大输出 Token、返回方式和模型支持范围'],
  compatibility: ['compatibility', '当前酒馆不支持此次文字调用方式，请使用聊天补全接口，或改用独立 API'],
  network: ['network', '未取得酒馆文字接口响应，请检查酒馆服务器连接与服务网络'],
  upstream: ['upstream', '酒馆上游文字服务异常，请查看酒馆后端日志并稍后手动重试'],
  'invalid-response': ['response', '酒馆文字接口返回了无效 JSON 或意外的响应格式，请检查服务地址与返回方式'],
  'tavern-failed': ['local-or-upstream', '酒馆文字调用未完成，具体原因未由宿主提供；请查看酒馆后端日志并复制助手调用诊断'],
};
const status = (value) => Number.isInteger(Number(value)) && Number(value) >= 100 && Number(value) <= 599 ? Number(value) : undefined;
const parameters = new Set(['max_tokens', 'max_completion_tokens', 'max_output_tokens', 'temperature', 'response_format', 'json_schema', 'tools', 'tool_choice']);
const responseTypes = new Set(['json', 'html', 'stream', 'text', 'unknown']);

export function assistantFailureInfo(value) {
  if (!value || !Object.hasOwn(failures, value.code)) return undefined;
  return { code: value.code, category: failures[value.code][0],
    ...(status(value.httpStatus) ? { httpStatus: status(value.httpStatus) } : {}),
    ...(status(value.upstreamStatus) ? { upstreamStatus: status(value.upstreamStatus) } : {}),
    ...(parameters.has(value.parameter) ? { parameter: value.parameter } : {}),
    ...(responseTypes.has(value.responseType) ? { responseType: value.responseType } : {}) };
}

export function assistantCallError(code, details = {}) {
  const info = assistantFailureInfo({ ...details, code }) || assistantFailureInfo({ code: 'tavern-failed' });
  const suffix = [info.httpStatus ? `酒馆 HTTP ${info.httpStatus}` : '',
    info.upstreamStatus ? `上游 HTTP ${info.upstreamStatus}` : '', info.parameter || ''].filter(Boolean);
  return Object.assign(new Error(`${failures[info.code][1]}${suffix.length ? `（${suffix.join(' · ')}）` : ''}`),
    { assistantDiagnostic: true, assistantFailure: info });
}

// Inspect provider details only to select fixed messages; never expose raw errors or response bodies.
export function tavernResponseError(data, details = {}) {
  const remote = data?.error;
  const upstreamStatus = status(remote?.status) || status(remote?.status_code) || status(remote?.code)
    || status(data?.status) || status(data?.status_code);
  const message = [typeof remote === 'string' ? remote : remote?.message, remote?.type, remote?.code,
    data?.message, data?.detail].filter((value) => typeof value === 'string').join(' ').slice(0, 16000);
  const httpStatus = status(details.httpStatus);
  const codeStatus = upstreamStatus || (httpStatus !== 200 ? httpStatus : undefined);
  const parameter = parameters.has(remote?.param) ? remote.param
    : [...parameters].find((name) => new RegExp(`\\b${name}\\b`, 'i').test(message));
  const metadata = { ...details, upstreamStatus, parameter };
  if (codeStatus === 401 || /invalid[_ -]?(?:api[_ -]?)?key|authentication|unauthorized|认证失败|秘钥无效/i.test(message)) return assistantCallError('authentication', metadata);
  if (/insufficient[_ -]?(?:quota|credit|balance)|quota[_ -]?exceeded|余额不足|额度不足|配额.*不足/i.test(message) || codeStatus === 402) return assistantCallError('quota', metadata);
  if (codeStatus === 429 || /rate[_ -]?limit|too many requests|限流/i.test(message)) return assistantCallError('rate-limit', metadata);
  if (/model[_ -]?(?:not[_ -]?found|not[_ -]?available|not[_ -]?supported)|(?:unknown|invalid|unsupported|unavailable)\s+model|model.{0,120}(?:does not exist|not found|not supported|not available|no access)|模型.{0,30}(?:不存在|不可用|无权|不支持)/i.test(message)) return assistantCallError('model', metadata);
  if (codeStatus === 403 || /permission[_ -]?denied|forbidden|无权限/i.test(message)) return assistantCallError('permission', metadata);
  if (codeStatus === 400 || codeStatus === 422 || /invalid[_ -]?(?:request|parameter)|unsupported[_ -]?parameter|context[_ -]?length|maximum context|maximum.*tokens|不支持.*参数/i.test(message)) return assistantCallError('parameters', metadata);
  if (codeStatus >= 500) return assistantCallError('upstream', metadata);
  return assistantCallError('tavern-failed', metadata);
}

export function normalizeTavernError(error) {
  if (error?.assistantDiagnostic) return error;
  if (error?.name === 'AbortError') return assistantCallError('cancelled');
  if (error?.name === 'TimeoutError') return assistantCallError('timeout');
  const message = String(error?.message || '');
  if (/正在使用|正在生成回复|其他页面使用|当前任务尚未完成/.test(message)) return assistantCallError('busy');
  if (/不支持.*(?:跟随|选模)|需要酒馆使用聊天补全接口/.test(message)) return assistantCallError('compatibility');
  if (error?.name === 'TypeError' && /fetch|network|load failed/i.test(message)) return assistantCallError('network');
  if (error?.name === 'SyntaxError') return assistantCallError('invalid-response');
  return tavernResponseError({ error: { message, status: error?.status } });
}
