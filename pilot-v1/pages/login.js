import { escapeHtml } from '../components/layout.js';

function authShell(content) {
  return `<div class="admin-login-stage">
    <section class="admin-login-frame" aria-labelledby="admin-login-title">
      <header class="admin-login-topbar">
        <strong>PantryFlow</strong>
      </header>
      ${content}
    </section>
  </div>`;
}

export function loginPage() {
  return authShell(`<div class="admin-login-content">
    <div class="admin-login-heading">
      <h1 id="admin-login-title">管理者登入</h1>
      <p>使用既有管理帳號登入</p>
    </div>
    <form id="management-login" class="admin-login-form">
      <label class="field">Email
        <input name="email" type="email" autocomplete="username" placeholder="name@restaurant.com" required>
      </label>
      <label class="field">密碼
        <input name="password" type="password" autocomplete="current-password" placeholder="輸入密碼" required>
      </label>
      <p class="error admin-login-error" data-error aria-live="polite"></p>
      <button class="primary" type="submit">登入</button>
    </form>
  </div>`);
}

export function storePickerPage(stores) {
  return authShell(`<div class="admin-login-content"><div class="admin-login-heading"><p class="eyebrow">已指派門市</p><h1 id="admin-login-title">選擇作業門市</h1><p>你的角色與資料權限會依門市切換。</p></div><div class="list">${stores.map(store => `<button class="secondary admin-store-choice" data-store="${store.id}"><strong>${escapeHtml(store.name)}</strong><small>${escapeHtml(store.store_code)}｜${escapeHtml(store.role)}</small></button>`).join('')}</div></div>`);
}

export function unassignedStorePage() {
  return authShell(`<div class="admin-login-content admin-empty-state"><span class="admin-empty-icon" aria-hidden="true">!</span><div class="admin-login-heading"><p class="eyebrow">門市權限</p><h1 id="admin-login-title">尚未指派門市</h1><p>此帳號已登入，但目前沒有可使用的門市。請聯絡 Owner 或管理者完成 membership 指派。</p></div><button class="secondary" data-sign-out type="button">登出</button></div>`);
}
