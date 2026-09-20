// Persist only a stable code for the merchant UI. Provider messages stay server-side.
export function receiptOcrErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/^GEMINI_429:/.test(message)) return "OCR_RATE_LIMIT";
  if (/^GEMINI_(500|502|503|504):/.test(message)) return "OCR_SERVICE_BUSY";
  if (/^GEMINI_API_KEY_MISSING$|^GEMINI_(401|403):/.test(message)) return "OCR_CONFIGURATION_ERROR";
  if (error instanceof SyntaxError || /^GEMINI_EMPTY_STRUCTURED_OUTPUT|^OCR_NO_LINES$/.test(message)) return "OCR_UNREADABLE_RESULT";
  return "OCR_PROCESSING_FAILED";
}

export function receiptOcrFailureMessage(code: string | null | undefined): string {
  const preserved = "原圖與貨單已保留，請勿重複上傳。";
  switch (code) {
    case "OCR_RATE_LIMIT":
      return `辨識服務已達用量或請求上限。請稍後重試；若持續失敗，請聯絡管理者檢查辨識服務額度。${preserved}`;
    case "OCR_SERVICE_BUSY":
      return `辨識服務暫時忙碌，請稍後重試。${preserved}`;
    case "OCR_CONFIGURATION_ERROR":
      return `辨識服務設定異常，請聯絡管理者修復後再重試。${preserved}`;
    case "OCR_UNREADABLE_RESULT":
      return `本次未取得可用的品項資料。請先檢查原圖是否清楚、完整，再重試辨識。${preserved}`;
    default:
      return `辨識未完成，可稍後重試；若持續失敗，請聯絡管理者並提供貨單編號。${preserved}`;
  }
}
