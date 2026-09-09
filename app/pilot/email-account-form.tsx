"use client";

import { useRef, type FormEvent } from "react";
import type { MailStatus } from "@/lib/auth-email";

export function MailNotice({ status, seconds }: { status: MailStatus; seconds: number }) {
  if (!status.message && seconds <= 0) return null;
  return <div aria-live="polite">
    {status.message && <p className="pilot-message" role={status.state === "error" ? "alert" : "status"}>{status.message}</p>}
    {seconds > 0 && <p className="auth-footnote">{seconds} 秒後可再次寄送。</p>}
  </div>;
}

export default function EmailAccountForm({ mode, email, password, awaiting, recipientLocked, busy, seconds, mail,
  onEmailChange, onPasswordChange, onSubmit, onEditEmail, code, codeError, onCodeChange, onVerify,
}: {
  mode: "login" | "signup";
  email: string; password: string; awaiting: boolean; recipientLocked: boolean; busy: boolean; seconds: number; mail: MailStatus;
  onEmailChange: (value: string) => void; onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void; onEditEmail: () => void;
  code: string; codeError: string; onCodeChange: (value: string) => void; onVerify: (email: string, code: string) => void;
}) {
  const signup = mode === "signup";
  const accountForm = useRef<HTMLFormElement>(null);
  function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const emailInput = accountForm.current?.elements.namedItem("email") as HTMLInputElement | null;
    // Verify only the email and code; an already-issued code must not require a
    // password or another send request. FormData also reads browser autofill.
    if (!emailInput?.reportValidity()) return;
    const enteredCode = String(new FormData(event.currentTarget).get("email_verification_code") || "");
    onVerify(emailInput.value.trim(), enteredCode);
  }
  return <><form ref={accountForm} key={`account-${mode}`} id={`account-${mode}`} className="admin-login-form" onSubmit={onSubmit}>
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
  </form>
    {signup && <form key="signup-code-form" id="signup-code-form" className="admin-login-form" onSubmit={verify}>
      <label className="field" htmlFor="signup-email-code">Email 驗證碼
        <input key="signup-email-code" id="signup-email-code" name="email_verification_code" type="text"
          inputMode="numeric" autoComplete="section-signup-code one-time-code" autoCapitalize="none" spellCheck={false}
          value={code} onChange={event => onCodeChange(event.target.value)} pattern="[0-9]{6,10}" minLength={6} maxLength={10}
          aria-invalid={!!codeError} aria-describedby={codeError ? "signup-code-error" : undefined} required />
      </label>
      {codeError && <p id="signup-code-error" className="pilot-message" role="alert">{codeError}</p>}
      <button className="primary" type="submit" disabled={busy}>{busy ? "處理中…" : "驗證並繼續"}</button>
      <p className="auth-footnote">已有驗證碼可直接驗證，不需重新寄送。</p>
    </form>}
  </>;
}
