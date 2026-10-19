import { randomUUID, sha256Hex } from './crypto-compat.js';
import { RELEASE } from './release.js';
import { diagnosticURL } from './network-diagnostics.js';
import { hostEnvironment } from './host-compat.js';

const size = (value) => Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
const abortError = () => new DOMException('检测已取消', 'AbortError');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function diagnosticTimeout(operation, signal, timeout = 6000) {
  if (signal?.aborted) throw abortError();
  let timer, cancel;
  const stop = new Promise((_, reject) => {
    cancel = () => reject(abortError());
    signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => reject(new DOMException('检测超时', 'TimeoutError')), timeout);
  });
  try { return await Promise.race([Promise.resolve().then(operation), stop]); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}

export function probeSettingsCache(storage, id) {
  if (!storage) throw new DOMException('存储不可用', 'SecurityError');
  const key = `linghuashi-debug-probe:${id}`, value = 'linghuashi-storage-probe:'.padEnd(1024, '0');
  if (storage.getItem(key) !== null) throw new Error('ProbeConflict');
  let wrote = false, verified = false, cleaned = false;
  try {
    storage.setItem(key, value); wrote = true;
    verified = storage.getItem(key) === value;
    if (!verified) throw new Error('ProbeMismatch');
  } finally {
    if (wrote && storage.getItem(key) === value) { storage.removeItem(key); cleaned = storage.getItem(key) === null; }
  }
  return { bytes: 1024, verified, cleaned };
}

async function deleteProbeDatabase(factory, name) {
  return diagnosticTimeout(() => new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(name);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve(false);
  }), null, 1000).catch(() => false);
}

export async function probeImageDatabase(factory, id, signal, timeout = 6000) {
  if (!factory) throw new DOMException('数据库不可用', 'SecurityError');
  const name = `linghuashi-debug-probe-${id}`;
  let db, owned = false, abandoned = false, cleaned = false;
  try {
    db = await diagnosticTimeout(() => new Promise((resolve, reject) => {
      const request = factory.open(name, 1);
      request.onupgradeneeded = (event) => {
        if (event.oldVersion !== 0 || abandoned || signal?.aborted) { request.transaction.abort(); return; }
        owned = true; request.result.createObjectStore('probe');
      };
      request.onsuccess = () => {
        if (abandoned || signal?.aborted) {
          request.result.close();
          if (owned) void deleteProbeDatabase(factory, name);
          reject(abortError()); return;
        }
        if (!owned) { request.result.close(); reject(new Error('ProbeConflict')); return; }
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new DOMException('数据库被占用', 'InvalidStateError'));
    }), signal, timeout);
    await diagnosticTimeout(() => new Promise((resolve, reject) => {
      const tx = db.transaction('probe', 'readwrite'), store = tx.objectStore('probe');
      let value;
      const cancel = () => { try { tx.abort(); } catch {} };
      signal?.addEventListener('abort', cancel, { once: true });
      store.put(new Blob([new Uint8Array(1024).fill(37)], { type: 'application/octet-stream' }), 'test');
      const read = store.get('test');
      read.onsuccess = () => { value = read.result; };
      tx.oncomplete = () => { signal?.removeEventListener('abort', cancel); resolve(value); };
      tx.onabort = () => { signal?.removeEventListener('abort', cancel); reject(tx.error || abortError()); };
      tx.onerror = () => {};
    }), signal, timeout).then(async (value) => {
      if (!(value instanceof Blob) || value.size !== 1024 || !(new Uint8Array(await value.arrayBuffer())).every((byte) => byte === 37)) {
        throw new Error('ProbeMismatch');
      }
    });
  } finally {
    abandoned = true;
    db?.close();
    if (owned) cleaned = await deleteProbeDatabase(factory, name);
  }
  return { bytes: 1024, verified: true, cleaned };
}

export async function countDiagnosticDatabase(factory, name, stores, signal, timeout = 6000) {
  if (!factory) throw new DOMException('数据库不可用', 'SecurityError');
  let db, missing = false, abandoned = false;
  try {
    db = await diagnosticTimeout(() => new Promise((resolve, reject) => {
      const request = factory.open(name);
      // Abort an accidental creation: diagnostics must never initialize a user's database.
      request.onupgradeneeded = () => { missing = true; request.transaction.abort(); };
      request.onsuccess = () => {
        if (abandoned) { request.result.close(); return; }
        resolve(request.result);
      };
      request.onerror = () => missing ? resolve(null) : reject(request.error);
      request.onblocked = () => reject(new DOMException('数据库被占用', 'InvalidStateError'));
    }), signal, timeout);
    if (!db) return { exists: false, counts: {} };
    const existing = stores.filter((store) => db.objectStoreNames.contains(store));
    if (!existing.length) return { exists: true, counts: {}, schemaMismatch: true };
    const counts = await diagnosticTimeout(() => new Promise((resolve, reject) => {
      const tx = db.transaction(existing, 'readonly'), result = {};
      for (const store of existing) {
        const request = tx.objectStore(store).count();
        request.onsuccess = () => { result[store] = request.result; };
      }
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error || abortError()); tx.onerror = () => {};
    }), signal, timeout);
    return { exists: true, counts, schemaMismatch: existing.length !== stores.length };
  } finally { abandoned = true; db?.close(); }
}

