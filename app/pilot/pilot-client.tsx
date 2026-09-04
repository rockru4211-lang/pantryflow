"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { activeProjectRef, supabase } from "@/lib/supabase-browser";
import { EXPECTED_SCHEMA_VERSION, releaseInfo } from "@/lib/release";
import CountWorkspace from "./count-workspace";
import {
  AuthBrand,
  AuthShell,
  AuthTopbar,
  FormalAppShell,
  FormalHome,
  WorkspaceBack,
  type ShellRole,
} from "./app-shell";

type Store = { id: string; name: string; store_code: string };
type Profile = { display_name: string | null; organization_id: string | null; role: string | null };

const errorText = (message: string) => {
  if (message.includes("Invalid login credentials")) return "帳號或密碼不正確。";
  if (message.includes("Email not confirmed")) return "請先到信箱完成驗證。";
  if (message.includes("User already registered")) return "此 Email 已註冊，請直接登入。";
  if (message.includes("OWNER_EMAIL_NOT_VERIFIED")) return "請先到信箱完成驗證，再建立餐廳。";
  if (message.includes("Token has expired") || message.includes("otp_expired")) return "驗證碼已過期，請重新寄送。";
  if (message.includes("Token has been invalid") || message.includes("invalid")) return "驗證碼不正確，請確認後再試。";
  if (message.includes("rate limit")) return "寄送次數過多，請稍後再試。";
  return "目前無法完成，請稍後再試。";
};

