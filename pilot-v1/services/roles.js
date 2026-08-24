const roleAliases={
  EMPLOYEE:'STAFF',STAFF:'STAFF',
  ADMIN:'ADMIN',SUPERVISOR:'SUPERVISOR',MANAGER:'SUPERVISOR',STORE_MANAGER:'SUPERVISOR',
  LOGISTICS:'LOGISTICS',BACKOFFICE:'LOGISTICS',OWNER:'OWNER'
};

export function normalizeStoreRole(value){return roleAliases[String(value||'').trim().toUpperCase()]||null}
export function homeRouteForRole(value){const role=normalizeStoreRole(value);if(role==='STAFF')return'#/employee/home';if(role==='ADMIN'||role==='SUPERVISOR')return'#/manager/home';return null}
export function roleHomeKind(value){const route=homeRouteForRole(value);return route==='#/employee/home'?'employee':route==='#/manager/home'?'manager':null}
