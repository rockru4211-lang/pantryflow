import type { MetadataRoute } from "next";

const publicUrl = "https://pantryflow-app-shell-preview.rockru4211.chatgpt.site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "序｜餐飲庫存管理",
    short_name: "序",
    description: "餐飲商家的品項匯入與盲盤管理工具。",
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
