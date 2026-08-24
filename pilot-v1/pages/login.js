import { escapeHtml, formalUiText } from '../components/layout.js';

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
    <div class="login-role-switch" role="tablist" aria-label="登入方式">
      <button class="active" type="button" role="tab" aria-selected="true" data-login-mode="manager">管理者</button>
      <button type="button" role="tab" aria-selected="false" data-login-mode="employee">員工</button>
    </div>
    <section class="login-panel" data-login-panel="manager">
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
    </section>
    <section class="login-panel employee-login-panel" data-login-panel="employee" hidden>
      <div class="admin-login-heading">
        <h1>員工快速登入</h1>
        <p>使用主管提供的門市識別碼、員工識別與 6 位數 PIN。</p>
      </div>
      <form id="staff-pin-login" class="admin-login-form">
        <label class="field">門市識別碼
          <input name="storeCode" autocomplete="organization" placeholder="輸入門市識別碼" pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,31}" required>
        </label>
        <label class="field">員工識別
          <input name="identifier" autocomplete="username" placeholder="姓名、暱稱或員工編號" required>
        </label>
        <label class="field">6 位數 PIN
          <input class="pin-input" name="pin" type="password" inputmode="numeric" autocomplete="current-password" pattern="[0-9]{6}" maxlength="6" placeholder="••••••" required>
        </label>
        <p class="error admin-login-error" data-error aria-live="polite"></p>
        <button class="primary" type="submit">員工登入</button>
      </form>
    </section>
  </div>`);
}

export function storePickerPage(stores) {
  return authShell(`<div class="admin-login-content"><div class="admin-login-heading"><p class="eyebrow">已指派門市</p><h1 id="admin-login-title">選擇作業門市</h1><p>你的角色與資料權限會依門市切換。</p></div><div class="list">${stores.map(store => `<button class="secondary admin-store-choice" data-store="${store.id}"><strong>${escapeHtml(formalUiText(store.name,'門市'))}</strong><small>${escapeHtml(formalUiText(store.store_code,'門市代碼'))}｜${escapeHtml(store.role)}</small></button>`).join('')}</div></div>`);
}

export function unassignedStorePage() {
  return authShell(`<div class="admin-login-content admin-empty-state"><span class="admin-empty-icon" aria-hidden="true">!</span><div class="admin-login-heading"><p class="eyebrow">門市權限</p><h1 id="admin-login-title">尚未指派門市</h1><p>此帳號已登入，但目前沒有可使用的門市。請聯絡 Owner 或管理者完成 membership 指派。</p></div><button class="secondary" data-sign-out type="button">登出</button></div>`);
}

export function unavailableRolePage(role='') {
  const known=role==='OWNER'||role==='LOGISTICS';
  return authShell(`<div class="admin-login-content admin-empty-state"><span class="admin-empty-icon" aria-hidden="true">!</span><div class="admin-login-heading"><p class="eyebrow">角色權限</p><h1 id="admin-login-title">${known?'此角色首頁尚未開放':'尚未指派角色／門市'}</h1><p>${known?'此帳號已有門市角色，但本版本不以員工或店長首頁替代。':'此帳號已登入，但沒有可辨識的有效門市角色。請聯絡管理者確認 membership。'}</p></div><button class="secondary" data-sign-out type="button">登出</button></div>`);
}
