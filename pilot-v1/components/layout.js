export function layout({ storeName, role, page, content }) {
  const items=[['home','首頁'],['activity','作業紀錄'],['notifications','通知'],['profile','我的']];
  return `<div class="shell"><header class="topbar"><div><div class="eyebrow">PANTRYFLOW｜正式 Supabase</div><h1>${escapeHtml(storeName||'封閉 Pilot')}</h1></div><span class="status">${escapeHtml(role||'')}</span></header>${content}</div><nav class="bottom-nav" aria-label="主要導覽">${items.map(([id,label])=>`<button data-route="${id}" class="${page===id?'active':''}">${label}</button>`).join('')}</nav>`;
}
export function emptyState(title,copy){return `<section class="card empty"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(copy)}</p></section>`}
export function escapeHtml(value=''){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
