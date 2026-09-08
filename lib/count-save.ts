// Bound both network waits and authentication waits; abort alone may not settle
// a client promise that is still waiting for the auth lock.
export async function withCountSaveTimeout<T>(
  request: (signal: AbortSignal) => PromiseLike<T>,
  timeoutMs = 12000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => request(controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("COUNT_SAVE_TIMEOUT"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
