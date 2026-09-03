import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "序｜餐飲庫存管理",
  description: "餐飲現場的盤點、進貨、效期、廢棄與門市協作。",
  openGraph: {
    title: "序｜完整 App 外殼預覽",
    description: "切換餐廳類型與角色，查看「序」整套 App 頁面、最新版登入註冊與導覽外殼。",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "序｜完整 App 外殼預覽",
    description: "切換餐廳類型與角色，查看「序」整套 App 頁面、最新版登入註冊與導覽外殼。",
  },
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
