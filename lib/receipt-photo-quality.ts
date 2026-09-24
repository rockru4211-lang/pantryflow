export const photoIssueLabels = {
  BLUR: '照片模糊，請靠近並對焦後重拍',
  GLARE: '反光遮住文字，請調整角度重拍',
  CROPPED: '貨單未拍完整，請將四角與明細拍入',
} as const;

export type PhotoIssue = { page: number; reason: keyof typeof photoIssueLabels };

// Missing prices, OCR uncertainty and provider errors never imply a bad photo.
// Accept only explicit, high-confidence physical defects on an existing image.
export function receiptPhotoIssues(input: unknown, pages: number[]): PhotoIssue[] {
  if (!Array.isArray(input)) return [];
  const result = new Map<number, PhotoIssue>();
  for (const value of input) {
    if (!value || typeof value !== 'object') continue;
    const { page, reason, confidence } = value;
    if (!Number.isInteger(page) || !pages.includes(page) ||
        !Object.hasOwn(photoIssueLabels, reason) ||
        typeof confidence !== 'number' || confidence < 0.9 || confidence > 1) continue;
    result.set(page, { page, reason });
  }
  return [...result.values()].sort((a, b) => a.page - b.page);
}
