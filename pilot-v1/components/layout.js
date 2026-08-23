const roleLabels={OWNER:'Owner',ADMIN:'管理者',SUPERVISOR:'主管',LOGISTICS:'後勤',STAFF:'員工'};
const roleClasses={OWNER:'role-owner',ADMIN:'role-admin',SUPERVISOR:'role-supervisor',LOGISTICS:'role-logistics',STAFF:'role-staff'};
export function layout({storeName,role,page,content,displayName}){
  const items=[['home','首頁'],['activity','作業紀錄'],['notifications','通知'],['profile','我的']];
  return `<div class="shell ${roleClasses[role]||'role-staff'}"><header class="app-topbar"><div class="topbar-line"><div class="topbar-brand"><span class="mini-mark">P</span>PantryFlow</div><span class="role-pill">${escapeHtml(roleLabels[role]||role||'')}</span></div><div class="store-line"><p>${escapeHtml(displayName||'')}，歡迎回來</p><h1>${escapeHtml(storeName||'封閉 Pilot')}</h1></div></header>${content}</div><nav class="bottom-nav" aria-label="主要導覽">${items.map(([id,label])=>`<button data-route="${id}" class="${page===id?'active':''}" aria-current="${page===id?'page':'false'}">${label}</button>`).join('')}</nav>`;
}
export function emptyState(title,copy){return `<section class="card empty"><span class="empty-icon">✓</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(copy)}</p></section>`}
export function escapeHtml(value=''){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
