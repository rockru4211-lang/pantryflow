import type { MetadataRoute } from "next";

const publicUrl = "https://beape-ops.rockru4211.workers.dev";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BeApe｜營運整合系統",
    short_name: "BeApe",
    description: "BeApe 餐廳專屬的進貨、請購、盤點庫存與成本整合工具。",
    start_url: publicUrl,
    scope: "/",
    display: "standalone",
    background_color: "#f3f1ec",
    theme_color: "#173f35",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
