// Only the deployed App is an authentication return destination. Never accept a
// user-supplied next/redirect URL or a development origin from an email request.
export const AUTH_APP_URL = "https://pantryflow-app-shell-preview.rockru4211.chatgpt.site/";
export type AuthFlow = "recovery" | "signup" | "google";
export const authRedirect = (flow: AuthFlow) => `${AUTH_APP_URL}?auth=${flow}`;

export function readAuthCallback(href: string) {
  const url = new URL(href, AUTH_APP_URL);
  const hash = new URLSearchParams(url.hash.slice(1));
  const type = hash.get("type") || url.searchParams.get("type");
  const requested = url.searchParams.get("auth");
  const flow: AuthFlow | null = type === "recovery" ? "recovery"
    : type === "signup" || type === "email" ? "signup"
    : requested === "recovery" || requested === "signup" || requested === "google" ? requested : null;
  return {
    flow,
    // The SDK validates these credentials. This flag alone never grants a session.
    hasCredentials: Boolean(hash.get("access_token") && hash.get("refresh_token")),
    hasCode: url.searchParams.has("code"),
    error: hash.get("error_code") || hash.get("error") || url.searchParams.get("error_code") || url.searchParams.get("error") || null,
    isCallback: Boolean(flow || hash.has("access_token") || url.searchParams.has("code") || hash.has("error") || hash.has("error_code") || url.searchParams.has("error")),
  };
}

export function cleanAuthUrl(href: string) {
  const url = new URL(href);
  for (const key of ["auth", "code", "type", "error", "error_code", "error_description", "flow_id"]) url.searchParams.delete(key);
  url.hash = "";
  return url.pathname + url.search;
}

export function authErrorMessage(error: { code?: string; message?: string }, flow?: AuthFlow | null) {
  const code = error.code || "";
  const message = error.message || "";
  if (code === "email_address_invalid" || /invalid format|Unable to validate email address/i.test(message)) return "Email 格式不正確，請確認後再試。";
  if (code === "access_denied" && flow === "google") return "已取消 Google 登入，您可以重新選擇登入方式。";
  if (code === "email_address_not_authorized" || /Email address not authorized/i.test(message)) return "寄信服務尚未開放一般信箱，請聯絡管理者完成寄信設定。";
  if (code === "over_email_send_rate_limit" || /email rate limit/i.test(message)) return "寄信服務已達寄送上限，本次未寄出。服務未提供恢復時間；若持續失敗，請聯絡管理者完成寄信設定。";
  if (code === "over_request_rate_limit" || /rate limit|security purposes/i.test(message)) return "請稍候再試，寄送請求過於頻繁。";
  if (code === "email_not_confirmed" || /Email not confirmed/i.test(message)) return "Email 尚未驗證，請到信箱點開驗證信，或在此重新寄送。";
  if (code === "provider_disabled" || /provider is not enabled|unsupported provider/i.test(message)) return "Google 登入尚未完成設定，請先使用 Email 與密碼登入。";
  if (code === "same_password") return "新密碼不能與原密碼相同。";
  if (code === "weak_password") return "新密碼不符合安全要求，請使用至少 8 個字元並增加英文字母與數字。";
  if (code === "otp_expired" || code === "flow_state_expired" || /expired|invalid.*token|Token.*invalid/i.test(message)) return flow === "recovery" ? "重設連結已過期或已使用，請重新寄送重設信。" : flow === "signup" ? "驗證連結已過期或已使用，請在此重新寄送，或返回登入。" : "登入連結已過期或已使用。重設密碼請選「忘記密碼」，註冊驗證請回「建立新商家」重新寄送。";
  if (code === "invalid_credentials" || /Invalid login credentials/i.test(message)) return "Email 或密碼不正確。";
  if (code === "user_already_exists" || /User already registered/i.test(message)) return "此 Email 已註冊，請返回登入或使用忘記密碼。";
  if (code === "unexpected_failure" || /sending.*email/i.test(message)) return "寄信服務目前無法完成寄送，請稍後重試；若持續失敗，請聯絡管理者。";
  if (flow === "google") return "Google 登入未完成，請重新登入。";
  return "目前無法完成，請確認網路連線後再試。";
}

export type RecoveryContext = { userId: string; expiresAt: number };
export const RECOVERY_STORAGE_KEY = "pantryflow:password-recovery";
export function validRecoveryContext(value: string | null, userId?: string, now = Date.now()): boolean {
  if (!value || !userId) return false;
  try {
    const parsed = JSON.parse(value) as RecoveryContext;
    return parsed.userId === userId && Number.isFinite(parsed.expiresAt) && parsed.expiresAt > now && parsed.expiresAt <= now + 60 * 60 * 1000;
  } catch { return false; }
}
