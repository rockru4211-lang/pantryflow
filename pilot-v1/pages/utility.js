import { backButton, emptyState, escapeHtml, formalUiText } from '../components/layout.js';

function membershipList({ store, staff, currentUserId }) {
  return `<section class="section">
    <div class="section-head"><h2>門市成員</h2><span>${escapeHtml(formalUiText(store.name, '門市'))}</span></div>
    <div class="card member-list">${staff.length ? staff.map(item => {
      const person = item.identity || {};
      const manageable = item.user_id !== currentUserId && item.is_active && person.is_active !== false;
      return `<article class="member-row">
        <div><strong>${escapeHtml(formalUiText(person.display_name || item.login_identifier, '成員'))}</strong><small>${escapeHtml(formalUiText(item.login_identifier, '登入識別'))}｜${escapeHtml(item.role)}</small></div>
        <span class="status">${item.is_active && person.is_active !== false ? '啟用' : '停用'}</span>
        ${manageable ? `<form class="inline-pin-form" data-reset-pin="${item.user_id}"><input name="pin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="新 6 位 PIN" required><button class="secondary" type="submit">重設</button><p class="error" data-error></p></form><button class="text-button danger-text" data-disable-staff="${item.user_id}" type="button">停用</button>` : ''}
      </article>`;
    }).join('') : '<div class="empty compact-empty">尚無門市成員。請先建立第一位員工。</div>'}</div>
  </section>`;
}

function contextCard({ organization, store }) {
  return `<section class="card settings-context">
    <div><small>商家名稱</small><strong>${escapeHtml(formalUiText(organization?.name, '尚未設定商家'))}</strong></div>
    <div><small>目前門市</small><strong>${escapeHtml(formalUiText(store?.name, '尚未選擇門市'))}</strong></div>
    <div><small>門市代碼</small><strong>${escapeHtml(formalUiText(store?.store_code, '尚未設定'))}</strong></div>
  </section>`;
}

function profilePage({ organization, store, staff, canManage, canCreateStore, currentUserId }) {
  return `<h1 class="page-title">門市管理</h1>
    ${contextCard({ organization, store })}
    ${canManage ? membershipList({ store, staff, currentUserId }) : emptyState('門市成員', '目前角色只能查看自己的門市資料。')}
    ${canManage ? `<div class="settings-actions"><button class="primary" data-route="staff-create" type="button">新增店長／員工</button>${canCreateStore ? '<button class="secondary" data-route="store-create" type="button">新增門市</button>' : ''}</div>` : ''}
    <button class="secondary sign-out-button" data-sign-out type="button">登出</button>`;
}

function staffCreatePage({ organization, store, canCreateSupervisor }) {
  const identifierLabel = store.staff_login_mode === 'EMPLOYEE_NUMBER' ? '員工編號' : '登入暱稱';
  return `${backButton()}<h1 class="page-title">新增店長／員工</h1>
    ${contextCard({ organization, store })}
    <section class="section card settings-card">
      <form id="create-staff">
        <input name="storeId" type="hidden" value="${escapeHtml(store.id)}">
        <label class="field">姓名<input name="displayName" maxlength="80" required></label>
        <label class="field">${identifierLabel}<input name="loginIdentifier" maxlength="64" required></label>
        <label class="field">身分<select name="role"><option value="STAFF">員工</option>${canCreateSupervisor ? '<option value="SUPERVISOR">主管</option>' : ''}</select></label>
        <label class="field">6 位數 PIN<input name="pin" type="password" inputmode="numeric" autocomplete="new-password" pattern="[0-9]{6}" maxlength="6" required></label>
        <label class="field">確認 PIN<input name="confirmPin" type="password" inputmode="numeric" autocomplete="new-password" pattern="[0-9]{6}" maxlength="6" required></label>
        <p class="error" data-error aria-live="polite"></p>
        <button class="primary" type="submit">建立門市成員</button>
      </form>
      <div class="helper">PIN 只會送往安全後端建立雜湊，不會顯示於成員清單或保存於瀏覽器。</div>
    </section>`;
}

function storeCreatePage({ organization }) {
  return `${backButton()}<h1 class="page-title">新增門市</h1>
    <section class="card settings-context"><div><small>所屬商家</small><strong>${escapeHtml(formalUiText(organization?.name, '尚未設定商家'))}</strong></div></section>
    <section class="section card settings-card">
      <form id="create-store">
        <label class="field">門市名稱<input name="name" maxlength="100" required></label>
        <label class="field">門市代碼<input name="storeCode" pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,31}" maxlength="32" autocapitalize="characters" required></label>
        <label class="field">員工登入方式<select name="loginMode"><option value="NAME_OR_NICKNAME">登入暱稱＋6 位 PIN</option><option value="EMPLOYEE_NUMBER">員工編號＋6 位 PIN</option></select></label>
        <p class="error" data-error aria-live="polite"></p>
        <button class="primary" type="submit">建立門市</button>
      </form>
    </section>`;
}

export function utilityPage(page, {
  canManage = false,
  canCreateStore = false,
  canCreateSupervisor = false,
  organization = null,
  store = null,
  staff = [],
  currentUserId = '',
} = {}) {
  if (page === 'profile') return profilePage({ organization, store, staff, canManage, canCreateStore, currentUserId });
  if (page === 'staff-create' && canManage && store) return staffCreatePage({ organization, store, canCreateSupervisor });
  if (page === 'store-create' && canCreateStore) return storeCreatePage({ organization });

  const labels = {
    activity: ['作業紀錄', '尚無目前門市的正式紀錄。'],
    scan: ['掃描', '請從已開放的作業入口啟動掃描。'],
    notifications: ['通知', '目前沒有正式待處理通知。'],
    waste: ['廢棄', '此作業尚未開放。'],
    expiry: ['效期巡檢', '此作業尚未開放。'],
    other: ['其他作業', '此作業尚未開放。'],
  };
  const [title, copy] = labels[page] || ['無法開啟', '目前角色沒有此頁面的權限。'];
  return `${backButton()}<h1 class="page-title">${title}</h1>${emptyState(title, copy)}`;
}
