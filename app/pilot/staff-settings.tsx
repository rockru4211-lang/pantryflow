"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import {roleLabel,type AppRole} from '@/lib/app-workspace';
import {memberProvisionSucceeded} from '@/lib/member-provision-result';

type Store = { id: string; name: string; store_code: string; staff_login_mode?: string };
type Membership = {
  store_id: string;
  user_id: string;
  login_identifier: string;
  role: string;
  is_active: boolean;
};
type StaffIdentity = { user_id: string; display_name: string; is_active: boolean };
type ManageStaffResponse = {
  inviteId?: string;
  pending?: boolean;
  verificationSent?: boolean;
  staffId?: string;
  storeId?: string;
  store?: { id: string };
  error?: string;
  correlationId?: string;
  email?: string;
  invited?: boolean;
  existing?: boolean;
  login?: { storeCode: string; loginIdentifier: string; displayName: string; role: string; activationCode: string; expiresInDays: number };
};

const managementError = (code?: string) => {
  if (code === "STAFF_ALREADY_EXISTS") return "此門市已有相同登入帳號。";
  if (code === "STORE_CODE_ALREADY_EXISTS") return "此門市代碼已被使用。";
  if (["ADMIN_REQUIRED", "STORE_MEMBERSHIP_REQUIRED", "ROLE_NOT_ALLOWED"].includes(code || "")) {
    return "目前帳號沒有管理此門市的權限。";
  }
  if (code === "INVALID_STAFF_INPUT") return "請確認姓名與登入帳號格式。";
  if (code === "MEMBER_OTHER_ORGANIZATION") return "此帳號已屬於另一個商家，請確認邀請的 Email。既有商家資料未變更。";
  if (code === "over_email_send_rate_limit") return "寄信服務暫時達到上限，邀請資料已保留，請稍後重寄。";
  if (code === "INVALID_INVITE") return "請確認管理成員的姓名、Email 與門市權限。";
  return "目前無法完成，請稍後再試。";
};

