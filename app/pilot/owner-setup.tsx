"use client";

import { useRef, useState, type FormEvent } from "react";
import { roleLabel, type AppRole } from "@/lib/app-workspace";
import { supabase } from "@/lib/supabase-browser";
import { ownerSetupError, parseOwnerSetup, type OwnerSetup, type OwnerSetupDraft } from "@/lib/owner-setup";
import { BAIHUAYUAN_NAME } from "@/lib/baihuayuan";
import { AuthShell, AuthTopbar } from "./app-shell";

// Reuses the approved preview's three existing registration panels and CSS.
// Only the final manager confirmation creates/completes canonical records.
export default function OwnerSetupFlow({ initial, email, displayName, onComplete, onSignOut }: {
  initial: OwnerSetup; email: string; displayName: string | null;
  onComplete: () => Promise<void>; onSignOut: () => Promise<void>;
}) {
  const [progress, setProgress] = useState(initial);
  const [draft, setDraft] = useState(initial.draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const step = progress.step;
  const change = (field: keyof OwnerSetupDraft, value: string) => setDraft(current => ({ ...current, [field]: value }));
  async function save(action: string, nextDraft = draft) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    const scopedDraft={...nextDraft,organization_name:BAIHUAYUAN_NAME,business_type:"SINGLE_RESTAURANT",store_mode:"MULTI"};
    try {
      const { data, error: failure } = await supabase.rpc("owner_setup", { p_action: action, p_data: scopedDraft, p_revision: progress.revision });
      if (failure) throw failure;
      const next = parseOwnerSetup(data);
      if (!next.required) { await onComplete(); return; }
      setProgress(next); setDraft({...next.draft,organization_name:BAIHUAYUAN_NAME,business_type:"SINGLE_RESTAURANT",store_mode:"MULTI"});
    } catch (failure) { setError(ownerSetupError(failure instanceof Error ? failure.message : String((failure as { message?: string })?.message || ""))); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void save(step === "manager" ? "complete" : step); }
  const active = step === "business" ? 2 : step === "store" ? 3 : 4;
  return <AuthShell><section className="admin-login-stage"><div className="admin-login-frame"><AuthTopbar /><div className="admin-login-content">
    {step !== "business" && <button className="auth-back link" type="button" disabled={busy} onClick={() => void save(step === "store" ? "back_business" : "back_store")}>‹ {step === "store" ? "返回建立商家" : "返回門市設定"}</button>}
    <div className="registration-steps" aria-label="建立新商家步驟">{["帳號", "商家", "門市", "工作身分"].map((label, index) => <span key={label} className={index + 1 <= active ? "active" : ""} aria-current={index + 1 === active ? "step" : undefined}><b>{index + 1}</b><small>{label}</small></span>)}</div>
    <div className="admin-login-heading">
      {step === "business" && <p className="eyebrow">Email 已驗證</p>}
      <h1>{step === "business" ? "百花猿系統設定" : step === "store" ? "建立門市" : "選擇工作身分"}</h1>
      <p>{step === "business" ? "百花猿固定使用獨立餐廳、多門市架構。" : step === "store" ? "建立 BeApe 或 Gras；門市代碼提供現場登入。" : "選擇管理端工作身分；現場主管與員工由行政建立。"}</p>
    </div>
    {step === "manager" && <><article className="confirm-card manager-confirm"><span aria-hidden="true">管</span><strong>{displayName || "管理者"}</strong><small>{email}<br />{draft.organization_name}｜{draft.store_name}</small></article>
      <section className="business-setup-summary"><div><span>餐廳類型</span><strong>{draft.business_type === "CHAIN_RESTAURANT" ? "連鎖餐飲" : "獨立餐廳"}</strong></div><div><span>門市數量</span><strong>{draft.store_mode === "MULTI" ? "多家門市" : "單一門市"}</strong></div><div><span>第一間門市</span><strong>{draft.store_name}</strong></div><div><span>門市代碼</span><strong>{draft.store_code}</strong></div></section></>}
    <form key={step} id={`owner-${step}`} className="admin-login-form" onSubmit={submit}>
      {step === "business" && <section className="shell-card settings-card"><strong>{BAIHUAYUAN_NAME}</strong><p>獨立餐廳・多門市・無 ERP</p><small>門市固定為 BeApe／Gras，系統不提供連鎖餐飲模式切換。</small></section>}
      {step === "store" && <>
        <label className="field">門市名稱<select name="store_name" value={draft.store_name} onChange={event => change("store_name", event.target.value)} required><option value="">選擇門市</option><option value="BeApe">BeApe</option><option value="Gras">Gras</option></select></label>
        <label className="field">門市代碼<input name="store_code" value={draft.store_code} onChange={event => change("store_code", event.target.value.toUpperCase())} autoCapitalize="characters" pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,31}" maxLength={32} required /></label>
        <label className="field">員工登入方式<select name="staff_login_mode" value={draft.staff_login_mode} onChange={event => change("staff_login_mode", event.target.value)}><option value="NAME_OR_NICKNAME">姓名／暱稱</option><option value="EMPLOYEE_NUMBER">員工編號</option></select></label>
      </>}
      {step === "manager" && <fieldset className="business-option-set" disabled={busy}><legend>管理端身分</legend><div>{(['LOGISTICS','OWNER'] as AppRole[]).map(role => <label key={role}><input type="radio" name="work_role" value={role} checked={draft.work_role===role} required onChange={()=>{const next={...draft,work_role:role};setDraft(next);void save('identity',next);}}/><span><strong>{roleLabel(role,'SINGLE_RESTAURANT')}</strong></span></label>)}</div></fieldset>}
      {error && <p className="pilot-message" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={busy}>{busy ? "儲存中…" : step === "manager" ? "完成設定並進入百花猿" : "下一步"}</button>
    </form>
    {step === "business" && <button className="secondary full-button" type="button" disabled={busy} onClick={() => void onSignOut()}>登出</button>}
  </div></div></section></AuthShell>;
}
