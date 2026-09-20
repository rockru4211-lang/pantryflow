type RemovalRpc = (name: 'undo_inventory_import_batch', args: {p_store_id: string; p_file_sha256: string}) => PromiseLike<{data: unknown; error: {message: string} | null}>;

export function importRemovalConfirmation(filename: string, storeName?: string) {
  return `整批移除「${filename}」？${storeName ? `\n門市：${storeName}` : ''}\n將一併移除這份匯入資料、所屬品項與未完成盤點內容。已完成的歷史紀錄會保留。`;
}

export async function removeInventoryImport(rpc: RemovalRpc, storeId: string, fileSha256: string) {
  const {data, error} = await rpc('undo_inventory_import_batch', {p_store_id: storeId, p_file_sha256: fileSha256});
  if (error) throw new Error(error.message);
  const result = data as {removed?: number; shared?: number; protected?: number; hidden?: boolean} | null;
  if (!result || result.hidden !== true || !Number.isInteger(result.removed) || result.removed! < 0) throw new Error('IMPORT_REMOVAL_NOT_CONFIRMED');
  let message = `已整批移除這份資料及 ${result.removed} 個品項。`;
  if (result.shared) message += `另有 ${result.shared} 個品項仍由其他匯入資料使用，已保留。`;
  if (result.protected) message += `另有 ${result.protected} 個品項因已有後續紀錄而保留。`;
  return message;
}

export function importRemovalError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/STORE_MANAGER_REQUIRED|AUTHENTICATION_REQUIRED/.test(message)) return '請使用這間門市有匯入管理權限的帳號操作。';
  if (/PRODUCT_ALREADY_COUNTED/.test(message)) return '這份資料已有後續盤點紀錄，目前無法整批移除。';
  return '尚未確認整批移除完成，請稍後重試或重新開啟匯入紀錄確認。';
}
