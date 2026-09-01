import { daisyMark } from '../components/icons.js';
import { escapeHtml } from '../components/layout.js';

function authShell(content, { identity = false } = {}) {
  return `<div class="admin-login-stage ${identity ? 'identity-stage' : ''}"><section class="admin-login-frame ${identity ? 'identity-frame' : ''}" aria-labelledby="admin-login-title">${identity ? '' : `<header class="admin-login-topbar"><span class="topbar-daisy">${daisyMark}</span><strong>序</strong></header>`}${content}</section></div>`;
}

function backButton(route = 'welcome', label = '返回登入首頁') {
  return `<button class="auth-back link" type="button" data-auth-route="${escapeHtml(route)}">‹ ${escapeHtml(label)}</button>`;
}

function steps(active) {
  return `<div class="registration-steps" aria-label="建立新商家步驟">${['帳號', '商家', '門市', '管理者', '功能'].map((label, index) => `<span class="${index + 1 <= active ? 'active' : ''}"><b>${index + 1}</b><small>${label}</small></span>`).join('')}</div>`;
}

function loginPage() {
  return authShell(`<div class="identity-content"><div class="brand-lockup"><span class="brand-glyph">${daisyMark}</span><span><strong>序</strong><small>讓餐廳，自然有序。</small></span></div><div class="identity-heading"><h1 id="admin-login-title">歡迎回來</h1><p>選擇你的登入方式</p></div><div class="identity-list"><button class="identity-choice primary-choice" type="button" data-auth-route="employee"><span class="identity-icon">人</span><span><strong>員工快速登入</strong><small>門市與身分、6 位 PIN</small></span><b>›</b></button><button class="identity-choice" type="button" data-auth-route="management"><span class="identity-icon">管</span><span><strong>管理帳號登入</strong><small>門市主管、區主管、後勤與 Owner</small></span><b>›</b></button></div><button class="new-business-link" type="button" data-auth-route="register">建立新商家</button></div>`, { identity: true });
}

function employeePage() {
  return authShell(`<div class="admin-login-content employee-login-panel">${backButton()}<div class="admin-login-heading"><h1 id="admin-login-title">歡迎回來</h1><p>選擇門市與身分，快速進入。</p></div><form id="staff-identity" class="admin-login-form"><label class="field">門市代碼<input name="storeCode" value="BEAPE01" placeholder="例如 BEAPE01" required></label><article class="confirm-card store-confirm"><span aria-hidden="true">店</span><strong>BeApe 大安店</strong><small>門市已確認</small></article><label class="field">姓名／暱稱<input name="identifier" value="王小明" placeholder="輸入姓名或暱稱" required></label><p class="helper">登入方式由門市主管設定，員工不可自行切換。</p><button class="primary" type="submit">繼續</button></form></div>`);
}

function employeePinPage() {
  return authShell(`<div class="admin-login-content employee-login-panel">${backButton('employee', '返回門市與身分')}<div class="admin-login-heading"><h1 id="admin-login-title">輸入你的 PIN</h1><p>確認身分後即可進入。</p></div><article class="confirm-card identity-confirm"><span aria-hidden="true">人</span><strong>王小明</strong><small>BeApe 大安店｜員工</small></article><form id="staff-pin-login" class="admin-login-form"><label class="field">6 位 PIN<input class="pin-input" name="pin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="••••••" required></label><section class="device-policy-summary"><span aria-hidden="true">裝</span><div><strong>主管設定的裝置政策</strong><small>個人裝置｜7 天未使用需重新輸入 PIN</small></div></section><p class="helper">連續錯誤 5 次將鎖定 15 分鐘；忘記 PIN 請洽門市主管重設。</p><button class="primary" type="submit">進入</button></form></div>`);
}

function managementPage() {
  return authShell(`<div class="admin-login-content">${backButton()}<div class="admin-login-heading"><h1 id="admin-login-title">歡迎回來</h1><p>使用管理帳號登入</p></div><form id="management-login" class="admin-login-form"><label class="field">Email<input name="email" type="email" placeholder="name@restaurant.com" required></label><label class="field">密碼<input name="password" type="password" placeholder="輸入密碼" required></label><button class="text-button" type="button" data-auth-route="forgot-password">忘記密碼？</button><button class="primary" type="submit">登入</button></form></div>`);
}

