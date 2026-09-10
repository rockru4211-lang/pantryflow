"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { activeProjectRef, supabase, initialAuthCallback, googleSignInAvailable } from "@/lib/supabase-browser";
import { authRedirect, authErrorMessage, cleanAuthUrl, validRecoveryContext, RECOVERY_STORAGE_KEY } from "@/lib/auth-flow";
import {markAppSession,openSessionKey} from '@/lib/device-session';
import {deviceId,readLoginMemory,writeLoginMemory,clearLoginMemory,devicePolicySummary,type DevicePolicy} from '@/lib/login-device';
import {useSessionPolicy} from './session-policy';
import { initializeAppAuth, clearRecovery, rememberRecovery } from "@/lib/auth-bootstrap";
import { EXPECTED_SCHEMA_VERSION, releaseInfo } from "@/lib/release";
import EmailAccountForm, { MailNotice } from "./email-account-form";
import PasswordInput from "./password-input";
import ChangePasswordForm from './change-password-form';
import { parseAppContext, type AppStore } from "@/lib/app-workspace";
import OwnerSetupFlow from "./owner-setup";
import { parseOwnerSetup, type OwnerSetup } from "@/lib/owner-setup";
import { emptyMailStatus, mailResult, remainingMailSeconds, requestAuthEmail, verifyEmailCode, readMailDraft, signupDraftKey, recoveryDraftKey, type MailStatus } from "@/lib/auth-email";
import CountWorkspace from "./count-workspace";
import ReceivingWorkspace, { ReceivingActivity } from "./receiving-workspace";
import ExpiryWasteWorkspace, { ExpiryWasteActivity, type ExpiryWastePage } from "./expiry-waste-workspace";
import CountHistory from "./count-history";
import RoleHome, {OtherWorkspace,ShortagesWorkspace,viewTitles} from './role-home';
import TransfersWorkspace from './transfers-workspace';
import RecordsWorkspace, {RecordsActivity,type RecordSection} from './records-workspace';
import CatalogWorkspace from './catalog-workspace';
import ReportsWorkspace from './reports-workspace';
import BusinessSettings from './business-settings';
import MembersWorkspace from './members-workspace';
import {hasCrossStore} from '@/lib/app-workspace';
import {
  AuthBrand,
  AuthShell,
  AuthTopbar,
  FormalAppShell,
  type ShellRole,
  type ShellView,
} from "./app-shell";

type Store = AppStore & {organizations: {business_type:string|null}};
type LoginContext = {storeName:string;storeCode:string;loginMode:string;displayName?:string;loginIdentifier?:string;role?:string;policy?:DevicePolicy};
type Profile = { display_name: string | null; organization_id: string | null; role: string | null };
type StaffLoginResponse = {
  storeId?: string;
  session?: { access_token?: string; refresh_token?: string };
  error?: string;
  correlationId?: string;
};

