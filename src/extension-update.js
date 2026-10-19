import { RELEASE, compareVersions } from './release.js';

export function installedExtension(moduleURL) {
  const url = new URL(moduleURL);
  const match = /\/scripts\/extensions\/third-party\/([^/]+)\//.exec(url.pathname);
  if (!match) throw new Error('无法定位安装目录，请通过酒馆扩展管理更新');
  const name = decodeURIComponent(match[1]);
  if (!name || name === '.' || name === '..' || /[/\\\0]/.test(name)) throw new Error('扩展安装目录无效');
  return { name, manifestURL: new URL(`/scripts/extensions/third-party/${encodeURIComponent(name)}/manifest.json`, url).href };
}

function officialRemote(remote) {
  return String(remote || '').replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git\/?$/, '').replace(/\/$/, '').toLowerCase() === RELEASE.url.toLowerCase();
}

export function createExtensionUpdater({ moduleURL, getHeaders, request = fetch, isBusy = () => false, nativeUpdates = false }) {
  let pending;
  return {
    update(version) {
      if (pending) return pending;
      pending = (async () => {
        if (isBusy()) throw new Error('请等待当前聊天生成任务结束后再更新');
        if (compareVersions(version, RELEASE.version) <= 0) throw new Error('当前没有可安装的新版本');
        const installed = installedExtension(moduleURL), headers = getHeaders();
        if (!headers) throw new Error('酒馆请求验证尚未就绪，请刷新后重试');
        const send = async (path, body) => {
          const response = await request(`/api/extensions/${path}`, {
            method: body ? 'POST' : 'GET', headers, credentials: 'same-origin',
            cache: 'no-store', ...(nativeUpdates && path === 'update' ? {}
              : { signal: AbortSignal.timeout(path === 'discover' ? 15000 : 120000) }),
            ...(body ? { body: JSON.stringify(body) } : {}),
          });
          if (!response.ok) throw new Error(response.status === 403
            ? '没有更新权限；全局扩展请由管理账号更新'
            : nativeUpdates ? '扩展更新失败，请检查设备网络、仓库来源或本地修改后重试，也可打开扩展管理'
              : '酒馆更新失败，请检查 Git 安装、服务器网络或本地修改后重试，也可打开扩展管理');
          return response.json();
        };
        const list = await send('discover');
        const entry = Array.isArray(list) && list.find((row) => row.name === `third-party/${installed.name}`);
        if (!entry || !['local', 'global'].includes(entry.type)) throw new Error('无法确认扩展安装位置，请打开扩展管理');
        const body = { extensionName: installed.name, global: entry.type === 'global' };
        const current = await send('version', body);
        if (!current.currentBranchName || !current.currentCommitHash) throw new Error('当前是 ZIP 安装，请下载新版前端 ZIP 后手动覆盖');
        if (!officialRemote(current.remoteUrl)) throw new Error('安装来源与发布仓库不一致，请通过扩展管理核对');
        if (current.currentBranchName !== 'main') throw new Error('当前安装不在 main 分支，请通过扩展管理选择更新分支');
        if (isBusy()) throw new Error('聊天正在生成，请结束后重试更新');
        await send('update', body);
        const response = await request(`${installed.manifestURL}?updated=${Date.now()}`, {
          cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error('代码已拉取，但版本无法读取，请稍后刷新酒馆核对');
        const manifest = await response.json();
        if (compareVersions(manifest.version, version) < 0) throw new Error('代码已拉取，但尚未达到目标版本，请打开扩展管理核对分支或稍后重试');
        return { version: manifest.version, reloadRequired: true };
      })().catch((error) => {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error('更新请求超时，服务器可能仍在处理，请先在扩展管理中核对结果');
        throw error;
      }).finally(() => { pending = null; });
      return pending;
    },
  };
}
