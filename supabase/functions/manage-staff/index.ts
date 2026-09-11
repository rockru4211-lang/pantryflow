import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { provisionStaffIdentity, createInternalAuthPassword } from "../_shared/staff-provisioning.js";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ||
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const serverKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SUPABASE_SECRET_KEY") || "";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const loginIdentifierPattern = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,63}$/u;

type AdminClient = ReturnType<typeof createClient<any>>;
type Caller = { organization_id: string; role: string; can_manage_business: boolean };

Deno.serve(async (req) => {
  const correlationId = crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED", correlationId }, 405);
  if (!supabaseUrl || !publishableKey || !serverKey) {
    return jsonResponse({ error: "SERVER_CONFIGURATION_MISSING", correlationId }, 500);
  }

  const authorization = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, serverKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return jsonResponse({ error: "UNAUTHORIZED", correlationId }, 401);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action || "create");
  const {data: context, error: contextError} = await userClient.rpc("get_app_context");
  const allowedStores = (context?.stores || []) as {id:string;organization_id:string;role:string;can_manage_business:boolean}[];
  const requestedStore = String(body.storeId || "");
  const scoped = allowedStores.find(store=>requestedStore ? store.id===requestedStore : action==="create_store"&&store.can_manage_business);
  if(contextError || !scoped || !(scoped.can_manage_business||scoped.role==="SUPERVISOR")) return jsonResponse({error:"STORE_MEMBERSHIP_REQUIRED",correlationId},403);
  const caller: Caller = {organization_id:scoped.organization_id,role:scoped.role,can_manage_business:scoped.can_manage_business};
  if (action === "create_store") return createStore(admin, caller, authData.user.id, body, correlationId);
  if (action === "create") return createStaff(admin, caller, authData.user.id, body, correlationId);
  if (action === "invite_management") return inviteManagement(admin, caller, authData.user.id, body, correlationId);
  if (action === "reset_pin") return resetPin(admin, caller, authData.user.id, body);
  if (action === "disable") return disableStaff(userClient, admin, caller, authData.user.id, body);
  return jsonResponse({ error: "INVALID_ACTION", correlationId }, 400);
});

async function inviteManagement(admin:AdminClient,caller:Caller,callerId:string,body:Record<string,unknown>,correlationId:string){
  if(!caller.can_manage_business)return jsonResponse({error:"OWNER_REQUIRED",correlationId},403);
  const email=String(body.email||"").trim().toLowerCase();
  const displayName=String(body.displayName||"").trim();
  const role=String(body.role||"");
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||!displayName||!["SUPERVISOR","LOGISTICS","OWNER"].includes(role))return jsonResponse({error:"INVALID_INVITE",correlationId},400);
  const {data:prepared,error:prepareError}=await admin.rpc("prepare_management_invite",{p_store_id:String(body.storeId||""),p_actor:callerId,p_email:email,p_name:displayName,p_role:role});
  if(prepareError||!prepared)return jsonResponse({error:prepareError?.message||"INVITE_PREPARE_FAILED",correlationId},400);
  if(!prepared.send_mail)return jsonResponse({email,pending:true,mailState:prepared.mail_state,inviteId:prepared.invite_id,correlationId});
  const redirectTo="https://pantryflow-app-shell-preview.rockru4211.chatgpt.site/?auth=invite";
  let failure:{code?:string;status?:number}|null=null;
  if(prepared.user_id){
    const sender=createClient(supabaseUrl,publishableKey,{auth:{persistSession:false,autoRefreshToken:false}});
    if(prepared.email_verified){
      const {error}=await sender.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:redirectTo.replace('auth=invite','auth=join')}});failure=error;
    }else{
      const {error}=await sender.auth.resend({type:'signup',email,options:{emailRedirectTo:redirectTo.replace('auth=invite','auth=signup')}});failure=error;
    }
  }else{
    const {error}=await admin.auth.admin.inviteUserByEmail(email,{redirectTo});failure=error;
  }
  const {error:deliveryError}=await admin.rpc('finish_management_invite_delivery',{p_invite_id:prepared.invite_id,p_attempt_id:prepared.mail_attempt_id,p_error:failure?.code|| (failure?'INVITE_EMAIL_FAILED':null)});
  if(failure)return jsonResponse({error:failure.code||"INVITE_EMAIL_FAILED",correlationId},failure.status||500);
  if(deliveryError)return jsonResponse({error:'INVITE_DELIVERY_STATUS_FAILED',correlationId},500);
  return jsonResponse({email,invited:true,inviteId:prepared.invite_id,existing:prepared.existing,correlationId},201);
}

