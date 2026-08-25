import { db } from './supabase.js';

export async function signIn(email, password) {
  const { data, error } = await db.auth.signInWithPassword({ email: String(email).trim().toLowerCase(), password });
  if (error) throw error;
  return data.session;
}

export async function signUpOwner(displayName, email, password) {
  const { data, error } = await db.auth.signUp({
    email: String(email).trim().toLowerCase(),
    password,
    options: {
      emailRedirectTo: `${location.origin}${location.pathname}`,
      // Display data is copied to public.profiles by the Auth trigger. It is
      // deliberately not used for authorization.
      data: { display_name: String(displayName).trim() },
    },
  });
  if (error) throw error;
  return data;
}

async function invoke(functionName, body, fallback) {
  const { data, error } = await db.functions.invoke(functionName, { body });
  if (!error && !data?.error) return data;

  let code = data?.error || '';
  const status = error?.context?.status || null;
  if (!code && error?.context?.json) {
    try {
      const details = await error.context.json();
      code = details?.error || '';
    } catch {
      // The response may already be consumed. Keep the public fallback below.
    }
  }
  const failure = new Error(code || fallback);
  failure.status = status;
  throw failure;
}

export async function staffPinLogin(storeCode, identifier, pin) {
  const data = await invoke('staff-pin-login', {
    storeCode: String(storeCode).trim().toUpperCase(),
    identifier: String(identifier).trim(),
    pin,
  }, 'STAFF_LOGIN_FAILED');
  if (!data?.session) throw new Error('STAFF_LOGIN_FAILED');
  const result = await db.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  if (result.error) throw result.error;
  return data.storeId;
}

export async function signOut() {
  const { error } = await db.auth.signOut();
  if (error) throw error;
}

export async function profile(userId) {
  const { data, error } = await db.from('profiles')
    .select('id,organization_id,display_name,role')
    .eq('id', userId)
    .single();
  if (error) throw error;
  data.is_owner = false;
  if (data.organization_id) {
    const member = await db.from('organization_members')
      .select('is_owner,role,is_active')
      .eq('organization_id', data.organization_id)
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();
    if (member.error) throw member.error;
    data.is_owner = Boolean(member.data?.is_owner);
    data.organization_role = member.data?.role || null;
  }
  return data;
}

export async function createOwnerBusiness(input) {
  const { data, error } = await db.rpc('create_owner_business', {
    p_organization_name: String(input.organizationName).trim(),
    p_business_type: input.businessType,
    p_store_name: String(input.storeName).trim(),
    p_store_code: String(input.storeCode).trim().toUpperCase(),
    p_staff_login_mode: input.loginMode,
  });
  if (error) throw error;
  return data;
}

export async function createStore(input, { isFirstStore = false } = {}) {
  return invoke('manage-staff', {
    action: 'create_store',
    name: String(input.name).trim(),
    storeCode: String(input.storeCode).trim().toUpperCase(),
    loginMode: input.loginMode,
    isPilotStore: Boolean(isFirstStore),
  }, 'STORE_CREATE_FAILED');
}

export async function createStaff(input) {
  return invoke('manage-staff', {
    action: 'create',
    requestId: input.requestId || crypto.randomUUID(),
    storeId: input.storeId,
    displayName: String(input.displayName).trim(),
    loginIdentifier: String(input.loginIdentifier).trim(),
    role: input.role || 'STAFF',
    pin: input.pin,
  }, 'STAFF_CREATE_FAILED');
}

export async function resetStaffPin(staffId, pin) {
  return invoke('manage-staff', { action: 'reset_pin', staffId, pin }, 'PIN_RESET_FAILED');
}

export async function disableStaff(staffId) {
  return invoke('manage-staff', { action: 'disable', staffId }, 'STAFF_DISABLE_FAILED');
}
