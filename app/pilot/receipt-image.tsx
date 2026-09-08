"use client";
/* eslint-disable @next/next/no-img-element -- Private source images and local HEIC previews. */
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { isHeicMime, receiptPreview } from "@/lib/receipt-photo";

export default function ReceiptImage({ src, mime, alt, style }: { src: string; mime: string; alt: string; style?: CSSProperties }) {
  const [result, setResult] = useState({ src: "", preview: "", failed: false });
  useEffect(() => {
    if (!isHeicMime(mime)) return;
    let active = true;
    let objectUrl = "";
    const controller = new AbortController();
    void (async () => {
      const response = await fetch(src, { signal: controller.signal });
      if (!response.ok) throw new Error("ORIGINAL_READ_FAILED");
      const blob = await response.blob();
      objectUrl = await receiptPreview(new Blob([blob], { type: mime }));
      if (active) setResult({ src, preview: objectUrl, failed: false });
      else URL.revokeObjectURL(objectUrl);
    })().catch(() => { if (active) setResult({ src, preview: "", failed: true }); });
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, mime]);
  const current = result.src === src ? result : null;
  if (isHeicMime(mime) && !current?.preview)
    return <span>{current?.failed ? "預覽暫時無法讀取，可開啟原圖。" : "原圖讀取中…"}</span>;
  return <img src={isHeicMime(mime) ? current!.preview : src} alt={alt} style={style} />;
}
