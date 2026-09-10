import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { RECOVERY_STORAGE_KEY, validRecoveryContext, type readAuthCallback } from "./auth-flow";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
export function rememberRecovery(storage: Storage, session: Session) {
  try { storage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify({ userId: session.user.id, expiresAt: Date.now() + 60 * 60 * 1000 })); } catch { /* The open recovery screen still works without storage. */ }
}
export function clearRecovery(storage: Storage) {
  try { storage.removeItem(RECOVERY_STORAGE_KEY); } catch { /* Private browsing. */ }
}
export async function initializeAppAuth(
  auth: Pick<SupabaseClient["auth"], "initialize" | "getSession">,
  callback: ReturnType<typeof readAuthCallback> | null,
  storage: Storage,
) {
  const initialized = await auth.initialize();
  const { data, error } = await auth.getSession();
  const session = data.session;
  const callbackError = callback?.error || initialized.error?.code || (initialized.error ? "callback_failed" : null);
  // Never reinterpret an old signed-in session as proof of a new recovery link.
  if (callback?.isCallback && (callbackError || error || !callback.hasCredentials || !session)) {
    return { session, recovery: false, callbackFailed: true, error: callbackError || "otp_expired" };
  }
  if ((callback?.flow === "recovery" || callback?.flow === "invite") && session) {
    rememberRecovery(storage, session);
    return { session, recovery: true, callbackFailed: false, error: null };
  }
  if (callback?.isCallback && session) clearRecovery(storage);
  let recovery = false;
  try { recovery = validRecoveryContext(storage.getItem(RECOVERY_STORAGE_KEY), session?.user.id); } catch { /* Private browsing. */ }
  return { session, recovery, callbackFailed: false, error: error?.code || null };
}
