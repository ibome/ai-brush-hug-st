const pending = new Set(['preparing', 'confirming', 'queued', 'running']);
const phases = {
  preparing: ['准备绘图素材', '正在读取参考图片与参数'],
  submitting: ['正在绘制画面', '等待生图接口返回结果'],
  generating: ['正在绘制画面', 'SDWebUI 正在生成'],
  retrieving: ['正在取回图片', '正在读取生成结果'],
  downloading: ['正在下载图片', '正在接收图片文件'],
  saving: ['正在保存图片', '正在存入绘图管理'],
};
const preparationPhases = {
  inbox: ['等待前面的配图任务', '前面的提示词分析或确认完成后继续'],
  window: ['等待关闭编辑窗口', '请先完成或关闭插件内的编辑窗口；尚未提交生图'],
  storage: ['正在读取图片存储', '正在准备图库与任务记录'],
  context: ['正在提取聊天上下文', '正在读取当前回复与角色资料'],
  preset: ['正在组装提示词预设', '正在按顺序读取已启用的预设条目'],
  analysis: ['正在分析画面', '正在等待文字模型生成绘图提示词'],
  parse: ['正在解析画面提示词', '正在检查文字模型返回的画面内容'],
  validate: ['正在核对配图内容', '正在确认原消息与绘图设置'],
  draft: ['正在保存提示词草稿', '正在保留画面与角色信息'],
};

export function generationTransitionState(task, { remote = false } = {}) {
  if (!task || !pending.has(task.status)) return null;
  let stage = task.status;
  let title, detail;
  if (remote) {
    title = '等待任务状态同步'; detail = '任务仍在执行，正在同步进度';
  } else if (stage === 'queued') {
    title = '正在排队'; detail = '等待调度，轮到后开始绘制';
  } else if (stage === 'confirming') {
    title = '等待确认提示词'; detail = '确认后开始绘制';
  } else if (stage === 'preparing') {
    [title, detail] = preparationPhases[task.phase] || ['准备生图', '正在准备提示词与绘图参数'];
  } else {
    stage = Object.hasOwn(phases, task.phase) ? task.phase : 'submitting';
    [title, detail] = phases[stage];
  }
  const value = task.progress?.value, max = task.progress?.max;
  const progress = !remote && task.status === 'running' && ['retrieving', 'generating'].includes(stage)
    && Number.isFinite(value) && value >= 0 && Number.isFinite(max) && max > 0
    ? { value: Math.min(value, max), max, percent: Math.min(100, value / max * 100) } : null;
  const node = task.progress?.node;
  if (progress) detail = `${detail} · ${progress.value} / ${progress.max}`;
  if (!remote && task.status === 'running' && typeof node === 'string' && /^[\w.-]{1,40}$/.test(node)) {
    if (node !== 'SDWebUI') detail += ` · 节点 #${node}`;
  }
  return {
    stage, title, detail, progress,
    animated: !remote && task.status !== 'confirming',
    cancellable: !remote && stage !== 'saving',
  };
}
