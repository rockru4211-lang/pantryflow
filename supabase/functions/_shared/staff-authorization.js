export const STORE_MANAGER_ROLES = Object.freeze(['ADMIN', 'SUPERVISOR']);

export function hasTargetStoreManagerAccess({
  callerId,
  organizationId,
  storeId,
  store,
  membership,
}) {
  return Boolean(
    callerId && organizationId && storeId &&
    store?.id === storeId &&
    store?.organization_id === organizationId &&
    store?.is_active === true &&
    membership?.user_id === callerId &&
    membership?.store_id === storeId &&
    membership?.organization_id === organizationId &&
    membership?.is_active === true &&
    STORE_MANAGER_ROLES.includes(membership?.role),
  );
}

export function managesEveryTargetStore({ callerId, organizationId, targetStoreIds, memberships }) {
  const allowed = new Set((memberships || []).filter(item =>
    item.user_id === callerId &&
    item.organization_id === organizationId &&
    item.is_active === true &&
    STORE_MANAGER_ROLES.includes(item.role)
  ).map(item => item.store_id));
  return targetStoreIds.length > 0 && targetStoreIds.every(storeId => allowed.has(storeId));
}
