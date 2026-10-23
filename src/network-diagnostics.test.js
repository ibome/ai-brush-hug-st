import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {} };
const { networkDiagnosticPlan, runNetworkDiagnostics, formatNetworkDiagnostics, diagnosticURL } = await import('./network-diagnostics.js');
const key = 'pst-fixture';
const environment = (overrides = {}) => ({
  location: { href: 'https://tavern.test/extensions/private/extension-ui.html?ver=1#account', origin: 'https://tavern.test', protocol: 'https:' },
  navigator: { userAgent: 'Fixture Android Mobile', platform: 'fixture', language: 'zh-CN', onLine: true },
  isSecureContext: true, ...overrides,
});
const official = { provider: 'novelai', key, endpoint: '', error: '无法连接接口，请检查网络或跨域设置' };
const readable = (status = 200) => new Response('private response body must not be logged', {
  status, headers: { 'Content-Type': 'application/json' },
});

test('assistant relay diagnostics inspect the selected route without browser upstream fetches or generation', async () => {
  const fetches = [], probes = [];
  const report = await runNetworkDiagnostics({ provider: 'assistant', apiTransport: 'tavern',
    endpoint: 'http://text.test/private-route/v1', key: 'sk-private-fixture' }, {
    environment: environment(),
    fetcher: async (url) => { fetches.push(url); return readable(); },
    relayProbe: async (value) => {
      probes.push(value);
      return { outcome: value.key ? 'relay-ok' : 'relay-error', httpStatus: 200, modelCount: value.key ? 3 : 0,
        detail: value.key ? '已读取模型列表' : '上游未通过' };
    },
  });
  assert.equal(fetches.length, 1);
  assert.ok(fetches[0].startsWith('https://tavern.test'));
  assert.deepEqual(probes.map((value) => value.key), ['', 'sk-private-fixture']);
  assert.equal(report.scope, 'tavern-relay');
  assert.equal(report.environment.requestTransport, 'tavern-relay');
  assert.deepEqual(report.checks.slice(1).map((row) => row.outcome), ['relay-error', 'relay-ok']);
  assert.ok(report.checks.slice(1).every((row) => row.method === 'POST' && row.upstreamMethod === 'GET'));
  assert.doesNotMatch(formatNetworkDiagnostics(report), /sk-private-fixture|private-route|mixed-content|当前浏览器能直接/);
  assert.match(report.conclusions.join(' '), /服务器/);
  assert.doesNotMatch(report.conclusions.join(' '), /转发未通过/);
});

test('relay diagnostic cancellation stops later probes and does not expose raw failures', async () => {
  const controller = new AbortController();
  const report = await runNetworkDiagnostics({ provider: 'assistant', apiTransport: 'tavern',
    endpoint: 'https://text.test', key: 'sk-private-fixture' }, { signal: controller.signal,
    environment: environment(), fetcher: async () => readable(),
    relayProbe: async () => { controller.abort(); throw new Error('private upstream failure'); },
  });
  assert.equal(report.status, 'cancelled');
  assert.equal(report.checks.length, 2);
  assert.equal(report.checks[1].outcome, 'cancelled');
  assert.doesNotMatch(formatNetworkDiagnostics(report), /private upstream failure/);
});

test('all providers use only known read-only routes and keep authentication off unrecognized services', () => {
  const contexts = [
    official,
    { provider: 'novelai', key: 'sk-fixture', endpoint: 'https://dangao.iisbo.com' },
    { provider: 'novelai', key: 'STD-fixture' },
    { provider: 'novelai', key: 'sk-' + 'a'.repeat(43) },
    { provider: 'novelai', key: 'custom', endpoint: 'https://custom.test/subpath' },
    { provider: 'openai', key: 'sk-fixture', endpoint: 'https://openai.test/v1/' },
    { provider: 'comfyui', key: 'fixture', endpoint: 'https://comfy.test', auth: 'bearer' },
    { provider: 'sdwebui', key: 'password', endpoint: 'https://sd.test', auth: 'basic', username: 'fixture-user' },
  ];
  for (const context of contexts) {
    const plan = networkDiagnosticPlan(context);
    assert.ok(plan.targets.length, context.provider);
    for (const target of plan.targets) {
      assert.doesNotMatch(target.url, /\/ai\/generate-image|\/images\/generations|\/txt2img|\/img2img|\/prompt(?:$|\?)/);
      if (['sugar', 'custom'].some((name) => target.id.includes(name)) || target.id === 'sugar-public') {
        assert.deepEqual(target.headers, {});
      }
    }
  }
  assert.deepEqual(networkDiagnosticPlan(official).targets.map((target) => new URL(target.url).hostname),
    ['image.novelai.net', 'image.novelai.net', 'image.novelai.net']);
});

