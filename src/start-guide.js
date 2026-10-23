export const START_GOALS = Object.freeze([
  ['manual', '手动生图', 'image-plus'],
  ['chat', '聊天自动配图', 'messages-square'],
  ['comic', '制作漫画', 'panels-top-left'],
]);

export function normalizeExperience(value, existing = false) {
  return {
    version: 1,
    level: ['common', 'full'].includes(value?.level) ? value.level : existing ? 'full' : 'common',
    goal: START_GOALS.some(([id]) => id === value?.goal) ? value.goal : '',
    dismissed: typeof value?.dismissed === 'boolean' ? value.dismissed : existing,
    completed: value?.completed === true,
  };
}

const status = (code, label, detail, action, canSubmit = false) => ({ code, label, detail, action, canSubmit });
const validEndpoint = (endpoint) => {
  try {
    const url = new URL(endpoint);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
};
const localEndpoint = (endpoint) => {
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname); }
  catch { return false; }
};

export function imageReadiness({ provider, endpoint = '', hasKey, auth = 'none', credentialError = '',
  model = '', workflowReady = true, route = 'resolved', probe = {}, generated = false, enabled = true }) {
  if (!enabled) return status('missing', '插件已关闭', '在插件设置中启用', 'settings');
  if (credentialError) return status('error', '秘钥未保存', credentialError, 'connection');
  if (provider === 'novelai') {
    if (!hasKey) return status('missing', '未配置秘钥', '填写 NovelAI 或第三方秘钥', 'connection');
    if (['error', 'unknown', 'empty'].includes(route)) return status('missing', '接口待确认', '核对秘钥或填写第三方接口地址', 'connection');
  } else {
    if (!validEndpoint(endpoint)) return status('missing', '未配置有效地址', '填写完整的 HTTP 或 HTTPS 接口地址', 'connection');
    if ((provider === 'openai' && !localEndpoint(endpoint) || auth !== 'none') && !hasKey) {
      return status('missing', '未配置秘钥', '填写当前接口的认证信息', 'connection');
    }
  }
  if (['novelai', 'openai'].includes(provider) && !model.trim()) {
    return status('missing', '未选择生图模型', '选择或填写生图模型', 'connection');
  }
  if (provider === 'comfyui' && !workflowReady) return status('missing', '工作流未准备好', '导入工作流并核对正向提示词与输出节点', 'connection');
  if (probe.tone === 'pending') return status('checking', '正在检查连接', probe.message || '', 'connection', true);
  if (probe.tone === 'error') return status('error', '连接异常', probe.message || '重新测试或检测网络', 'connection', true);
  if (generated) return status('ready', '生图已验证', '当前接口与模型已实际返回图片', 'generate', true);
  if (probe.tone === 'success') return status('configured', '连接通过 · 生图待验证', '实际成功生成后才标记生图已验证', 'generate', true);
  return status('configured', '已配置 · 尚未验证', '可测试连接，或手动提交第一张图', 'connection', true);
}

export function assistantReadiness({ source = 'tavern', endpoint = '', hasKey, model = '', tavernCurrent = '',
  installed = false, modelSource = '', modelsError = '', busy = false, enabled = true, succeeded = false,
  credentialError = '' }) {
  if (!enabled) return status('missing', '插件已关闭', '在插件设置中启用', 'settings');
  if (busy) return status('checking', '正在处理', '文字任务进行中', 'assistant');
  if (credentialError) return status('error', '秘钥未保存', credentialError, 'assistant-config');
  if (source === 'api') {
    if (!validEndpoint(endpoint)) return status('missing', '文字地址未配置', '填写独立 API 地址', 'assistant-config');
    if (!hasKey && !localEndpoint(endpoint)) return status('missing', '文字秘钥未配置', '填写助手 API Key', 'assistant-config');
    if (!model.trim()) return status('missing', '文字模型未选择', '输入模型名称或读取模型列表', 'assistant-config');
  } else if (!installed) return status('missing', '需要酒馆接口', '在酒馆中使用跟随模式，或配置独立 API', 'assistant-config');
  else if (!model.trim() && !tavernCurrent) {
    return status('unverified', '酒馆模型待确认', '读取酒馆当前模型；不会发起文字生成', 'assistant-models', true);
  }
  if (modelsError) return status('error', '模型列表读取异常', modelsError, 'assistant-config', true);
  if (succeeded) return status('ready', '文字调用已验证', '当前配置已成功完成文字任务', 'assistant-config', true);
  if (modelSource === source) return status('configured', '模型已读取 · 调用待验证', '模型列表不代表文字调用权限已验证', 'assistant-config', true);
  return status('configured', '已配置 · 调用待验证', '提交文字任务后验证实际调用', 'assistant-config', true);
}

export function storageReadiness({ location = 'browser', loading = false, error = '', installed = false }) {
  if (location === 'server' && !installed) return status('missing', '需要登录酒馆', '服务器存图使用当前酒馆账号', 'storage-settings');
  if (loading) return status('checking', '正在读取', '正在打开图片存储', 'storage-settings');
  if (error) return status('error', '存储暂不可用', error, 'storage-check');
  return status('configured', '图片库可读取', location === 'server' ? '当前酒馆账号 · 尚未进行写入测试' : '当前设备与站点 · 尚未进行写入测试', 'storage-check', true);
}

export function guideSteps(experience, { image, assistant, storage, chat = {} }) {
  const autoPrompt = chat.assistant?.autoPrompt ?? chat.autoPrompt;
  const steps = [{ id: 'image', label: '配置生图接口', page: 'connection', result: image }];
  if (['comic', 'chat'].includes(experience.goal)) {
    steps.push({ id: 'assistant', label: '配置文字模型', page: 'assistant', result: assistant,
      optional: experience.goal === 'chat' && !autoPrompt });
  }
  if (experience.goal === 'chat') steps.push({ id: 'chat', label: '聊天触发与展示', page: 'chat-settings',
    result: chat.inline && (chat.auto || autoPrompt)
      ? status('configured', '自动配图已开启', autoPrompt ? '使用提示词助手分析剧情' : '识别回复中的提示词块', 'chat-settings', true)
      : status('missing', '需要核对自动配图', '检查自动生图与聊天图片展示开关', 'chat-settings') });
  steps.push({ id: 'storage', label: '选择图片存储', page: 'storage-settings', result: storage });
  return steps;
}

export function guideStepComplete(row) {
  return Boolean(row.optional || row.result.canSubmit && !['error', 'checking', 'missing'].includes(row.result.code));
}

export function failureActions({ scope = 'image', message = '', phase = '', execution = false,
  saved = false, status: taskStatus = '', stage = '' } = {}) {
  if (scope === 'assistant') return [
    ...(/JSON|解析|格式|截断|回复|工具|分镜/.test(message) ? ['assistant-response'] : []),
    'assistant-config', 'assistant-network', 'assistant-diagnostic',
  ];
  const storage = /存储|保存|缓存|配额|磁盘|数据库|图库|缩略图/.test(message)
    || ['saving', 'refreshing', 'response-cache', 'image-processing'].includes(phase);
  const recoverable = !['running', 'queued', 'completed', 'cancelled'].includes(taskStatus) && (execution || stage === 'waiting');
  return [...(recoverable ? ['task-retry'] : []), ...(saved ? ['gallery'] : []),
    ...(storage ? ['storage-check', 'storage-settings', 'backup-settings']
      : /网络|连接|跨域|超时|fetch|HTTPS/i.test(message) ? ['image-network', 'connection'] : ['connection']),
    ...(['uncertain', 'paused'].includes(taskStatus) || !recoverable ? ['task-records'] : [])];
}
