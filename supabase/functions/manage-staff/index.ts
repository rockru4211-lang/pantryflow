import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ||
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const serverKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SUPABASE_SECRET_KEY") || "";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pinPattern = /^\d{6}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!supabaseUrl || !publishableKey || !serverKey) {
    return jsonResponse({ error: "SERVER_CONFIGURATION_MISSING" }, 500);
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
  if (authError || !authData.user) return jsonResponse({ error: "UNAUTHORIZED" }, 401);

  const { data: caller, error: callerError } = await admin
    .from("organization_members")
    .select("organization_id,role,is_active")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .in("role", ["ADMIN", "SUPERVISOR"])
    .maybeSingle();
  if (callerError || !caller) return jsonResponse({ error: "SUPERVISOR_REQUIRED" }, 403);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action || "create");
  if (action === "create_store") return createStore(admin, caller, authData.user.id, body);
  if (action === "update_store_login_mode") return updateStoreLoginMode(admin, caller, authData.user.id, body);
  if (action === "create") return createStaff(admin, caller, authData.user.id, body);
  if (action === "reset_pin") return resetPin(admin, caller, authData.user.id, body);
  if (action === "disable") return disableStaff(admin, caller, authData.user.id, body);
  return jsonResponse({ error: "INVALID_ACTION" }, 400);
});

async function createStore(
  admin: ReturnType<typeof createClient>,
  caller: { organization_id: string; role: string },
  callerId: string,
  body: Record<string, unknown>,
) {
  if (caller.role !== "ADMIN") return jsonResponse({ error: "ADMIN_REQUIRED" }, 403);
  const storeCode = String(body.storeCode || "").trim();
  const name = String(body.name || "").trim();
  const loginMode = String(body.loginMode || "NAME_OR_NICKNAME");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$/.test(storeCode) || !name ||
    !["NAME_OR_NICKNAME", "EMPLOYEE_NUMBER"].includes(loginMode)) {
    return jsonResponse({ error: "INVALID_STORE_INPUT" }, 400);
  }
  const { data: store, error } = await admin.from("stores").insert({
    organization_id: caller.organization_id,
    store_code: storeCode,
    name,
    staff_login_mode: loginMode,
    is_pilot_store: Boolean(body.isPilotStore),
    created_by: callerId,
  }).select("id,store_code,name,staff_login_mode,is_pilot_store").single();
  if (error || !store) {
    return jsonResponse({ error: error?.code === "23505" ? "STORE_ALREADY_EXISTS" : "STORE_CREATE_FAILED" }, 400);
  }
  const { error: membershipError } = await admin.from("store_memberships").insert({
    store_id: store.id,
    organization_id: caller.organization_id,
    user_id: callerId,
    login_identifier: `manager-${callerId}`,
    role: "ADMIN",
    assigned_by: callerId,
  });
  if (membershipError) {
    await admin.from("stores").delete().eq("id", store.id).eq("organization_id", caller.organization_id);
    return jsonResponse({ error: "STORE_MEMBERSHIP_CREATE_FAILED" }, 500);
  }
  await writeAudit(admin, caller.organization_id, callerId, "STORE_CREATED", "store", store.id, {
    store_code: store.store_code, staff_login_mode: store.staff_login_mode, is_pilot_store: store.is_pilot_store,
  });
  return jsonResponse({ storeId: store.id, store }, 201);
}

async function hasStoreRole(
  admin: ReturnType<typeof createClient>, organizationId: string, storeId: string, userId: string, roles = ["ADMIN", "SUPERVISOR"],
) {
  const { data } = await admin.from("store_memberships").select("role").eq("organization_id", organizationId)
    .eq("store_id", storeId).eq("user_id", userId).eq("is_active", true).in("role", roles).maybeSingle();
  return data?.role || null;
}

async function writeAudit(
  admin: ReturnType<typeof createClient>, organizationId: string, userId: string, action: string,
  entityType: string, entityId: string, newValue: Record<string, unknown>,
) {
  const { error } = await admin.from("audit_logs").insert({
    organization_id: organizationId, user_id: userId, action, entity_type: entityType, entity_id: entityId, new_value: newValue,
  });
  if (error) console.error(JSON.stringify({ event: "audit_write_failed", action, entityId, error }));
}