test('reports retain HTTP evidence and timing without reading bodies or claiming generation permission', async () => {
  const requests = [], progress = [];
  const report = await runNetworkDiagnostics(official, { environment: environment(),
    fetcher: async (url, options) => {
      requests.push({ url, options });
      return readable(options.headers.Authorization ? 200 : url.includes('subscription') ? 401 : 200);
    },
    onProgress: (value) => progress.push(value),
  });
  assert.equal(report.status, 'completed');
  assert.equal(report.scope, 'current-browser');
  assert.equal(report.checks.length, 4);
  assert.ok(report.checks.every((row) => row.outcome === 'http' && row.durationMs >= 0));
  assert.ok(report.checks.some((row) => !row.authenticated && row.httpStatus === 401));
  assert.match(report.conclusions.join(' '), /不代表|仍需/);
  assert.ok(progress.some((value) => value.current));
  for (const { url, options } of requests) {
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, url.startsWith('https://tavern.test') ? 'same-origin' : 'omit');
  }
  assert.doesNotMatch(requests[0].url, /\?|#/);
  assert.doesNotMatch(formatNetworkDiagnostics(report), /private response body/);
});

test('native diagnostics identify WebView transport without claiming the host proxy was used', async () => {
  const report = await runNetworkDiagnostics(official, { environment: environment({ __TAURI_RUNNING__: true }),
    fetcher: async () => readable() });
  assert.equal(report.environment.host, 'tauritavern');
  assert.equal(report.environment.requestTransport, 'webview-direct');
  assert.match(report.environment.proxy, /不自动使用.*Request Proxy/);
  assert.match(report.conclusions.join(' '), /WebView.*跟随酒馆/);
});

test('diagnostic logs redact keys, basic credentials, embedded URLs, paths and queries', async () => {
  const password = 'fixture-password-private', username = 'fixture-account-private';
  const encoded = btoa(`${username}:${password}`);
  const context = { provider: 'sdwebui', key: password, username, auth: 'basic',
    endpoint: `https://service.test/customer/${password}`, error: `Bearer ${password}; Basic ${encoded} https://u:p@service.test/private?token=another-secret ${username}` };
  const report = await runNetworkDiagnostics(context, { environment: environment(), fetcher: async () => readable(401) });
  const text = formatNetworkDiagnostics(report);
  for (const secret of [password, username, encoded, 'another-secret', 'u:p@', '/customer/', '/extensions/private/']) {
    assert.equal(text.includes(secret), false, secret);
  }
  assert.equal(report.credential.authMode, 'basic');
  assert.equal(report.credential.present, true);
  assert.match(report.conclusions.join(' '), /401/);
  assert.doesNotMatch(diagnosticURL('http://192.168.1.23:8188/private?token=abc'), /192\.168|private|abc/);
});

test('opaque fallback remains inconclusive and never reports status zero as HTTP success', async () => {
  const report = await runNetworkDiagnostics(official, { environment: environment(), fetcher: async (url, options) => {
    if (url.startsWith('https://tavern.test')) return readable();
    if (options.mode === 'no-cors') {
      assert.equal(options.redirect, 'follow');
      assert.equal(options.credentials, 'omit');
      assert.deepEqual(options.headers, {});
      return { type: 'opaque', status: 0, body: null };
    }
    throw new TypeError(`blocked ${key} must never appear`);
  } });
  assert.ok(report.checks.some((row) => row.outcome === 'opaque'));
  assert.ok(report.checks.filter((row) => row.outcome === 'opaque').every((row) => !('httpStatus' in row)));
  assert.match(report.conclusions.join(' '), /不能确认跨域或鉴权/);
  assert.doesNotMatch(formatNetworkDiagnostics(report), /blocked|must never appear/);
});

