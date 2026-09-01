export const SHELL_ROLES = {
  STAFF: { label: '員工', home: 'employee', accent: 'green' },
  SUPERVISOR: { label: '店長／主管', home: 'manager', accent: 'orange' },
  LOGISTICS: { label: '後勤／管理', home: 'logistics', accent: 'blue' },
  OWNER: { label: 'Owner／管理者', home: 'owner', accent: 'purple' },
};

export const MAIN_NAV = [
  { id: 'home', label: '首頁', icon: 'home' },
  { id: 'activity', label: '作業紀錄', icon: 'activity' },
  { id: 'tasks', label: '待辦', icon: 'tasks' },
  { id: 'notifications', label: '通知', icon: 'bell' },
  { id: 'profile', label: '我的', icon: 'user' },
];

export const OPERATIONS = [
  { id: 'count', label: '盤點', icon: 'clipboard', roles: ['STAFF', 'SUPERVISOR', 'LOGISTICS', 'OWNER'] },
  { id: 'receiving', label: '進貨', icon: 'truck', roles: ['STAFF', 'SUPERVISOR', 'LOGISTICS', 'OWNER'] },
  { id: 'ordering', label: '叫貨', icon: 'package', roles: ['STAFF', 'SUPERVISOR'] },
  { id: 'expiry', label: '效期巡檢', icon: 'calendarClock', roles: ['STAFF', 'SUPERVISOR'] },
  { id: 'waste', label: '廢棄', icon: 'trash', roles: ['STAFF', 'SUPERVISOR', 'LOGISTICS', 'OWNER'] },
  { id: 'transfers', label: '跨店借貸', icon: 'arrowRight', roles: ['STAFF', 'SUPERVISOR', 'LOGISTICS', 'OWNER'] },
  { id: 'incidents', label: '異常回報', icon: 'warning', roles: ['STAFF', 'SUPERVISOR', 'LOGISTICS', 'OWNER'] },
  { id: 'handover', label: '交接', icon: 'activity', roles: ['STAFF', 'SUPERVISOR'] },
];

export const MANAGEMENT = [
  { id: 'catalog', label: '商品／編碼', icon: 'package', roles: ['SUPERVISOR', 'LOGISTICS', 'OWNER'] },
  { id: 'suppliers', label: '供應商', icon: 'truck', roles: ['LOGISTICS', 'OWNER'] },
  { id: 'recipes', label: '配方', icon: 'book', roles: ['LOGISTICS', 'OWNER'], future: true },
  { id: 'costs', label: '成本分析', icon: 'chart', roles: ['LOGISTICS', 'OWNER'] },
  { id: 'reports', label: '報表中心', icon: 'fileText', roles: ['LOGISTICS', 'OWNER'] },
  { id: 'members', label: '成員與權限', icon: 'users', roles: ['OWNER'] },
  { id: 'business', label: '商家設定', icon: 'building', roles: ['OWNER'] },
  { id: 'permissions', label: '模組權限', icon: 'shield', roles: ['OWNER'] },
  { id: 'exports', label: '資料匯出', icon: 'download', roles: ['OWNER'] },
  { id: 'audit', label: 'Audit Log', icon: 'fileText', roles: ['OWNER'] },
  { id: 'settings', label: '設定', icon: 'settings', roles: ['SUPERVISOR', 'LOGISTICS', 'OWNER'] },
];

const routeRoles = new Map([...OPERATIONS, ...MANAGEMENT].map(item => [item.id, item.roles]));

[
  [['count-zones', 'count-entry', 'count-complete', 'count-finished', 'count-finished-direct', 'count-paper', 'count-paper-complete'], ['STAFF', 'SUPERVISOR']],
  [['count-setup', 'count-import', 'count-scope', 'count-task', 'count-review'], ['SUPERVISOR']],
  [['count-analysis'], ['LOGISTICS']],
  [['count-policy'], ['OWNER']],
  [['receiving-upload', 'receiving-status'], ['STAFF', 'SUPERVISOR']],
  [['receiving-review', 'receiving-mapping'], ['LOGISTICS']],
  [['receiving-published'], ['LOGISTICS', 'OWNER']],
].forEach(([routes, roles]) => routes.forEach(route => routeRoles.set(route, roles)));

export function roleMeta(role) {
  return SHELL_ROLES[role] || SHELL_ROLES.STAFF;
}

export function roleCanOpen(role, route) {
  const allowed = routeRoles.get(route);
  return !allowed || allowed.includes(role);
}

export function hashFor(role, route = 'home') {
  return `#/${roleMeta(role).home}/${route}`;
}

export function routeFromHash(hash = location.hash) {
  const parts = String(hash).replace(/^#\/?/, '').split('/').filter(Boolean);
  return parts[1] || 'home';
}

export function visibleItems(items, role) {
  return items.filter(item => !item.roles || item.roles.includes(role));
}