export default function StaffSettings({ stores, canManageStores, onWorkspaceChanged, businessType='SINGLE_RESTAURANT', createOnly=false }: {
  stores: Store[];
  canManageStores: boolean;
  onWorkspaceChanged: () => Promise<void>;
  businessType?: string;
  createOnly?: boolean;
}) {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [identities, setIdentities] = useState<StaffIdentity[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState<ManageStaffResponse["login"]>();
  const [createRole,setCreateRole]=useState<AppRole>('STAFF');
  const usesEmployeeNumber=stores[0]?.staff_login_mode==='EMPLOYEE_NUMBER';

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
        storeId: stores[0]?.id,
        name: String(values.get("store_name") || "").trim(),
        storeCode: String(values.get("store_code") || "").trim().toUpperCase(),
        loginMode: "NAME_OR_NICKNAME",
      },
    });
    if (error || !data?.store?.id) setMessage(managementError(data?.error));
    else {
      form.reset();
      setMessage("門市已建立。");
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
        action: createRole==='STAFF'?"create":"invite_management",
        storeId: String(values.get("store_id") || ""),
        displayName: String(values.get("display_name") || "").trim(),
        loginIdentifier: String(values.get(usesEmployeeNumber?"login_identifier":"display_name") || "").trim(),
        role: String(values.get("role") || "STAFF"),
        email: String(values.get('email')||'').trim(),
      },
    });
    if (error || !data || !memberProvisionSucceeded(createRole,data)) {
      let detail=data;
      if(error&&'context' in error&&error.context instanceof Response)try{detail=await error.context.json();}catch{}
      setMessage(managementError(detail?.error));
    }
    else {
      form.reset();
      setReceipt(data.login);
      setMessage(data.pending?"邀請已保留，請稍後再寄；本人可沿用原帳號登入並確認加入。":data.verificationSent?`已寄出驗證信至 ${data.email}，請本人完成驗證後沿用原帳號登入。`:data.invited?`已寄出商家邀請信至 ${data.email}。本人點信中連結後，使用個人帳號確認加入此商家。已有帳號可直接登入接受邀請。`:data.existing?`邀請已保留：${data.email}，請本人登入確認加入。`:"帳號已建立，請將下方登入資料交給本人，由本人設定 PIN。");
      await loadStaff();
      await onWorkspaceChanged();
    }
    setBusy(false);
  }

  return <section className="shell-section">
    <div className="shell-section-head"><h2>員工與權限</h2><span>管理者設定</span></div>
    {canManageStores && !createOnly && <details className="setup-panel"><summary>門市管理</summary><article className="shell-card settings-card">
      <h3>新增門市</h3>
      <p className="helper">門市代碼供員工快速登入使用；資料依門市權限隔離。</p>
      <form className="compact-form" onSubmit={createStore}>
        <label>門市名稱<input name="store_name" required /></label>
        <label>門市代碼<input name="store_code" pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,31}" autoCapitalize="characters" required /></label>
        <button disabled={busy}>建立門市</button>
      </form>
    </article></details>}
    <article className="shell-card settings-card">
      <h3>新增成員</h3>
      <p className="helper">{createRole==='STAFF'?`${usesEmployeeNumber?'以員工編號登入；姓名供畫面顯示。':'以畫面提供的姓名／暱稱登入。'}PIN 由本人首次啟用時設定。`:'管理成員使用自己的 Email 與密碼登入，姓名供畫面顯示。'}</p>
      <form className="compact-form" onSubmit={createStaff}>
        <label>門市<select name="store_id" required>{stores.map(store => <option key={store.id} value={store.id}>{store.name}（{store.store_code}）</option>)}</select></label>
        <label>{usesEmployeeNumber?'員工姓名':'姓名／暱稱'}<input name="display_name" maxLength={64} required /></label>
        {usesEmployeeNumber&&createRole==='STAFF'&&<label>員工編號<input name="login_identifier" maxLength={64} required /></label>}
        <label>工作身分<select name="role" value={createRole} onChange={e=>setCreateRole(e.target.value as AppRole)}><option value="STAFF">員工</option>{canManageStores && (['SUPERVISOR','LOGISTICS','OWNER'] as const).map(role=><option key={role} value={role}>{roleLabel(role,businessType)}</option>)}</select></label>
        {createRole!=='STAFF'&&<label>管理帳號 Email<input name="email" type="email" autoComplete="off" autoCapitalize="none" required/></label>}
        <button disabled={busy}>{createRole==='STAFF'?'建立員工帳號':'邀請管理成員'}</button>
      </form>
    </article>
    {receipt && <article className="shell-card settings-card login-receipt" aria-label="新帳號登入資料">
      <h3>請交給本人：首次登入資料</h3>
      <p>員工姓名：{receipt.displayName}</p><p>門市代碼：<b>{receipt.storeCode}</b></p>
      <p>登入識別（{usesEmployeeNumber?'員工編號':'姓名／暱稱'}）：<b>{receipt.loginIdentifier}</b></p><p>權限：{roleLabel(receipt.role as AppRole,businessType)}</p>
      <p>一次性啟用碼：<code style={{ overflowWrap: "anywhere" }}>{receipt.activationCode}</code></p>
      <p>請保存此頁資料。啟用碼 {receipt.expiresInDays} 天內有效，僅顯示這一次。</p>
      <p>登入首頁 → 員工快速登入 → 輸入門市代碼 → 輸入登入識別 → 首次使用，設定 PIN。本人使用以上啟用碼設定六位數 PIN，之後用自己的 PIN 登入。</p>
    </article>}
    {message && <p className="count-notice" role="status">{message}</p>}
    {!createOnly&&<article className="shell-card member-list">
      {memberships.length ? memberships.map(row => {
        const identity = identities.find(item => item.user_id === row.user_id);
        const store = stores.find(item => item.id === row.store_id);
        return <div className="member-row" key={`${row.store_id}:${row.user_id}`}>
          <span><strong>{identity?.display_name || row.login_identifier}</strong><small>{store?.name}｜登入帳號：{row.login_identifier}｜權限：{row.role === "STAFF" ? "員工" : row.role === "ADMIN" ? "管理員" : "主管"}</small></span>
          <b className="status">{row.is_active && identity?.is_active !== false ? "使用中" : "停用"}</b>
        </div>;
      }) : <p className="pilot-empty compact-empty">目前沒有可顯示的成員。</p>}
    </article>}
  </section>;
}
