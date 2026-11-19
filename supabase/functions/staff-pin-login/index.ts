import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ||
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const serverKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SUPABASE_SECRET_KEY") || "";

function rejectLogin(correlationId: string) {
  return jsonResponse({ error: "INVALID_STAFF_CREDENTIALS", correlationId }, 401);
}

Deno.serve(async (req) => {
  const correlationId = crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED", correlationId }, 405);
  if (!supabaseUrl || !publishableKey || !serverKey) {
    return jsonResponse({ error: "LOGIN_TEMPORARILY_UNAVAILABLE", correlationId }, 503);
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  let storeCode = String(body.storeCode || "").trim().toUpperCase();
  let identifier = String(body.identifier || "").trim();
  const pin = String(body.pin || "");
  const contextOnly=body.action==='context';

  const admin = createClient(supabaseUrl, serverKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // The Edge gateway supplies the client address. Never persist the address,
  // identifier or PIN; rate-limit keys are one-way hashes, retained for one day.
  const address=(req.headers.get('x-forwarded-for')||req.headers.get('x-real-ip')||'unknown').split(',')[0].trim();
  for(const [scope,limit] of [[`ip:${address}`,60],[`identity:${storeCode}:${identifier.toLowerCase()}`,30]] as const) {
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(scope));
    const hash=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
    const rate=await admin.rpc('check_staff_login_rate',{p_key_hash:hash,p_limit:limit});
    if(rate.error)return jsonResponse({error:'LOGIN_TEMPORARILY_UNAVAILABLE',correlationId},503);
    if(rate.data!==true)return jsonResponse({error:'LOGIN_RATE_LIMITED',correlationId},429);
  }
  if(contextOnly) {
    const context=await admin.rpc('get_pilot_staff_login_context',{p_store_code:storeCode,p_identifier:null});
    if(context.error)return jsonResponse({error:'LOGIN_CONTEXT_NOT_FOUND',correlationId},400);
    const {storeName,storeCode:code,loginMode,policy}=context.data;
    return jsonResponse({context:{storeName,storeCode:code,loginMode,policy},correlationId});
  }
  if(body.action==='invitation'||body.invitationToken){
    const result=await admin.rpc('get_staff_invitation',{p_code:String(body.invitationToken||'')});
    if(result.error)return jsonResponse({error:'LOGIN_TEMPORARILY_UNAVAILABLE',correlationId},503);
    if(body.action==='invitation'){
      const {status,storeName,storeCode:code,loginMode}=result.data;
      return jsonResponse({context:{status,storeName,storeCode:code,loginMode},correlationId});
    }
    if(result.data?.status!=='VALID')return jsonResponse({error:'INVALID_ACTIVATION',invitationStatus:result.data?.status,correlationId},401);
    storeCode=result.data.storeCode;identifier=result.data.loginIdentifier;
    body.action='activate';body.activationCode=body.invitationToken;
  }
  if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(storeCode) || (!contextOnly&&(!identifier || !/^\d{6}$/.test(pin))) || identifier.length>64) {
    return jsonResponse({ error: "INVALID_LOGIN_INPUT", correlationId }, 400);
  }

  if (body.action !== "activate") {
    const resolved = await admin.rpc("get_pilot_staff_login_context", {p_store_code:storeCode, p_identifier:identifier});
    if (resolved.error && resolved.error.message !== "LOGIN_CONTEXT_NOT_FOUND") {
      return jsonResponse({error:"LOGIN_TEMPORARILY_UNAVAILABLE",correlationId},503);
    }
    if (!resolved.data?.loginIdentifier) return rejectLogin(correlationId);
    identifier = resolved.data.loginIdentifier;
  }

  if (body.action === "activate") {
    const code = String(body.activationCode || "");
    if (code.length < 32 || code.length > 128) return rejectLogin(correlationId);
    const { data: activated, error: activationError } = await admin.rpc("activate_staff_pin", {
      p_store_code: storeCode, p_identifier: identifier, p_code: code, p_pin: pin,
    });
    if (activationError) return jsonResponse({ error: "LOGIN_TEMPORARILY_UNAVAILABLE", correlationId }, 503);
    if (!activated) return jsonResponse({ error: "INVALID_ACTIVATION", correlationId }, 401);
  }

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
    return rejectLogin(correlationId);
  }
  if (result.outcome === "LOCKED") {
    return rejectLogin(correlationId);
  }
  if (result.outcome !== "OK" || !result.auth_email) {
    return rejectLogin(correlationId);
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