async function createStore(admin: AdminClient, caller: Caller, callerId: string, body: Record<string, unknown>, correlationId: string) {
  if (!caller.can_manage_business) {
    return jsonResponse({ error: "ADMIN_REQUIRED", correlationId }, 403);
  }
  const storeCode = String(body.storeCode || "").trim().toUpperCase();
  const name = String(body.name || "").trim();
  const loginMode = String(body.loginMode || "NAME_OR_NICKNAME");
  if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(storeCode) || !name ||
    !["NAME_OR_NICKNAME", "EMPLOYEE_NUMBER"].includes(loginMode)) {
    return jsonResponse({ error: "INVALID_STORE_INPUT", correlationId }, 400);
  }

  const { count: storeCount, error: storeCountError } = await admin.from("stores")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", caller.organization_id);
  if (storeCountError) {
    return jsonResponse({ error: "STORE_CREATE_FAILED", correlationId }, 500);
  }
  const isFirstStore = (storeCount || 0) === 0;

  const { data: store, error } = await admin.from("stores").insert({
    organization_id: caller.organization_id,
    store_code: storeCode,
    name,
    staff_login_mode: loginMode,
    is_pilot_store: isFirstStore,
    created_by: callerId,
  }).select("id,store_code,name,staff_login_mode,is_pilot_store").single();
  if (error || !store) {
    return jsonResponse({
      error: error?.code === "23505" ? "STORE_CODE_ALREADY_EXISTS" : "STORE_CREATE_FAILED",
      correlationId,
    }, error?.code === "23505" ? 409 : 500);
  }
  const { error: membershipError } = await admin.from("store_memberships").insert({
    store_id: store.id,
    organization_id: caller.organization_id,
    user_id: callerId,
    login_identifier: `manager-${callerId}`,
    role: caller.role,
    work_role: caller.role,
    assigned_by: callerId,
  });
  if (membershipError) {
    await admin.from("stores").delete().eq("id", store.id).eq("organization_id", caller.organization_id);
    return jsonResponse({ error: "STORE_MEMBERSHIP_CREATE_FAILED", correlationId }, 500);
  }
  const { error: auditError } = await admin.from("audit_logs").insert({
    organization_id: caller.organization_id,
    user_id: callerId,
    action: "STORE_CREATED",
    entity_type: "store",
    entity_id: store.id,
    new_value: { store_code: store.store_code, is_first_store: isFirstStore },
  });
  if (auditError) {
    await admin.from("store_memberships").delete().eq("store_id", store.id).eq("user_id", callerId);
    await admin.from("stores").delete().eq("id", store.id).eq("organization_id", caller.organization_id);
    return jsonResponse({ error: "STORE_AUDIT_CREATE_FAILED", correlationId }, 500);
  }
  return jsonResponse({ store, correlationId }, 201);
}

function throwOnError(error: unknown, code: string) {
  if (!error) return;
  const source = error as { code?: string; message?: string };
  throw Object.assign(new Error(code), { databaseCode: source.code, databaseMessage: source.message });
}

