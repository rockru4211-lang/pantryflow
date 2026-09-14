// Same role policy for the formal shell and isolated demo. The database rechecks every request.
export function managementPolicy(role, businessType, granted = false) {
 const stores = role !== 'STAFF' && !(businessType === 'CHAIN_RESTAURANT' && role === 'SUPERVISOR') && granted;
 const members = stores || role === 'SUPERVISOR';
 const assignable = !members ? [] : role === 'OWNER' ? ['STAFF','SUPERVISOR','LOGISTICS','OWNER'] : !stores ? ['STAFF'] : role === 'LOGISTICS' && businessType === 'SINGLE_RESTAURANT' ? ['STAFF','LOGISTICS'] : ['STAFF','SUPERVISOR','LOGISTICS'];
 return {can_manage_stores:stores,can_manage_members:members,assignable_roles:assignable};
}