function probeFailure(error) {
  const name = ['QuotaExceededError', 'SecurityError', 'InvalidStateError', 'NotFoundError', 'UnknownError',
    'AbortError', 'TimeoutError', 'TypeError', 'TransactionInactiveError'].includes(error?.name) ? error.name : 'Error';
  const status = Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? error.status : 0;
  const code = name === 'QuotaExceededError' ? 'BROWSER_QUOTA' : name === 'SecurityError' ? 'STORAGE_BLOCKED'
    : name === 'TimeoutError' ? 'CHECK_TIMEOUT' : name === 'AbortError' ? 'CANCELLED'
      : status === 403 || status === 401 ? 'SERVER_STORAGE_PERMISSION' : status ? 'SERVER_STORAGE_HTTP' : 'CHECK_FAILED';
  const detail = ({
    BROWSER_QUOTA: '浏览器报告存储配额不足，请先备份后整理；不能据此判断服务器磁盘空间。',
    STORAGE_BLOCKED: '浏览器拒绝存储访问，请核对站点权限、隐私模式和浏览器限制。',
    CHECK_TIMEOUT: '此项检查超时，可能存在数据库占用、设备繁忙或服务无响应。',
    CANCELLED: '检查已取消。',
    SERVER_STORAGE_PERMISSION: '酒馆存储访问被拒绝，请核对登录状态和账号权限。',
    SERVER_STORAGE_HTTP: `酒馆存储返回 HTTP ${status}，请由管理员结合服务器日志检查。`,
    CHECK_FAILED: '此项检查失败，日志保留错误类型；不能仅据此认定磁盘或配额不足。',
  })[code];
  return { outcome: code === 'CANCELLED' ? 'cancelled' : 'error', code, errorName: name, httpStatus: status, detail };
}

export function storageDiagnosticConclusions(report) {
  const rows = report.checks || [], findings = [], runtime = report.runtime || {};
  const quota = rows.find((row) => row.id === 'quota');
  if (rows.some((row) => row.code === 'BROWSER_QUOTA')) {
    findings.push('浏览器明确报告配额不足。先导出备份，再整理此浏览器图片；酒馆存图也可能使用浏览器保存任务响应。');
  } else if (Number.isFinite(quota?.metrics?.remaining) && quota.metrics.remaining < 20 * 1024 * 1024) {
    findings.push('此站点的浏览器估计剩余额度较少，较大的图片或任务响应仍可能写入失败；估计值不是磁盘空闲容量。');
  }
  if (rows.some((row) => row.id === 'settings-cache' && row.outcome === 'error')
    && rows.some((row) => row.id === 'image-write' && row.outcome === 'pass')) {
    findings.push('设置缓存与图片数据库的检查结果不同，请分别处理；设置缓存受限不等于图片数据库已满。');
  }
  if (report.configCacheAvailable === false) findings.push('当前页面曾发生设置缓存写入失败。小型试写通过也不代表完整设置能够保存；请核对酒馆账号同步状态并导出备份。');
  if (rows.some((row) => row.code === 'UI_DELAY')) findings.push('本次采样观察到较长的页面调度延迟。可先改为顺序生图、减少同时生成张数或图片尺寸，再比较是否改善。');
  if (runtime.running > 1 || runtime.concurrency > 1 && runtime.generationMode === 'parallel') {
    findings.push('当前启用了并行生成。低内存设备可先使用顺序队列、并发 1、每次 1 张，减少图片解码及保存的同时开销。');
  }
  if (report.storageLocation === 'server') findings.push(report.environment?.host === 'tauritavern'
    ? 'TauriTavern 的酒馆存图位于当前设备数据目录。WebView 容量估计不等于设备剩余磁盘；本次仅读取图片目录。'
    : '浏览器容量估计不代表酒馆服务器磁盘。此工具只读检查服务器目录，服务器剩余磁盘和上传限制需管理员查看。');
  if (rows.some((row) => row.id === 'image-write' && row.outcome === 'pass')) findings.push('1 KB 图片数据试写通过，只能证明小型读写可用，不能保证大图、整批图片或后续请求一定成功。');
  if (!findings.length) findings.push('目前未检出明确的存储故障；请在问题出现后复制日志，结合最近失败阶段继续排查。');
  return findings;
}

