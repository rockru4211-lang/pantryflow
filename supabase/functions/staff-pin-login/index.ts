import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ||
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const serverKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SUPABASE_SECRET_KEY") || "";

type AdminClient = ReturnType<typeof createClient<any>>;
type RejectionReason =
  | "STORE_CODE_NOT_FOUND"
  | "STAFF_IDENTIFIER_NOT_FOUND"
  | "INVALID_PIN"
  | "INACTIVE_MEMBERSHIP"
  | "INACTIVE_STORE";

function rejectLogin(correlationId: string, reason: RejectionReason) {
  console.warn(JSON.stringify({ event: "staff_pin_login_rejected", correlationId, reason }));
  return jsonResponse({ error: "INVALID_STAFF_CREDENTIALS", correlationId }, 401);
}

async function diagnosticReason(admin: AdminClient, storeCode: string, identifier: string): Promise<{
  reason: RejectionReason | null;
  storeId: string | null;
}> {
  const { data: store, error: storeError } = await admin.from("stores")
    .select("id,is_active")
    .ilike("store_code", storeCode)
    .maybeSingle();
  if (storeError || !store) return { reason: "STORE_CODE_NOT_FOUND", storeId: null };
  if (!store.is_active) return { reason: "INACTIVE_STORE", storeId: store.id };

  const { data: membership, error: membershipError } = await admin.from("store_memberships")
    .select("user_id,is_active")
    .eq("store_id", store.id)
    .ilike("login_identifier", identifier)
    .maybeSingle();
  if (membershipError || !membership) return { reason: "STAFF_IDENTIFIER_NOT_FOUND", storeId: store.id };
  if (!membership.is_active) return { reason: "INACTIVE_MEMBERSHIP", storeId: store.id };

  const { data: staff, error: staffError } = await admin.from("staff_identities")
    .select("is_active")
    .eq("user_id", membership.user_id)
    .maybeSingle();
  if (staffError || !staff?.is_active) return { reason: "INACTIVE_MEMBERSHIP", storeId: store.id };
  return { reason: null, storeId: store.id };
}

Deno.serve(async (req) => {
  const correlationId = crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED", correlationId }, 405);
  if (!supabaseUrl || !publishableKey || !serverKey) {
    return jsonResponse({ error: "LOGIN_TEMPORARILY_UNAVAILABLE", correlationId }, 503);
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const storeCode = String(body.storeCode || "").trim().toUpperCase();
  const identifier = String(body.identifier || "").trim();
  const pin = String(body.pin || "");
  if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(storeCode) || !identifier || !/^\d{6}$/.test(pin)) {
    return jsonResponse({ error: "INVALID_LOGIN_INPUT", correlationId }, 400);
  }

  const admin = createClient(supabaseUrl, serverKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const diagnostic = await diagnosticReason(admin, storeCode, identifier);
  if (diagnostic.reason) return rejectLogin(correlationId, diagnostic.reason);

  const { data: verification, error: verificationError } = await admin.rpc("verify_staff_pin", {
    p_store_code: storeCode,
    p_identifier: identifier,
    p_pin: pin,
  });
  if (verificationError) {
    console.error(JSON.stringify({ event: "staff_pin_verify_failed", correlationId, code: verificationError.code || "UNKNOWN" }));
    return jsonResponse({ error: "LOGIN_TEMPORARILY_UNAVAILABLE", correlationId }, 503);
  }
  const result = verification?.[0];
  if (!result || result.outcome === "INVALID" || result.outcome === "INACTIVE") {
    return rejectLogin(correlationId, "INVALID_PIN");
  }
  if (result.outcome === "LOCKED") {
    return rejectLogin(correlationId, "INVALID_PIN");
  }
  if (result.outcome !== "OK" || !result.auth_email) {
    return rejectLogin(correlationId, "INVALID_PIN");
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: result.auth_email,
  });
  const tokenHash = linkData?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    console.error(JSON.stringify({ event: "staff_auth_link_failed", correlationId }));
    return jsonResponse({ error: "LOGIN_TEMPORARILY_UNAVAILABLE", correlationId }, 503);
  }

  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: sessionData, error: sessionError } = await authClient.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (sessionError || !sessionData.session) {
    console.error(JSON.stringify({ event: "staff_session_exchange_failed", correlationId }));
    return jsonResponse({ error: "LOGIN_TEMPORARILY_UNAVAILABLE", correlationId }, 503);
  }

  return jsonResponse({
    session: {
      access_token: sessionData.session.access_token,
      refresh_token: sessionData.session.refresh_token,
      expires_at: sessionData.session.expires_at,
      expires_in: sessionData.session.expires_in,
      token_type: sessionData.session.token_type,
    },
    storeId: result.store_id,
    role: result.role,
    correlationId,
  });
});
