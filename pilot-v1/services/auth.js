import { db } from './supabase.js';
import { normalizeStoreCode } from './validation.js';

export { normalizeStoreCode } from './validation.js';

function codedError(code, status = 0, correlationId = '') {
  const error = new Error(code || 'REQUEST_FAILED');
  error.code = code || 'REQUEST_FAILED';
  error.status = status;
  error.correlationId = correlationId;
  return error;
}

async function functionPayload(error, data) {
  if (data?.error) return data;
  const response = error?.context;
  if (typeof Response !== 'undefined' && response instanceof Response) {
    try { return await response.clone().json(); } catch { return {}; }
  }
  return {};
}

async function invoke(functionName, body) {
  const { data, error } = await db.functions.invoke(functionName, { body });
  if (!error && !data?.error) return data;
  const payload = await functionPayload(error, data);
  throw codedError(payload.error || data?.error || 'NETWORK_REQUEST_FAILED', error?.context?.status || 0, payload.correlationId || '');
}

export async function signIn(email, password) {
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

export async function signUpOwner(displayName, email, password) {
  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${location.origin}${location.pathname}`, data: { display_name: displayName } },
  });
  if (error) throw error;
  return data;
}

export async function staffPinLogin(storeCode, identifier, pin) {
  const data = await invoke('staff-pin-login', { storeCode: normalizeStoreCode(storeCode), identifier: String(identifier).trim(), pin });
  if (!data?.session) throw codedError('STAFF_LOGIN_FAILED', 401, data?.correlationId);
  const result = await db.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  if (result.error) throw result.error;
  return data.storeId;
}

export async function signOut() {
  const { error } = await db.auth.signOut();
  if (error) throw error;
}

export async function profile(userId) {
  const { data, error } = await db.from('profiles').select('id,organization_id,display_name,role').eq('id', userId).single();
  if (error) throw error;
  data.is_owner = false;
  data.organization_name = '';
  if (data.organization_id) {
    const [member, organization] = await Promise.all([
      db.from('organization_members').select('is_owner,role').eq('organization_id', data.organization_id).eq('user_id', userId).eq('is_active', true).single(),
      db.from('organizations').select('id,name').eq('id', data.organization_id).single(),
    ]);
    if (member.error) throw member.error;
    if (organization.error) throw organization.error;
    data.is_owner = Boolean(member.data?.is_owner);
    data.organization_role = member.data?.role || data.role;
    data.organization_name = organization.data?.name || '';
  }
  return data;
}

export async function createOwnerBusiness(input) {
  const { data, error } = await db.rpc('create_owner_business', {
    p_organization_name: String(input.organizationName || '').trim(),
    p_business_type: input.businessType || 'SINGLE_RESTAURANT',
    p_store_name: String(input.storeName || '').trim(),
    p_store_code: normalizeStoreCode(input.storeCode),
    p_staff_login_mode: input.loginMode || 'NAME_OR_NICKNAME',
  });
  if (error) throw codedError(error.message || error.code, 400);
  return data;
}

export async function createStore(input) {
  return invoke('manage-staff', {
    action: 'create_store',
    name: String(input.name || '').trim(),
    storeCode: normalizeStoreCode(input.storeCode),
    loginMode: input.loginMode || 'NAME_OR_NICKNAME',
    isPilotStore: Boolean(input.isFirstStore),
  });
}

export async function createStaff(input) {
  return invoke('manage-staff', {
    action: 'create',
    storeId: input.storeId,
    displayName: String(input.displayName || '').trim(),
    loginIdentifier: String(input.loginIdentifier || '').trim(),
    role: input.role || 'STAFF',
    pin: input.pin,
  });
}

export async function resetStaffPin(staffId, pin) {
  return invoke('manage-staff', { action: 'reset_pin', staffId, pin });
}

export async function disableStaff(staffId) {
  return invoke('manage-staff', { action: 'disable', staffId });
}
