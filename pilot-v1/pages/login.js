import{escapeHtml}from'../components/layout.js';
function brand(copy='把餐廳現場的事情，整理成今天可以完成的工作。'){return `<aside class="auth-brand"><span class="brand-mark">P</span><div class="pilot-note">封閉 Pilot｜內部測試中</div><h1>餐飲現場的<br>營運秘書</h1><p>${escapeHtml(copy)}</p></aside>`}
function authShell(content,copy){return `<div class="center-stage"><section class="auth-layout">${brand(copy)}<div class="auth-panel">${content}</div></section></div>`}
export function loginPage(){return authShell(`
  <div class="auth-heading"><h2>登入 PantryFlow</h2><p>主管與員工使用各自的正式身分進入同一間門市。</p></div>
  <div class="tabs"><button data-auth-tab="management" class="active">管理／後勤</button><button data-auth-tab="staff">員工快速登入</button></div>
  <form id="management-login">
    <label class="field">Email<input name="email" type="email" autocomplete="username" placeholder="name@restaurant.com" required></label>
    <label class="field">密碼<input name="password" type="password" autocomplete="current-password" placeholder="輸入密碼" required></label>
    <p class="error" data-error></p><button class="primary" type="submit">登入管理首頁</button>
    <div class="auth-divider">第一次使用 PantryFlow</div><button class="link" data-owner-signup type="button">建立商家帳號</button>
  </form>
  <form id="staff-login" class="hidden">
    <div class="helper">員工帳號由主管建立。請使用主管提供的門市代碼與登入方式，不需 Email。</div>
    <label class="field">門市代碼<input name="storeCode" autocomplete="organization" placeholder="例如 TPE01" required></label>
    <div class="login-mode" aria-label="員工識別方式"><button class="mode-choice active" data-login-mode="NAME_OR_NICKNAME" type="button">姓名／暱稱<small>商家採姓名快速登入</small></button><button class="mode-choice" data-login-mode="EMPLOYEE_NUMBER" type="button">員工編號<small>商家已有員編制度</small></button></div>
    <input name="loginMode" type="hidden" value="NAME_OR_NICKNAME">
    <label class="field"><span data-identifier-label>姓名或暱稱</span><input name="identifier" autocomplete="username" placeholder="輸入姓名或暱稱" required></label>
    <label class="field">6 位個人 PIN<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="current-password" placeholder="••••••" required></label>
    <p class="error" data-error></p><button class="primary" type="submit">進入今日工作</button>
  </form>
  <form id="owner-signup" class="hidden">
    <button class="text-button" data-back-login type="button">← 返回登入</button><div class="auth-heading"><h2>建立商家帳號</h2><p>只有建立商家的人註冊 Owner 主帳號；員工不可自行註冊。</p></div>
    <div class="steps"><span class="step-dot active">1</span><span>帳號</span><i class="step-line"></i><span class="step-dot">2</span><span>商家</span><i class="step-line"></i><span class="step-dot">3</span><span>門市</span></div>
    <label class="field">Owner 姓名<input name="displayName" autocomplete="name" placeholder="您的姓名" required></label><label class="field">工作 Email<input name="email" type="email" autocomplete="email" placeholder="owner@restaurant.com" required></label><label class="field">密碼<input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="至少 8 個字元" required></label>
    <p class="error" data-error></p><div data-success></div><button class="primary" type="submit">寄送 Email 驗證信</button><div class="helper">完成 Email 驗證後，系統才會建立正式商家、第一間門市與 Owner 權限。</div>
  </form>`)}
export function onboardingPage(){return authShell(`<div class="auth-heading"><h2>建立正式商家</h2><p>Email 已驗證。接著建立品牌與第一間門市；所有資料都會寫入正式 Supabase。</p></div><div class="steps"><span class="step-dot">✓</span><span>帳號</span><i class="step-line"></i><span class="step-dot active">2</span><span>商家</span><i class="step-line"></i><span class="step-dot active">3</span><span>門市</span></div><form id="owner-onboarding"><label class="field">商家／品牌名稱<input name="organizationName" placeholder="例如 山丘餐飲" required></label><label class="field">商家類型<select name="businessType"><option value="SINGLE_RESTAURANT">單店餐廳</option><option value="CHAIN_RESTAURANT">連鎖餐飲</option></select></label><div class="form-grid two"><label class="field">第一間門市名稱<input name="storeName" placeholder="例如 信義店" required></label><label class="field">門市代碼<input name="storeCode" placeholder="例如 TPE01" pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,31}" required></label></div><label class="field">員工登入方式<select name="loginMode"><option value="NAME_OR_NICKNAME">姓名／暱稱＋6 位 PIN</option><option value="EMPLOYEE_NUMBER">員工編號＋6 位 PIN</option></select></label><p class="error" data-error></p><button class="primary" type="submit">建立商家與第一間門市</button><div class="helper">完成後可從管理首頁新增第二、第三間門市，以及主管與員工。</div></form>`,`正式資料從第一間門市開始，沒有預設商品、假帳號或展示資料。`)}
export function storePickerPage(stores){return authShell(`<div class="auth-heading"><h2>選擇作業門市</h2><p>您的角色與資料權限會依門市切換。</p></div><div class="list">${stores.map(s=>`<button class="secondary" data-store="${s.id}"><strong>${escapeHtml(s.name)}</strong><br><small>${escapeHtml(s.store_code)}｜${escapeHtml(s.role)}</small></button>`).join('')}</div>`,`每一間門市都有獨立 membership 與營運資料。`)}
