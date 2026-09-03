"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import Link from "next/link";
import { supabase } from "@/lib/supabase-browser";

type Store = { id: string; name: string; store_code: string };
type Profile = { display_name: string | null; organization_id: string | null; role: string };

const errorText = (message: string) => {
  if (message.includes("Invalid login credentials")) return "帳號或密碼不正確。";
  if (message.includes("Email not confirmed")) return "請先到信箱完成驗證。";
  if (message.includes("User already registered")) return "此 Email 已註冊，請直接登入。";
  if (message.includes("OWNER_EMAIL_NOT_VERIFIED")) return "請先到信箱完成驗證，再建立餐廳。";
  return "目前無法完成，請稍後再試。";
};

export default function PilotClient() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");

  async function loadWorkspace(activeSession: Session | null) {
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
  }, []);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    const result = mode === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/` },
        });

    if (result.error) setMessage(errorText(result.error.message));
    else if (mode === "signup" && !result.data.session) setMessage("註冊完成，請到信箱點擊驗證連結後登入。");
    setBusy(false);
  }

  async function createBusiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const { error } = await supabase.rpc("create_owner_business", {
      p_organization_name: String(form.get("organization_name") || "").trim(),
      p_business_type: String(form.get("business_type") || "SINGLE_RESTAURANT"),
      p_store_name: String(form.get("store_name") || "").trim(),
      p_store_code: String(form.get("store_code") || "").trim(),
      p_staff_login_mode: "NAME_OR_NICKNAME",
    });
    if (error) setMessage(errorText(error.message));
    else await loadWorkspace(session);
    setBusy(false);
  }

  if (busy && !session) return <main className="pilot-stage"><p>正在載入…</p></main>;

  if (!session) {
    return <main className="pilot-stage"><section className="pilot-card auth-card">
      <div className="pilot-brand"><span>序</span><small>正式資料測試</small></div>
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
      <Link href="/preview">查看內部外觀預覽</Link>
    </section></main>;
  }

  if (!profile?.organization_id) {
    return <main className="pilot-stage"><section className="pilot-card auth-card">
      <div className="pilot-brand"><span>序</span><small>首次設定</small></div>
      <h1>建立餐廳與第一家門市</h1>
      <p>單店／多門市與有無 ERP 會分開設定；這裡先建立基本資料。</p>
      <form onSubmit={createBusiness}>
        <label>餐廳名稱<input name="organization_name" required /></label>
        <label>營運型態<select name="business_type"><option value="SINGLE_RESTAURANT">獨立餐廳</option><option value="CHAIN_RESTAURANT">連鎖餐飲</option></select></label>
        <label>第一家門市<input name="store_name" required /></label>
        <label>門市代碼<input name="store_code" placeholder="例如 DAAN01" pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,31}" required /></label>
        <button className="pilot-primary" disabled={busy}>{busy ? "建立中…" : "完成設定"}</button>
      </form>
      {message && <p className="pilot-message" role="status">{message}</p>}
      <button className="pilot-link" onClick={() => supabase.auth.signOut()}>登出</button>
    </section></main>;
  }

  return <main className="pilot-stage"><section className="pilot-card workspace-card">
    <header><div><small>正式資料</small><h1>{profile.display_name || "管理者"}</h1></div><button className="pilot-link" onClick={() => supabase.auth.signOut()}>登出</button></header>
    <div className="pilot-status"><b>登入與門市權限已連線</b><span>目前只顯示這個帳號可存取的門市。</span></div>
    <h2>我的門市</h2>
    <div className="store-list">{stores.map(store => <article key={store.id}><div><b>{store.name}</b><small>{store.store_code}</small></div><span>盤點建置中</span></article>)}</div>
    {!stores.length && <p className="pilot-empty">目前沒有可存取的門市。</p>}
    <p className="pilot-note">下一步：以這些正式門市資料建立第一個盤點區域、品項與盤點紀錄。</p>
  </section></main>;
}
