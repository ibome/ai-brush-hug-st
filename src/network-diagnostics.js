import { RELEASE } from './release.js';
import { NOVELAI_SERVICES, NOVELAI_SUBSCRIPTION_URL, normalizeEndpoint, resolveNovelAIService } from './ui/connection.js';
import { openAIURLs } from './ui/openai.js';
import { normalizeComfyEndpoint } from './ui/comfyui.js';
import { sdwebuiBase, sdwebuiHeaders } from './sdwebui.js';
import { assistantURLs } from './prompt-assistant.js';
import { hostEnvironment } from './host-compat.js';

const PROVIDERS = { novelai: 'NovelAI', openai: 'OpenAI 兼容', comfyui: 'ComfyUI', sdwebui: 'SDWebUI', assistant: '提示词助手 · 独立 API' };
const ROUTES = ['/user/subscription', '/v1/models', '/models', '/system_stats', '/sdapi/v1/samplers'];
const localHost = (host) => ['localhost', '127.0.0.1', '[::1]'].includes(host);

export function diagnosticHostKind(host) {
  if (localHost(host)) return 'loopback';
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[(fc|fd|fe80))/i.test(host)) return 'private-network';
  return 'public';
}

export function diagnosticURL(value) {
  try {
    const url = new URL(value);
    const ip = /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) || url.hostname.startsWith('[');
    const host = ip ? `[${diagnosticHostKind(url.hostname) === 'loopback' ? '本机地址' : 'IP已隐藏'}]` : url.hostname;
    const route = ROUTES.find((path) => url.pathname.endsWith(path)) || '';
    const prefix = url.pathname.slice(0, url.pathname.length - route.length);
    return `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}${prefix && prefix !== '/' ? '/[自定义路径已隐藏]' : ''}${route || '/'}`;
  } catch { return '[地址无效或已隐藏]'; }
}

export function diagnosticRedactor(secrets = []) {
  const values = [...new Set(secrets.filter((value) => typeof value === 'string' && value))].sort((a, b) => b.length - a.length);
  return (value) => {
    let text = String(value ?? '');
    for (const secret of values) text = text.split(secret).join('[已隐藏]');
    return text.replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/gi, '[认证已隐藏]')
      .replace(/\b(?:pst-|sk-|STD-)[A-Za-z0-9_-]+/g, '[秘钥已隐藏]')
      .replace(/https?:\/\/[^\s<>"'`]+/gi, (url) => diagnosticURL(url))
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, 500);
  };
}

export function networkDiagnosticPlan(context) {
  const key = String(context.key || '').trim(), headers = key ? { Authorization: `Bearer ${key}` } : {};
  const targets = [];
  const add = (id, label, url, authHeaders = {}) => targets.push({ id, label, url, headers: authHeaders });
  let service = PROVIDERS[context.provider] || '未知接口', note = '';
  try {
    if (context.provider === 'novelai') {
      const route = resolveNovelAIService(key, context.endpoint);
      if (route.kind === 'resolved') {
        service = route.title;
        if (route.id === 'official') {
          add('nai-account-public', '官方订阅接口 · 普通请求', NOVELAI_SUBSCRIPTION_URL);
          add('nai-account-auth', '官方订阅接口 · 带秘钥请求', NOVELAI_SUBSCRIPTION_URL, headers);
          add('nai-images', '官方图片域名 · 只读访问', `${route.endpoint}/`);
          note = '订阅与图片请求使用官方图片服务域名；仅检查只读访问，不验证实际生图权限，也不提交生图。';
        } else if (route.id === 'cake') {
          add('cake-public', '蛋糕模型接口 · 普通请求', `${route.endpoint}/v1/models`);
          add('cake-auth', '蛋糕模型接口 · 带秘钥请求', `${route.endpoint}/v1/models`, headers);
        } else {
          add('nai-custom', `${route.title} · 只读访问`, `${route.endpoint}/`);
          note = '当前服务没有已知的只读鉴权检查；未发送秘钥或提交生图。';
        }
      } else if (route.kind === 'identify') {
        add('cake-public', '蛋糕模型接口 · 只读访问', `${NOVELAI_SERVICES.cake.endpoint}/v1/models`);
        add('sugar-public', '砂糖服务 · 只读访问', `${NOVELAI_SERVICES.sugar.endpoint}/`);
        note = '秘钥归属尚未确定；只检查候选服务网络，不发送秘钥或提交生图。';
      } else if (context.endpoint?.trim()) {
        add('nai-custom', '自定义服务 · 只读访问', `${normalizeEndpoint(context.endpoint)}/`);
        note = route.message;
      } else throw new Error(route.message || '请先填写接口秘钥或地址');
    } else if (context.provider === 'assistant') {
      const urls = assistantURLs(context.endpoint || '');
      add('assistant-public', '助手模型列表 · 普通请求', urls.models);
      add('assistant-auth', '助手模型列表 · 当前认证', urls.models, headers);
      note = '独立 API 由当前浏览器直接连接，跟随酒馆由酒馆服务器连接，网络与跨域条件可能不同。仅检查助手模型列表，不调用文字或图片生成；模型列表通过不代表聊天补全可用。';
    } else if (context.provider === 'openai') {
      const urls = openAIURLs(context.endpoint, context.path);
      add('openai-public', '模型列表 · 普通请求', urls.models);
      add('openai-auth', '模型列表 · 当前认证', urls.models, headers);
      if (new URL(urls.generation).origin !== new URL(urls.models).origin) {
        add('openai-images', '图片接口域名 · 只读访问', new URL('/', urls.generation).href);
      }
      note = '仅检查模型列表和域名访问；不调用图片或文字生成。';
    } else if (context.provider === 'comfyui') {
      const base = normalizeComfyEndpoint(context.endpoint);
      add('comfy-public', 'ComfyUI 系统信息 · 普通请求', `${base}/system_stats`);
      add('comfy-auth', 'ComfyUI 系统信息 · 当前认证', `${base}/system_stats`, context.auth === 'bearer' ? headers : {});
    } else if (context.provider === 'sdwebui') {
      const base = sdwebuiBase(context.endpoint);
      add('sd-public', 'SDWebUI 采样器列表 · 普通请求', `${base}/sdapi/v1/samplers`);
      add('sd-auth', 'SDWebUI 采样器列表 · 当前认证', `${base}/sdapi/v1/samplers`, sdwebuiHeaders(context, key));
    } else throw new Error('暂不支持此接口类型');
  } catch (error) { note = error.message; }
  const unique = targets.filter((target, index) => targets.findIndex((item) =>
    item.url === target.url && item.headers.Authorization === target.headers.Authorization) === index);
  return { service, targets: unique, note };
}

