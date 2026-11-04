export function createChatRenderQueue(render, { blocked = () => false, delay = 60 } = {}) {
  let timer;
  let active = false;
  let pending = false;
  let localOnly = false;
  let destroyed = false;

  async function flush() {
    timer = undefined;
    if (destroyed || blocked()) return;
    active = true;
    pending = false;
    const local = localOnly;
    localOnly = false;
    try { await render(local); }
    finally {
      active = false;
      if (pending) schedule();
    }
  }

  function schedule(local = false) {
    if (destroyed) return;
    pending = true;
    localOnly ||= local === true;
    // Keep the first deadline, and let a slow render finish before starting another.
    if (active || timer !== undefined || blocked()) return;
    timer = setTimeout(() => { void flush(); }, delay);
  }

  function pause() {
    clearTimeout(timer);
    timer = undefined;
  }

  return {
    schedule,
    pause,
    destroy() { destroyed = true; pending = false; pause(); },
  };
}
