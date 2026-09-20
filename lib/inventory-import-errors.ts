// Browsers use different messages for a failed dynamic module/worker import.
// These errors occur before OCR and must not be presented as quota failures.
export function isImportModuleLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Loading chunk .+ failed|Failed to load module script|Setting up fake worker failed/i.test(message);
}

export const importModuleLoadMessage = 'PDF 解析程式無法載入，請更新頁面後重新選擇檔案。這不是辨識額度不足。';
