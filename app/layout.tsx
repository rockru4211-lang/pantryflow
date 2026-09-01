import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PantryFlow｜完整 App 外殼預覽",
  description: "免登入查看 PantryFlow 登入流程，以及員工、店長／主管、後勤與 Owner 四種 App 外殼。此預覽不連接正式資料。",
  openGraph: {
    title: "PantryFlow｜完整 App 外殼預覽",
    description: "免登入切換四種角色，查看整套 App 頁面與導覽外殼。",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "PantryFlow｜完整 App 外殼預覽",
    description: "免登入切換四種角色，查看整套 App 頁面與導覽外殼。",
  },
  other: {
    "codex-preview": "pantryflow-app-shell",
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
