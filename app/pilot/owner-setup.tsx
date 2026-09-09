"use client";

import { useRef, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase-browser";
import { ownerSetupError, parseOwnerSetup, type OwnerSetup, type OwnerSetupDraft } from "@/lib/owner-setup";
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
  async function save(action: string) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const { data, error: failure } = await supabase.rpc("owner_setup", { p_action: action, p_data: draft, p_revision: progress.revision });
      if (failure) throw failure;
      const next = parseOwnerSetup(data);
      if (!next.required) { await onComplete(); return; }
      setProgress(next); setDraft(next.draft);
    } catch (failure) { setError(ownerSetupError(failure instanceof Error ? failure.message : String((failure as { message?: string })?.message || ""))); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void save(step === "manager" ? "complete" : step); }
  const active = step === "business" ? 2 : step === "store" ? 3 : 4;
  return <AuthShell><section className="admin-login-stage"><div className="admin-login-frame"><AuthTopbar /><div className="admin-login-content">
    {step !== "business" && <button className="auth-back link" type="button" disabled={busy} onClick={() => void save(step === "store" ? "back_business" : "back_store")}>‹ {step === "store" ? "返回建立商家" : "返回門市設定"}</button>}
    <div className="registration-steps" aria-label="建立新商家步驟">{["帳號", "商家", "門市", "管理者"].map((label, index) => <span key={label} className={index + 1 <= active ? "active" : ""} aria-current={index + 1 === active ? "step" : undefined}><b>{index + 1}</b><small>{label}</small></span>)}</div>
    <div className="admin-login-heading">
      {step === "business" && <p className="eyebrow">Email 已驗證</p>}
      <h1>{step === "business" ? "建立商家" : step === "store" ? "建立第一間門市" : "確認第一位管理者"}</h1>
      <p>{step === "business" ? "設定品牌、餐廳類型與門市數量。" : step === "store" ? "門市代碼會提供員工快速登入使用。" : "第一位管理者就是目前已驗證帳號。"}</p>
    </div>
    {step === "manager" && <><article className="confirm-card manager-confirm"><span aria-hidden="true">管</span><strong>{displayName || "管理者"}</strong><small>{email}｜Owner／管理者<br />{draft.organization_name}｜{draft.store_name}</small></article>
      <section className="business-setup-summary"><div><span>餐廳類型</span><strong>{draft.business_type === "CHAIN_RESTAURANT" ? "連鎖餐飲" : "獨立餐廳"}</strong></div><div><span>門市數量</span><strong>{draft.store_mode === "MULTI" ? "多家門市" : "單一門市"}</strong></div><div><span>第一間門市</span><strong>{draft.store_name}</strong></div><div><span>門市代碼</span><strong>{draft.store_code}</strong></div></section></>}
    <form key={step} id={`owner-${step}`} className="admin-login-form" onSubmit={submit}>
      {step === "business" && <>
        <label className="field">餐廳／品牌名稱<input name="organization_name" value={draft.organization_name} onChange={event => change("organization_name", event.target.value)} maxLength={160} required /></label>
        <fieldset className="business-option-set"><legend>餐廳類型</legend><p>系統會自動安排完成後的現場流程。</p><div>
          <label><input type="radio" name="business_type" value="SINGLE_RESTAURANT" checked={draft.business_type === "SINGLE_RESTAURANT"} onChange={event => change("business_type", event.target.value)} required /><span><strong>獨立餐廳</strong><small>由序串連日常現場紀錄</small></span></label>
          <label><input type="radio" name="business_type" value="CHAIN_RESTAURANT" checked={draft.business_type === "CHAIN_RESTAURANT"} onChange={event => change("business_type", event.target.value)} /><span><strong>連鎖餐飲</strong><small>配合公司既有作業流程</small></span></label>
        </div></fieldset>
        <fieldset className="business-option-set"><legend>門市數量</legend><p>只影響門市、組織權限與跨店管理。</p><div>
          <label><input type="radio" name="store_mode" value="SINGLE" checked={draft.store_mode === "SINGLE"} onChange={event => change("store_mode", event.target.value)} required /><span><strong>單一門市</strong><small>目前只有一間店</small></span></label>
          <label><input type="radio" name="store_mode" value="MULTI" checked={draft.store_mode === "MULTI"} onChange={event => change("store_mode", event.target.value)} /><span><strong>多家門市</strong><small>管理兩間以上門市</small></span></label>
        </div></fieldset>
      </>}
      {step === "store" && <>
        <label className="field">門市名稱<input name="store_name" value={draft.store_name} onChange={event => change("store_name", event.target.value)} maxLength={160} required /></label>
        <label className="field">門市代碼<input name="store_code" value={draft.store_code} onChange={event => change("store_code", event.target.value.toUpperCase())} autoCapitalize="characters" pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,31}" maxLength={32} required /></label>
        <label className="field">員工登入方式<select name="staff_login_mode" value={draft.staff_login_mode} onChange={event => change("staff_login_mode", event.target.value)}><option value="NAME_OR_NICKNAME">姓名／暱稱</option><option value="EMPLOYEE_NUMBER">員工編號</option></select></label>
      </>}
      {error && <p className="pilot-message" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={busy}>{busy ? "儲存中…" : step === "manager" ? "完成設定並進入序" : "下一步"}</button>
    </form>
    {step === "business" && <button className="secondary full-button" type="button" disabled={busy} onClick={() => void onSignOut()}>登出</button>}
  </div></div></section></AuthShell>;
}
