import type { Metadata, Viewport } from "next";
import "./globals.css";

const publicUrl = "https://beape-ops.rockru4211.workers.dev";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#173f35",
};

export const metadata: Metadata = {
  metadataBase: new URL(publicUrl),
  title: "百花猿｜營運整合系統",
  description: "百花猿餐飲公司專屬的進貨、請購、盤點庫存與成本整合系統，涵蓋 BeApe 與 Gras 兩家門市。",
  applicationName: "百花猿｜營運整合系統",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "百花猿",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "百花猿｜營運整合系統",
    description: "整合 BeApe、Gras 兩家門市的進貨、請購、盤點庫存與成本資料。",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "百花猿｜營運整合系統",
    description: "整合 BeApe、Gras 兩家門市的進貨、請購、盤點庫存與成本資料。",
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/favicon.svg",
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <head><meta name="apple-mobile-web-app-capable" content="yes" /></head>
      <body>{children}</body>
    </html>
  );
}
