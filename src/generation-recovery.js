export const INVALID_IMAGE_RESPONSE = 'INVALID_IMAGE_RESPONSE';

export function taskCapacityIssue(message = '') {
  return /^(?:最多保留 (?:100 条任务|32 条未完成任务|32 个等待或运行任务)|还有 32 个生图任务需要处理|待恢复响应超过 512 MB|待保存的图片响应已达到 512 MB)/.test(message);
}

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
