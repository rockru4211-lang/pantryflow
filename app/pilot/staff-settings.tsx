"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

type Store = { id: string; name: string; store_code: string };
type Membership = {
  store_id: string;
  user_id: string;
  login_identifier: string;
  role: string;
  is_active: boolean;
};
type StaffIdentity = { user_id: string; display_name: string; is_active: boolean };
type ManageStaffResponse = { ok?: boolean; userId?: string; storeId?: string; error?: string; correlationId?: string };

const managementError = (code?: string) => {
  if (code === "LOGIN_IDENTIFIER_ALREADY_EXISTS") return "此門市已有相同登入身分。";
  if (code === "STORE_CODE_ALREADY_EXISTS") return "此門市代碼已被使用。";
  if (code === "MANAGER_PERMISSION_REQUIRED") return "目前帳號沒有管理此門市的權限。";
  if (code === "PIN_MUST_BE_SIX_DIGITS") return "PIN 必須是六位數字。";
  return "目前無法完成，請稍後再試。";
};

export default function StaffSettings({ stores, onWorkspaceChanged }: {
  stores: Store[];
  onWorkspaceChanged: () => Promise<void>;
}) {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [identities, setIdentities] = useState<StaffIdentity[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function loadStaff() {
    const userIds = new Set<string>();
    const { data: membershipData } = await supabase
      .from("store_memberships")
      .select("store_id,user_id,login_identifier,role,is_active")
      .in("store_id", stores.map(store => store.id));
    for (const row of membershipData ?? []) userIds.add(row.user_id);
    const { data: identityData } = userIds.size
      ? await supabase.from("staff_identities").select("user_id,display_name,is_active").in("user_id", [...userIds])
      : { data: [] };
    setMemberships(membershipData ?? []);
    setIdentities(identityData ?? []);
  }

  // The membership list is remote state and refreshes whenever authorized stores change.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void loadStaff(); }, [stores]);

  async function createStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setMessage("");
    const { data, error } = await supabase.functions.invoke<ManageStaffResponse>("manage-staff", {
      body: {
        action: "create_store",
        name: String(values.get("store_name") || "").trim(),
        storeCode: String(values.get("store_code") || "").trim().toUpperCase(),
        loginMode: "NAME_OR_NICKNAME",
      },
    });
    if (error || !data?.ok) setMessage(managementError(data?.error));
    else {
      form.reset();
      setMessage("隔離測試門市已建立。");
      await onWorkspaceChanged();
    }
    setBusy(false);
  }

  async function createStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const pin = String(values.get("pin") || "").replace(/\D/g, "");
    setBusy(true);
    setMessage("");
    const { data, error } = await supabase.functions.invoke<ManageStaffResponse>("manage-staff", {
      body: {
        action: "create",
        storeId: String(values.get("store_id") || ""),
        displayName: String(values.get("display_name") || "").trim(),
        loginIdentifier: String(values.get("login_identifier") || "").trim(),
        role: String(values.get("role") || "STAFF"),
        pin,
      },
    });
    if (error || !data?.ok) setMessage(managementError(data?.error));
    else {
      form.reset();
      setMessage("員工身分已建立，可使用門市代碼、登入身分與 PIN 登入。");
      await loadStaff();
    }
    setBusy(false);
  }

  return <section className="shell-section">
    <div className="shell-section-head"><h2>我的</h2><span>管理者設定</span></div>
    <article className="shell-card settings-card">
      <h3>建立隔離測試門市</h3>
      <p className="helper">門市代碼供員工快速登入使用；資料依門市權限隔離。</p>
      <form className="compact-form" onSubmit={createStore}>
        <label>門市名稱<input name="store_name" required /></label>
        <label>門市代碼<input name="store_code" pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,31}" autoCapitalize="characters" required /></label>
        <button disabled={busy}>建立門市</button>
      </form>
    </article>
    <article className="shell-card settings-card">
      <h3>建立員工登入身分</h3>
      <p className="helper">PIN 只會送到安全後端雜湊保存，建立後不會在此顯示。</p>
      <form className="compact-form" onSubmit={createStaff}>
        <label>門市<select name="store_id" required>{stores.map(store => <option key={store.id} value={store.id}>{store.name}（{store.store_code}）</option>)}</select></label>
        <label>顯示名稱<input name="display_name" required /></label>
        <label>登入身分<input name="login_identifier" required /></label>
        <label>權限<select name="role" defaultValue="STAFF"><option value="STAFF">員工</option><option value="SUPERVISOR">主管</option></select></label>
        <label>六位數 PIN<input name="pin" type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{6}" minLength={6} maxLength={6} required /></label>
        <button disabled={busy}>建立登入身分</button>
      </form>
    </article>
    {message && <p className="count-notice" role="status">{message}</p>}
    <article className="shell-card member-list">
      {memberships.length ? memberships.map(row => {
        const identity = identities.find(item => item.user_id === row.user_id);
        const store = stores.find(item => item.id === row.store_id);
        return <div className="member-row" key={`${row.store_id}:${row.user_id}`}>
          <span><strong>{identity?.display_name || row.login_identifier}</strong><small>{store?.name}｜{row.login_identifier}｜{row.role === "STAFF" ? "員工" : "主管"}</small></span>
          <b className="status">{row.is_active && identity?.is_active !== false ? "使用中" : "停用"}</b>
        </div>;
      }) : <p className="pilot-empty compact-empty">目前沒有可顯示的成員。</p>}
    </article>
  </section>;
}
