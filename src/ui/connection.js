export const NOVELAI_SERVICES = Object.freeze({
  official: Object.freeze({ id: 'official', title: 'NovelAI 官方', endpoint: 'https://image.novelai.net' }),
  cake: Object.freeze({ id: 'cake', title: '蛋糕生图', endpoint: 'https://dangao.iisbo.com' }),
  sugar: Object.freeze({ id: 'sugar', title: '砂糖绘画', endpoint: 'https://tang.iisbo.com/novelai' }),
});

export const NOVELAI_SUBSCRIPTION_URL = `${NOVELAI_SERVICES.official.endpoint}/user/subscription`;

export function normalizeEndpoint(value) {
  const url = new URL(value.trim());
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('请填写 HTTPS 接口地址；本机服务可使用 HTTP');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('接口地址不能包含账号、密码、查询参数或锚点');
  }
  return url.href.replace(/\/+$/, '').replace(/\/ai\/generate-image$/, '');
}

export function resolveNovelAIService(key, endpoint = '') {
  const token = key.trim();
  if (!token) return { kind: 'empty', message: '等待输入秘钥' };
  if (/^pst-\S+$/.test(token)) return { kind: 'resolved', ...NOVELAI_SERVICES.official };
  if (endpoint.trim()) {
    try {
      const normalized = normalizeEndpoint(endpoint);
      const known = [NOVELAI_SERVICES.cake, NOVELAI_SERVICES.sugar].find((service) => service.endpoint === normalized);
      return { kind: 'resolved', ...(known || { id: 'custom', title: '自定义第三方接口', endpoint: normalized }) };
    } catch (error) {
      return { kind: 'error', message: error.message };
    }
  }
  if (/^STD-\S+$/.test(token)) return { kind: 'resolved', ...NOVELAI_SERVICES.sugar };
  if (/^sk-[A-Za-z0-9_-]{43}$/.test(token)) return { kind: 'identify', message: '正在识别蛋糕 / 砂糖秘钥…' };
  if (token.startsWith('sk-')) return { kind: 'unknown', message: '请填入完整秘钥；其他第三方可展开填写接口地址' };
  return { kind: 'unknown', message: '暂未识别此秘钥，请展开填写第三方接口地址' };
}

async function requestProbe(url, key, { method = 'GET', signal, fetcher = fetch } = {}) {
  const response = await fetcher(url, {
    method,
    headers: { Authorization: `Bearer ${key.trim()}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
    ...(method === 'POST' ? { body: '{}' } : {}),
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    signal,
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

export async function probeService(service, key, options = {}) {
  const sugar = service.id === 'sugar';
  const url = service.id === 'official'
    ? NOVELAI_SUBSCRIPTION_URL
    : `${service.endpoint}${sugar ? '/ai/generate-image' : '/v1/models'}`;
  // Sugar explicitly treats an empty body as a non-billable authentication probe.
  const { response, body } = await requestProbe(url, key, { ...options, method: sugar ? 'POST' : 'GET' });
  const valid = sugar
    ? response.status === 400 && body?.status === 'ok' && body?.message === 'Token valid'
    : response.ok && (service.id === 'official'
      ? body !== null && typeof body === 'object' && typeof body.tier === 'number'
      : body?.object === 'list' && Array.isArray(body.data));
  return { service, valid, rejected: response.status === 401 || response.status === 403 };
}

export async function identifySkService(key, options = {}) {
  const results = await Promise.allSettled(
    [NOVELAI_SERVICES.cake, NOVELAI_SERVICES.sugar].map((service) => probeService(service, key, options)),
  );
  if (options.signal?.aborted) throw options.signal.reason;
  const matches = results.filter((result) => result.status === 'fulfilled' && result.value.valid);
  if (matches.length === 1) return { kind: 'resolved', ...matches[0].value.service };
  if (matches.length > 1) throw new Error('此秘钥在两个项目均有效，请展开填写要使用的第三方地址');
  const rejected = results.every((result) => result.status === 'fulfilled' && result.value.rejected);
  throw new Error(rejected
    ? '蛋糕与砂糖均未通过鉴权，请检查秘钥或填写其他第三方地址'
    : '自动识别未完成，请检查网络后重试，或填写第三方地址');
}