async function updateStoreLoginMode(
  admin: ReturnType<typeof createClient>, caller: { organization_id: string }, callerId: string, body: Record<string, unknown>,
) {
  const storeId = String(body.storeId || "");
  const loginMode = String(body.loginMode || "");
  if (!uuidPattern.test(storeId) || !["NAME_OR_NICKNAME", "EMPLOYEE_NUMBER"].includes(loginMode)) {
    return jsonResponse({ error: "INVALID_STORE_INPUT" }, 400);
  }
  const role = await hasStoreRole(admin, caller.organization_id, storeId, callerId);
  if (!role) return jsonResponse({ error: "STORE_MANAGER_REQUIRED" }, 403);
  const { data, error } = await admin.from("stores").update({ staff_login_mode: loginMode, updated_at: new Date().toISOString() })
    .eq("id", storeId).eq("organization_id", caller.organization_id).select("id,staff_login_mode").single();
  if (error || !data) return jsonResponse({ error: "STORE_UPDATE_FAILED" }, 400);
  await writeAudit(admin, caller.organization_id, callerId, "STORE_LOGIN_MODE_UPDATED", "store", storeId, { staff_login_mode: loginMode });
  return jsonResponse({ store: data });
}

async function createStaff(
  admin: ReturnType<typeof createClient>,
  caller: { organization_id: string; role: string },
  callerId: string,
  body: Record<string, unknown>,
) {
  const storeId = String(body.storeId || "");
  const displayName = String(body.displayName || "").trim();
  const nickname = String(body.nickname || "").trim() || null;
  const jobTitle = String(body.jobTitle || "").trim() || null;
  const employeeNumber = String(body.employeeNumber || "").trim() || null;
  const pin = String(body.pin || "");
  const requestedRole = String(body.role || "STAFF");
  if (!uuidPattern.test(storeId) || !displayName || !pinPattern.test(pin)) {
    return jsonResponse({ error: "INVALID_STAFF_INPUT" }, 400);
  }
  if (!(["STAFF", "SUPERVISOR"].includes(requestedRole)) ||
    (requestedRole === "SUPERVISOR" && caller.role !== "ADMIN")) {
    return jsonResponse({ error: "ROLE_NOT_ALLOWED" }, 403);
  }

  const { data: store, error: storeError } = await admin.from("stores")
    .select("id,organization_id,staff_login_mode,is_active")
    .eq("id", storeId).eq("organization_id", caller.organization_id).eq("is_active", true).maybeSingle();
  if (storeError || !store) return jsonResponse({ error: "STORE_NOT_FOUND" }, 404);
  const managerRole = await hasStoreRole(admin, caller.organization_id, storeId, callerId);
  if (!managerRole) return jsonResponse({ error: "STORE_MANAGER_REQUIRED" }, 403);
  if (requestedRole === "SUPERVISOR" && managerRole !== "ADMIN") return jsonResponse({ error: "ROLE_NOT_ALLOWED" }, 403);
  if (store.staff_login_mode === "EMPLOYEE_NUMBER" && !employeeNumber) {
    return jsonResponse({ error: "EMPLOYEE_NUMBER_REQUIRED" }, 400);
  }
  const loginIdentifier = store.staff_login_mode === "EMPLOYEE_NUMBER"
    ? employeeNumber!
    : (nickname || displayName);

  const userId = crypto.randomUUID();
  const internalEmail = `staff+${userId}@auth.pantryflow.invalid`;
  const internalPassword = `${crypto.randomUUID()}${crypto.randomUUID()}Aa1!`;
  const { error: createError } = await admin.auth.admin.createUser({
    id: userId,
    email: internalEmail,
    password: internalPassword,
    email_confirm: true,
    user_metadata: { account_type: "STAFF_PIN", display_name: displayName },
  });
  if (createError) return jsonResponse({ error: "STAFF_AUTH_CREATE_FAILED" }, 500);

  try {
    const { error: profileError } = await admin.from("profiles").update({
      organization_id: caller.organization_id,
      display_name: displayName,
      role: requestedRole,
      store: "",
    }).eq("id", userId);
    if (profileError) throw profileError;
    const { error: orgMemberError } = await admin.from("organization_members").insert({
      organization_id: caller.organization_id,
      user_id: userId,
      role: requestedRole,
      is_active: true,
    });
    if (orgMemberError) throw orgMemberError;
    const { error: identityError } = await admin.from("staff_identities").insert({
      user_id: userId,
      organization_id: caller.organization_id,
      display_name: displayName,
      nickname,
      job_title: jobTitle,
      employee_number: employeeNumber,
      created_by: callerId,
    });
    if (identityError) throw identityError;
    const { error: membershipError } = await admin.from("store_memberships").insert({
      store_id: storeId,
      organization_id: caller.organization_id,
      user_id: userId,
      login_identifier: loginIdentifier,
      role: requestedRole,
      assigned_by: callerId,
    });
    if (membershipError) throw membershipError;
    const { error: pinError } = await admin.rpc("set_staff_pin", { p_user_id: userId, p_pin: pin });
    if (pinError) throw pinError;
    await writeAudit(admin, caller.organization_id, callerId, "STAFF_CREATED", "staff_identity", userId, {
      store_id: storeId, display_name: displayName, role: requestedRole,
    });
    return jsonResponse({ staffId: userId, storeId, role: requestedRole }, 201);
  } catch (error) {
    console.error(JSON.stringify({ event: "staff_provision_failed", userId, error }));
    await admin.auth.admin.deleteUser(userId);
    return jsonResponse({ error: "STAFF_PROVISION_FAILED" }, 500);
  }
}

