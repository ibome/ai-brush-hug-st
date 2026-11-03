export function createTaskImageSync({ tasks, images, location, ready, reload, select, notify }) {
  const observed = new Map();
  const misses = new Map();
  let active;
  let pending = false;
  return function refresh() {
    pending = true;
    if (active) return active;
    active = Promise.resolve().then(async () => {
      await ready();
      while (pending) {
        pending = false;
        const currentLocation = location();
        const saved = tasks().filter((task) => task.savedIds?.length
          && task.plan.storageLocation === currentLocation);
        const changes = saved.map((task) => ({
          task, key: `${currentLocation}:${task.id}`, signature: JSON.stringify(task.savedIds),
        })).filter(({ key, signature }) => observed.get(key) !== signature);
        if (!changes.length) continue;
        const ids = new Set(images().map((image) => image.id));
        if (changes.some(({ task }) => task.savedIds.some((id) => !ids.has(id)))) await reload(true);
        if (location() !== currentLocation) { pending = true; continue; }
        select(changes.map(({ task }) => task));
        notify();
        const loaded = new Set(images().map((image) => image.id));
        for (const { task, key, signature } of changes) {
          if (task.savedIds.every((id) => loaded.has(id))) {
            observed.set(key, signature); misses.delete(key);
          } else {
            const previous = misses.get(key);
            const attempts = previous?.signature === signature ? previous.attempts + 1 : 1;
            misses.set(key, { signature, attempts });
            // Old task records may refer to deliberately deleted images.
            if (attempts >= 3) observed.set(key, signature);
          }
        }
        const retained = new Set(saved.map((task) => `${currentLocation}:${task.id}`));
        for (const key of new Set([...observed.keys(), ...misses.keys()])) if (!retained.has(key)) {
          observed.delete(key); misses.delete(key);
        }
      }
    }).finally(() => { active = null; });
    return active;
  };
}

export function startGenerationPolling({ refresh, resumed, window, document, interval = 8000, failed = () => {} }) {
  let timer;
  let resumeWork;
  const poll = () => {
    if (document.visibilityState === 'hidden') return;
    void Promise.resolve().then(refresh).catch(failed);
  };
  const start = () => { timer ??= window.setInterval(poll, interval); };
  const pause = () => { window.clearInterval(timer); timer = undefined; };
  const resume = () => {
    if (document.visibilityState === 'hidden') return;
    start();
    if (resumeWork) return;
    resumeWork = Promise.resolve().then(refresh).then(resumed).catch(failed)
      .finally(() => { resumeWork = null; });
  };
  start();
  window.addEventListener('pagehide', pause);
  window.addEventListener('pageshow', resume);
  window.addEventListener('focus', resume);
  window.addEventListener('online', resume);
  document.addEventListener('visibilitychange', resume);
  return () => {
    pause();
    window.removeEventListener('pagehide', pause);
    window.removeEventListener('pageshow', resume);
    window.removeEventListener('focus', resume);
    window.removeEventListener('online', resume);
    document.removeEventListener('visibilitychange', resume);
  };
}
