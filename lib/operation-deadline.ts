// A stalled connection must release the form so the same request can be retried.
export async function operationDeadline<T>(run: (signal: AbortSignal) => PromiseLike<T>, milliseconds = 20000): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => run(controller.signal)),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new Error('REQUEST_TIMEOUT')); controller.abort(); }, milliseconds);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
