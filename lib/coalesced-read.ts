/** Share overlapping reads. A read requested after a write must start after any older read. */
export function coalescedRead<T>(read: () => Promise<T>) {
  let pending: Promise<T> | undefined;
  return function refresh(afterWrite = false): Promise<T> {
    if (pending) {
      return afterWrite ? pending.catch(() => undefined).then(() => refresh()) : pending;
    }
    pending = Promise.resolve().then(read).finally(() => { pending = undefined; });
    return pending;
  };
}
