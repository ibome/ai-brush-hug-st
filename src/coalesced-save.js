export function createCoalescedSave(save, { delay = 300, schedule = setTimeout, cancel = clearTimeout, onError = () => {}, onPending = () => {} } = {}) {
  let timer = null;
  function flush() {
    if (timer === null) return;
    cancel(timer); timer = null;
    return save();
  }
  return {
    schedule() {
      if (timer !== null) cancel(timer);
      onPending();
      timer = schedule(() => {
        timer = null;
        try { save(); } catch (error) { onError(error); }
      }, delay);
    },
    flush,
    cancel() { if (timer !== null) cancel(timer); timer = null; },
  };
}
