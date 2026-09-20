// Browsers use different messages for a failed dynamic module/worker import.
// These errors occur before OCR and must not be presented as quota failures.
export function isImportModuleLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Loading chunk .+ failed|Failed to load module script|Setting up fake worker failed/i.test(message);
}

export const importModuleLoadMessage = 'PDF 解析程式無法載入，請更新頁面後重新選擇檔案。這不是辨識額度不足。';

export function importRecoveryMessage(error: unknown): string | undefined {
  const message = typeof error === 'string' ? error
    : error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  if (/\bIMPORT_REMOVED_REVIEW_REQUIRED\b/.test(message)) {
    return '此檔案先前已移除，缺少可安全復原的紀錄；已停止匯入，請聯絡管理者處理。';
  }
  if (/\bIMPORT_ROW_REMOVED_REVIEW_REQUIRED\b/.test(message)) {
    return '部分品項曾被個別移除，已保留移除狀態；請先確認品項再重新匯入。';
  }
  return undefined;
}
