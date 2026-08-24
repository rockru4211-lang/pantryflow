const roleLabels={OWNER:'Owner',ADMIN:'管理者',SUPERVISOR:'主管',LOGISTICS:'後勤',STAFF:'員工'};
const roleClasses={OWNER:'role-owner',ADMIN:'role-admin',SUPERVISOR:'role-supervisor',LOGISTICS:'role-logistics',STAFF:'role-staff'};
export function layout({storeName,role,page,content,displayName}){
  const items=[['home','首頁'],['activity','作業紀錄'],['notifications','通知'],['profile','我的']];
  const greeting=formalUiText(displayName,'管理者');
  return `<div class="shell ${roleClasses[role]||'role-staff'}"><header class="app-topbar"><button class="store-switch" data-store-switch type="button" aria-label="切換門市"><span>門市</span><b>⌄</b></button><div class="topbar-brand"><span class="mini-mark">P</span><strong>PantryFlow</strong></div><button class="notification-button" data-route="notifications" type="button" aria-label="通知">◔</button></header><div class="home-greeting"><p>${escapeHtml(greeting)}，歡迎回來</p><span class="role-pill">${escapeHtml(roleLabels[role]||role||'')}</span></div>${content}</div><nav class="bottom-nav" aria-label="主要導覽">${items.map(([id,label])=>`<button data-route="${id}" class="${page===id?'active':''}" aria-current="${page===id?'page':'false'}">${label}</button>`).join('')}</nav>`;
}
export function emptyState(title,copy){return `<section class="card empty"><span class="empty-icon">✓</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(copy)}</p></section>`}
export function escapeHtml(value=''){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
export function formalUiText(value='',fallback='PantryFlow'){const cleaned=String(value).replace(/封閉 Pilot|BeApe|legacy-demo|preview|pilot-v1/gi,'').replace(/^[\s｜|·—–-]+|[\s｜|·—–-]+$/g,'').trim();return cleaned||fallback}
