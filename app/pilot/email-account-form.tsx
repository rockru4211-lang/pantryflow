"use client";

import type { FormEvent } from "react";
import type { MailStatus } from "@/lib/auth-email";

export function MailNotice({ status, seconds }: { status: MailStatus; seconds: number }) {
  if (!status.message && seconds <= 0) return null;
  return <div aria-live="polite">
    {status.message && <p className="pilot-message" role={status.state === "error" ? "alert" : "status"}>{status.message}</p>}
    {seconds > 0 && <p className="auth-footnote">{seconds} 秒後可再次寄送。</p>}
  </div>;
}

export default function EmailAccountForm({ mode, email, password, awaiting, recipientLocked, busy, seconds, mail,
  onEmailChange, onPasswordChange, onSubmit, onEditEmail,
}: {
  mode: "login" | "signup";
  email: string; password: string; awaiting: boolean; recipientLocked: boolean; busy: boolean; seconds: number; mail: MailStatus;
  onEmailChange: (value: string) => void; onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void; onEditEmail: () => void;
}) {
  const signup = mode === "signup";
  return <form key={`account-${mode}`} id={`account-${mode}`} className="admin-login-form" onSubmit={onSubmit}>
    <label className="field" htmlFor={`${mode}-email`}>Email
      <input key={`${mode}-email`} id={`${mode}-email`} name="email" value={email} onChange={event => onEmailChange(event.target.value)}
        type="email" autoComplete={`section-${mode} email`} autoCapitalize="none" spellCheck={false} readOnly={signup && recipientLocked} required />
    </label>
    <label className="field" htmlFor={`${mode}-password`}>密碼
      <input key={`${mode}-password`} id={`${mode}-password`} name="password" value={password} onChange={event => onPasswordChange(event.target.value)}
        type="password" minLength={8} autoComplete={`section-${mode} ${signup ? "new-password" : "current-password"}`} readOnly={signup && awaiting} required={!signup || !awaiting} />
    </label>
    {signup && <MailNotice status={mail} seconds={seconds} />}
    <button className="primary" disabled={busy || (signup && seconds > 0)}>
      {busy ? "處理中…" : !signup ? "登入" : awaiting ? "重新寄送驗證信" : "寄送驗證信"}
    </button>
    {signup && awaiting && <button className="text-button full-button" type="button" disabled={busy} onClick={onEditEmail}>修改 Email</button>}
  </form>;
}
