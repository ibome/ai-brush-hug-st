export async function withRequestTimeout(signal, milliseconds, message, request) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException(message, 'TimeoutError')), milliseconds);
  try {
    const value = await request(controller.signal);
    controller.signal.throwIfAborted();
    return value;
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
