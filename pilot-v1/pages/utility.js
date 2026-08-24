import { backButton, emptyState, escapeHtml, formalUiText } from '../components/layout.js';

const roleLabels = { ADMIN: '店長', SUPERVISOR: '主管', STAFF: '員工' };

function memberList(staff, currentUserId) {
  return `<section class="section"><div class="section-head"><h2>門市成員</h2><span>${staff.length} 位</span></div><div class="card member-list">${staff.length ? staff.map(item => {
    const person = item.identity || {};
    const manageable = item.user_id !== currentUserId && item.is_active && person.is_active !== false;
    return `<article class="member-row"><div><strong>${escapeHtml(formalUiText(person.display_name || item.login_identifier, '成員'))}</strong><small>${escapeHtml(item.login_identifier)}｜${escapeHtml(roleLabels[item.role] || item.role)}</small></div><span class="status">${item.is_active && person.is_active !== false ? '啟用' : '停用'}</span>${manageable ? `<form class="inline-pin-form" data-reset-pin="${item.user_id}"><input name="pin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="新 6 位 PIN" required><button class="secondary" type="submit">重設</button><p class="error" data-error></p></form><button class="text-button danger-text" data-disable-staff="${item.user_id}" type="button">停用</button>` : ''}</article>`;
  }).join('') : '<div class="empty compact-empty">此門市尚無成員。請建立第一位店長、主管或員工。</div>'}</div></section>`;
}

export function profilePage({ organizationName, stores, currentStore, staff, currentUserId }) {
  return `${backButton()}<h1 class="page-title">我的</h1>
    <section class="card store-context-card" data-onboarding-state="has-store">
      <span class="context-label">商家名稱</span><strong>${escapeHtml(formalUiText(organizationName, '尚未設定商家'))}</strong>
      <label class="field">目前門市
        <select data-store-select>${stores.map(store => `<option value="${store.id}" ${store.id === currentStore.id ? 'selected' : ''}>${escapeHtml(store.name)}</option>`).join('')}</select>
      </label>
      <div class="store-meta"><span>門市名稱<strong>${escapeHtml(currentStore.name)}</strong></span><span>門市代碼<strong>${escapeHtml(currentStore.store_code)}</strong></span></div>
    </section>
    ${memberList(staff, currentUserId)}
    <div class="profile-actions"><button class="primary" data-route="add-staff" type="button">新增店長／員工</button><button class="secondary" data-route="add-store" type="button">新增門市</button></div>
    <button class="secondary sign-out-button" data-sign-out type="button">登出</button>`;
}

export function addStorePage({ organizationName, isFirstStore = false }) {
  return `${backButton()}<main class="form-page" data-onboarding-state="${isFirstStore ? 'no-store' : 'add-store'}"><p class="eyebrow">${escapeHtml(formalUiText(organizationName, '目前商家'))}</p><h1 class="page-title">${isFirstStore ? '建立第一間門市' : '新增門市'}</h1><p class="muted">門市建立成功後會自動切換至新門市。</p>
    <section class="card settings-card"><form id="create-store"><input name="isFirstStore" type="hidden" value="${String(isFirstStore)}"><label class="field">門市名稱<input name="name" maxlength="80" required></label><label class="field">門市代碼<input name="storeCode" maxlength="32" pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,31}" autocapitalize="characters" required></label><input name="loginMode" type="hidden" value="NAME_OR_NICKNAME"><p class="error" data-error aria-live="polite"></p><button class="primary" type="submit">${isFirstStore ? '建立第一間門市' : '建立門市'}</button></form></section></main>`;
}

export function addStaffPage({ organizationName, store }) {
  return `${backButton()}<main class="form-page"><h1 class="page-title">新增店長／員工</h1>
    <section class="card staff-context"><div><span>所屬商家</span><strong>${escapeHtml(formalUiText(organizationName, '尚未設定商家'))}</strong></div><div><span>所屬門市</span><strong>${escapeHtml(store.name)}</strong></div><div><span>門市代碼</span><strong>${escapeHtml(store.store_code)}</strong></div></section>
    <section class="card settings-card"><form id="create-staff"><input name="storeId" type="hidden" value="${escapeHtml(store.id)}"><label class="field">姓名<input name="displayName" maxlength="80" autocomplete="name" required></label><label class="field">員工編號或登入暱稱<input name="loginIdentifier" maxlength="64" pattern="[A-Za-z0-9\u4e00-\u9fff._-]+" autocomplete="username" required></label><label class="field">身分<select name="role" required><option value="ADMIN">店長</option><option value="SUPERVISOR">主管</option><option value="STAFF" selected>員工</option></select></label><label class="field">6 位數 PIN<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="new-password" required></label><label class="field">確認 PIN<input name="confirmPin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="new-password" required></label><p class="error" data-error aria-live="polite"></p><button class="primary" type="submit">建立門市登入身分</button></form></section></main>`;
}

export function utilityPage(page) {
  const labels = { activity: ['作業紀錄', '尚無目前門市的正式紀錄。'], scan: ['掃描', '請從已開放的作業入口啟動掃描。'], notifications: ['通知', '目前沒有正式待處理通知。'], profile: ['我的', '帳號、門市與角色資料來自正式 memberships。'], waste: ['廢棄', '此作業尚未開放。'], expiry: ['效期巡檢', '此作業尚未開放。'], other: ['其他作業', '此作業尚未開放。'] };
  const [title, copy] = labels[page] || ['功能', '此作業尚未開放。'];
  return `${backButton()}<h1 class="page-title">${title}</h1>${emptyState(title, copy)}${page === 'profile' ? '<button class="secondary sign-out-button" data-sign-out type="button">登出</button>' : ''}`;
}
