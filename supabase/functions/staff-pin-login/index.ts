import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ||
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const serverKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SUPABASE_SECRET_KEY") || "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!supabaseUrl || !publishableKey || !serverKey) {
    return jsonResponse({ error: "SERVER_CONFIGURATION_MISSING" }, 500);
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const storeCode = String(body.storeCode || "").trim();
  const identifier = String(body.identifier || "").trim();
  const pin = String(body.pin || "");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$/.test(storeCode) || !identifier || !/^\d{6}$/.test(pin)) {
    return jsonResponse({ error: "INVALID_LOGIN_INPUT" }, 400);
  }

  const admin = createClient(supabaseUrl, serverKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: verification, error: verificationError } = await admin.rpc("verify_staff_pin", {
    p_store_code: storeCode,
    p_identifier: identifier,
    p_pin: pin,
  });
  if (verificationError) {
    console.error(JSON.stringify({ event: "staff_pin_verify_failed", verificationError }));
    return jsonResponse({ error: "LOGIN_TEMPORARILY_UNAVAILABLE" }, 503);
  }
  const result = verification?.[0];
  if (!result || result.outcome === "INVALID") {
    return jsonResponse({ error: "INVALID_STAFF_CREDENTIALS" }, 401);
  }
  if (result.outcome === "LOCKED") {
    return jsonResponse({ error: "PIN_LOCKED", lockedUntil: result.locked_until }, 423);
  }
  if (result.outcome !== "OK" || !result.auth_email) {
    return jsonResponse({ error: "INVALID_STAFF_CREDENTIALS" }, 401);
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: result.auth_email,
  });
  const tokenHash = linkData?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    console.error(JSON.stringify({ event: "staff_auth_link_failed", userId: result.user_id, linkError }));
    return jsonResponse({ error: "LOGIN_TEMPORARILY_UNAVAILABLE" }, 503);
  }

  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: sessionData, error: sessionError } = await authClient.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (sessionError || !sessionData.session) {
    console.error(JSON.stringify({ event: "staff_session_exchange_failed", userId: result.user_id, sessionError }));
    return jsonResponse({ error: "LOGIN_TEMPORARILY_UNAVAILABLE" }, 503);
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
  });
});