async function resetPin(
  admin: ReturnType<typeof createClient>,
  caller: { organization_id: string },
  callerId: string,
  body: Record<string, unknown>,
) {
  const staffId = String(body.staffId || "");
  const pin = String(body.pin || "");
  if (!uuidPattern.test(staffId) || !pinPattern.test(pin)) {
    return jsonResponse({ error: "INVALID_PIN_RESET_INPUT" }, 400);
  }
  const { data: staff } = await admin.from("staff_identities").select("user_id")
    .eq("user_id", staffId).eq("organization_id", caller.organization_id).eq("is_active", true).maybeSingle();
  if (!staff) return jsonResponse({ error: "STAFF_NOT_FOUND" }, 404);
  const { data: targetMemberships } = await admin.from("store_memberships").select("store_id")
    .eq("user_id", staffId).eq("organization_id", caller.organization_id).eq("is_active", true);
  const manageable = await Promise.all((targetMemberships || []).map(item => hasStoreRole(admin, caller.organization_id, item.store_id, callerId)));
  if (!manageable.some(Boolean)) return jsonResponse({ error: "STORE_MANAGER_REQUIRED" }, 403);
  const { error } = await admin.rpc("set_staff_pin", { p_user_id: staffId, p_pin: pin });
  if (error) return jsonResponse({ error: "PIN_RESET_FAILED" }, 500);
  await writeAudit(admin, caller.organization_id, callerId, "STAFF_PIN_RESET", "staff_identity", staffId, { staff_id: staffId });
  return jsonResponse({ staffId, reset: true });
}

async function disableStaff(
  admin: ReturnType<typeof createClient>,
  caller: { organization_id: string },
  callerId: string,
  body: Record<string, unknown>,
) {
  const staffId = String(body.staffId || "");
  if (!uuidPattern.test(staffId) || staffId === callerId) {
    return jsonResponse({ error: "INVALID_DISABLE_TARGET" }, 400);
  }
  const { data: targetMemberships } = await admin.from("store_memberships").select("store_id")
    .eq("user_id", staffId).eq("organization_id", caller.organization_id).eq("is_active", true);
  const manageable = await Promise.all((targetMemberships || []).map(item => hasStoreRole(admin, caller.organization_id, item.store_id, callerId)));
  if (!manageable.some(Boolean)) return jsonResponse({ error: "STORE_MANAGER_REQUIRED" }, 403);
  const now = new Date().toISOString();
  const { data: staff, error } = await admin.from("staff_identities")
    .update({ is_active: false, disabled_at: now, disabled_by: callerId, updated_at: now })
    .eq("user_id", staffId).eq("organization_id", caller.organization_id).eq("is_active", true)
    .select("user_id").maybeSingle();
  if (error || !staff) return jsonResponse({ error: "STAFF_NOT_FOUND" }, 404);
  await admin.from("store_memberships").update({ is_active: false, updated_at: now })
    .eq("user_id", staffId).eq("organization_id", caller.organization_id);
  await admin.from("organization_members").update({ is_active: false })
    .eq("user_id", staffId).eq("organization_id", caller.organization_id);
  await admin.auth.admin.updateUserById(staffId, { ban_duration: "876000h" });
  await writeAudit(admin, caller.organization_id, callerId, "STAFF_DISABLED", "staff_identity", staffId, { disabled_at: now });
  return jsonResponse({ staffId, disabled: true });
}
