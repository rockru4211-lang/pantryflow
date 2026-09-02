export const SHELL_ROLES = {
  STAFF: { label: '員工', home: 'employee', accent: 'green' },
  SUPERVISOR: { label: '店長／主管', home: 'manager', accent: 'orange' },
  LOGISTICS: { label: '後勤／管理', home: 'logistics', accent: 'blue' },
  OWNER: { label: 'Owner／管理者', home: 'owner', accent: 'purple' },
};

export const BUSINESS_TYPES = {
  CHAIN_RESTAURANT: { label: '連鎖餐飲', copy: '現場執行＋跨店管理；正式後勤由 ERP 承接' },
  INDEPENDENT_RESTAURANT: { label: '獨立餐廳', copy: '現場、行政與資料維護集中在序' },
};

export const ROLE_OPTIONS = {
  CHAIN_RESTAURANT: [
    { role: 'STAFF', label: '員工' },
    { role: 'SUPERVISOR', label: '店長' },
    { role: 'LOGISTICS', label: '區主管' },
    { role: 'OWNER', label: '老闆' },
  ],
  INDEPENDENT_RESTAURANT: [
    { role: 'STAFF', label: '員工' },
    { role: 'SUPERVISOR', label: '主管' },
    { role: 'LOGISTICS', label: '行政／後勤' },
    { role: 'OWNER', label: '老闆' },
    { role: 'FINANCE', label: '財務', future: true },
  ],
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
  { id: 'expiry', label: '效期提醒', icon: 'calendarClock', roles: ['STAFF', 'SUPERVISOR'] },
  { id: 'waste', label: '廢棄', icon: 'trash', roles: ['STAFF', 'SUPERVISOR', 'LOGISTICS', 'OWNER'] },
  { id: 'transfers', label: '跨店借貸', icon: 'arrowRight', roles: ['STAFF', 'SUPERVISOR', 'LOGISTICS', 'OWNER'] },
  { id: 'incidents', label: '異常回報', icon: 'warning', roles: ['STAFF', 'SUPERVISOR', 'LOGISTICS', 'OWNER'] },
  { id: 'handover', label: '交接', icon: 'activity', roles: ['STAFF', 'SUPERVISOR'] },
];

export const MANAGEMENT = [
  { id: 'catalog', label: '商品／編碼', icon: 'package', roles: ['SUPERVISOR', 'LOGISTICS', 'OWNER'] },
  { id: 'bulletins', label: '公佈欄', icon: 'bell', roles: ['SUPERVISOR', 'LOGISTICS'] },
  { id: 'company-reminders', label: '公司流程', icon: 'tasks', roles: ['LOGISTICS', 'OWNER'], businessTypes: ['CHAIN_RESTAURANT'] },
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

const routeRules = new Map([...OPERATIONS, ...MANAGEMENT].map(item => [item.id, { roles: item.roles, businessTypes: item.businessTypes }]));

[
  [['count-zones', 'count-entry', 'count-complete', 'count-finished'], ['STAFF', 'SUPERVISOR']],
  [['count-finished-direct'], ['STAFF', 'SUPERVISOR'], ['INDEPENDENT_RESTAURANT']],
  [['count-paper', 'count-paper-complete'], ['STAFF', 'SUPERVISOR'], ['CHAIN_RESTAURANT']],
  [['count-setup', 'count-import', 'count-assign', 'count-order', 'count-task', 'count-review', 'count-completed'], ['SUPERVISOR']],
  [['count-scope'], ['SUPERVISOR'], ['INDEPENDENT_RESTAURANT']],
  [['count-analysis'], ['LOGISTICS']],
  [['count-policy'], ['OWNER']],
  [['receiving-upload', 'receiving-status'], ['STAFF', 'SUPERVISOR']],
  [['receiving-erp-complete'], ['STAFF', 'SUPERVISOR'], ['CHAIN_RESTAURANT']],
  [['store-company-tasks'], ['STAFF', 'SUPERVISOR'], ['CHAIN_RESTAURANT']],
  [['receiving-issues'], ['SUPERVISOR']],
  [['receiving-review', 'receiving-mapping'], ['LOGISTICS'], ['INDEPENDENT_RESTAURANT']],
  [['receiving-published'], ['LOGISTICS', 'OWNER']],
  [['expiry-inbound', 'expiry-edge', 'expiry-inspection', 'expiry-watchlist', 'expiry-alerts', 'expiry-suggest', 'expiry-inspection-record', 'expiry-issue', 'expiry-expired', 'expiry-discard', 'expiry-discard-complete', 'expiry-zone-cold', 'expiry-zone-work', 'expiry-zone-freezer', 'expiry-lot-cream', 'expiry-lot-beef', 'expiry-lot-ham', 'expiry-result-inspected', 'expiry-result-normal', 'expiry-result-label', 'expiry-quantity-reason', 'expiry-result-used', 'expiry-result-waste', 'expiry-result-waste-chain', 'expiry-result-quantity', 'expiry-erp-waste-complete'], ['STAFF', 'SUPERVISOR']],
  [['bulletin-board'], ['STAFF', 'SUPERVISOR']],
].forEach(([routes, roles, businessTypes]) => routes.forEach(route => routeRules.set(route, { roles, businessTypes })));

export function roleOptions(businessType = 'CHAIN_RESTAURANT') {
  return ROLE_OPTIONS[businessType] || ROLE_OPTIONS.CHAIN_RESTAURANT;
}

export function roleMeta(role, businessType = 'CHAIN_RESTAURANT') {
  const base = SHELL_ROLES[role] || SHELL_ROLES.STAFF;
  const option = roleOptions(businessType).find(item => item.role === role);
  const home = role === 'LOGISTICS' ? (businessType === 'CHAIN_RESTAURANT' ? 'area' : 'backoffice') : base.home;
  return { ...base, home, label: option?.label || base.label };
}

export function roleCanOpen(role, route, businessType = 'CHAIN_RESTAURANT') {
  const rule = routeRules.get(route);
  if (!rule) return true;
  if (rule.businessTypes && !rule.businessTypes.includes(businessType)) return false;
  return !rule.roles || rule.roles.includes(role);
}

export function hashFor(role, route = 'home', businessType = 'CHAIN_RESTAURANT') {
  return `#/${roleMeta(role, businessType).home}/${route}`;
}

export function routeFromHash(hash = location.hash) {
  const parts = String(hash).replace(/^#\/?/, '').split('/').filter(Boolean);
  return parts[1] || 'home';
}

export function visibleItems(items, role, businessType = 'CHAIN_RESTAURANT') {
  return items.filter(item => (!item.roles || item.roles.includes(role)) && (!item.businessTypes || item.businessTypes.includes(businessType)));
}
