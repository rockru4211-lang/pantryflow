"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { activeProjectRef, supabase, initialAuthCallback, googleSignInAvailable } from "@/lib/supabase-browser";
import { authRedirect, authErrorMessage, cleanAuthUrl, validRecoveryContext, RECOVERY_STORAGE_KEY } from "@/lib/auth-flow";
import { initializeAppAuth, clearRecovery, rememberRecovery } from "@/lib/auth-bootstrap";
import { EXPECTED_SCHEMA_VERSION, releaseInfo } from "@/lib/release";
import EmailAccountForm, { MailNotice } from "./email-account-form";
import { emptyMailStatus, mailResult, remainingMailSeconds, requestAuthEmail, readMailDraft, signupDraftKey, recoveryDraftKey, type MailStatus } from "@/lib/auth-email";
import CountWorkspace from "./count-workspace";
import ReceivingWorkspace, { ReceivingActivity } from "./receiving-workspace";
import ExpiryWasteWorkspace, { ExpiryWasteActivity, type ExpiryWastePage } from "./expiry-waste-workspace";
import CountHistory from "./count-history";
import StaffSettings from "./staff-settings";
import {
  AuthBrand,
  AuthShell,
  AuthTopbar,
  FormalAppShell,
  FormalHome,
  type ShellRole,
  type ShellView,
} from "./app-shell";

type Store = { id: string; name: string; store_code: string; staff_login_mode: string; organization_id: string; organizations: {business_type:string|null} | null };
type LoginContext = {storeName:string;storeCode:string;loginMode:string;displayName?:string;loginIdentifier?:string;role?:string};
type Profile = { display_name: string | null; organization_id: string | null; role: string | null };
type StaffLoginResponse = {
  storeId?: string;
  session?: { access_token?: string; refresh_token?: string };
  error?: string;
  correlationId?: string;
};

const errorText = (message: string) => {
  if (message.includes("Invalid login credentials")) return "帳號或密碼不正確。";
  if (message.includes("Email not confirmed")) return "請先到信箱完成驗證。";
  if (message.includes("User already registered")) return "此 Email 已註冊，請直接登入。";
  if (message.includes("OWNER_EMAIL_NOT_VERIFIED")) return "請先到信箱完成驗證，再建立餐廳。";
  if (message.includes("Token has expired") || message.includes("otp_expired")) return "驗證連結已過期，請重新寄送。";
  if (message.includes("Token has been invalid") || message.includes("invalid")) return "資料不正確，請確認後再試。";
  if (message.includes("rate limit")) return "寄送次數過多，請稍後再試。";
  return "目前無法完成，請稍後再試。";
};