function environmentInfo(environment, redact) {
  const navigator = environment.navigator || {}, page = environment.location || {};
  const connection = navigator.connection;
  const host = hostEnvironment(environment);
  return {
    page: redact(page.origin || page.href), protocol: page.protocol || '', secureContext: Boolean(environment.isSecureContext),
    online: typeof navigator.onLine === 'boolean' ? navigator.onLine : null,
    userAgent: redact(navigator.userAgent || ''), platform: redact(navigator.platform || ''),
    language: redact(navigator.language || ''),
    ...(connection ? { connection: { effectiveType: redact(connection.effectiveType || ''), saveData: Boolean(connection.saveData) } } : {}),
    host: host.kind, requestTransport: host.network,
    proxy: host.kind === 'tauritavern'
      ? '外部生图与独立 API 由 WebView 直连，不自动使用 TauriTavern 的 Request Proxy；无法自动判断系统代理或分流状态'
      : '浏览器不提供代理状态，无法自动判断是否开启代理或命中分流规则',
  };
}

function httpHint(status, authenticated) {
  if (status === 401) return authenticated ? '鉴权未通过，请核对秘钥及认证方式' : '未携带秘钥，401 可作为接口已响应的证据';
  if (status === 403) return '服务拒绝访问；权限、出口 IP、区域或风控均需进一步核对';
  if (status === 404 || status === 405) return '已收到 HTTP 响应，但此只读路径或方法不可用；不等于生图接口不可用';
  if (status === 429) return '服务限制请求频率或额度，请稍后重试';
  if (status >= 500) return '服务端或上游异常，请结合服务日志核对';
  return status >= 200 && status < 300 ? 'HTTP 响应可读取；不代表生图权限已验证' : '已收到可读取的 HTTP 响应';
}

