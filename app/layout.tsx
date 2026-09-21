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
  title: "BeApe｜營運整合系統",
  description: "BeApe 餐廳專屬的進貨、請購、盤點庫存與成本整合系統。",
  applicationName: "BeApe｜營運整合系統",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "BeApe",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "BeApe｜營運整合系統",
    description: "整合 BeApe 進貨、請購、盤點庫存與成本資料。",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "BeApe｜營運整合系統",
    description: "整合 BeApe 進貨、請購、盤點庫存與成本資料。",
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
