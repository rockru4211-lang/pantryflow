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
type ManageStaffResponse = {
  staffId?: string;
  storeId?: string;
  store?: { id: string };
  error?: string;
  correlationId?: string;
  login?: { storeCode: string; loginIdentifier: string; displayName: string; role: string; activationCode: string; expiresInDays: number };
};

const managementError = (code?: string) => {
  if (code === "STAFF_ALREADY_EXISTS") return "此門市已有相同登入帳號。";
  if (code === "STORE_CODE_ALREADY_EXISTS") return "此門市代碼已被使用。";
  if (["ADMIN_REQUIRED", "STORE_MEMBERSHIP_REQUIRED", "ROLE_NOT_ALLOWED"].includes(code || "")) {
    return "目前帳號沒有管理此門市的權限。";
  }
  if (code === "INVALID_STAFF_INPUT") return "請確認姓名與登入帳號格式。";
  return "目前無法完成，請稍後再試。";
};

export default function StaffSettings({ stores, canManageStores, onWorkspaceChanged }: {
  stores: Store[];
  canManageStores: boolean;
  onWorkspaceChanged: () => Promise<void>;
}) {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [identities, setIdentities] = useState<StaffIdentity[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState<ManageStaffResponse["login"]>();

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
    if (error || !data?.store?.id) setMessage(managementError(data?.error));
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
    setBusy(true);
    setMessage("");
    const { data, error } = await supabase.functions.invoke<ManageStaffResponse>("manage-staff", {
      body: {
        action: "create",
        storeId: String(values.get("store_id") || ""),
        displayName: String(values.get("display_name") || "").trim(),
        loginIdentifier: String(values.get("login_identifier") || "").trim(),
        role: String(values.get("role") || "STAFF"),
      },
    });
    if (error || !data?.staffId) setMessage(managementError(data?.error));
    else {
      form.reset();
      setReceipt(data.login);
      setMessage("帳號已建立，請將下方登入資料交給本人，由本人設定 PIN。");
      await loadStaff();
    }
    setBusy(false);
  }

  return <section className="shell-section">
    <div className="shell-section-head"><h2>我的</h2><span>管理者設定</span></div>
    {canManageStores && <article className="shell-card settings-card">
      <h3>建立隔離測試門市</h3>
      <p className="helper">門市代碼供員工快速登入使用；資料依門市權限隔離。</p>
      <form className="compact-form" onSubmit={createStore}>
        <label>門市名稱<input name="store_name" required /></label>
        <label>門市代碼<input name="store_code" pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,31}" autoCapitalize="characters" required /></label>
        <button disabled={busy}>建立門市</button>
      </form>
    </article>}
    <article className="shell-card settings-card">
      <h3>建立員工帳號</h3>
      <p className="helper">姓名供畫面顯示；登入帳號供登入使用；權限決定可操作的功能。PIN 由本人首次啟用時設定。</p>
      <form className="compact-form" onSubmit={createStaff}>
        <label>門市<select name="store_id" required>{stores.map(store => <option key={store.id} value={store.id}>{store.name}（{store.store_code}）</option>)}</select></label>
        <label>員工姓名<input name="display_name" required /></label>
        <label>登入帳號<input name="login_identifier" placeholder="例如 kitchen-01" maxLength={64} required /></label>
        <label>權限<select name="role" defaultValue="STAFF"><option value="STAFF">員工</option>{canManageStores && <option value="SUPERVISOR">主管</option>}</select></label>
        <button disabled={busy}>建立員工帳號</button>
      </form>
    </article>
    {receipt && <article className="shell-card settings-card login-receipt" aria-label="新帳號登入資料">
      <h3>請交給本人：首次登入資料</h3>
      <p>員工姓名：{receipt.displayName}</p><p>門市代碼：<b>{receipt.storeCode}</b></p>
      <p>登入帳號：<b>{receipt.loginIdentifier}</b></p><p>權限：{receipt.role === "STAFF" ? "員工" : "主管"}</p>
      <p>一次性啟用碼：<code style={{ overflowWrap: "anywhere" }}>{receipt.activationCode}</code></p>
      <p>請保存此頁資料。啟用碼 {receipt.expiresInDays} 天內有效，僅顯示這一次。</p>
      <p>登入首頁 → 門市帳號登入 → 首次使用，設定 PIN。本人輸入以上資料與自訂六位數 PIN，之後用門市代碼、登入帳號及 PIN 登入。</p>
    </article>}
    {message && <p className="count-notice" role="status">{message}</p>}
    <article className="shell-card member-list">
      {memberships.length ? memberships.map(row => {
        const identity = identities.find(item => item.user_id === row.user_id);
        const store = stores.find(item => item.id === row.store_id);
        return <div className="member-row" key={`${row.store_id}:${row.user_id}`}>
          <span><strong>{identity?.display_name || row.login_identifier}</strong><small>{store?.name}｜登入帳號：{row.login_identifier}｜權限：{row.role === "STAFF" ? "員工" : row.role === "ADMIN" ? "管理員" : "主管"}</small></span>
          <b className="status">{row.is_active && identity?.is_active !== false ? "使用中" : "停用"}</b>
        </div>;
      }) : <p className="pilot-empty compact-empty">目前沒有可顯示的成員。</p>}
    </article>
  </section>;
}