test('a readable public request followed by failed authorization suggests preflight without asserting a cause', async () => {
  const report = await runNetworkDiagnostics(official, { environment: environment(), fetcher: async (_url, options) => {
    if (options.headers.Authorization) throw new TypeError('Failed to fetch');
    return readable(401);
  } });
  assert.match(report.conclusions.join(' '), /普通请求能读取响应，带认证请求失败/);
  assert.match(report.conclusions.join(' '), /原因尚未确认/);
  assert.doesNotMatch(report.conclusions.join(' '), /秘钥错误|秘钥无效/);
});

test('403 remains a permission, egress or service restriction instead of a definitive invalid-key diagnosis', async () => {
  const report = await runNetworkDiagnostics(official, { environment: environment(), fetcher: async () => readable(403) });
  assert.match(report.conclusions.join(' '), /不能单凭此状态认定秘钥错误/);
});

test('timeouts are bounded and are not reported as invalid credentials', async () => {
  const report = await runNetworkDiagnostics(official, { timeout: 5, environment: environment(),
    fetcher: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Fixture timeout', 'AbortError')), { once: true });
    }),
  });
  assert.ok(report.checks.every((row) => row.outcome === 'timeout'));
  assert.match(report.conclusions.join(' '), /不能|无法/);
});

test('cancellation keeps partial evidence and makes no subsequent or fallback requests', async () => {
  const controller = new AbortController();
  let count = 0;
  const report = await runNetworkDiagnostics(official, { signal: controller.signal, environment: environment(),
    fetcher: async () => { count++; controller.abort(); return readable(); },
  });
  assert.equal(count, 1);
  assert.equal(report.status, 'cancelled');
  assert.equal(report.checks[0].outcome, 'cancelled');
});

test('mixed-content checks do not send remote HTTP traffic from HTTPS', async () => {
  const requests = [];
  const report = await runNetworkDiagnostics({ provider: 'comfyui', endpoint: 'http://192.168.1.30:8188', auth: 'none' }, {
    environment: environment(), fetcher: async (url) => { requests.push(url); return readable(); },
  });
  assert.equal(requests.length, 1);
  assert.ok(report.checks.some((row) => row.outcome === 'mixed-content'));
  assert.match(report.conclusions.join(' '), /协议冲突/);
  assert.doesNotMatch(formatNetworkDiagnostics(report), /192\.168\.1\.30/);
});

test('CSP evidence is restricted to the current targets and its listener is removed', async () => {
  let listener, removed = false;
  const report = await runNetworkDiagnostics(official, {
    environment: environment({
      addEventListener(_name, callback) { listener = callback; },
      removeEventListener(_name, callback) { removed = callback === listener; },
    }),
    fetcher: async (url) => {
      if (url.startsWith('https://tavern.test')) return readable();
      listener({ effectiveDirective: 'connect-src', blockedURI: url, originalPolicy: 'not copied' });
      throw new TypeError('CSP denied');
    },
  });
  assert.ok(report.checks.some((row) => row.outcome === 'csp'));
  assert.equal(removed, true);
  assert.doesNotMatch(formatNetworkDiagnostics(report), /originalPolicy|not copied/);
});

test('invalid header characters are detected without sending the malformed credential', async () => {
  const requests = [];
  const report = await runNetworkDiagnostics({ ...official, key: 'pst-中文fixture' }, {
    environment: environment(), fetcher: async (_url, options) => { requests.push(options); return readable(); },
  });
  assert.ok(report.checks.some((row) => row.outcome === 'invalid-header'));
  assert.equal(requests.some((options) => options.headers.Authorization), false);
  assert.equal(report.credential.containsNonLatin1, true);
  assert.doesNotMatch(formatNetworkDiagnostics(report), /中文fixture/);
});

