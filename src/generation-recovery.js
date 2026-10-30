export const INVALID_IMAGE_RESPONSE = 'INVALID_IMAGE_RESPONSE';

// Older task ledgers retain only the displayed error, without a diagnostic code.
const UNUSABLE_RESPONSE = /^(?:接口未返回可用图片：|接口没有返回可用图片；不支持异步任务式图片响应|NovelAI 图片响应缺少 image|图片响应缺少 b64_json 或 url|服务返回的内容不是图片、ZIP 或图片 JSON|图片 Base64 内容无效|服务返回的图片地址(?:无效|不可使用))/;

export function unusableGenerationResponse(task = {}) {
  return task.diagnostic?.code === INVALID_IMAGE_RESPONSE || task.code === INVALID_IMAGE_RESPONSE
    || UNUSABLE_RESPONSE.test(task.error || task.message || '');
}

export function canRecoverGeneration(task = {}) {
  return ['failed', 'paused', 'uncertain'].includes(task.status)
    && !unusableGenerationResponse(task)
    && (Boolean(task.execution) || task.stage === 'waiting' && task.status !== 'uncertain');
}
