import { wait } from './generation.js';
import { withRequestTimeout } from './request-timeout.js';

export function blockingChatWindow(root) {
  return root?.querySelector('dialog[open]:not(.drawing-viewer)') || null;
}

export async function waitForChatWindow(root, { signal, timeout = 60000, onWait = () => {} } = {}) {
  signal?.throwIfAborted();
  if (!blockingChatWindow(root)) return;
  onWait();
  await withRequestTimeout(signal, timeout,
    '等待关闭编辑窗口超时，本次尚未提交生图；请关闭编辑窗口后手动重试', async (waitingSignal) => {
      while (blockingChatWindow(root)) await wait(200, waitingSignal);
    });
}