test('mobile loopback and offline signals remain hints, and incomplete configuration stays explicit', async () => {
  const report = await runNetworkDiagnostics({ provider: 'comfyui', endpoint: 'http://127.0.0.1:8188', auth: 'none' }, {
    environment: environment({ navigator: { userAgent: 'Fixture Android Mobile', onLine: false } }), fetcher: async () => readable(),
  });
  assert.match(report.conclusions.join(' '), /手机自身/);
  assert.match(report.conclusions.join(' '), /报告设备离线/);
  const empty = await runNetworkDiagnostics({ provider: 'novelai', key: '' }, { environment: environment(), fetcher: async () => readable() });
  assert.equal(empty.targetCount, 0);
  assert.match(empty.conclusions.join(' '), /配置尚未准备好/);
});

test('a mobile local tavern is not mistaken for a local provider, and actual NAI authentication is reported', async () => {
  const report = await runNetworkDiagnostics({ ...official, auth: 'none' }, {
    environment: environment({ location: {
      href: 'http://127.0.0.1:8000/private/extension-ui.html?ver=1', origin: 'http://127.0.0.1:8000', protocol: 'http:',
    } }),
    fetcher: async () => readable(),
  });
  assert.equal(report.credential.authMode, 'bearer');
  assert.equal(report.environment.page, 'http://[本机地址]:8000/');
  assert.equal(report.checks[0].url, 'http://[本机地址]:8000/[自定义路径已隐藏]/');
  assert.doesNotMatch(report.conclusions.join(' '), /手机自身|请确认填写/);
  assert.doesNotMatch(formatNetworkDiagnostics(report), /127\.0\.0\.1|地址无效/);
});

test('reachable NAI image index with unreadable subscription paths remains a path-specific failure', async () => {
  const report = await runNetworkDiagnostics(official, { environment: environment(),
    fetcher: async (url, options) => {
      if (url.includes('/user/subscription')) {
        if (options.mode === 'no-cors') return { type: 'opaque', status: 0, body: null };
        throw new TypeError('Fixture path failure');
      }
      return readable();
    },
  });
  assert.match(report.conclusions.join(' '), /图片域名首页已响应，但订阅路径/);
  assert.ok(report.checks.some((row) => row.id === 'nai-images' && row.httpStatus === 200));
  assert.doesNotMatch(report.conclusions.join(' '), /秘钥错误|秘钥无效/);
});

test('assistant diagnostics use its actual independent endpoint, only GET models and redact credentials and prompts', async () => {
  const requests = [];
  const report = await runNetworkDiagnostics({ provider: 'assistant', endpoint: 'https://text.test/private/v1/chat/completions/',
    key: 'fixture-assistant-secret', error: '文字接口连接失败' }, {
    environment: environment(),
    fetcher: async (url, options) => {
      requests.push({ url, options });
      return readable(options.headers.Authorization ? 200 : 401);
    },
  });
  assert.equal(report.provider, 'assistant');
  assert.equal(report.service, '提示词助手 · 独立 API');
  assert.equal(report.targetCount, 2);
  const targets = requests.filter((row) => row.url.startsWith('https://text.test'));
  assert.equal(targets.length, 2);
  assert.ok(targets.every(({ url, options }) => url === 'https://text.test/private/v1/models'
    && options.method === 'GET' && !options.body));
  assert.equal(targets[0].options.headers.Authorization, undefined);
  assert.equal(targets[1].options.headers.Authorization, 'Bearer fixture-assistant-secret');
  assert.match(report.note, /当前浏览器直接连接/);
  assert.match(report.conclusions.join(' '), /不代表.*聊天补全/);
  assert.doesNotMatch(formatNetworkDiagnostics(report), /fixture-assistant-secret|private response|\/private\/|chat\/completions/);
});

test('unconfigured assistant diagnostics do not probe other configured image services', async () => {
  const requests = [];
  const report = await runNetworkDiagnostics({ provider: 'assistant', endpoint: '', key: 'fixture-assistant-secret' }, {
    environment: environment(), fetcher: async (url) => { requests.push(url); return readable(); },
  });
  assert.equal(report.targetCount, 0);
  assert.equal(requests.length, 1);
  assert.ok(requests[0].startsWith('https://tavern.test'));
  assert.match(report.conclusions.join(' '), /配置尚未准备好/);
});
