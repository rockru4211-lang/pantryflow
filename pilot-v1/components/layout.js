const roleLabels={OWNER:'Owner／管理者',ADMIN:'店長／主管',SUPERVISOR:'店長／主管',LOGISTICS:'後勤／管理',STAFF:'員工'};
const roleClasses={OWNER:'role-owner',ADMIN:'role-manager',SUPERVISOR:'role-manager',LOGISTICS:'role-logistics',STAFF:'role-employee'};
export function layout({storeName,role,page,content,displayName}){
  const items=[['home','首頁'],['activity','作業紀錄'],['scan','掃描'],['notifications','通知'],['profile','我的']];
  return `<div class="shell app-view ${roleClasses[role]||'role-unknown'}"><header class="app-topbar"><button class="store-switch" data-store-switch type="button" aria-label="切換門市"><span>${escapeHtml(formalUiText(storeName,'目前門市'))}</span><b>⌄</b></button><strong class="topbar-brand">PantryFlow</strong><button class="notification-button" data-route="notifications" type="button" aria-label="通知">♧</button></header><div class="role-home-label"><span>${escapeHtml(roleLabels[role]||'尚未指派角色')}</span><small>${escapeHtml(formalUiText(displayName,'使用者'))}</small></div>${content}</div><nav class="bottom-nav ${roleClasses[role]||'role-unknown'}" aria-label="主要導覽">${items.map(([id,label])=>`<button data-route="${id}" class="${page===id?'active':''}" aria-current="${page===id?'page':'false'}">${label}</button>`).join('')}</nav>`;
}
export function backButton(label='返回上一頁'){return `<button class="page-back" data-back type="button" aria-label="${escapeHtml(label)}">‹ <span>${escapeHtml(label)}</span></button>`}
export function emptyState(title,copy){return `<section class="card empty"><span class="empty-icon">✓</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(copy)}</p></section>`}
export function escapeHtml(value=''){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
export function formalUiText(value='',fallback='PantryFlow'){const cleaned=String(value).replace(/封閉 Pilot|legacy-demo|preview|pilot-v1/gi,'').replace(/^[\s｜|·—–-]+|[\s｜|·—–-]+$/g,'').trim();return cleaned||fallback}
