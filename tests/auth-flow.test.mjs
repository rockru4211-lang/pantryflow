import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { AUTH_APP_URL, authRedirect, readAuthCallback, cleanAuthUrl, authErrorMessage, validRecoveryContext, RECOVERY_STORAGE_KEY } from "../lib/auth-flow.ts";

const vite = await createServer({ configFile: false, appType: "custom", cacheDir: "node_modules/.vite/auth-tests", server: { middlewareMode: true } });
after(() => vite.close());
const { initializeAppAuth, clearRecovery } = await vite.ssrLoadModule("/lib/auth-bootstrap.ts");
const memory = () => { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }; };
const session = { user: { id: "verified-user" } };
const auth = (active = session, error = null) => ({ initialize: async () => ({ error }), getSession: async () => ({ data: { session: active }, error: null }) });
const callback = type => readAuthCallback(`${AUTH_APP_URL}?auth=${type}#access_token=test&refresh_token=test&type=${type}`);

test("email and Google callbacks always return to the original App", () => {
  for (const type of ["signup", "recovery", "google"]) assert.equal(new URL(authRedirect(type)).origin, new URL(AUTH_APP_URL).origin);
  assert.equal(readAuthCallback(`${AUTH_APP_URL}?next=https://attacker.example`).flow, null);
});
test("callback cleanup removes tokens, errors and codes from browser history", () => {
  assert.equal(cleanAuthUrl(`${AUTH_APP_URL}?auth=recovery&error_description=secret&code=secret&keep=1#access_token=secret`), "/?keep=1");
});
test("validated recovery link opens password reset before workspace or onboarding", async () => {
  const storage = memory();
  const result = await initializeAppAuth(auth(), callback("recovery"), storage);
  assert.equal(result.recovery, true);
  assert.equal(result.callbackFailed, false);
  assert.equal(result.session.user.id, "verified-user");
  assert.ok(validRecoveryContext(storage.getItem(RECOVERY_STORAGE_KEY), "verified-user"));
});
test("reopening the App resumes a recovery only for its verified user", async () => {
  const storage = memory();
  await initializeAppAuth(auth(), callback("recovery"), storage);
  assert.equal((await initializeAppAuth(auth(), null, storage)).recovery, true);
  assert.equal((await initializeAppAuth(auth({ user: { id: "another-user" } }), null, storage)).recovery, false);
  clearRecovery(storage);
  assert.equal((await initializeAppAuth(auth(), null, storage)).recovery, false);
});
test("a recovery query alone cannot reuse an old normal session as a reset link", async () => {
  const result = await initializeAppAuth(auth(), readAuthCallback(authRedirect("recovery")), memory());
  assert.equal(result.recovery, false);
  assert.equal(result.callbackFailed, true);
});
test("invalid SDK credentials never become a recovery session", async () => {
  const result = await initializeAppAuth(auth(session, { code: "bad_jwt" }), callback("recovery"), memory());
  assert.equal(result.recovery, false);
  assert.equal(result.callbackFailed, true);
});
test("expired and reused links stay recoverable even with an existing session", async () => {
  const result = await initializeAppAuth(auth(), readAuthCallback(`${authRedirect("recovery")}#error=access_denied&error_code=otp_expired`), memory());
  assert.equal(result.callbackFailed, true);
  assert.equal(result.recovery, false);
  assert.equal(result.session, session);
  assert.match(authErrorMessage({ code: result.error }, "recovery"), /重新寄送重設信/);
});
test("a failed callback with no authenticated session cannot pass signup", async () => {
  const result = await initializeAppAuth(auth(null), callback("signup"), memory());
  assert.equal(result.callbackFailed, true);
  assert.equal(result.session, null);
});
test("Google and signup use the SDK identity without creating a merchant", async () => {
  for (const type of ["google", "signup"]) {
    const storage = memory();
    const result = await initializeAppAuth(auth(), callback(type), storage);
    assert.equal(result.session, session);
    assert.equal(result.recovery, false);
    assert.equal(result.callbackFailed, false);
  }
});
test("Google cancellation has a retryable error and grants no session", async () => {
  const result = await initializeAppAuth(auth(null), readAuthCallback(`${authRedirect("google")}#error=access_denied`), memory());
  assert.equal(result.callbackFailed, true);
  assert.equal(result.session, null);
  assert.match(authErrorMessage({ code: result.error }, "google"), /取消 Google/);
});
test("mail delivery configuration errors are distinct from request limits", () => {
  assert.match(authErrorMessage({ code: "email_address_not_authorized" }), /寄信設定/);
  assert.match(authErrorMessage({ code: "over_email_send_rate_limit" }), /寄送上限/);
  assert.match(authErrorMessage({ code: "email_not_confirmed" }), /重新寄送/);
  assert.doesNotMatch(authErrorMessage({ code: "unknown" }), /已註冊|不存在|已寄出/);
});
test("stale, malformed and wrong-user recovery markers are ignored", () => {
  for (const marker of [null, "{", JSON.stringify({ userId: "u", expiresAt: 0 }), JSON.stringify({ userId: "other", expiresAt: Date.now() + 1000 })]) assert.equal(validRecoveryContext(marker, "u"), false);
});