export async function runStorageDiagnostics(context, { environment = globalThis, signal, timeout = 6000, onProgress = () => {} } = {}) {
  const navigator = environment.navigator || {}, location = environment.location || {};
  const runtime = context.runtime || {};
  const report = {
    type: 'linghuashi-storage-diagnostics', formatVersion: 1, version: RELEASE.version, build: RELEASE.build,
    createdAt: new Date().toISOString(), scope: 'current-browser', status: 'running',
    storageLocation: context.storageLocation === 'server' ? 'server' : 'browser',
    environment: { page: diagnosticURL(location.origin || location.href || ''), protocol: location.protocol || '',
      host: hostEnvironment(environment).kind,
      secureContext: Boolean(environment.isSecureContext), online: navigator.onLine ?? null,
      visibility: environment.document?.visibilityState || 'unknown',
      userAgent: String(navigator.userAgent || '').slice(0, 400) },
    runtime: { running: size(runtime.running) || 0, queued: size(runtime.queued) || 0,
      generationMode: runtime.generationMode === 'parallel' ? 'parallel' : 'queue', concurrency: size(runtime.concurrency) || 1,
      width: size(runtime.width), height: size(runtime.height), samples: size(runtime.samples) },
    configCacheAvailable: context.configCacheAvailable !== false,
    checks: [], conclusions: [],
    limits: '仅测试约 1 KB 的临时浏览器缓存及图片数据，并清理本次临时数据；现有数据库只读取数量。酒馆存储仅读目录，不写入或删除用户图片。日志不含秘钥、提示词、聊天、账号或文件名，不自动上传。容量为同站点的浏览器估计，不能反映服务器磁盘。',
  };
  const progress = () => onProgress({ ...report, checks: [...report.checks], conclusions: [...report.conclusions] });
  async function check(id, label, operation) {
    if (signal?.aborted) return;
    report.current = label; progress();
    const started = performance.now();
    let result;
    try { result = await diagnosticTimeout(operation, signal, timeout); }
    catch (error) { result = probeFailure(error); }
    report.checks.push({ id, label, ...result, durationMs: Math.round(performance.now() - started) });
    progress();
  }
  await check('crypto', '浏览器 UUID 与图片校验', async () => {
    const id = randomUUID(environment.crypto), hash = await sha256Hex(new Uint8Array([97, 98, 99]), environment.crypto);
    if (!/^[a-f0-9-]{36}$/i.test(id) || hash !== 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') throw new Error('CryptoMismatch');
    return { outcome: 'pass', code: 'CRYPTO_READY', detail: `UUID 和 SHA-256 可用${environment.isSecureContext ? '' : '，当前使用 HTTP 兼容处理'}。`,
      metrics: { nativeUUID: typeof environment.crypto?.randomUUID === 'function', nativeDigest: Boolean(environment.crypto?.subtle) } };
  });
  await check('settings-cache', '设置缓存读写', async () => {
    const result = probeSettingsCache(environment.localStorage, randomUUID(environment.crypto));
    return { outcome: result.cleaned ? 'pass' : 'warning', code: result.cleaned ? 'CACHE_READY' : 'PROBE_CLEANUP',
      detail: result.cleaned ? '临时设置缓存写入、读取及清理通过。' : '读写通过，但临时数据清理未确认。', metrics: result };
  });
  await check('image-write', '图片数据库读写', async () => {
    const result = await probeImageDatabase(environment.indexedDB, randomUUID(environment.crypto), signal, timeout);
    return { outcome: result.cleaned ? 'pass' : 'warning', code: result.cleaned ? 'DATABASE_READY' : 'PROBE_CLEANUP',
      detail: result.cleaned ? '独立临时数据库的 1 KB Blob 写入、读取及清理通过。' : '小型读写通过，但临时数据库清理未确认。', metrics: result };
  });
  await check('quota', '浏览器站点容量', async () => {
    if (typeof navigator.storage?.estimate !== 'function') return { outcome: 'unsupported', code: 'QUOTA_UNKNOWN', detail: '此环境未提供容量估计，不能据此判断空间不足。' };
    const estimate = await navigator.storage.estimate(), usage = size(estimate.usage), quota = size(estimate.quota);
    const remaining = usage !== null && quota !== null ? Math.max(0, quota - usage) : null;
    const persisted = typeof navigator.storage.persisted === 'function' ? await navigator.storage.persisted().catch(() => null) : null;
    return { outcome: remaining !== null && remaining < 20 * 1024 * 1024 ? 'warning' : 'pass', code: 'QUOTA_ESTIMATE',
      detail: '容量是同一站点全部浏览器存储的估计值；不等于插件独占配额，也不代表服务器磁盘。未申请更改存储权限。',
      metrics: { usage, quota, remaining, persisted } };
  });
  for (const database of context.databases || []) {
    if (!['drawings', 'tasks', 'references'].includes(database.id)) continue;
    await check(`database-${database.id}`, ({ drawings: '当前账号浏览器图库', tasks: '当前账号任务缓存', references: '当前账号参考素材库' })[database.id], async () => {
      const result = await countDiagnosticDatabase(environment.indexedDB, database.name, database.stores, signal, timeout);
      const count = result.counts[database.stores[0]];
      return { outcome: result.schemaMismatch || database.id === 'drawings' && count >= 500 ? 'warning' : 'pass', code: result.schemaMismatch ? 'DATABASE_SCHEMA' : result.exists ? 'DATABASE_READABLE' : 'DATABASE_UNUSED',
        detail: !result.exists ? '此账号尚未创建该数据库，未新建或修改用户数据库。'
          : database.id === 'drawings' && count >= 500 ? '浏览器图库已达到 500 张上限，请先备份整理，或切换酒馆存图。'
            : database.id === 'tasks' ? '只读取存储项数量，包含任务索引及响应块，不读取任务正文。' : '只读取记录数量，不加载图片或素材内容。',
        metrics: { exists: result.exists, counts: result.counts, ...(database.id === 'drawings' ? { maxRecords: 500 } : {}) } };
    });
  }
  if (context.serverStatus) await check('server-storage', '酒馆账号存储访问', async () => {
    const result = await context.serverStatus();
    return { outcome: result.unmatched || ['denied', 'error'].includes(result.enhanced) ? 'warning' : 'pass', code: 'SERVER_READABLE',
      detail: '目录读取已响应，未上传测试文件；目录可读不代表大图上传、磁盘空间或组件写权限正常。',
      metrics: { originals: size(result.originals), thumbnails: size(result.thumbnails), unmatched: size(result.unmatched),
        maxRecords: size(result.maxRecords), diskFree: null,
        enhanced: ['installed', 'missing', 'denied', 'error', 'unsupported'].includes(result.enhanced) ? result.enhanced : 'unknown',
        componentVersion: /^\d+\.\d+\.\d+$/.test(result.componentVersion) ? result.componentVersion : '',
        taskStorage: result.taskStorage === 'server' ? 'server' : 'browser', componentHttpStatus: size(result.componentHttpStatus) } };
  });
  await check('responsiveness', '页面响应采样', async () => {
    if (environment.document?.visibilityState !== 'visible') return { outcome: 'unsupported', code: 'PAGE_BACKGROUND', detail: '页面不在前台，跳过响应采样，避免将后台限速当成卡顿。' };
    const delays = [];
    for (let index = 0; index < 5; index++) {
      if (signal?.aborted) throw abortError();
      const start = performance.now(); await wait(40); delays.push(Math.max(0, performance.now() - start - 40));
    }
    if (environment.document?.visibilityState !== 'visible') return { outcome: 'unsupported', code: 'PAGE_BACKGROUND', detail: '采样期间页面转入后台，本项不作卡顿结论。' };
    const maxDelayMs = Math.round(Math.max(...delays));
    return { outcome: maxDelayMs > 120 ? 'warning' : 'pass', code: maxDelayMs > 120 ? 'UI_DELAY' : 'UI_SAMPLE',
      detail: '仅反映短时间的页面调度延迟，不是显卡、网络或整次生图的性能结论。', metrics: { maxDelayMs, samples: 5 } };
  });
  report.status = signal?.aborted ? 'cancelled' : 'completed';
  delete report.current; report.conclusions = storageDiagnosticConclusions(report); progress();
  return report;
}

export function formatDebugReport({ storage = null, network = null, failures = [], createdAt } = {}) {
  return '灵画师调试日志\n' + JSON.stringify({
    type: 'linghuashi-debug-report', formatVersion: 1, version: RELEASE.version, build: RELEASE.build,
    createdAt: createdAt || storage?.createdAt || network?.createdAt || failures.at(-1)?.createdAt || new Date().toISOString(),
    storage, network, recentGenerationFailures: failures.slice(-20),
    limits: '日志仅在当前设备生成，不自动上传；最近失败记录仅保留在当前插件页面内存中。',
  }, null, 2);
}