const maskEmail = (email: string) => {
  const [name, domain] = email.split("@");
  if (!domain) return email;
  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}${"•".repeat(Math.max(3, name.length - visible.length))}@${domain}`;
};

export default function PilotClient() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [mode, setMode] = useState<"welcome" | "login" | "signup">("welcome");
  const [pendingEmail, setPendingEmail] = useState("");
  const [resendSeconds, setResendSeconds] = useState(0);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [view, setView] = useState<"home" | "count" | "manual">("home");
  const [schemaVersion, setSchemaVersion] = useState("checking");
  const [schemaError, setSchemaError] = useState("");

  async function checkCompatibility() {
    const { data, error } = await supabase.rpc("get_app_schema_version");
    const actual = typeof data === "string" ? data : "unavailable";
    setSchemaVersion(actual);
    if (error || actual !== EXPECTED_SCHEMA_VERSION) {
      setSchemaError(`版本不相容：App 需要 ${EXPECTED_SCHEMA_VERSION}，資料庫目前為 ${actual}。`);
      return false;
    }
    setSchemaError("");
    return true;
  }

  async function loadWorkspace(activeSession: Session | null) {
    if (!await checkCompatibility()) {
      setBusy(false);
      return;
    }
    setSession(activeSession);
    if (!activeSession) {
      setProfile(null);
      setStores([]);
      setBusy(false);
      return;
    }

    const [{ data: profileData }, { data: storeData }] = await Promise.all([
      supabase.from("profiles").select("display_name, organization_id, role").single(),
      supabase.from("stores").select("id, name, store_code").eq("is_active", true).order("name"),
    ]);
    setProfile(profileData ?? null);
    setStores(storeData ?? []);
    setBusy(false);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => loadWorkspace(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void loadWorkspace(nextSession);
    });
    return () => data.subscription.unsubscribe();
    // Auth owns this subscription lifecycle; workspace reloads are triggered by auth events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setInterval(() => setResendSeconds(value => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    const result = mode === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });

    if (result.error) setMessage(errorText(result.error.message));
    else if (mode === "signup" && !result.data.session) {
      setPendingEmail(email);
      setResendSeconds(60);
      setMessage("");
    }
    setBusy(false);
  }

  async function verifySignupOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const token = String(form.get("otp") || "").replace(/\D/g, "");
    const { data, error } = await supabase.auth.verifyOtp({ email: pendingEmail, token, type: "signup" });
    if (error) setMessage(errorText(error.message));
    else if (data.session) await loadWorkspace(data.session);
    else setMessage("驗證完成，但尚未建立登入狀態，請重新登入。");
    setBusy(false);
  }

  async function resendSignupOtp() {
    if (resendSeconds > 0) return;
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.resend({ type: "signup", email: pendingEmail });
    if (error) setMessage(errorText(error.message));
    else {
      setResendSeconds(60);
      setMessage("新的驗證碼已寄出。");
    }
    setBusy(false);
  }

  async function createBusiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const organizationName = String(new FormData(event.currentTarget).get("organization_name") || "").trim();
    const { error } = await supabase.rpc("create_owner_business", {
      p_organization_name: organizationName,
      p_business_type: "SINGLE_RESTAURANT",
      p_store_name: organizationName,
      p_store_code: `STORE-${Date.now().toString(36).toUpperCase()}`,
      p_staff_login_mode: "NAME_OR_NICKNAME",
    });
    if (error) setMessage(errorText(error.message));
    else await loadWorkspace(session);
    setBusy(false);
  }

  const versionPanel = <details className="version-info"><summary>版本資訊</summary>
    <dl><div><dt>Commit</dt><dd>{releaseInfo.commitSha}</dd></div><div><dt>Branch</dt><dd>{releaseInfo.branch}</dd></div><div><dt>Build time</dt><dd>{releaseInfo.buildTime}</dd></div><div><dt>Environment</dt><dd>{releaseInfo.environment}</dd></div><div><dt>Supabase</dt><dd>{activeProjectRef.slice(0, 8)}</dd></div><div><dt>Schema</dt><dd>{schemaVersion}</dd></div></dl>
  </details>;

  if (busy && !session) return <AuthShell><section className="auth-loading"><AuthBrand /><p>正在載入…</p></section></AuthShell>;
  if (schemaError) return <AuthShell><section className="admin-login-stage"><div className="admin-login-frame"><AuthTopbar /><div className="admin-login-content"><h1>版本無法使用</h1><p className="pilot-message" role="alert">{schemaError}</p>{versionPanel}</div></div></section></AuthShell>;

  if (!session) {
    if (pendingEmail) {
      return <AuthShell><section className="admin-login-stage"><div className="admin-login-frame"><AuthTopbar /><div className="admin-login-content otp-card">
          <button className="auth-back link" type="button" onClick={() => { setPendingEmail(""); setMessage(""); setMode("signup"); }}>‹ 返回修改 Email</button>
          <div className="admin-login-heading"><h1>輸入六位數驗證碼</h1><p>驗證碼已寄到 {maskEmail(pendingEmail)}，請在此裝置完成驗證。</p></div>
          <form className="admin-login-form" onSubmit={verifySignupOtp}>
            <label className="field">六位數驗證碼<input name="otp" className="otp-input" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required /></label>
            <button className="primary" disabled={busy}>{busy ? "驗證中…" : "驗證並繼續"}</button>
          </form>
          {message && <p className="pilot-message" role="status">{message}</p>}
          <button className="text-button full-button" type="button" disabled={busy || resendSeconds > 0} onClick={resendSignupOtp}>
            {resendSeconds > 0 ? `${resendSeconds} 秒後可重新寄送` : "重新寄送驗證碼"}
          </button>
        </div></div></section></AuthShell>;
    }
    if (mode === "welcome") {
      return <AuthShell><section className="admin-login-stage identity-stage"><div className="admin-login-frame identity-frame"><div className="identity-content">
        <AuthBrand />
        <div className="identity-heading"><h1>歡迎回來</h1><p>選擇你的登入方式</p></div>
        <div className="identity-list">
          <button className="identity-choice primary-choice" type="button" disabled><span className="identity-icon">人</span><span><strong>員工快速登入</strong><small>門市與身分、6 位 PIN</small></span><b>›</b></button>
          <button className="identity-choice" type="button" onClick={() => setMode("login")}><span className="identity-icon">管</span><span><strong>管理帳號登入</strong><small>店長、主管、行政後勤與 Owner</small></span><b>›</b></button>
        </div>
        <button className="new-business-link" type="button" onClick={() => setMode("signup")}>建立新商家</button>
      </div></div></section></AuthShell>;
    }
    return <AuthShell><section className="admin-login-stage"><div className="admin-login-frame"><AuthTopbar /><div className="admin-login-content">
      <button className="auth-back link" type="button" onClick={() => { setMode("welcome"); setMessage(""); }}>‹ 返回登入首頁</button>
      <div className="admin-login-heading"><h1>{mode === "login" ? "歡迎回來" : "建立管理帳號"}</h1><p>{mode === "login" ? "使用管理帳號登入" : "先建立帳號，再驗證 Email。"}</p></div>
      <form className="admin-login-form" onSubmit={submitAuth}>
        <label className="field">Email<input name="email" type="email" autoComplete="email" required /></label>
        <label className="field">密碼<input name="password" type="password" minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} required /></label>
        <button className="primary" disabled={busy}>{busy ? "處理中…" : mode === "login" ? "登入" : "寄送驗證碼"}</button>
      </form>
      {message && <p className="pilot-message" role="status">{message}</p>}
      <small className="auth-footnote">登入後的資料會安全儲存在商家專屬空間。</small>
      <details className="install-help"><summary>iPhone 加入主畫面</summary><p>使用 Safari 開啟此網站，點選「分享」，再選「加入主畫面」。安裝後會以獨立 App 視窗開啟。</p></details>
      {versionPanel}
    </div></div></section></AuthShell>;
  }

  if (!profile?.organization_id) {
    return <AuthShell><section className="admin-login-stage"><div className="admin-login-frame"><AuthTopbar /><div className="admin-login-content">
      <div className="admin-login-heading"><p className="eyebrow">首次設定</p><h1>建立商家</h1><p>輸入餐廳名稱，系統會在背景建立同名單一門市。</p></div>
      <form className="admin-login-form" onSubmit={createBusiness}>
        <label className="field">餐廳名稱<input name="organization_name" required /></label>
        <button className="primary" disabled={busy}>{busy ? "建立中…" : "完成設定"}</button>
      </form>
      {message && <p className="pilot-message" role="status">{message}</p>}
      <button className="text-button" type="button" onClick={() => supabase.auth.signOut()}>登出</button>
    </div></div></section></AuthShell>;
  }

  const role: ShellRole = profile.role === "STAFF"
    ? "STAFF"
    : profile.role === "LOGISTICS"
      ? "LOGISTICS"
      : profile.role === "SUPERVISOR" || profile.role === "ADMIN"
        ? "SUPERVISOR"
        : "OWNER";

  return <FormalAppShell role={role} storeName={stores[0]?.name || "序"} view={view} onNavigate={setView} onSignOut={() => { void supabase.auth.signOut(); }}>
    {view === "home"
      ? <FormalHome role={role} onImport={() => setView("count")} onManual={() => setView("manual")} versionPanel={versionPanel} />
      : <WorkspaceBack onBack={() => setView("home")}><CountWorkspace stores={stores} organizationId={profile.organization_id} session={session} allowManual={view === "manual"} /></WorkspaceBack>}
  </FormalAppShell>;
}
