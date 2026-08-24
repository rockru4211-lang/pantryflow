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
  return jsonResponse({ store }, 201);
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
  const { error } = await admin.rpc("set_staff_pin", { p_user_id: staffId, p_pin: pin });
  if (error) return jsonResponse({ error: "PIN_RESET_FAILED" }, 500);
  await admin.from("audit_logs").insert({
    organization_id: caller.organization_id,
    user_id: callerId,
    action: "STAFF_PIN_RESET",
    entity_type: "staff_identity",
    entity_id: staffId,
    new_value: { staff_id: staffId },
  });
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
  return jsonResponse({ staffId, disabled: true });
}

