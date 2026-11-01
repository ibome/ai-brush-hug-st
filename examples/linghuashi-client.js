export async function connectLinghuashi(source, timeoutMs = 20000) {
  const api = await new Promise((resolve, reject) => {
    const finish = () => {
      if (!window.Linghuashi) return;
      clearTimeout(timer);
      window.removeEventListener('linghuashi:api-ready', finish);
      resolve(window.Linghuashi);
    };
    const timer = setTimeout(() => {
      window.removeEventListener('linghuashi:api-ready', finish);
      reject(new Error('Linghuashi is not installed or did not initialize'));
    }, timeoutMs);
    window.addEventListener('linghuashi:api-ready', finish);
    finish();
  });
  if (api.apiVersion !== 1) throw new Error('Unsupported Linghuashi API version');
  await api.ready();
  return api.connect(source);
}

export async function generateScene(prompt, requestId, { signal, onProgress } = {}) {
  const client = await connectLinghuashi({ id: 'example-scene', name: '场景扩展示例' });
  const result = await client.generate({ prompt, requestId }, { signal, onProgress });
  return { ...result, release: () => client.releaseResult(result.task.id) };
}
