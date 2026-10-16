/** A device draft is not a server receipt. Keep the exact request until acknowledged.
 * Compare the stored bytes before writes so another tab cannot silently replace it. */
export type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function recoveryKey(userId: string, storeId: string, kind: string) {
  return `app-recovery:${userId}:${storeId}:${kind}:v1`;
}
export function recoveryJournal<T>(storage: RecoveryStorage, key: string, validate: (value: unknown) => value is T) {
  let raw = storage.getItem(key);
  let value: T | null = null;
  if (raw !== null) {
    const saved = JSON.parse(raw);
    if (saved?.version !== 1 || !validate(saved.value)) throw Error('RECOVERY_INVALID');
    value = saved.value;
  }
  return {
    value,
    write(next: T | null) {
      if (storage.getItem(key) !== raw) throw Error('RECOVERY_CHANGED');
      const text = next === null ? null : JSON.stringify({version: 1, value: next});
      if (text === null) storage.removeItem(key); else storage.setItem(key, text);
      // Do not claim persistence if a browser/storage adapter silently drops a write.
      if (storage.getItem(key) !== text) throw Error('RECOVERY_UNAVAILABLE');
      raw = text;
      value = next;
    },
  };
}
export function recoveryError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('RECOVERY_CHANGED')
    ? '這份草稿已在另一個頁面變更，請重新開啟核對，避免覆蓋或重複送出。'
    : '此裝置無法保留草稿，請保持此頁；確認裝置儲存空間後重試。';
}
export function definitiveOperationFailure(error: unknown) {
  const failure = error as {code?: string; message?: string};
  return /^(22|23|40|42|P0)/.test(failure?.code || '') && !/REQUEST_REUSED/.test(failure.message || '');
}
