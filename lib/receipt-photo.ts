export const receiptPhotoAccept =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf";

export const isHeicMime = (mime: string) =>
  mime === "image/heic" || mime === "image/heif";

// iOS and file pickers may omit HEIC's MIME type. Inspect the container rather
// than trusting the filename, and retain the original bytes for upload and OCR.
export async function normalizeReceiptPhoto(file: File): Promise<File> {
  if (!file.size || file.size > 10485760) throw new Error("RECEIPT_FILE_SIZE");
  const header = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const ascii = (offset: number) =>
    String.fromCharCode(...header.slice(offset, offset + 4));
  const brands = [ascii(8)];
  for (let offset = 16; offset + 4 <= header.length; offset += 4)
    brands.push(ascii(offset));
  const heic = ascii(4) === "ftyp" &&
    brands.some((b) => ["heic", "heix", "hevc", "hevx"].includes(b));
  if (heic)
    return new File([file], file.name, {
      type: "image/heic",
      lastModified: file.lastModified,
    });
  if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type))
    throw new Error("RECEIPT_FILE_FORMAT");
  return file;
}

export async function receiptPreview(blob: Blob): Promise<string> {
  if (isHeicMime(blob.type)) {
    const { heicTo } = await import("heic-to/csp");
    const preview = await heicTo({ blob, type: "image/jpeg", quality: 0.9 });
    return URL.createObjectURL(preview);
  }
  return URL.createObjectURL(blob);
}
