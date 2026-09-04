"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { activeProjectRef, supabase } from "@/lib/supabase-browser";
import { EXPECTED_SCHEMA_VERSION, releaseInfo } from "@/lib/release";
import CountWorkspace from "./count-workspace";

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
  const [mode, setMode] = useState<"login" | "signup">("login");
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

  if (busy && !session) return <main className="pilot-stage"><p>正在載入…</p></main>;
  if (schemaError) return <main className="pilot-stage"><section className="pilot-card auth-card"><h1>版本無法使用</h1><p className="pilot-message" role="alert">{schemaError}</p>{versionPanel}</section></main>;

  if (!session) {
    if (pendingEmail) {
      return <main className="pilot-stage"><section className="pilot-card auth-card otp-card">
        <div className="pilot-brand"><strong>序</strong><small>Email 驗證</small></div>
        <h1>輸入六位數驗證碼</h1>
        <p>驗證碼已寄到 {maskEmail(pendingEmail)}，請在此裝置完成驗證。</p>
        <form onSubmit={verifySignupOtp}>
          <label>六位數驗證碼<input name="otp" className="otp-input" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required /></label>
          <button className="pilot-primary" disabled={busy}>{busy ? "驗證中…" : "驗證並繼續"}</button>
        </form>
        {message && <p className="pilot-message" role="status">{message}</p>}
        <button className="pilot-link" type="button" disabled={busy || resendSeconds > 0} onClick={resendSignupOtp}>
          {resendSeconds > 0 ? `${resendSeconds} 秒後可重新寄送` : "重新寄送驗證碼"}
        </button>
        <button className="pilot-link otp-back" type="button" onClick={() => { setPendingEmail(""); setMessage(""); setMode("signup"); }}>返回修改 Email</button>
      </section></main>;
    }
    return <main className="pilot-stage"><section className="pilot-card auth-card">
      <div className="pilot-brand"><strong>序</strong><small>正式資料測試</small></div>
      <h1>{mode === "login" ? "管理者登入" : "建立管理者帳號"}</h1>
      <p>此入口連接正式測試資料，不使用預覽示意內容。</p>
      <div className="pilot-tabs">
        <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>登入</button>
        <button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>註冊</button>
      </div>
      <form onSubmit={submitAuth}>
        <label>Email<input name="email" type="email" autoComplete="email" required /></label>
        <label>密碼<input name="password" type="password" minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} required /></label>
        <button className="pilot-primary" disabled={busy}>{busy ? "處理中…" : mode === "login" ? "登入" : "註冊"}</button>
      </form>
      {message && <p className="pilot-message" role="status">{message}</p>}
      <small className="auth-footnote">登入後的資料會安全儲存在商家專屬空間。</small>
      <details className="install-help"><summary>iPhone 加入主畫面</summary><p>使用 Safari 開啟此網站，點選「分享」，再選「加入主畫面」。安裝後會以獨立 App 視窗開啟。</p></details>
      {versionPanel}
    </section></main>;
  }

  if (!profile?.organization_id) {
    return <main className="pilot-stage"><section className="pilot-card auth-card">
      <div className="pilot-brand"><strong>序</strong><small>首次設定</small></div>
      <h1>建立商家</h1>
      <p>先建立商家基本資料，完成後直接進入首頁。</p>
      <form onSubmit={createBusiness}>
        <label>餐廳名稱<input name="organization_name" required /></label>
        <button className="pilot-primary" disabled={busy}>{busy ? "建立中…" : "完成設定"}</button>
      </form>
      {message && <p className="pilot-message" role="status">{message}</p>}
      <button className="pilot-link" onClick={() => supabase.auth.signOut()}>登出</button>
    </section></main>;
  }

  return <main className="app-stage"><section className="app-phone">
    <header className="app-header"><b>{stores[0]?.name || "序"}</b><strong className="app-wordmark">序</strong><button onClick={() => supabase.auth.signOut()}>登出</button></header>
    <div className="role-band">店長</div>
    {view === "home" ? <div className="app-content">
      <p className="home-date">今天</p><h1>今日營運重點</h1><p className="home-copy">先完成現場必要工作</p>
      <section className="onboarding-actions"><h2>開始使用</h2><button className="pilot-primary" onClick={() => setView("count")}>匯入現有品項檔案</button><button className="secondary-action" onClick={() => setView("manual")}>手動新增品項</button></section>
      <section><h2>每日作業</h2><div className="home-grid">
        <button onClick={() => setView("count")}><span>▣</span><b>盤點</b><small>開始或繼續</small></button>
        <button disabled><span>▤</span><b>進貨</b><small>下一階段</small></button>
        <button disabled><span>◷</span><b>效期提醒</b><small>下一階段</small></button>
      </div></section>
      <p className="live-note">目前為正式資料測試版，只有盤點已開放。</p>
      {versionPanel}
    </div> : <div className="app-content"><button className="back-button" onClick={() => setView("home")}>‹ 返回首頁</button><CountWorkspace stores={stores} organizationId={profile.organization_id} session={session} allowManual={view === "manual"} /></div>}
    <nav className="app-nav"><button onClick={() => setView("home")}>首頁</button><button disabled>作業紀錄</button><button disabled>待辦</button><button disabled>通知</button><button disabled>我的</button></nav>
  </section></main>;
}