export default function PilotClient() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ownerSetup, setOwnerSetup] = useState<OwnerSetup | null>(null);
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
  const [reauthOnly,setReauthOnly]=useState(false);
  const [authPassword, setAuthPassword] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupCode, setSignupCode] = useState("");
  const [signupCodeError, setSignupCodeError] = useState("");
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
  const [recordId,setRecordId]=useState<string>();
  const [recordReturn,setRecordReturn]=useState<ShellView>("home");
  const [transferReturn,setTransferReturn]=useState<ShellView>("home");
  const [countReturnView,setCountReturnView]=useState<ShellView>("home");
  const [receiptStartPage,setReceiptStartPage]=useState<"list"|"status"|"company-tasks">("list");
  const [receiptBatchId,setReceiptBatchId]=useState<string>();
  const [receiptReturnView,setReceiptReturnView]=useState<ShellView>("home");
  const [expiryStartPage,setExpiryStartPage]=useState<ExpiryWastePage>("expiry");
  const [expiryReturnView,setExpiryReturnView]=useState<ShellView>("home");
  async function openExpiry(page:ExpiryWastePage,from:ShellView=view){if(leaveCount.current&&!await leaveCount.current())return;setExpiryStartPage(page);setExpiryReturnView(from);setView(page.startsWith("waste")||page==="history"?"waste":"expiry");}
  const [historicSession,setHistoricSession]=useState<string>();
  const [schemaVersion, setSchemaVersion] = useState("checking");
  const [schemaError, setSchemaError] = useState("");

  async function expireSession(fullLogin=false,expectedUserId=workspaceUser.current||undefined,expectedStoreId?:string,expectedToken?:string){
    // An old store/identity request must never sign out the next login.
    const request=workspaceRequest.current;
    if(!expectedUserId||workspaceUser.current!==expectedUserId||(expectedStoreId&&selectedStoreId!==expectedStoreId)||authOperation.current)return;
    const reason=await supabase.rpc('get_app_reauth_reason');
    const current=await supabase.auth.getSession();
    if(request!==workspaceRequest.current||current.data.session?.user.id!==expectedUserId||(expectedToken&&current.data.session?.access_token!==expectedToken)||authOperation.current)return;
    const memory=readLoginMemory();
    try{sessionStorage.removeItem(openSessionKey(expectedUserId));}catch{}
    await supabase.auth.signOut({scope:'local'});
    setSession(null);setAuthPassword('');setStaffPin('');setReauthOnly(false);
    if(fullLogin||reason.error||reason.data==='revoked'){clearLoginMemory();setMode('welcome');}
    else if(memory){
      setStaffStoreCode(memory.storeCode);setLoginContext({...memory,policy:memory.policy});
      if(memory.identifier){setStaffIdentifier(memory.identifier);setLoginContext({...memory,displayName:memory.displayName,loginIdentifier:memory.identifier,role:'STAFF'});setMode('staff-pin');}
      else if(memory.email){setAuthEmail(memory.email);setReauthOnly(true);setMode('login');}
      else{setStaffIdentifier('');setMode('staff-identity');}
    }else setMode('welcome');
    setMessage('此裝置需要重新驗證，已儲存的工作會保留。');
  }
  useSessionPolicy(session?.user.id,selectedStoreId,session?.access_token,expireSession);

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
      setProfile(null); setStores([]); setSelectedStoreId(""); setOwnerSetup(null); setView("home");
      if (activeSession) setInitializing(true);
    }
    setWorkspaceError("");
    setSession(activeSession);
    const compatible=await checkCompatibility();
    if (request !== workspaceRequest.current) return;
    if (!compatible) {
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

    const [{ data: profileData, error: profileError }, { data: contextData, error: storeError }, { data: setupData, error: setupError }] = await Promise.all([
      supabase.from("profiles").select("display_name, organization_id, role").eq("id", activeSession.user.id).single(),
      supabase.rpc("get_app_context"),
      supabase.rpc("owner_setup"),
    ]);
    if (request !== workspaceRequest.current) return;
    if(storeError?.message.includes('AUTH_REAUTH_REQUIRED')){await expireSession();setBusy(false);setInitializing(false);return;}
    if (profileError || storeError || setupError || !profileData) {
      setWorkspaceError("無法讀取帳號與門市資料，請重新載入。");
      setBusy(false); setInitializing(false); return;
    }
    let setup: OwnerSetup;
    try { setup = parseOwnerSetup(setupData); } catch { setWorkspaceError("無法讀取商家設定進度，請重新載入。"); setBusy(false); setInitializing(false); return; }
    let storeData: Store[];
    try {
      const context = parseAppContext(contextData);
      if (context.user_id !== activeSession.user.id) throw Error("CONTEXT_USER_MISMATCH");
      storeData = context.stores.map(store=>({...store,organizations:{business_type:store.business_type}}));
    } catch { setWorkspaceError("無法讀取門市權限，請重新載入。"); setBusy(false); setInitializing(false); return; }
    const previousMemory=readLoginMemory();
    let hadOpening=false;try{hadOpening=sessionStorage.getItem(openSessionKey(activeSession.user.id))==='active';}catch{}
    let preferredStore="";try{preferredStore=localStorage.getItem(`count-store:${activeSession.user.id}`)||"";}catch{}
    const firstStore=storeData.find(s=>s.id===preferredStore)||storeData.find(s=>s.store_code===previousMemory?.storeCode)||storeData[0];
    if(firstStore){
      let id:string;try{id=deviceId();}catch{id=crypto.randomUUID();}
      const registration=await supabase.rpc('register_app_device',{p_store_id:firstStore.id,p_device_id:id,p_label:/Mobi|Android/i.test(navigator.userAgent)?'手機瀏覽器':'電腦瀏覽器'});
      if(request!==workspaceRequest.current)return;
      if(registration.error){setWorkspaceError('無法確認裝置授權，請重新載入。');setBusy(false);setInitializing(false);return;}
      const policy=registration.data as unknown as DevicePolicy;
      const personal=policy.authorized&&policy.remember_device&&policy.device_type==='PERSONAL';
      // Existing sessions do not become remembered devices merely by opening a tab.
      if(!hadOpening&&(!personal||policy.reauth_days===0)){await expireSession();setBusy(false);setInitializing(false);return;}
      const staff=firstStore.role==='STAFF';
      writeLoginMemory({storeCode:firstStore.store_code,storeName:firstStore.name,loginMode:firstStore.staff_login_mode,policy,
       ...(staff?{identifier:firstStore.login_identifier||undefined,displayName:profileData.display_name||undefined}:{email:activeSession.user.email})});
    }
    markAppSession(activeSession);setReauthOnly(false);
    if (!setup.required && !storeData.length) { setWorkspaceError("目前帳號沒有可使用的門市，請洽商家管理者。"); setBusy(false); setInitializing(false); return; }
    try {
      const draft = readMailDraft(sessionStorage.getItem(signupDraftKey));
      if (draft?.email.toLowerCase() === activeSession.user.email?.toLowerCase()) {
        sessionStorage.removeItem(signupDraftKey); sessionStorage.removeItem("pantryflow:pending-signup-email");
        setSignupAwaiting(false); setSignupPassword(""); setSignupCode(""); setSignupCodeError(""); setSignupMail(emptyMailStatus);
      }
    } catch { /* Private browsing. */ }
    setProfile(profileData ?? null);
    setOwnerSetup(setup);
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
        else if (legacyEmail) { setSignupEmail(legacyEmail); setSignupAwaiting(true); setSignupRecipientLocked(true); setSignupMail({ ...emptyMailStatus, message: "Email 尚待驗證，已有驗證碼可直接在此輸入，或重新寄送。" }); }
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
      } else { if(initialAuthCallback?.isCallback&&result.session)markAppSession(result.session);setAuthFlowOpen(false); await loadWorkspace(result.session); }
      authReady.current = true;
    }).catch(() => { if (mounted) { setMessage("登入狀態無法載入，請重新開啟 App。"); setBusy(false); setInitializing(false); authReady.current = true; } });
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!authReady.current || !mounted) return;
      // Auth callbacks must return before queries acquire the SDK's session lock.
      window.setTimeout(async () => {
        if (!mounted) return;
        // Explicit password/PIN/OTP handlers load their returned session once.
        // Delayed auth events can otherwise race a new identity or an old logout.
        if(authOperation.current&&event!=="SIGNED_OUT")return;
        const current=await supabase.auth.getSession();
        if(!mounted||current.data.session?.access_token!==nextSession?.access_token)return;
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
      } else if (result.data.session) { markAppSession(result.data.session);clearRecovery(localStorage); setAuthFlowOpen(false); await loadWorkspace(result.data.session); }
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
    setSignupAwaiting(false); setSignupCode(""); setSignupCodeError("");
    const changed = { ...signupMail, message: "修改後請重新寄送驗證信；原有密碼輸入會保留。", state: "idle" as const };
    recordMail("signup", signupEmail, changed, false);
    window.setTimeout(() => document.getElementById("signup-email")?.focus(), 0);
  }

  async function verifySignupCode(email: string, code: string) {
    // A send cooldown (including a rejected resend) never blocks verification.
    if (authOperation.current) return;
    authOperation.current = true; setBusy(true); setSignupCodeError(""); setSignupEmail(email);
    try {
      const result = await verifyEmailCode(supabase.auth, email, code);
      if (result.error || !result.session) { setSignupCodeError(result.error); return; }
      setSignupCode(""); clearRecovery(localStorage); setRecoveryActive(false); setAuthFlowOpen(false);
      markAppSession(result.session);await loadWorkspace(result.session);
    } finally { authOperation.current = false; setBusy(false); }
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

  async function changePassword(currentPassword:string,nextPassword:string):Promise<string|null>{
    if(!session?.user.email||authOperation.current)return '請稍候再試。';
    const user=session.user;authOperation.current=true;setBusy(true);
    try{
      const verified=await supabase.auth.signInWithPassword({email:user.email!,password:currentPassword});
      if(verified.error||verified.data.user?.id!==user.id)return '目前密碼不正確，請重新輸入。';
      markAppSession(verified.data.session);
      const updated=await supabase.auth.updateUser({password:nextPassword});
      if(updated.error){await loadWorkspace(verified.data.session);return authErrorMessage(updated.error);}
      const signedOut=await supabase.auth.signOut({scope:'global'});
      if(signedOut.error)await supabase.auth.signOut({scope:'local'});
      clearRecovery(localStorage);setRecoveryActive(false);setSession(null);setAuthEmail(user.email!);setAuthPassword('');setAuthFlowOpen(false);setMode('login');
      setMessage(signedOut.error?'密碼已更新，請使用新密碼登入；其他裝置的登出未能確認。':'密碼已更新，請使用新密碼登入。');
      return null;
    }finally{authOperation.current=false;setBusy(false);}
  }

  async function googleLogin() {
    if (authOperation.current) return;
    authOperation.current = true; setBusy(true); setMessage("");
    try {
      if (!googleAvailable && !await googleSignInAvailable()) {
        setMessage("Google 登入設定尚未完成，請先使用管理帳號登入。");
        return;
      }
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
    const response=await supabase.functions.invoke('staff-pin-login',{body:{action:'context',storeCode,identifier}});
    const data=response.data?.context;const error=response.error;
    if(error||!data) setMessage(mode==='staff'?"找不到此門市，請確認門市代碼。":"找不到符合的身分，請確認姓名／暱稱或員工編號；若有同名，請使用主管提供的登入識別。");
    else {
      const context=data as unknown as LoginContext;const memory=readLoginMemory();if(memory?.storeCode===context.storeCode)context.policy=memory.policy;setLoginContext(context);setStaffStoreCode(context.storeCode);
      if(identifier){setStaffIdentifier(context.loginIdentifier||identifier);setStaffPin('');setMode('staff-pin');}
      else setMode('staff-identity');
    }
    setBusy(false);
  }

  async function submitStaffPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(authOperation.current)return;
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const pin = String(form.get("pin") || "");
    const activating = mode === "staff-activate";
    if (activating && pin !== String(form.get("confirm_pin") || "")) {
      setMessage("兩次 PIN 不相同，請重新輸入。"); setBusy(false); return;
    }
    authOperation.current=true;
    try {
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
      else { clearRecovery(localStorage); setRecoveryActive(false); setAuthFlowOpen(false); if(sessionData.session)markAppSession(sessionData.session);await loadWorkspace(sessionData.session); if(data?.storeId){setSelectedStoreId(data.storeId);try{localStorage.setItem(`count-store:${sessionData.session.user.id}`,data.storeId);}catch{}} }
    }
    } finally { authOperation.current=false;setBusy(false); }
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
        <label className="field" htmlFor="reset-new-password">新密碼<PasswordInput aria-label="新密碼" strength key="new-password" id="reset-new-password" name="new_password" minLength={8} autoComplete="section-reset new-password" required /></label>
        <label className="field" htmlFor="reset-confirm-password">再次輸入新密碼<PasswordInput aria-label="再次輸入新密碼" key="confirm-password" id="reset-confirm-password" name="confirm_password" minLength={8} autoComplete="section-reset new-password" required /></label>
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
        {message&&<p className="pilot-message" role="status">{message}</p>}<div className="identity-list">
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
          <p className="auth-footnote">{devicePolicySummary(loginContext?.policy)}</p>
          <p className="helper">連續錯誤 5 次將鎖定 15 分鐘；忘記 PIN 請洽門市主管重設。</p>
          <button className="primary" type="submit" disabled={busy}>{busy ? "處理中…" : mode === "staff-activate" ? "設定 PIN 並登入" : "進入"}</button>
        </form>
        <button className="text-button full-button" type="button" onClick={() => { setMode(mode === "staff-activate" ? "staff-pin" : "staff-activate"); setMessage(""); }}>{mode === "staff-activate" ? "已設定 PIN，返回登入" : "首次使用，設定 PIN"}</button>
        {message && <p className="pilot-message" role="status">{message}</p>}
      </div></div></section></AuthShell>;
    }
    return <AuthShell><section key={`management-${mode}`} className="admin-login-stage"><div className="admin-login-frame"><AuthTopbar /><div className="admin-login-content">
      <button className="auth-back link" type="button" onClick={() => { setMode("welcome");setReauthOnly(false);clearLoginMemory(); setMessage(""); }}>‹ 返回登入首頁</button>
      <div className="admin-login-heading"><h1>{mode === "signup" ? "建立管理帳號" : "歡迎回來"}</h1><p>{mode === "signup" ? "建立帳號後，在此輸入 Email 驗證碼，繼續設定商家。" : "使用管理帳號登入"}</p></div>
      <EmailAccountForm key={mode} mode={mode === "signup" ? "signup" : "login"}
        reauthOnly={reauthOnly&&mode==='login'} email={mode === "signup" ? signupEmail : authEmail} password={mode === "signup" ? signupPassword : authPassword}
        onEmailChange={mode === "signup" ? value => { setSignupEmail(value); setSignupCode(""); setSignupCodeError(""); } : setAuthEmail} onPasswordChange={mode === "signup" ? setSignupPassword : setAuthPassword}
        awaiting={signupAwaiting} recipientLocked={signupRecipientLocked} mail={signupMail} seconds={signupSeconds} busy={busy} onSubmit={submitAuth} onEditEmail={editSignupEmail}
        code={signupCode} codeError={signupCodeError} onCodeChange={value => { setSignupCode(value); setSignupCodeError(""); }} onVerify={(email, code) => void verifySignupCode(email, code)} />
      {mode === "login" && <button className="text-button full-button" type="button" disabled={busy} onClick={() => { setMode("forgot"); setRecoveryEmail(authEmail || recoveryEmail); setMessage(""); }}>忘記密碼</button>}
      {mode === "login" && <button className="secondary full-button" type="button" disabled={busy} onClick={() => void googleLogin()}>使用 Google 帳號登入</button>}
      {message && <p className="pilot-message" role="status">{message}</p>}
      {mode === "login" && emailNeedsVerification && <><MailNotice status={signupMail} seconds={signupSeconds} /><button className="text-button full-button" type="button" disabled={busy || signupSeconds > 0} onClick={() => void resendSignupEmail(authEmail.trim())}>重新寄送驗證信</button></>}
      <small className="auth-footnote">登入後的資料會安全儲存在商家專屬空間。</small>
      <details className="install-help"><summary>iPhone 加入主畫面</summary><p>使用 Safari 開啟此網站，點選「分享」，再選「加入主畫面」。安裝後會以獨立 App 視窗開啟。</p></details>
      {versionPanel}
    </div></div></section></AuthShell>;
  }

  if (!profile) return <AuthShell><p className="pilot-message" role="alert">無法讀取帳號資料，請重新開啟 App。</p></AuthShell>;

  if (!ownerSetup) return <AuthShell><p className="pilot-message" role="alert">無法讀取商家設定進度，請重新開啟 App。</p></AuthShell>;
  if (ownerSetup.required) return <OwnerSetupFlow key={session.user.id} initial={ownerSetup} email={session.user.email || ""} displayName={profile.display_name}
    onComplete={async () => { setView("home"); await loadWorkspace(session); }} onSignOut={async () => { setMode("welcome"); await supabase.auth.signOut({scope:"local"}); }} />;

  const selectedStore = stores.find(store => store.id === selectedStoreId);
  if(!selectedStore) return <AuthShell><p className="pilot-message" role="alert">目前沒有可使用的門市，請重新登入或洽商家管理者。</p><button className="text-button" onClick={()=>void returnToManagement()}>返回登入</button></AuthShell>;
  const role: ShellRole = selectedStore.role;
  const currentBusinessType=selectedStore.business_type;
  const openCount = (page: "overview" | "import" | "setup" | "management" | "start" | "details",id?:string) => { if(view!=="count")setCountReturnView(view);setHistoricSession(id);setCountStartPage(page);setView("count"); };
  const openReceipt=(id?:string)=>{setReceiptReturnView(view);setReceiptBatchId(id);setReceiptStartPage(id?"status":"list");setView("receiving");};
  const navigate=async(next:ShellView)=>{
    if(leaveCount.current&&!await leaveCount.current())return;
    if(next==='count'){openCount('overview');return;}
    if(next==='manual'){openCount('management');return;}
    if(next==='receiving'){openReceipt();return;}
    if(next==='transfers'){setTransferReturn(view);setView(next);return;}
    if(next==='expiry'||next==='waste'){await openExpiry(next);return;}
    setRecordId(undefined);setRecordReturn(view);setView(next);
  };
  const changeStore=async(id:string)=>{if(leaveCount.current&&!await leaveCount.current())return;setSelectedStoreId(id);setView("home");setHistoricSession(undefined);try{localStorage.setItem(`count-store:${session.user.id}`,id);}catch{}await loadWorkspace(session);};
  const signOut=async()=>{if(leaveCount.current&&!await leaveCount.current())return;setView("home");setMode("welcome");setReauthOnly(false);clearLoginMemory();setMessage("");await supabase.auth.signOut({scope:"local"});};
  const go=(next:ShellView)=>void navigate(next);
  const activity=(mode:'activity'|'tasks'|'notifications')=><>
    {view!=='handover'&&<h1>{mode==='activity'?'作業紀錄':mode==='tasks'?'待辦':'通知'}</h1>}
    <ExpiryWasteActivity key={`expiry:${selectedStoreId}:${mode}`} storeId={selectedStoreId} mode={mode} onOpen={page=>openExpiry(page)}/>
    <ReceivingActivity storeId={selectedStoreId} tasks={mode==='tasks'} notifications={mode==='notifications'} onOpen={(id,companyTask)=>{setReceiptReturnView(view==='handover'?'handover':mode);setReceiptBatchId(id);setReceiptStartPage(companyTask?'company-tasks':'status');setView('receiving');}}/>
    <CountHistory storeId={selectedStoreId} notifications={mode!=='activity'} management={role!=='STAFF'} onOpen={id=>openCount('details',id)}/>
    <RecordsActivity storeId={selectedStoreId} mode={mode} onOpen={(section,id)=>{setRecordId(id);setRecordReturn(view==='handover'?'handover':mode);setView(section);}}/>
    {hasCrossStore(selectedStore)&&<button className="shell-secondary full" onClick={()=>go('transfers')}>借貸與調撥{mode==='activity'?'紀錄':'待處理'}</button>}
  </>;
  const workspace=()=>{
    if(view==='home')return <RoleHome key={`${session.user.id}:${selectedStoreId}`} store={selectedStore} stores={stores} onNavigate={go} onStore={id=>void changeStore(id)} versionPanel={versionPanel}/>;
    if(view==='other')return <OtherWorkspace store={selectedStore} onNavigate={go} onBack={()=>setView('home')}/>;
    if(view==='shortages')return <ShortagesWorkspace store={selectedStore} onNavigate={go} onBack={()=>setView('home')}/>;
    if(view==='transfers')return <TransfersWorkspace key={`${session.user.id}:${selectedStoreId}`} store={selectedStore} userId={session.user.id} returnLabel={`返回${viewTitles[transferReturn]||'首頁'}`} onBack={()=>setView(transferReturn)}/>;
    if(['incidents','handover','bulletins','company-tasks'].includes(view))return <>
      {view==='company-tasks'&&<><ReceivingActivity storeId={selectedStoreId} tasks onOpen={(id)=>{setReceiptReturnView('company-tasks');setReceiptBatchId(id);setReceiptStartPage('company-tasks');setView('receiving');}}/><ExpiryWasteActivity storeId={selectedStoreId} mode="tasks" onOpen={page=>openExpiry(page)}/></>}
      <RecordsWorkspace key={`${session.user.id}:${selectedStoreId}:${view}`} store={selectedStore} userId={session.user.id} section={view as RecordSection} pendingWork={view==='handover'?activity('tasks'):undefined} initialId={recordId} returnLabel={`返回${viewTitles[recordReturn]||'首頁'}`} onBack={()=>{setRecordId(undefined);setView(recordReturn);}}/>
    </>;
    if(view==='catalog'||view==='suppliers')return <CatalogWorkspace key={`${selectedStoreId}:${view}`} store={selectedStore} userId={session.user.id} section={view} onBack={()=>setView('home')} onImport={()=>openCount('import')} onReceiving={()=>openReceipt()} onReceipt={openReceipt}/>;
    if(view==='reports'||view==='exports'||view==='costs'||view==='audit')return <ReportsWorkspace key={`${selectedStoreId}:${view}`} userId={session.user.id} store={selectedStore} section={view} onBack={()=>setView('home')} onCount={id=>openCount('details',id)} onReceipt={openReceipt} onNavigate={go}/>;
    if(view==='business'||view==='preferences')return <BusinessSettings key={`${selectedStoreId}:${view}`} store={selectedStore} userId={session.user.id} section={view} onBack={()=>setView('settings')} onNavigate={go} onChanged={()=>loadWorkspace(session)}/>;
    if(view==='members'||view==='permissions')return <MembersWorkspace key={`${selectedStoreId}:${view}`} store={selectedStore} userId={session.user.id} section={view} onBack={()=>setView('settings')} onChanged={()=>loadWorkspace(session)}/>;
    if(view==='expiry'||view==='waste')return <ExpiryWasteWorkspace key={`${selectedStoreId}:${expiryStartPage}`} storeId={selectedStoreId} initialPage={expiryStartPage} returnLabel={expiryReturnView==='home'?'返回首頁':`返回${viewTitles[expiryReturnView]||'上一頁'}`} onBack={()=>setView(expiryReturnView)}/>;
    if(view==='receiving')return <ReceivingWorkspace key={`${selectedStoreId}:${receiptBatchId||'list'}`} storeId={selectedStoreId} organizationId={selectedStore.organization_id} role={role} businessType={currentBusinessType} initialBatchId={receiptBatchId} initialPage={receiptStartPage} returnLabel={receiptReturnView==='home'?'返回首頁':`返回${viewTitles[receiptReturnView]||'上一頁'}`} onBack={()=>setView(receiptReturnView)}/>;
    if(view==='activity'||view==='tasks'||view==='notifications')return activity(view);
    if(view==='settings')return <><h1>我的</h1><p>{profile.display_name}</p><p>{selectedStore.name}（{selectedStore.store_code}）</p><div className="shell-card shell-list"><button className="shell-list-row" onClick={()=>go('preferences')}><span><strong>設定</strong></span><b>›</b></button>{['OWNER','SUPERVISOR'].includes(role)&&<button className="shell-list-row" onClick={()=>go('members')}><span><strong>員工與權限</strong></span><b>›</b></button>}{role!=='STAFF'&&<button className="shell-list-row" onClick={()=>openCount('management')}><span><strong>盤點設定與資料</strong></span><b>›</b></button>}</div>{role!=='STAFF'&&profile.role!=='STAFF'&&!session.user.email?.endsWith('@auth.pantryflow.invalid')&&<ChangePasswordForm onChangePassword={changePassword}/>}<button className="text-button" onClick={signOut}>登出</button>{versionPanel}</>;
    return <CountWorkspace key={`${selectedStoreId}:${historicSession||'current'}`} stores={[selectedStore]} organizationId={selectedStore.organization_id} session={session} initialPage={countStartPage} initialSessionId={historicSession} returnLabel={`返回${viewTitles[countReturnView]||'首頁'}`} onBack={()=>setView(countReturnView)} canViewFullDetails={role!=='STAFF'} canManage={role==='SUPERVISOR'||role==='OWNER'} canImport={role==='SUPERVISOR'||role==='OWNER'||(role==='LOGISTICS'&&currentBusinessType==='SINGLE_RESTAURANT')} businessType={currentBusinessType} registerLeave={handler=>{leaveCount.current=handler;}}/>;
  };
  return <FormalAppShell role={role} businessType={currentBusinessType} storeName={selectedStore.name} stores={stores} storeId={selectedStoreId} onStoreChange={id=>void changeStore(id)} view={view} onNavigate={go}>{workspace()}</FormalAppShell>;
}