function staffFailure(error: unknown) {
  const value = error as { message?: string; databaseCode?: string; databaseMessage?: string; cause?: unknown };
  const raw = `${value?.message || ""} ${value?.databaseCode || ""} ${value?.databaseMessage || ""}`;
  if (/STAFF_ALREADY_EXISTS|23505/i.test(raw)) return { error: "STAFF_ALREADY_EXISTS", status: 409 };
  if (/INVALID_STAFF|EMPLOYEE_NUMBER|22023|23514|22P02/i.test(raw)) return { error: "INVALID_STAFF_INPUT", status: 400 };
  if (/ROLE_NOT_ALLOWED/i.test(raw)) return { error: "ROLE_NOT_ALLOWED", status: 403 };
  if (/STORE_NOT_FOUND|23503/i.test(raw)) return { error: "STORE_NOT_FOUND", status: 404 };
  if (/STAFF_ROLLBACK_FAILED/i.test(raw)) return { error: "STAFF_ROLLBACK_FAILED", status: 500 };
  if (/STAFF_AUTH_CREATE_FAILED/i.test(raw)) return { error: "STAFF_AUTH_CREATE_FAILED", status: 500 };
  return { error: "STAFF_PROVISION_FAILED", status: 500 };
}

async function createStaff(admin: AdminClient, caller: Caller, callerId: string, body: Record<string, unknown>, correlationId: string) {
  const storeId = String(body.storeId || "");
  const displayName = String(body.displayName || "").trim();
  const loginIdentifier = String(body.loginIdentifier || "").trim();
  const activationCode = createInternalAuthPassword(crypto);
  const requestedRole = String(body.role || "STAFF");
  if (!uuidPattern.test(storeId) || !displayName || displayName.length > 80 ||
    !loginIdentifierPattern.test(loginIdentifier)) {
    return jsonResponse({ error: "INVALID_STAFF_INPUT", correlationId }, 400);
  }
  if (!["SUPERVISOR", "STAFF", "LOGISTICS", "OWNER"].includes(requestedRole) ||
    (requestedRole !== "STAFF" && !["ADMIN","OWNER"].includes(caller.role) && !caller.can_manage_business)) {
    return jsonResponse({ error: "ROLE_NOT_ALLOWED", correlationId }, 403);
  }

  const { data: store, error: storeError } = await admin.from("stores")
    .select("id,organization_id,store_code,staff_login_mode,is_active")
    .eq("id", storeId).eq("organization_id", caller.organization_id).eq("is_active", true).maybeSingle();
  if (storeError || !store) return jsonResponse({ error: "STORE_NOT_FOUND", correlationId }, 404);

  const { data: storePermission, error: storePermissionError } = await admin.from("store_memberships")
    .select("role,is_active")
    .eq("store_id", storeId)
    .eq("organization_id", caller.organization_id)
    .eq("user_id", callerId)
    .eq("is_active", true)
    .maybeSingle();
  if (storePermissionError || !storePermission) {
    return jsonResponse({ error: "STORE_MEMBERSHIP_REQUIRED", correlationId }, 403);
  }
  if (requestedRole !== "STAFF" && !["ADMIN","OWNER"].includes(storePermission.role) && !caller.can_manage_business) {
    return jsonResponse({ error: "ROLE_NOT_ALLOWED", correlationId }, 403);
  }

  const { data: duplicateLogin, error: duplicateLoginError } = await admin.from("store_memberships")
    .select("user_id").eq("store_id", storeId).ilike("login_identifier", loginIdentifier).maybeSingle();
  if (duplicateLoginError) return jsonResponse({ error: "STAFF_DUPLICATE_CHECK_FAILED", correlationId }, 500);
  if (duplicateLogin) return jsonResponse({ error: "STAFF_ALREADY_EXISTS", correlationId }, 409);

  const nickname = store.staff_login_mode === "NAME_OR_NICKNAME" ? loginIdentifier : null;
  const employeeNumber = store.staff_login_mode === "EMPLOYEE_NUMBER" ? loginIdentifier : null;
  const jobTitle = requestedRole === "OWNER" ? "老闆" : requestedRole === "LOGISTICS" ? "行政／後勤" : requestedRole === "SUPERVISOR" ? "主管" : "員工";

  const input = {
    storeId,
    organizationId: caller.organization_id,
    displayName,
    nickname,
    jobTitle,
    employeeNumber,
    loginIdentifier,
    role: requestedRole,
    activationCode,
    callerId,
  };

  const operations = {
    randomUUID: () => crypto.randomUUID(),
    crypto,
    createAuthUser: (payload: Parameters<typeof admin.auth.admin.createUser>[0]) =>
      admin.auth.admin.createUser(payload),
    updateProfile: async (userId: string) => {
      const { error } = await admin.from("profiles").update({
        organization_id: input.organizationId,
        display_name: input.displayName,
        role: input.role,
        store: "",
      }).eq("id", userId).select("id").single();
      throwOnError(error, "STAFF_PROFILE_CREATE_FAILED");
    },
    insertOrganizationMember: async (userId: string) => {
      const { error } = await admin.from("organization_members").insert({
        organization_id: input.organizationId,
        user_id: userId,
        role: input.role,
        is_active: true,
      });
      throwOnError(error, "STAFF_ORGANIZATION_MEMBERSHIP_FAILED");
    },
    insertStaffIdentity: async (userId: string) => {
      const { error } = await admin.from("staff_identities").insert({
        user_id: userId,
        organization_id: input.organizationId,
        display_name: input.displayName,
        nickname: input.nickname,
        job_title: input.jobTitle,
        employee_number: input.employeeNumber,
        created_by: input.callerId,
      });
      throwOnError(error, "STAFF_IDENTITY_CREATE_FAILED");
    },
    insertStoreMembership: async (userId: string) => {
      const { error } = await admin.from("store_memberships").insert({
        store_id: input.storeId,
        organization_id: input.organizationId,
        user_id: userId,
        login_identifier: input.loginIdentifier,
        role: input.role,
        assigned_by: input.callerId,
      });
      throwOnError(error, "STAFF_STORE_MEMBERSHIP_FAILED");
    },
    insertAuditSuccess: async (userId: string) => {
      const { error } = await admin.from("audit_logs").insert({
        organization_id: input.organizationId,
        user_id: input.callerId,
        action: "STAFF_PROVISIONED",
        entity_type: "staff_identity",
        entity_id: userId,
        new_value: { store_id: input.storeId, role: input.role, login_identifier: input.loginIdentifier },
      });
      throwOnError(error, "STAFF_AUDIT_CREATE_FAILED");
    },
    issueActivation: async (userId: string, code: string) => {
      const { error } = await admin.rpc("issue_staff_activation", { p_user_id: userId, p_code: code });
      throwOnError(error, "STAFF_ACTIVATION_CREATE_FAILED");
    },
    deletePin: async (userId: string) => {
      const { error } = await admin.rpc("delete_staff_pin_for_provisioning", { p_user_id: userId });
      return { error };
    },
    deleteAuthUser: async (userId: string) => {
      for (const table of ["store_memberships", "staff_identities", "organization_members"]) {
        const { error } = await admin.from(table).delete().eq("user_id", userId);
        if (error) return { error };
      }
      return admin.auth.admin.deleteUser(userId);
    },
  };

  try {
    const result = await provisionStaffIdentity(operations, input);
    return jsonResponse({ ...result, login: { storeCode: store.store_code, loginIdentifier, displayName, role: requestedRole, activationCode, expiresInDays: 7 }, correlationId }, 201);
  } catch (error) {
    const failure = staffFailure(error);
    console.error(JSON.stringify({ event: "staff_provision_failed", correlationId, error: failure.error }));
    return jsonResponse({ error: failure.error, correlationId }, failure.status);
  }
}