function registrationPage({ sent = false } = {}) {
  return authShell(`<div class="admin-login-content">${backButton()}${steps(1)}<div class="admin-login-heading"><h1 id="admin-login-title">建立管理帳號</h1><p>先建立帳號，再驗證 Email。</p></div>${sent ? `<p class="success-message">驗證信已寄出至 example@email.com</p><div class="registration-next-step"><strong>請檢查你的信箱</strong><p>也請查看垃圾郵件或促銷內容。完成驗證後會直接進入建立商家。</p></div><button class="primary full-button" type="button" data-auth-route="business">模擬完成 Email 驗證</button><button class="text-button full-button" type="button" data-auth-route="register">修改 Email</button><button class="text-button full-button" type="button" data-auth-route="management">回管理登入</button>` : `<form id="owner-registration" class="admin-login-form"><label class="field">姓名<input name="displayName" value="林店長" required></label><label class="field">Email<input name="email" type="email" value="example@email.com" required></label><label class="field">密碼<input name="password" type="password" minlength="8" placeholder="至少 8 個字元" required></label><label class="field">再次輸入密碼<input name="passwordConfirm" type="password" minlength="8" required></label><p class="helper">若 Email 已註冊，請回管理登入或重設密碼。</p><button class="primary" type="submit">寄送驗證信</button></form>`}</div>`);
}

function businessPage() {
  return authShell(`<div class="admin-login-content">${steps(2)}<div class="admin-login-heading"><p class="eyebrow">Email 已驗證</p><h1 id="admin-login-title">建立商家</h1><p>先建立商家與門市結構；需要的功能稍後統一選擇。</p></div><form id="owner-business" class="admin-login-form"><label class="field">餐廳／品牌名稱<input name="organizationName" value="BeApe" required></label><fieldset class="business-option-set"><legend>門市結構</legend><p>只影響門市、組織權限與跨店管理。</p><div><label><input type="radio" name="organizationStructure" value="single"><span><strong>單一門市</strong><small>目前只有一間店</small></span></label><label><input type="radio" name="organizationStructure" value="multi" checked><span><strong>多門市／連鎖</strong><small>管理兩間以上門市</small></span></label></div></fieldset><p class="business-option-note">選擇多門市後，功能設定會自動提供跨店管理選項。</p><button class="primary" type="submit">下一步</button></form><button class="secondary full-button" data-sign-out type="button">登出</button></div>`);
}

function storePage() {
  return authShell(`<div class="admin-login-content">${backButton('business', '返回建立商家')}${steps(3)}<div class="admin-login-heading"><h1 id="admin-login-title">建立第一間門市</h1><p>門市代碼會提供員工快速登入使用。</p></div><form id="owner-store" class="admin-login-form"><label class="field">門市名稱<input name="storeName" value="大安店" required></label><label class="field">門市代碼<input name="storeCode" value="BEAPE01" required></label><label class="field">員工登入方式<select name="loginMode"><option selected>姓名／暱稱</option><option>員工編號</option></select></label><button class="primary" type="submit">下一步</button></form></div>`);
}

function managerPage() {
  return authShell(`<div class="admin-login-content">${backButton('first-store', '返回門市設定')}${steps(4)}<div class="admin-login-heading"><h1 id="admin-login-title">確認第一位管理者</h1><p>第一位管理者就是目前已驗證帳號。</p></div><article class="confirm-card manager-confirm"><span aria-hidden="true">管</span><strong>林店長</strong><small>example@email.com｜Owner／管理者<br>BeApe｜大安店</small></article><section class="business-setup-summary"><div><span>門市結構</span><strong>多門市／連鎖</strong></div><div><span>第一間門市</span><strong>大安店</strong></div></section><form id="owner-business-setup" class="admin-login-form"><button class="primary" type="submit">下一步：選擇功能</button></form><p class="helper">新增員工不放在註冊流程；完成後可在管理首頁新增。</p></div>`);
}