export default function PilotClient() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [countStartPage, setCountStartPage] = useState<"overview" | "import" | "setup" | "management" | "start" | "details">("overview");
  const [mode, setMode] = useState<"welcome" | "login" | "signup" | "staff" | "staff-identity" | "staff-pin" | "staff-activate" | "forgot" | "reset">("welcome");
  const [loginContext,setLoginContext]=useState<LoginContext>();
  const [staffStoreCode, setStaffStoreCode] = useState("");
  const [staffIdentifier, setStaffIdentifier] = useState("");
  const [staffPin, setStaffPin] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [confirmationPin, setConfirmationPin] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupAwaiting, setSignupAwaiting] = useState(false);
  const [signupRecipientLocked, setSignupRecipientLocked] = useState(false);
  const [signupMail, setSignupMail] = useState<MailStatus>(emptyMailStatus);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryMail, setRecoveryMail] = useState<MailStatus>(emptyMailStatus);
  const [mailNow, setMailNow] = useState(0);
  const signupSeconds = remainingMailSeconds(signupMail, mailNow);
  const recoverySeconds = remainingMailSeconds(recoveryMail, mailNow);
  const [authFlowOpen, setAuthFlowOpen] = useState(false);
  const [recoveryActive, setRecoveryActive] = useState(false);
  const [googleAvailable, setGoogleAvailable] = useState(false);
  const [emailNeedsVerification, setEmailNeedsVerification] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const authReady = useRef(false);
  const authOperation = useRef(false);
  const workspaceRequest = useRef(0);
  const workspaceUser = useRef<string | null>(null);
  const bootstrap = useRef<ReturnType<typeof initializeAppAuth> | null>(null);
  const [busy, setBusy] = useState(true);
  const [initializing, setInitializing] = useState(true);
  const [message, setMessage] = useState("");
  const [view, setView] = useState<ShellView>("home");
  const leaveCount = useRef<(() => Promise<boolean>) | null>(null);
  const [staffSettingsOpen,setStaffSettingsOpen]=useState(false);
  const [receiptStartPage,setReceiptStartPage]=useState<"list"|"status"|"company-tasks">("list");
  const [receiptBatchId,setReceiptBatchId]=useState<string>();
  const [receiptReturnView,setReceiptReturnView]=useState<ShellView>("home");
  const [expiryStartPage,setExpiryStartPage]=useState<ExpiryWastePage>("expiry");
  const [expiryReturnView,setExpiryReturnView]=useState<ShellView>("home");
  async function openExpiry(page:ExpiryWastePage,from:ShellView=view){if(leaveCount.current&&!await leaveCount.current())return;setExpiryStartPage(page);setExpiryReturnView(from);setView(page.startsWith("waste")||page==="history"?"waste":"expiry");}
  const [historicSession,setHistoricSession]=useState<string>();
  const [businessType,setBusinessType]=useState("SINGLE_RESTAURANT");
  const [storeRoles,setStoreRoles]=useState<Record<string,string>>({});
  const [schemaVersion, setSchemaVersion] = useState("checking");
  const [schemaError, setSchemaError] = useState("");

  async function checkCompatibility() {
    const { data, error } = await supabase.rpc("get_app_schema_version");
    const actual = typeof data === "string" ? data : "unavailable";
    setSchemaVersion(actual);
    if (error || actual !== EXPECTED_SCHEMA_VERSION) {
      setSchemaError(`版本不相容：App 需要 ${EXPECTED_SCHEMA_VERSION}，資料庫目前為 ${actual}。`);
      return false;
    }
    setSchemaError("");
    return true;
  }

  async function loadWorkspace(activeSession: Session | null) {
    const request = ++workspaceRequest.current;
    if (workspaceUser.current !== (activeSession?.user.id || null)) {
      workspaceUser.current = activeSession?.user.id || null;
      setProfile(null); setStores([]); setSelectedStoreId("");
      if (activeSession) setInitializing(true);
    }
    setWorkspaceError("");
    setSession(activeSession);
    if (!await checkCompatibility()) {
      setBusy(false);
      setInitializing(false);
      return;
    }
    if (request !== workspaceRequest.current) return;
    if (!activeSession) {
      setProfile(null);
      setStores([]);
      setBusy(false);
      setInitializing(false);
      return;
    }

    const [{ data: profileData, error: profileError }, { data: storeData, error: storeError }] = await Promise.all([
      supabase.from("profiles").select("display_name, organization_id, role").eq("id", activeSession.user.id).single(),
      supabase.from("stores").select("id, name, store_code, staff_login_mode, organization_id, organizations(business_type)").eq("is_active", true).order("name"),
    ]);
    if (request !== workspaceRequest.current) return;
    if (profileError || storeError || !profileData) {
      setWorkspaceError("無法讀取帳號與門市資料，請重新載入。");
      setBusy(false); setInitializing(false); return;
    }
    const [{data:org},{data:roles,error:rolesError}]=await Promise.all([supabase.from("organizations").select("business_type").eq("id",profileData?.organization_id||"").maybeSingle(),supabase.from("store_memberships").select("store_id,role").eq("user_id",activeSession.user.id).eq("is_active",true)]);
    if (request !== workspaceRequest.current) return;
    if (rolesError) { setWorkspaceError("無法讀取門市權限，請重新載入。"); setBusy(false); setInitializing(false); return; }
    try {
      const draft = readMailDraft(sessionStorage.getItem(signupDraftKey));
      if (draft?.email.toLowerCase() === activeSession.user.email?.toLowerCase()) {
        sessionStorage.removeItem(signupDraftKey); sessionStorage.removeItem("pantryflow:pending-signup-email");
        setSignupAwaiting(false); setSignupPassword(""); setSignupMail(emptyMailStatus);
      }
    } catch { /* Private browsing. */ }
    setBusinessType(org?.business_type||"SINGLE_RESTAURANT");setStoreRoles(Object.fromEntries((roles||[]).map(r=>[r.store_id,r.role])));
    setProfile(profileData ?? null);
    setStores(storeData ?? []);
    let rememberedStore = "";
    try { rememberedStore = localStorage.getItem(`count-store:${activeSession.user.id}`) || ""; } catch { /* Storage may be unavailable in a private browser. */ }
    setSelectedStoreId(current => (storeData ?? []).some(store => store.id === current) ? current : (storeData ?? []).find(store => store.id === rememberedStore)?.id || storeData?.[0]?.id || "");
    setStaffPin("");
    setActivationCode("");
    setConfirmationPin("");
    setAuthPassword("");
    setBusy(false);
    setInitializing(false);
  }

  useEffect(() => {
    let mounted = true;
    void googleSignInAvailable().then(value => { if (mounted) setGoogleAvailable(value); });
    bootstrap.current ??= initializeAppAuth(supabase.auth, initialAuthCallback, localStorage);
    void bootstrap.current.then(async result => {
      if (!mounted) return;
      setMailNow(Date.now());
      try {
        const signup = readMailDraft(sessionStorage.getItem(signupDraftKey));
        const recovery = readMailDraft(sessionStorage.getItem(recoveryDraftKey));
        const legacyEmail = sessionStorage.getItem("pantryflow:pending-signup-email") || "";
        if (signup) { setSignupEmail(signup.email); setSignupAwaiting(signup.awaiting); setSignupRecipientLocked(signup.awaiting && !!signup.email); setSignupMail(signup.mail); }
        else if (legacyEmail) { setSignupEmail(legacyEmail); setSignupAwaiting(true); setSignupRecipientLocked(true); setSignupMail({ ...emptyMailStatus, message: "Email 尚待驗證，請在原頁重新寄送，或修改 Email。" }); }
        if (recovery) { setRecoveryEmail(recovery.email); setRecoveryMail(recovery.mail); }
      } catch { /* Private browsing. */ }
      if (initialAuthCallback?.isCallback) history.replaceState(history.state, "", cleanAuthUrl(location.href));
      if (result.callbackFailed) {
        const flow = initialAuthCallback?.flow;
        const failure = authErrorMessage({ code: result.error || "otp_expired" }, flow);
        setAuthFlowOpen(true);
        if (flow === "recovery") { setMode("forgot"); setRecoveryMail(current => ({ ...current, state: "error", message: failure })); }
        else if (flow === "signup") { setMode("signup"); setSignupAwaiting(true); setSignupMail(current => ({ ...current, state: "error", message: failure })); }
        else { setMode("login"); setMessage(failure); }
        setSession(result.session); setBusy(false); setInitializing(false);
      } else if (result.recovery && result.session) {
        setSession(result.session); setRecoveryActive(true); setMode("reset");
        setBusy(false); setInitializing(false);
      } else await loadWorkspace(result.session);
      authReady.current = true;
    }).catch(() => { if (mounted) { setMessage("登入狀態無法載入，請重新開啟 App。"); setBusy(false); setInitializing(false); authReady.current = true; } });
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!authReady.current || !mounted) return;
      // Auth callbacks must return before queries acquire the SDK's session lock.
      window.setTimeout(() => {
        if (!mounted) return;
        if (event === "PASSWORD_RECOVERY" && nextSession) {
          rememberRecovery(localStorage, nextSession); setSession(nextSession); setRecoveryActive(true); setMode("reset");
        } else if (event === "SIGNED_OUT") {
          clearRecovery(localStorage); setRecoveryActive(false); setMode(current => current === "reset" ? "forgot" : current); void loadWorkspace(null);
        } else if (event === "SIGNED_IN" || event === "USER_UPDATED") {
          let recovering = false;
          try { recovering = validRecoveryContext(localStorage.getItem(RECOVERY_STORAGE_KEY), nextSession?.user.id); } catch { /* Private browsing. */ }
          if (recovering) setSession(nextSession);
          else void loadWorkspace(nextSession);
        }
      }, 0);
    });
    return () => { mounted = false; data.subscription.unsubscribe(); };
    // Auth owns this subscription lifecycle; workspace reloads are triggered by auth events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (signupSeconds <= 0 && recoverySeconds <= 0) return;
    const timer = window.setInterval(() => setMailNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [signupSeconds, recoverySeconds]);

  function recordMail(flow: "signup" | "recovery", email: string, mail: MailStatus, awaiting = true) {
    setMailNow(Date.now());
    if (flow === "signup") { setSignupEmail(email); setSignupMail(mail); setSignupAwaiting(awaiting); setSignupRecipientLocked(awaiting && !!email); }
    else { setRecoveryEmail(email); setRecoveryMail(mail); }
    try { sessionStorage.setItem(flow === "signup" ? signupDraftKey : recoveryDraftKey, JSON.stringify({ email, awaiting, mail })); } catch { /* Private browsing. */ }
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    if (mode === "signup" && signupAwaiting) { await resendSignupEmail(email); return; }
    if (authOperation.current || (mode === "signup" && signupSeconds > 0)) return;
    authOperation.current = true; setBusy(true); setMessage(""); setEmailNeedsVerification(false);
    if (mode === "signup") { setSignupEmail(email); setSignupPassword(password); }
    else { setAuthEmail(email); setAuthPassword(password); }
    try {
      const result = mode === "signup"
        ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: authRedirect("signup") } })
        : await supabase.auth.signInWithPassword({ email, password });
      if (result.error) {
        if (mode === "signup") recordMail("signup", email, mailResult(result.error, "signup"), false);
        else { setMessage(authErrorMessage(result.error)); setEmailNeedsVerification(result.error.code === "email_not_confirmed"); }
      } else if (mode === "signup" && !result.data.session) {
        recordMail("signup", email, mailResult(null, "signup"));
      } else if (result.data.session) { clearRecovery(localStorage); setAuthFlowOpen(false); await loadWorkspace(result.data.session); }
    } catch {
      if (mode === "signup") recordMail("signup", email, { ...emptyMailStatus, state: "error", message: "本次未完成寄送，請確認網路連線後重試。" }, false);
      else setMessage(authErrorMessage({}));
    } finally { authOperation.current = false; setBusy(false); }
  }

  async function sendRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") || "").trim();
    if (authOperation.current || recoverySeconds > 0) return;
    authOperation.current = true; setBusy(true);
    recordMail("recovery", email, await requestAuthEmail(supabase.auth, "recovery", email));
    authOperation.current = false; setBusy(false);
  }

  async function resendSignupEmail(email: string) {
    if (signupSeconds > 0 || authOperation.current) return;
    authOperation.current = true; setBusy(true);
    recordMail("signup", email, await requestAuthEmail(supabase.auth, "signup", email));
    authOperation.current = false; setBusy(false);
  }

  function editSignupEmail() {
    setSignupAwaiting(false);
    const changed = { ...signupMail, message: "修改後請重新寄送驗證信；原有密碼輸入會保留。", state: "idle" as const };
    recordMail("signup", signupEmail, changed, false);
    window.setTimeout(() => document.getElementById("signup-email")?.focus(), 0);
  }

  async function finishRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recoveryActive || !session || authOperation.current) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("new_password") || "");
    if (password !== form.get("confirm_password")) { setMessage("兩次密碼不相同，請重新輸入。"); return; }
    authOperation.current = true; setBusy(true); setMessage("");
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setMessage(authErrorMessage(error, "recovery"));
        if (["session_not_found", "refresh_token_not_found", "refresh_token_already_used", "bad_jwt"].includes(error.code || "")) {
          clearRecovery(localStorage); setRecoveryActive(false); setMode("forgot");
          recordMail("recovery", session.user.email || recoveryEmail, { ...emptyMailStatus, state: "error", message: "重設連結已失效，請重新寄送重設信。" });
        }
      } else {
        setAuthEmail(session.user.email || ""); clearRecovery(localStorage); setRecoveryActive(false);
        const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });
        if (signOutError) await supabase.auth.signOut({ scope: "local" });
        setSession(null); setAuthPassword(""); setAuthFlowOpen(false); setMode("login");
        setRecoveryMail(emptyMailStatus); try { sessionStorage.removeItem(recoveryDraftKey); } catch {}
        setMessage("密碼已更新，請使用新密碼登入。");
      }
    } catch { setMessage(authErrorMessage({})); }
    finally { authOperation.current = false; setBusy(false); }
  }

  async function returnToManagement() {
    setWorkspaceError("");
    clearRecovery(localStorage); setRecoveryActive(false); setAuthFlowOpen(false);
    setMode("login"); setMessage(""); setAuthPassword("");
    if (session) { await supabase.auth.signOut({ scope: "local" }); setSession(null); }
  }

  async function googleLogin() {
    if (!googleAvailable || authOperation.current) return;
    authOperation.current = true; setBusy(true); setMessage("");
    try {
      const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: authRedirect("google"), queryParams: { prompt: "select_account" } } });
      if (error) setMessage(authErrorMessage(error, "google"));
    } catch { setMessage(authErrorMessage({}, "google")); }
    finally { authOperation.current = false; setBusy(false); }
  }

  async function continueStaffLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const storeCode=mode==='staff'?String(form.get("store_code")||"").trim().toUpperCase():staffStoreCode;
    const identifier=mode==='staff-identity'?String(form.get("identifier")||"").trim():undefined;
    setBusy(true);setMessage("");
    const {data,error}=await supabase.rpc('get_pilot_staff_login_context',{p_store_code:storeCode,...(identifier?{p_identifier:identifier}:{})});
    if(error||!data) setMessage(mode==='staff'?"找不到此門市，請確認門市代碼。":"找不到符合的身分，請確認姓名／暱稱或員工編號；若有同名，請使用主管提供的登入識別。");
    else {
      const context=data as unknown as LoginContext;setLoginContext(context);setStaffStoreCode(context.storeCode);
      if(identifier){setStaffIdentifier(context.loginIdentifier||identifier);setStaffPin('');setMode('staff-pin');}
      else setMode('staff-identity');
    }
    setBusy(false);
  }

  async function submitStaffPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const pin = String(form.get("pin") || "");
    const activating = mode === "staff-activate";
    if (activating && pin !== String(form.get("confirm_pin") || "")) {
      setMessage("兩次 PIN 不相同，請重新輸入。"); setBusy(false); return;
    }
    const { data, error } = await supabase.functions.invoke<StaffLoginResponse>("staff-pin-login", {
      body: { storeCode: staffStoreCode, identifier: staffIdentifier, pin, ...(activating ? { action: "activate", activationCode: String(form.get("activation_code") || "").trim() } : {}) },
    });
    const accessToken = data?.session?.access_token;
    const refreshToken = data?.session?.refresh_token;
    if (error || !accessToken || !refreshToken) {
      setMessage(data?.error === "LOGIN_TEMPORARILY_UNAVAILABLE"
        ? "員工登入暫時無法使用，請稍後再試。"
        : activating ? "啟用未完成，請確認一次性啟用碼。若已設定 PIN，請返回一般登入。" : "PIN 不正確或帳號暫時鎖定，請確認後再試。");
    } else {
      const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (sessionError || !sessionData.session) setMessage("登入狀態建立失敗，請稍後再試。");
      else { clearRecovery(localStorage); setRecoveryActive(false); setAuthFlowOpen(false); await loadWorkspace(sessionData.session); if(data?.storeId){setSelectedStoreId(data.storeId);try{localStorage.setItem(`count-store:${sessionData.session.user.id}`,data.storeId);}catch{}} }
    }
    setBusy(false);
  }

  async function createBusiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const organizationName = String(new FormData(event.currentTarget).get("organization_name") || "").trim();
    const { error } = await supabase.rpc("create_owner_business", {
      p_organization_name: organizationName,
      p_business_type: "SINGLE_RESTAURANT",
      p_store_name: organizationName,
      p_store_code: `STORE-${Date.now().toString(36).toUpperCase()}`,
      p_staff_login_mode: "NAME_OR_NICKNAME",
    });
    if (error) setMessage(errorText(error.message));
    else await loadWorkspace(session);
    setBusy(false);
  }

  const versionPanel = <details className="version-info"><summary>版本資訊</summary>
    <dl><div><dt>Commit</dt><dd>{releaseInfo.commitSha}</dd></div><div><dt>Branch</dt><dd>{releaseInfo.branch}</dd></div><div><dt>Build time</dt><dd>{releaseInfo.buildTime}</dd></div><div><dt>Environment</dt><dd>{releaseInfo.environment}</dd></div><div><dt>Supabase</dt><dd>{activeProjectRef.slice(0, 8)}</dd></div><div><dt>Schema</dt><dd>{schemaVersion}</dd></div></dl>
  </details>;

  if (initializing) return <AuthShell><section className="auth-loading"><AuthBrand /><p>正在載入…</p></section></AuthShell>;
  if (schemaError) return <AuthShell><section className="admin-login-stage"><div className="admin-login-frame"><AuthTopbar /><div className="admin-login-content"><h1>版本無法使用</h1><p className="pilot-message" role="alert">{schemaError}</p>{versionPanel}</div></div></section></AuthShell>;

  if (mode === "forgot" || mode === "reset") {
    const resetting = mode === "reset" && recoveryActive && !!session;
    return <AuthShell><section key={resetting ? "password-reset" : "password-recovery"} className="admin-login-stage"><div className="admin-login-frame"><AuthTopbar /><div className="admin-login-content">
      <button className="auth-back link" type="button" disabled={busy} onClick={() => void returnToManagement()}>‹ 返回管理登入</button>
      <div className="admin-login-heading"><h1>{resetting ? "設定新密碼" : "忘記密碼"}</h1><p>{resetting ? "設定完成後，使用新密碼登入。" : "輸入管理帳號使用的 Email。"}</p></div>
      {resetting ? <form key="reset-password" id="reset-password" className="admin-login-form" onSubmit={finishRecovery}>
        <label className="field" htmlFor="reset-new-password">新密碼<input key="new-password" id="reset-new-password" name="new_password" type="password" minLength={8} autoComplete="section-reset new-password" required /></label>
        <label className="field" htmlFor="reset-confirm-password">再次輸入新密碼<input key="confirm-password" id="reset-confirm-password" name="confirm_password" type="password" minLength={8} autoComplete="section-reset new-password" required /></label>
        {message && <p className="pilot-message" role="status">{message}</p>}
        <button className="primary" disabled={busy}>{busy ? "儲存中…" : "儲存新密碼"}</button>
      </form> : <form key="recovery-email" id="recovery-email-form" className="admin-login-form" onSubmit={sendRecovery}>
        <label className="field" htmlFor="recovery-email">Email<input key="recovery-email" id="recovery-email" name="email" type="email" autoComplete="section-recovery email" autoCapitalize="none" spellCheck={false} value={recoveryEmail} onChange={event => setRecoveryEmail(event.target.value)} required /></label>
        <MailNotice status={recoveryMail} seconds={recoverySeconds} />
        <button className="primary" disabled={busy || recoverySeconds > 0}>{busy ? "寄送中…" : recoveryMail.state === "idle" ? "寄送重設信" : "重新寄送重設信"}</button>
      </form>}
    </div></div></section></AuthShell>;
  }
  if (workspaceError) return <AuthShell><section className="admin-login-stage"><div className="admin-login-frame"><AuthTopbar /><div className="admin-login-content">
    <p className="pilot-message" role="alert">{workspaceError}</p><button className="primary" disabled={busy} onClick={() => void loadWorkspace(session)}>重新載入</button><button className="text-button" onClick={() => void returnToManagement()}>返回管理登入</button>
  </div></div></section></AuthShell>;

  if (!session || authFlowOpen) {
    if (mode === "welcome") {
      return <AuthShell><section className="admin-login-stage identity-stage"><div className="admin-login-frame identity-frame"><div className="identity-content">
        <AuthBrand />
        <div className="identity-heading"><h1>歡迎回來</h1><p>選擇你的登入方式</p></div>
        <div className="identity-list">
          <button className="identity-choice primary-choice" type="button" onClick={() => setMode("staff")}><span className="identity-icon">人</span><span><strong>員工快速登入</strong><small>門市代碼、個人識別、6 位 PIN</small></span><b>›</b></button>
          <button className="identity-choice" type="button" onClick={() => setMode("login")}><span className="identity-icon">管</span><span><strong>管理帳號登入</strong><small>店長、主管、行政後勤與 Owner</small></span><b>›</b></button>
        </div>
        <button className="new-business-link" type="button" onClick={() => { setMode("signup"); setMessage(""); }}>建立新商家</button>
      </div></div></section></AuthShell>;
    }
    if (mode === "staff" || mode === "staff-identity") {
      return <AuthShell><section className="admin-login-stage"><div className="admin-login-frame"><AuthTopbar /><div className="admin-login-content employee-login-panel">
        <button className="auth-back link" type="button" onClick={() => { setMode(mode==='staff'?'welcome':'staff'); setMessage(""); }}>‹ {mode==='staff'?'返回登入首頁':'返回門市'}</button>
        <div className="admin-login-heading"><h1>{mode==='staff'?'進入你的門市':'確認你的身分'}</h1><p>{mode==='staff'?'輸入主管提供的門市代碼。':loginContext?.storeName}</p></div>
        <form className="admin-login-form" onSubmit={continueStaffLogin}>
          {mode==='staff'?<label className="field">門市代碼<input key="store" name="store_code" autoCapitalize="characters" defaultValue={staffStoreCode} placeholder="例如 BEAPE01" required /></label>:<label className="field">{loginContext?.loginMode==='EMPLOYEE_NUMBER'?'員工編號':'姓名／暱稱'}<input key="identity" name="identifier" autoComplete="username" defaultValue={staffIdentifier} maxLength={64} required /></label>}
          <button className="primary" type="submit" disabled={busy}>{busy?'確認中…':'繼續'}</button>
        </form>
        {message&&<p className="pilot-message" role="status">{message}</p>}
      </div></div></section></AuthShell>;
    }
    if (mode === "staff-pin" || mode === "staff-activate") {
      return <AuthShell><section className="admin-login-stage"><div className="admin-login-frame"><AuthTopbar /><div className="admin-login-content employee-login-panel">
        <button className="auth-back link" type="button" onClick={() => { setMode("staff-identity"); setMessage(""); }}>‹ 返回身分確認</button>
        <div className="admin-login-heading"><h1>{mode === "staff-activate" ? "首次設定 PIN" : "輸入你的 PIN"}</h1><p>{mode === "staff-activate" ? "使用一次性啟用碼，由你自己設定 PIN。" : "使用自己的 PIN 進入門市。"}</p></div>
        <article className="confirm-card identity-confirm">
          <span aria-hidden="true">人</span>
          <strong>{loginContext?.displayName||staffIdentifier}</strong>
          <small>{loginContext?.storeName}・{loginContext?.role==='STAFF'?'員工':loginContext?.role==='LOGISTICS'?'行政後勤':loginContext?.role==='OWNER'?'老闆':'店長／主管'}</small>
        </article>
        <form className="admin-login-form" onSubmit={submitStaffPin}>
          {mode === "staff-activate" && <label className="field">一次性啟用碼<input name="activation_code" value={activationCode} onChange={event => setActivationCode(event.target.value)} autoComplete="off" required /></label>}
          <label className="field">6 位 PIN<input className="pin-input" name="pin" value={staffPin} onChange={event => setStaffPin(event.target.value)} type="password" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="••••••" required /></label>
          {mode === "staff-activate" && <label className="field">再次輸入 PIN<input name="confirm_pin" value={confirmationPin} onChange={event => setConfirmationPin(event.target.value)} type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{6}" maxLength={6} required /></label>}
          <p className="helper">連續錯誤 5 次將鎖定 15 分鐘；忘記 PIN 請洽門市主管重設。</p>
          <button className="primary" type="submit" disabled={busy}>{busy ? "處理中…" : mode === "staff-activate" ? "設定 PIN 並登入" : "進入"}</button>
        </form>
        <button className="text-button full-button" type="button" onClick={() => { setMode(mode === "staff-activate" ? "staff-pin" : "staff-activate"); setMessage(""); }}>{mode === "staff-activate" ? "已設定 PIN，返回登入" : "首次使用，設定 PIN"}</button>
        {message && <p className="pilot-message" role="status">{message}</p>}
      </div></div></section></AuthShell>;
    }
    return <AuthShell><section key={`management-${mode}`} className="admin-login-stage"><div className="admin-login-frame"><AuthTopbar /><div className="admin-login-content">
      <button className="auth-back link" type="button" onClick={() => { setMode("welcome"); setMessage(""); }}>‹ 返回登入首頁</button>
      <div className="admin-login-heading"><h1>{mode === "signup" ? "建立管理帳號" : "歡迎回來"}</h1><p>{mode === "signup" ? "建立帳號後，點信中連結驗證 Email，繼續設定商家。" : "使用管理帳號登入"}</p></div>
      <EmailAccountForm key={mode} mode={mode === "signup" ? "signup" : "login"}
        email={mode === "signup" ? signupEmail : authEmail} password={mode === "signup" ? signupPassword : authPassword}
        onEmailChange={mode === "signup" ? setSignupEmail : setAuthEmail} onPasswordChange={mode === "signup" ? setSignupPassword : setAuthPassword}
        awaiting={signupAwaiting} recipientLocked={signupRecipientLocked} mail={signupMail} seconds={signupSeconds} busy={busy} onSubmit={submitAuth} onEditEmail={editSignupEmail} />
      {mode === "login" && <button className="text-button full-button" type="button" disabled={busy} onClick={() => { setMode("forgot"); setRecoveryEmail(authEmail || recoveryEmail); setMessage(""); }}>忘記密碼</button>}
      {mode === "login" && googleAvailable && <button className="secondary full-button" type="button" disabled={busy} onClick={() => void googleLogin()}>使用 Google 帳號登入</button>}
      {message && <p className="pilot-message" role="status">{message}</p>}
      {mode === "login" && emailNeedsVerification && <><MailNotice status={signupMail} seconds={signupSeconds} /><button className="text-button full-button" type="button" disabled={busy || signupSeconds > 0} onClick={() => void resendSignupEmail(authEmail.trim())}>重新寄送驗證信</button></>}
      <small className="auth-footnote">登入後的資料會安全儲存在商家專屬空間。</small>
      <details className="install-help"><summary>iPhone 加入主畫面</summary><p>使用 Safari 開啟此網站，點選「分享」，再選「加入主畫面」。安裝後會以獨立 App 視窗開啟。</p></details>
      {versionPanel}
    </div></div></section></AuthShell>;
  }

  if (!profile) return <AuthShell><p className="pilot-message" role="alert">無法讀取帳號資料，請重新開啟 App。</p></AuthShell>;

  if (!profile.organization_id && stores.length === 0) {
    return <AuthShell><section className="admin-login-stage"><div className="admin-login-frame"><AuthTopbar /><div className="admin-login-content">
      <div className="admin-login-heading"><p className="eyebrow">首次設定</p><h1>建立商家</h1><p>輸入餐廳名稱，系統會在背景建立同名單一門市。</p></div>
      <form className="admin-login-form" onSubmit={createBusiness}>
        <label className="field">餐廳名稱<input name="organization_name" required /></label>
        <button className="primary" disabled={busy}>{busy ? "建立中…" : "完成設定"}</button>
      </form>
      {message && <p className="pilot-message" role="status">{message}</p>}
      <button className="text-button" type="button" onClick={() => supabase.auth.signOut()}>登出</button>
    </div></div></section></AuthShell>;
  }

  const effectiveRole=storeRoles[selectedStoreId]||profile.role;
  const role: ShellRole = effectiveRole === "STAFF"
    ? "STAFF"
    : effectiveRole === "LOGISTICS"
      ? "LOGISTICS"
      : effectiveRole === "SUPERVISOR" || effectiveRole === "ADMIN"
        ? "SUPERVISOR"
        : "OWNER";

  const selectedStore = stores.find(store => store.id === selectedStoreId);
  const navigate=async(next:ShellView)=>{if(leaveCount.current&&!await leaveCount.current())return;setView(next);setStaffSettingsOpen(false);};
  const currentBusinessType=selectedStore?.organizations?.business_type||businessType;
  const openCount = (page: "overview" | "import" | "setup" | "management" | "start" | "details",id?:string) => { setHistoricSession(id);setCountStartPage(page);setView("count"); };
  const signOut=async()=>{if(leaveCount.current&&!await leaveCount.current())return;setView("home");setMode("welcome");setMessage("");await supabase.auth.signOut();};
  return <FormalAppShell role={role} storeName={selectedStore?.name || "序"} stores={stores} storeId={selectedStoreId} onStoreChange={async id => {
    if(leaveCount.current&&!await leaveCount.current())return;
    setSelectedStoreId(id);setView("home");setHistoricSession(undefined);
    try { localStorage.setItem(`count-store:${session.user.id}`, id); } catch { /* Memory fallback. */ }
  }} view={view} onNavigate={next=>void navigate(next)}>
    {view === "home"
      ? <FormalHome key={selectedStoreId} role={role} storeId={selectedStoreId} businessType={currentBusinessType} onImport={() => openCount("import")} onCount={start => openCount(start?"start":"overview")} onManagement={()=>openCount("management")} onExpiry={()=>openExpiry("expiry")} onWaste={()=>openExpiry("waste")} expirySummary={<ExpiryWasteActivity storeId={selectedStoreId} mode="home" onOpen={page=>openExpiry(page)}/>} onReceiving={()=>{setReceiptReturnView("home");setReceiptBatchId(undefined);setReceiptStartPage("list");setView("receiving");}} versionPanel={versionPanel} />
      : view === "expiry" || view === "waste" ? <ExpiryWasteWorkspace key={`${selectedStoreId}:${expiryStartPage}`} storeId={selectedStoreId} initialPage={expiryStartPage} returnLabel={expiryReturnView==="activity"?"返回作業紀錄":expiryReturnView==="tasks"?"返回待辦":expiryReturnView==="notifications"?"返回通知":"返回首頁"} onBack={()=>setView(expiryReturnView)}/>
      : view === "receiving" ? <ReceivingWorkspace key={`${selectedStoreId}:${receiptBatchId||'list'}`} storeId={selectedStoreId} organizationId={selectedStore!.organization_id} role={role} businessType={currentBusinessType} initialBatchId={receiptBatchId} initialPage={receiptStartPage} returnLabel={receiptReturnView==="activity"?"返回作業紀錄":receiptReturnView==="tasks"?"返回待辦":receiptReturnView==="notifications"?"返回通知":"返回首頁"} onBack={()=>setView(receiptReturnView)}/>
      : view === "activity" || view === "notifications" ? <><ExpiryWasteActivity key={`expiry:${selectedStoreId}:${view}`} storeId={selectedStoreId} mode={view} onOpen={page=>openExpiry(page)}/><ReceivingActivity storeId={selectedStoreId} notifications={view==='notifications'} onOpen={id=>{setReceiptReturnView(view);setReceiptBatchId(id);setReceiptStartPage("status");setView("receiving");}}/><CountHistory storeId={selectedStoreId} notifications={view==='notifications'} management={role!=='STAFF'} onOpen={id=>openCount("details",id)}/></>
      : view === "settings" ? <><h1>我的</h1><p>{profile.display_name}</p><p>{selectedStore?.name}（{selectedStore?.store_code}）</p>{role!=="STAFF"&&<div className="shell-button-stack"><button className="shell-secondary" onClick={()=>openCount("management")}>盤點設定與資料</button>{role==='SUPERVISOR'&&<button className="shell-secondary" onClick={()=>setStaffSettingsOpen(v=>!v)}>員工與權限</button>}</div>}{staffSettingsOpen&&<StaffSettings stores={selectedStore?[selectedStore]:[]} canManageStores={effectiveRole==="ADMIN"} onWorkspaceChanged={() => loadWorkspace(session)} />}<button className="text-button" onClick={signOut}>登出</button>{versionPanel}</>
      : <>{view==='tasks'&&<ExpiryWasteActivity key={`expiry:${selectedStoreId}`} storeId={selectedStoreId} mode="tasks" onOpen={page=>openExpiry(page)}/>} {view==='tasks'&&<ReceivingActivity storeId={selectedStoreId} tasks onOpen={(id,companyTask)=>{setReceiptReturnView("tasks");setReceiptBatchId(id);setReceiptStartPage(companyTask?"company-tasks":"status");setView("receiving");}}/>}<CountWorkspace key={`${selectedStoreId}:${historicSession||'current'}`} stores={selectedStore ? [selectedStore] : []} organizationId={selectedStore?.organization_id||profile.organization_id||""} session={session} initialPage={view==='tasks'?'overview':countStartPage} initialSessionId={historicSession} onBack={() => setView("home")} canViewFullDetails={role !== "STAFF"} canManage={role==='SUPERVISOR'} businessType={currentBusinessType} registerLeave={handler=>{leaveCount.current=handler;}} /></>}
  </FormalAppShell>;
}
