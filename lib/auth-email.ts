import type { SupabaseClient } from "@supabase/supabase-js";
import { authErrorMessage, authRedirect } from "./auth-flow";

export type MailStatus = { state: "idle" | "accepted" | "error"; message: string; retryAt: number };
export const emptyMailStatus: MailStatus = { state: "idle", message: "", retryAt: 0 };
export const signupDraftKey = "pantryflow:signup-mail";
export const recoveryDraftKey = "pantryflow:recovery-mail";
export function remainingMailSeconds(status: MailStatus, now: number) { return Math.max(0, Math.ceil((status.retryAt - now) / 1000)); }

export function mailResult(error: { message?: string; code?: string; status?: number } | null, flow: "signup" | "recovery", now = Date.now()): MailStatus {
  if (error) {
    const rateLimited = error.status === 429 || /rate_limit/.test(error.code || "") || /rate limit|security purposes/i.test(error.message || "");
    const seconds = Number(error.message?.match(/after (\d+) seconds/i)?.[1]) || 60;
    return { state: "error", message: authErrorMessage(error, flow), retryAt: rateLimited ? now + Math.min(3600, seconds) * 1000 : 0 };
  }
  return {
    state: "accepted", retryAt: now + 60000,
    message: flow === "recovery"
      ? "重設請求已提交。若此 Email 有可重設的帳號，將收到重設信；請點信中連結設定新密碼。"
      : "驗證信寄送請求已提交。若此 Email 尚待驗證，請到信箱點開最新驗證連結，返回 App 繼續。請一併查看垃圾郵件；已驗證的帳號請返回管理登入，或使用忘記密碼。",
  };
}

// Recovery and confirmation deliberately use separate endpoints and state.
export async function requestAuthEmail(auth: Pick<SupabaseClient["auth"], "resend" | "resetPasswordForEmail">, flow: "signup" | "recovery", email: string) {
  try {
    const { error } = flow === "recovery"
      ? await auth.resetPasswordForEmail(email.trim(), { redirectTo: authRedirect("recovery") })
      : await auth.resend({ type: "signup", email: email.trim(), options: { emailRedirectTo: authRedirect("signup") } });
    return mailResult(error, flow);
  } catch { return { ...emptyMailStatus, state: "error" as const, message: "本次未完成寄送，請確認網路連線後重試。" }; }
}

export type MailDraft = { email: string; awaiting: boolean; mail: MailStatus };
export function readMailDraft(value: string | null): MailDraft | null {
  try {
    const d = JSON.parse(value || "null");
    if (!d || typeof d.email !== "string" || typeof d.awaiting !== "boolean" || !["idle", "accepted", "error"].includes(d.mail?.state) || typeof d.mail?.message !== "string" || !Number.isFinite(d.mail?.retryAt)) return null;
    return d;
  } catch { return null; }
}
