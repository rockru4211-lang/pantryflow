"use client";

import type { ReactNode } from "react";
import {
  Bell,
  CalendarClock,
  ClipboardList,
  Home,
  ListChecks,
  Package,
  Search,
  Truck,
  UserRound,
} from "lucide-react";
import DaisyLogo from "./daisy-logo";

export type ShellRole = "STAFF" | "SUPERVISOR" | "LOGISTICS" | "OWNER";
export type ShellView = "home" | "count" | "manual";

const roleMeta: Record<ShellRole, { label: string; tone: string; homeTitle: string; homeCopy: string }> = {
  STAFF: { label: "員工", tone: "green", homeTitle: "歡迎回來", homeCopy: "先完成今天的工作" },
  SUPERVISOR: { label: "店長／主管", tone: "orange", homeTitle: "今日營運重點", homeCopy: "處理門市事項，確認營運順暢" },
  LOGISTICS: { label: "後勤／管理", tone: "blue", homeTitle: "後勤工作台", homeCopy: "核對資料，掌握營運成果" },
  OWNER: { label: "Owner／管理者", tone: "purple", homeTitle: "營運總覽", homeCopy: "管理商家，掌握全局" },
};

function navIcon(name: string) {
  const props = { className: "ui-icon", strokeWidth: 2 };
  if (name === "activity") return <ClipboardList {...props} />;
  if (name === "tasks") return <ListChecks {...props} />;
  if (name === "notifications") return <Bell {...props} />;
  if (name === "profile") return <UserRound {...props} />;
  return <Home {...props} />;
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="formal-auth-stage">
      <div className="shell-preview-role role-green">
        <div className="phone-app auth-phone">{children}</div>
      </div>
    </main>
  );
}

export function AuthBrand() {
  return (
    <div className="brand-lockup">
      <span className="brand-glyph"><DaisyLogo title="序" /></span>
      <span><strong>序</strong><small>讓餐廳，自然有序。</small></span>
    </div>
  );
}

export function AuthTopbar() {
  return (
    <header className="admin-login-topbar">
      <span className="topbar-daisy"><DaisyLogo title="序" /></span>
      <strong>序</strong>
    </header>
  );
}

export function FormalAppShell({
  role,
  storeName,
  view,
  onNavigate,
  onSignOut,
  children,
}: {
  role: ShellRole;
  storeName: string;
  view: ShellView;
  onNavigate: (view: ShellView) => void;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const meta = roleMeta[role];
  return (
    <main className="formal-app-stage">
      <div className={`shell-preview-role role-${meta.tone}`}>
        <div className="phone-app" data-shell-role={role}>
          <header className="shell-topbar">
            <button className="shell-store" type="button" onClick={() => onNavigate("home")}>
              <span>{storeName}</span><b>⌄</b>
            </button>
            <span className="shell-brand"><DaisyLogo title="序" /><b>序</b></span>
            <div className="shell-top-actions">
              {(role === "LOGISTICS" || role === "OWNER") && <button type="button" aria-label="搜尋" disabled><Search className="ui-icon" /></button>}
              <button type="button" aria-label="登出" onClick={onSignOut}><UserRound className="ui-icon" /></button>
            </div>
          </header>
          <div className="role-ribbon"><span>{meta.label}</span><small>單一門市</small></div>
          <div className="shell-content">{children}</div>
          <nav className="shell-bottom-nav" aria-label="主要導覽">
            {[
              ["home", "首頁"],
              ["activity", "作業紀錄"],
              ["tasks", "待辦"],
              ["notifications", "通知"],
              ["profile", "我的"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={id === "home" && view === "home" ? "active" : ""}
                aria-current={id === "home" && view === "home" ? "page" : undefined}
                disabled={id !== "home"}
                onClick={() => id === "home" && onNavigate("home")}
              >
                {navIcon(id)}<span>{label}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>
    </main>
  );
}

export function FormalHome({
  role,
  onImport,
  onManual,
  versionPanel,
}: {
  role: ShellRole;
  onImport: () => void;
  onManual: () => void;
  versionPanel: ReactNode;
}) {
  const meta = roleMeta[role];
  return (
    <>
      <div className="role-home-title">
        <div><span>今天</span><h1>{meta.homeTitle}</h1><p>{meta.homeCopy}</p></div>
      </div>
      <section className="shell-section first-use-section">
        <div className="shell-section-head"><h2>開始使用</h2><span>初始設定</span></div>
        <div className="shell-card first-use-card">
          <span className="row-icon"><Package className="ui-icon" /></span>
          <div><strong>匯入現有品項檔案</strong><small>Excel／CSV 建立品項、單位、區域、代碼與期初數量</small></div>
          <button className="shell-primary" type="button" onClick={onImport}>開始匯入</button>
          <button className="shell-secondary" type="button" onClick={onManual}>手動新增品項</button>
        </div>
      </section>
      <section className="shell-section">
        <div className="shell-section-head"><h2>每日作業</h2></div>
        <div className="shell-tile-grid">
          <button className="shell-icon-tile" type="button" onClick={onImport}><span><ClipboardList className="ui-icon" /></span><strong>盤點</strong></button>
          <button className="shell-icon-tile is-future" type="button" disabled><span><Truck className="ui-icon" /></span><strong>進貨</strong><small>下一階段</small></button>
          <button className="shell-icon-tile is-future" type="button" disabled><span><CalendarClock className="ui-icon" /></span><strong>效期提醒</strong><small>下一階段</small></button>
        </div>
      </section>
      <p className="shell-note">目前 Beta 僅開放真實品項匯入與盲盤流程。</p>
      {versionPanel}
    </>
  );
}

export function WorkspaceBack({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return <><button className="shell-back" type="button" onClick={onBack}>‹ <span>返回首頁</span></button>{children}</>;
}