async function canManageExistingStaff(admin: AdminClient, callerId: string, storeId: string, staffId: string, canManageBusiness: boolean) {
  if (!uuidPattern.test(storeId)) return false;
  const { data: manager } = await admin.from("store_memberships").select("role")
    .eq("store_id", storeId).eq("user_id", callerId).eq("is_active", true)
    .maybeSingle();
  const { data: target } = await admin.from("store_memberships").select("role,organization_id")
    .eq("store_id", storeId).eq("user_id", staffId).eq("is_active", true).maybeSingle();
  if (staffId === callerId) return false;
  const {data: owner} = await admin.from("organization_members").select("is_owner,can_manage_business").eq("user_id",staffId).eq("organization_id",target?.organization_id||"").maybeSingle();
  return Boolean(!owner?.is_owner && (canManageBusiness||!owner?.can_manage_business) && manager && target && (canManageBusiness || target.role === "STAFF"));
}

async function resetPin(admin: AdminClient, caller: Caller, callerId: string, body: Record<string, unknown>) {
  const staffId = String(body.staffId || "");
  const pin = String(body.pin || "");
  if (!uuidPattern.test(staffId) || pin) {
    return jsonResponse({ error: "INVALID_PIN_RESET_INPUT" }, 400);
  }
  if (!await canManageExistingStaff(admin, callerId, String(body.storeId || ""), staffId, caller.can_manage_business)) {
    return jsonResponse({ error: "STORE_MEMBERSHIP_REQUIRED" }, 403);
  }
  const { data: staff } = await admin.from("staff_identities").select("user_id")
    .eq("user_id", staffId).eq("organization_id", caller.organization_id).eq("is_active", true).maybeSingle();
  if (!staff) return jsonResponse({ error: "STAFF_NOT_FOUND" }, 404);
  const activationCode = createInternalAuthPassword(crypto);
  const { error } = await admin.rpc("reset_staff_activation",{p_user_id:staffId,p_code:activationCode,p_actor:callerId,p_store_id:String(body.storeId||"")});
  if (error) return jsonResponse({ error: "PIN_RESET_FAILED" }, 500);
  await admin.from("audit_logs").insert({
    organization_id: caller.organization_id,
    user_id: callerId,
    action: "STAFF_PIN_RESET",
    entity_type: "staff_identity",
    entity_id: staffId,
    new_value: { staff_id: staffId },
  });
  return jsonResponse({ staffId, reset: true, activationCode, expiresInDays: 7 });
}

