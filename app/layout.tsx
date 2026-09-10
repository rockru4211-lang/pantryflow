import type { Metadata, Viewport } from "next";
import "./globals.css";

const publicUrl = "https://pantryflow-app-shell-preview.rockru4211.chatgpt.site";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#173f35",
};

export const metadata: Metadata = {
  metadataBase: new URL(publicUrl),
  title: "序｜餐飲庫存管理",
  description: "提供商家實際使用的餐飲庫存盤點測試版。",
  applicationName: "序｜餐飲庫存管理",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "序",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "序｜餐飲庫存管理",
    description: "登入、匯入品項並完成真實盲盤。",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "序｜餐飲庫存管理",
    description: "登入、匯入品項並完成真實盲盤。",
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
