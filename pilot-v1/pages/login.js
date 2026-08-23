import { escapeHtml } from '../components/layout.js';

function brand(copy = '把餐廳現場的事情，整理成今天可以完成的工作。') {
  return `<aside class="auth-brand">
    <span class="brand-mark" aria-hidden="true">P</span>
    <div class="pilot-note">封閉 Pilot｜內部測試中</div>
    <h1>餐飲現場的<br>營運秘書</h1>
    <p>${escapeHtml(copy)}</p>
  </aside>`;
}

function authShell(content, copy) {
  return `<div class="center-stage"><section class="auth-layout">${brand(copy)}<div class="auth-panel">${content}</div></section></div>`;
}

function backToIdentity() {
  return '<button class="text-button auth-back" data-back-identity type="button">← 返回選擇登入身分</button>';
}

export function loginPage() {
  return authShell(`
    <section id="identity-choice" aria-labelledby="identity-title">
      <div class="auth-heading identity-heading">
        <p class="eyebrow">PantryFlow 餐飲營運管理</p>
        <h2 id="identity-title">選擇登入身分</h2>
      </div>
      <div class="identity-list">
        <button class="identity-choice" data-login-role="staff" type="button">
          <span class="identity-icon" aria-hidden="true">○</span>
          <span><strong>員工快速登入</strong><small>門市、姓名／員編、個人 PIN</small></span><b aria-hidden="true">›</b>
        </button>
        <button class="identity-choice" data-login-role="supervisor" type="button">
          <span class="identity-icon" aria-hidden="true">▣</span>
          <span><strong>店長／主管</strong><small>管理現場與異常</small></span><b aria-hidden="true">›</b>
        </button>
        <button class="identity-choice" data-login-role="management" type="button">
          <span class="identity-icon" aria-hidden="true">▤</span>
          <span><strong>後勤／管理</strong><small>核對資料與營運</small></span><b aria-hidden="true">›</b>
        </button>
      </div>
    </section>

    <form id="management-login" class="hidden">
      ${backToIdentity()}
      <div class="auth-heading"><p class="eyebrow" data-management-role>店長／主管</p><h2>使用正式帳號登入</h2><p>Email 與密碼由 Supabase Auth 驗證，登入後依個人 membership 載入門市。</p></div>
      <label class="field">Email<input name="email" type="email" autocomplete="username" placeholder="name@restaurant.com" required></label>
      <label class="field">密碼<input name="password" type="password" autocomplete="current-password" placeholder="輸入密碼" required></label>
      <p class="error" data-error aria-live="polite"></p>
      <button class="primary" type="submit">登入</button>
      <div class="auth-divider">第一次使用 PantryFlow</div>
      <button class="link" data-owner-signup type="button">建立商家帳號</button>
    </form>

    <form id="staff-login" class="hidden">
      ${backToIdentity()}
      <div class="auth-heading"><p class="eyebrow">員工快速登入</p><h2>確認你的身分</h2><p>帳號與 6 位 PIN 由主管建立；員工不需自行註冊。</p></div>
      <label class="field">門市代碼<input name="storeCode" autocomplete="organization" placeholder="例如 TPE01" required></label>
      <div class="login-mode" aria-label="員工識別方式">
        <button class="mode-choice active" data-login-mode="NAME_OR_NICKNAME" type="button">選姓名／暱稱<small>使用主管建立的姓名或暱稱</small></button>
        <button class="mode-choice" data-login-mode="EMPLOYEE_NUMBER" type="button">輸入員工編號<small>使用商家既有員編</small></button>
      </div>
      <input name="loginMode" type="hidden" value="NAME_OR_NICKNAME">
      <label class="field"><span data-identifier-label>姓名或暱稱</span><input name="identifier" autocomplete="username" placeholder="輸入姓名或暱稱" required></label>
      <label class="field">輸入 6 位 PIN<input name="pin" class="pin-input" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="current-password" placeholder="○ ○ ○ ○ ○ ○" required></label>
      <p class="error" data-error aria-live="polite"></p>
      <button class="primary" type="submit">登入</button>
      <div class="helper">連續錯誤 5 次將暫時鎖定 15 分鐘。</div>
    </form>

    <form id="owner-signup" class="hidden">
      <button class="text-button auth-back" data-back-management type="button">← 返回管理登入</button>
      <div class="auth-heading"><h2>建立商家帳號</h2><p>只有建立商家的人註冊 Owner 主帳號；員工不可自行註冊。</p></div>
      <div class="steps"><span class="step-dot active">1</span><span>帳號</span><i class="step-line"></i><span class="step-dot">2</span><span>商家</span><i class="step-line"></i><span class="step-dot">3</span><span>門市</span></div>
      <label class="field">Owner 姓名<input name="displayName" autocomplete="name" placeholder="您的姓名" required></label>
      <label class="field">工作 Email<input name="email" type="email" autocomplete="email" placeholder="owner@restaurant.com" required></label>
      <label class="field">密碼<input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="至少 8 個字元" required></label>
      <p class="error" data-error aria-live="polite"></p><div data-success></div>
      <button class="primary" type="submit">寄送 Email 驗證信</button>
      <div class="helper">完成 Email 驗證後，系統才會建立正式商家、第一間門市與 Owner 權限。</div>
    </form>`);
}

export function onboardingPage() {
  return authShell(`<div class="auth-heading"><h2>建立正式商家</h2><p>Email 已驗證。接著建立品牌與第一間門市；所有資料都會寫入正式 Supabase。</p></div><div class="steps"><span class="step-dot">✓</span><span>帳號</span><i class="step-line"></i><span class="step-dot active">2</span><span>商家</span><i class="step-line"></i><span class="step-dot active">3</span><span>門市</span></div><form id="owner-onboarding"><label class="field">商家／品牌名稱<input name="organizationName" placeholder="例如 山丘餐飲" required></label><label class="field">商家類型<select name="businessType"><option value="SINGLE_RESTAURANT">單店餐廳</option><option value="CHAIN_RESTAURANT">連鎖餐飲</option></select></label><div class="form-grid two"><label class="field">第一間門市名稱<input name="storeName" placeholder="例如 信義店" required></label><label class="field">門市代碼<input name="storeCode" placeholder="例如 TPE01" pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,31}" required></label></div><label class="field">員工登入方式<select name="loginMode"><option value="NAME_OR_NICKNAME">姓名／暱稱＋6 位 PIN</option><option value="EMPLOYEE_NUMBER">員工編號＋6 位 PIN</option></select></label><p class="error" data-error></p><button class="primary" type="submit">建立商家與第一間門市</button><div class="helper">完成後可從管理首頁新增第二、第三間門市，以及主管與員工。</div></form>`, '正式資料從第一間門市開始，沒有預設商品、假帳號或展示資料。');
}

export function storePickerPage(stores) {
  return authShell(`<div class="auth-heading"><h2>選擇作業門市</h2><p>您的角色與資料權限會依門市切換。</p></div><div class="list">${stores.map(store => `<button class="secondary" data-store="${store.id}"><strong>${escapeHtml(store.name)}</strong><br><small>${escapeHtml(store.store_code)}｜${escapeHtml(store.role)}</small></button>`).join('')}</div>`, '每一間門市都有獨立 membership 與營運資料。');
}