async function disableStaff(userClient: AdminClient, admin: AdminClient, caller: Caller, callerId: string, body: Record<string, unknown>) {
  const staffId = String(body.staffId || "");
  if (!uuidPattern.test(staffId) || staffId === callerId) {
    return jsonResponse({ error: "INVALID_DISABLE_TARGET" }, 400);
  }
  if (!await canManageExistingStaff(admin, callerId, String(body.storeId || ""), staffId, caller.can_manage_business)) {
    return jsonResponse({ error: "STORE_MEMBERSHIP_REQUIRED" }, 403);
  }
  const storeId=String(body.storeId||"");
  const {data:membership,error:readError}=await admin.from("store_memberships").select("updated_at,is_active").eq("store_id",storeId).eq("user_id",staffId).single();
  if(readError||!membership)return jsonResponse({error:"STAFF_NOT_FOUND"},404);
  if(!membership.is_active)return jsonResponse({staffId,disabled:true});
  const requestId=String(body.requestId||"");
  const {error}=await userClient.rpc("app_operation",{p_store_id:storeId,p_action:"member.offboard",p_data:{user_id:staffId,updated_at:membership.updated_at,handoff_to:body.handoffTo||null},p_request_id:uuidPattern.test(requestId)?requestId:crypto.randomUUID()});
  if(error)return jsonResponse({error:error.message||"STAFF_DISABLE_FAILED"},error.code==="42501"?403:400);
  return jsonResponse({staffId,disabled:true});
}
