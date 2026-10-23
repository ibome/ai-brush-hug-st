const baseURL = import.meta.env?.BASE_URL || '/';

export const samples = [
  { id: 'lake', title: '晨雾湖畔', src: `${baseURL}assets/lake.jpg`, prompt: 'a quiet alpine lake, mountain chalet, morning mist, pine forest, soft natural light, detailed landscape', time: '今天 20:32', size: '1216 × 832' },
  { id: 'mountain', title: '远山来信', src: `${baseURL}assets/mountain.jpg`, prompt: 'mountain valley, golden sunlight, cinematic landscape, serene atmosphere, high detail', time: '今天 20:18', size: '1216 × 832' },
];

export const navigation = [
  { id: 'settings', title: '插件设置', icon: 'sliders-horizontal' },
  { id: 'connection', title: '接口配置', icon: 'plug' },
  { id: 'assistant', title: '提示词助手', icon: 'sparkles' },
  { id: 'comic', title: '漫画工坊', icon: 'panels-top-left' },
  { id: 'characters', title: '角色档案', icon: 'users-round' },
  { id: 'styles', title: '画师串库', icon: 'palette' },
  { id: 'tags', title: '中文标签库', icon: 'list-filter' },
  { id: 'generate', title: '生图工坊', icon: 'wand-sparkles' },
  { id: 'gallery', title: '绘图管理', icon: 'images' },
  { id: 'reader', title: '图文阅读', icon: 'book-open' },
  { id: 'components', title: '扩展组件', icon: 'plug' },
  { id: 'debug', title: '调试工具', icon: 'scan' },
  { id: 'changelog', title: '更新日志', icon: 'history' },
];

export const styles = [
  { id: 'natural', title: '自然光影', description: '柔和光线 · 细腻场景', icon: 'sun', tags: 'soft natural light, detailed landscape' },
  { id: 'illustration', title: '日系插画', description: '清晰线条 · 柔和色彩', icon: 'palette', tags: 'anime illustration, clean lineart, delicate colors' },
  { id: 'cinematic', title: '电影质感', description: '环境叙事 · 镜头层次', icon: 'image', tags: 'cinematic composition, atmospheric lighting, depth of field' },
];