function featuresPage() {
  const core = [['盤點','區域盲盤、差異與盤點明細'],['進貨','貨單上傳、核對與正式紀錄'],['商品與成員','商品建檔、供應商與權限']];
  const optional = [['效期巡檢','即期與到期處理',true],['廢棄管理','原因、數量與追溯',true],['叫貨','建議數量與在途',false],['交接與異常','跨班追蹤與回報',true]];
  const multiStore = [['跨店借貸／調撥','門市間借出、借入與還貨',true],['跨店進度與比較','集中查看各門市執行情況',true]];
  return authShell(`<div class="admin-login-content feature-setup-page">${backButton('first-manager', '返回管理者')}${steps(5)}<div class="admin-login-heading"><p class="eyebrow">最後一步</p><h1 id="admin-login-title">選擇使用功能</h1><p>先套用建議設定，之後可隨時增減；未啟用的功能不會出現在員工畫面。</p></div><form id="owner-features" class="admin-login-form"><fieldset class="feature-preset"><legend>開始方式</legend><label><input type="radio" name="featurePreset" value="recommended" checked><span><strong>使用建議設定</strong><small>快速開始，可稍後修改</small></span></label><label><input type="radio" name="featurePreset" value="custom"><span><strong>自行選擇</strong><small>現在逐項調整</small></span></label></fieldset><section class="feature-group"><header><div><strong>核心功能</strong><small>所有商家都會啟用</small></div><span>固定</span></header>${core.map(([name,copy]) => `<div class="feature-module locked"><span><strong>${name}</strong><small>${copy}</small></span><b>已啟用</b></div>`).join('')}</section><section class="feature-group"><header><div><strong>日常管理</strong><small>依商家需要開關</small></div><span>選用</span></header>${optional.map(([name,copy,checked]) => `<label class="feature-module"><span><strong>${name}</strong><small>${copy}</small></span><input type="checkbox" ${checked ? 'checked' : ''}></label>`).join('')}</section><section class="feature-group multi-store"><header><div><strong>多門市功能</strong><small>因選擇多門市而顯示</small></div><span>跨店</span></header>${multiStore.map(([name,copy,checked]) => `<label class="feature-module"><span><strong>${name}</strong><small>${copy}</small></span><input type="checkbox" ${checked ? 'checked' : ''}></label>`).join('')}</section><p class="feature-setting-note"><strong>紙本謄寫不列為獨立功能</strong><br>完成後至「門市設定 → 盤點 → 完成方式」設定；商家可先設預設值，各門市再個別調整。</p><button class="primary" type="submit">完成並進入序</button><button class="text-button full-button" type="button" data-auth-route="owner-done">稍後設定</button></form></div>`);
}

function completePage() {
  return authShell(`<div class="admin-login-content auth-done"><span>✓</span><h1 id="admin-login-title">商家與第一間門市已建立</h1><p>歡迎加入序。</p><article class="confirm-card store-confirm"><strong>BeApe｜大安店</strong><small>多門市／連鎖・已啟用 8 項功能<br>門市代碼 BEAPE01</small></article><button class="primary" type="button" data-enter-role="OWNER">進入管理首頁</button><p class="helper">可在商家設定增減功能；紙本謄寫等作業規則由各門市設定。</p></div>`);
}

function forgotPasswordPage({ sent = false } = {}) {
  return authShell(`<div class="admin-login-content">${backButton('management', '返回管理登入')}<div class="admin-login-heading"><h1 id="admin-login-title">${sent ? '重設信已寄出' : '忘記密碼'}</h1><p>${sent ? '已寄至 example@email.com，請查看收件匣、垃圾郵件或促銷內容。' : '輸入註冊 Email，我們會寄出重設連結。'}</p></div>${sent ? `<button class="primary full-button" type="button" data-auth-route="management">返回管理登入</button><button class="text-button full-button" type="button" data-auth-route="forgot-password">重新寄送</button>` : `<form id="forgot-password" class="admin-login-form"><label class="field">Email<input name="email" type="email" value="example@email.com" required></label><button class="primary" type="submit">寄送重設信</button></form>`}</div>`);
}

export function appShellAuthPage(route = 'welcome') {
  const pages = {
    welcome: loginPage,
    employee: employeePage,
    'employee-store': employeePage,
    'employee-pin': employeePinPage,
    management: managementPage,
    register: registrationPage,
    'register-sent': () => registrationPage({ sent: true }),
    business: businessPage,
    'first-store': storePage,
    'first-manager': managerPage,
    features: featuresPage,
    'owner-done': completePage,
    'forgot-password': forgotPasswordPage,
    'forgot-password-sent': () => forgotPasswordPage({ sent: true }),
  };
  return (pages[route] || pages.welcome)();
}