async function networkProbe(target, { fetcher, signal, timeout, environment, redact, opaque = false, policyEvents }) {
  const started = performance.now(), controller = new AbortController();
  const row = { id: target.id + (opaque ? '-opaque' : ''), label: target.label + (opaque ? ' · 不透明响应辅助检查' : ''),
    url: redact(target.url), hostKind: diagnosticHostKind(new URL(target.url).hostname),
    method: 'GET', mode: opaque ? 'no-cors' : 'cors', authenticated: !opaque && Boolean(target.headers.Authorization) };
  const finish = (outcome, detail, extra = {}) => ({ ...row, outcome, detail, ...extra, durationMs: Math.round(performance.now() - started) });
  const url = new URL(target.url), page = environment.location || {};
  if (page.protocol === 'https:' && url.protocol === 'http:' && !localHost(url.hostname)) {
    return finish('mixed-content', 'HTTPS 页面连接远程 HTTP 服务可能被浏览器拦截，请配置 HTTPS 服务入口');
  }
  if (!opaque && target.headers.Authorization && /[^\u0020-\u00ff]|\r|\n/.test(target.headers.Authorization)) {
    return finish('invalid-header', '认证内容包含无法放入请求头的字符，请检查粘贴的秘钥或密码');
  }
  let timedOut = false;
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  try {
    if (signal?.aborted) controller.abort();
    const response = await fetcher(target.url, {
      method: 'GET', mode: opaque ? 'no-cors' : 'cors', headers: opaque ? {} : target.headers,
      credentials: target.sameOrigin ? 'same-origin' : 'omit', referrerPolicy: 'no-referrer',
      // Fetch rejects no-cors requests unless redirects follow; fallback requests carry no authentication.
      redirect: opaque ? 'follow' : 'error',
      cache: 'no-store', signal: controller.signal,
    });
    // The report deliberately excludes response bodies, account data and model names.
    void response.body?.cancel().catch(() => {});
    if (signal?.aborted) return finish('cancelled', '检测已取消');
    if (response.type === 'opaque') {
      return finish('opaque', '收到不透明响应，可能包含重定向；仅作辅助可达信号，HTTP 状态、跨域与鉴权均未验证', { responseType: 'opaque' });
    }
    return finish('http', httpHint(response.status, row.authenticated), {
      httpStatus: response.status, responseType: redact(response.type || ''),
      contentType: redact((response.headers.get('content-type') || '').split(';')[0]),
    });
  } catch (error) {
    if (signal?.aborted) return finish('cancelled', '检测已取消');
    if (timedOut) return finish('timeout', '等待响应超时；不能仅据此区分代理、DNS、TLS、跨域或服务异常');
    if (policyEvents.some((entry) => entry.origin === url.origin)) {
      return finish('csp', '浏览器报告 connect-src 安全策略阻止此域名', { errorName: 'SecurityPolicyViolation' });
    }
    const name = ['TypeError', 'SecurityError', 'NetworkError', 'AbortError', 'TimeoutError'].includes(error?.name) ? error.name : 'Error';
    return finish('network-error', '浏览器未提供可读取的 HTTP 响应；DNS、TLS、代理、跨域、重定向及拦截均有可能', { errorName: name });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

export function diagnosticConclusions(report) {
  const checks = report.checks, findings = [];
  if (!report.targetCount) findings.push('当前接口配置尚未准备好，未向外部接口发送检测请求，请先核对秘钥或地址。');
  if (report.environment.online === false) findings.push('浏览器报告设备离线，请先核对当前连接；此状态不是完整联网检测。');
  if (checks.some((row) => row.outcome === 'mixed-content')) findings.push('存在 HTTPS 页面访问远程 HTTP 的协议冲突，应先配置 HTTPS 服务地址。');
  if (checks.some((row) => row.outcome === 'csp')) findings.push('已捕获 connect-src 策略拦截，请由酒馆管理员核对页面安全策略。');
  if (checks.some((row) => row.outcome === 'invalid-header')) findings.push('认证内容存在无法放入 HTTP 请求头的字符，应先重新核对输入内容。');
  if (checks.some((row) => row.authenticated && row.httpStatus === 401)) findings.push('带认证请求返回 401，优先核对秘钥、密码及认证方式。');
  if (checks.some((row) => row.httpStatus === 403)) findings.push('接口返回 403，不能单凭此状态认定秘钥错误；需核对权限、出口 IP、区域与风控。');
  const authFailed = checks.filter((row) => row.authenticated && ['network-error', 'timeout'].includes(row.outcome));
  if (authFailed.some((row) => checks.some((other) => !other.authenticated && other.url === row.url && other.outcome === 'http'))) {
    findings.push('普通请求能读取响应，带认证请求失败；应重点核对跨域预检、Authorization 请求头及相关拦截，原因尚未确认。');
  }
  if (checks.some((row) => row.outcome === 'opaque')) {
    findings.push('部分域名只返回不透明响应，不能确认跨域或鉴权通过；请结合浏览器控制台及代理分流记录定位。');
  }
  if (checks.some((row) => ['network-error', 'timeout'].includes(row.outcome))) {
    findings.push('至少一项未取得可读取响应。手机能打开其他外网不代表当前 API 域名已走代理；浏览器无法直接判定 DNS、TLS 或跨域的具体原因。');
  }
  if (report.provider === 'novelai' && checks.some((row) => row.id === 'nai-images' && row.outcome === 'http')
    && checks.some((row) => ['nai-account-public', 'nai-account-auth'].includes(row.id)
      && ['network-error', 'timeout', 'csp'].includes(row.outcome))) {
    findings.push('图片域名首页已响应，但订阅路径未取得可读取响应；请核对该路径的代理、跨域或访问限制，首页可达不等于订阅鉴权通过。');
  }
  if (report.provider === 'assistant') {
    findings.push('本次检测的是提示词助手独立 API。模型列表可读不代表所选文字模型支持聊天补全；跟随酒馆成功也不代表当前浏览器能直接访问同一接口。');
  }
  if (report.environment.host === 'tauritavern') {
    findings.push('当前为 TauriTavern：生图与独立 API 使用 WebView 网络；跟随酒馆使用宿主文字接口。Request Proxy 配置不会自动应用到本次直连检测，请分别核对设备代理、跨域与接口地址。');
  }
  if (/Android|iPhone|iPad|Mobile/i.test(report.environment.userAgent)
    && checks.some((row) => row.id !== 'tavern-page' && row.hostKind === 'loopback')) {
    findings.push('手机访问 localhost 或 127.0.0.1 指向手机自身，请确认填写的是实际服务地址。');
  }
  if (!findings.length) findings.push(checks.some((row) => row.outcome === 'http')
    ? '本次只读检查取得 HTTP 响应；仍需结合原连接错误核对返回格式、模型与生图权限。'
    : '没有足够的网络结果，请核对接口配置或重新检测。');
  return findings;
}

export async function runNetworkDiagnostics(context, { fetcher = fetch, signal, timeout = 6000,
  environment = globalThis, onProgress = () => {} } = {}) {
  const plan = networkDiagnosticPlan(context);
  const secrets = [context.key, context.username, ...plan.targets.map((target) => target.headers.Authorization),
    ...plan.targets.map((target) => target.headers.Authorization?.split(' ')[1])];
  const redact = diagnosticRedactor(secrets);
  const authorization = plan.targets.find((target) => target.headers.Authorization)?.headers.Authorization;
  const report = {
    type: 'linghuashi-network-diagnostics', formatVersion: 1, version: RELEASE.version, build: RELEASE.build,
    createdAt: new Date().toISOString(), scope: 'current-browser', provider: context.provider, service: redact(plan.service),
    targetCount: plan.targets.length,
    environment: environmentInfo(environment, redact),
    credential: { present: Boolean(context.key?.trim()), format: /^(pst-|sk-|STD-)/.exec(context.key?.trim() || '')?.[1] || '其他或未填写',
      authMode: authorization?.startsWith('Basic ') ? 'basic' : authorization?.startsWith('Bearer ') ? 'bearer' : 'none',
      containsWhitespace: /\s/.test(context.key?.trim() || ''), containsNonLatin1: /[^\u0000-\u00ff]/.test(context.key || '') },
    previousError: redact(context.error || ''), note: redact(plan.note), status: 'running', checks: [], conclusions: [],
    limits: '仅在当前浏览器执行 GET 只读检查，不提交生图或文字生成；不记录秘钥、认证头、响应正文、聊天或完整地址路径；日志不会自动发送。',
  };
  const policyEvents = [];
  const onPolicy = (event) => {
    if (event.effectiveDirective !== 'connect-src') return;
    try {
      const origin = new URL(event.blockedURI).origin;
      if (plan.targets.some((target) => new URL(target.url).origin === origin)) policyEvents.push({ origin });
    } catch { /* Non-URL policy violations are unrelated to these network targets. */ }
  };
  environment.addEventListener?.('securitypolicyviolation', onPolicy);
  const pageURL = environment.location?.href;
  const targets = [...plan.targets];
  if (pageURL && /^https?:/.test(pageURL)) {
    const page = new URL(pageURL);
    page.search = ''; page.hash = ''; page.username = ''; page.password = '';
    targets.unshift({ id: 'tavern-page', label: '当前酒馆页面 · 同源访问', url: page.href, headers: {}, sameOrigin: true });
  }
  const publish = (current = '') => onProgress(structuredClone({ ...report, current }));
  try {
    publish();
    for (const target of targets) {
      if (signal?.aborted) break;
      publish(target.label);
      const options = { fetcher, signal, timeout, environment, redact, policyEvents };
      const row = await networkProbe(target, options);
      report.checks.push(row); publish();
      const crossOrigin = new URL(target.url).origin !== environment.location?.origin;
      if (!signal?.aborted && crossOrigin && !target.sameOrigin && !row.authenticated
        && ['network-error', 'timeout'].includes(row.outcome)) {
        publish(`${target.label} · 辅助检查`);
        report.checks.push(await networkProbe(target, { ...options, opaque: true, timeout: Math.min(timeout, 4000) }));
        publish();
      }
    }
    report.status = signal?.aborted ? 'cancelled' : 'completed';
    report.conclusions = diagnosticConclusions(report);
    publish();
    return report;
  } finally { environment.removeEventListener?.('securitypolicyviolation', onPolicy); }
}

export function formatNetworkDiagnostics(report) {
  return `灵画师设备网络诊断\n${JSON.stringify(report, null, 2)}`;
}
