import { daisyMark, icon } from '../components/icons.js';
import { escapeHtml } from '../components/app-shell-layout.js';

function authFrame(content, { step = '', back = '' } = {}) {
  return `<div class="auth-shell-screen">
    <header class="auth-shell-header">${back ? `<button type="button" data-auth-route="${back}" aria-label="返回">‹</button>` : '<span></span>'}<span class="auth-mini-brand">${daisyMark}<b>PantryFlow</b></span><span>${step}</span></header>
    <main class="auth-shell-content">${content}</main>
  </div>`;
}

function heading(title, copy = '') {
  return `<div class="auth-heading"><h1>${escapeHtml(title)}</h1>${copy ? `<p>${escapeHtml(copy)}</p>` : ''}</div>`;
}

function field(label, placeholder, type = 'text') {
  return `<label class="auth-field"><span>${escapeHtml(label)}</span><div>${type === 'select' ? `<select><option>${escapeHtml(placeholder)}</option></select>` : `<input type="${type}" placeholder="${escapeHtml(placeholder)}" readonly>`}</div></label>`;
}

function button(label, route, style = 'primary') {
  return `<button class="auth-${style}" type="button" data-auth-route="${route}">${escapeHtml(label)}</button>`;
}

function welcomePage() {
  return authFrame(`<section class="auth-welcome"><div class="auth-logo">${daisyMark}</div><h1>PantryFlow</h1><p>歡迎回來</p><div class="auth-entry-stack">${button('員工快速登入', 'employee-store')}${button('管理帳號登入', 'management', 'secondary')}${button('建立新商家', 'register', 'secondary')}</div><small>單店與連鎖使用同一入口，登入後依角色顯示內容。</small></section>`);
}

function employeeStorePage() {
  return authFrame(`${heading('輸入門市代碼', '輸入主管提供的門市代碼。')}${field('門市代碼', '例如 BEAPE01')}${button('下一步', 'employee-store-confirm')}`, { step: '1 / 5', back: 'welcome' });
}

function employeeStoreConfirmPage() {
  return authFrame(`${heading('確認門市', '請確認今天工作的門市。')}<section class="auth-confirm-card"><span>${icon('building')}</span><strong>BeApe 大安店</strong><small>台北市大安區</small></section>${button('這是我的門市', 'employee-identity')}${button('重新輸入', 'employee-store', 'text')}`, { step: '2 / 5', back: 'employee-store' });
}

function employeeIdentityPage() {
  return authFrame(`${heading('選擇員工身分', '登入方式由門市主管設定。')}${field('姓名／暱稱', '輸入姓名或暱稱')}${button('下一步', 'employee-confirm')}`, { step: '3 / 5', back: 'employee-store-confirm' });
}

function employeeConfirmPage() {
  return authFrame(`${heading('確認是你嗎？')}<section class="auth-confirm-card person"><span>${icon('user')}</span><strong>王小明</strong><small>員工・BeApe 大安店</small></section>${button('確認身分', 'employee-pin')}${button('不是我', 'employee-identity', 'text')}`, { step: '4 / 5', back: 'employee-identity' });
}

function employeePinPage() {
  return authFrame(`${heading('輸入 6 位 PIN', '個人 PIN 只用來確認身分。')}<div class="auth-pin"><i></i><i></i><i></i><i></i><i></i><i></i></div>${button('進入今日工作', 'employee-done')}<button class="auth-text" type="button" data-shell-action="忘記 PIN">忘記 PIN？</button><p class="auth-policy">已授權裝置政策：共用裝置只記住門市，每位員工仍須輸入 PIN。</p>`, { step: '5 / 5', back: 'employee-confirm' });
}

function managementPage() {
  return authFrame(`${heading('管理帳號登入', '店長、主管、後勤與 Owner 共用此入口。')}${field('Email', '輸入 Email', 'email')}${field('密碼', '輸入密碼', 'password')}${button('登入', 'management-done')}<button class="auth-text" type="button" data-shell-action="忘記密碼">忘記密碼？</button><p class="auth-policy">登入後會自動辨識商家、門市與角色權限。</p>`, { back: 'welcome' });
}

function registrationPage() {
  return authFrame(`${heading('建立管理帳號', '先建立 Owner 個人帳號，再設定商家與第一間門市。')}${field('姓名', '輸入姓名')}${field('Email', '輸入 Email', 'email')}${field('密碼', '至少 8 個字元', 'password')}${button('寄送驗證信', 'verify')}`, { step: '1 / 5', back: 'welcome' });
}

function verifyPage() {
  return authFrame(`${heading('驗證 Email', '我們已寄送 6 位驗證碼到 example@email.com。')}<div class="auth-pin"><i></i><i></i><i></i><i></i><i></i><i></i></div>${button('完成驗證', 'business')}<button class="auth-text" type="button" data-shell-action="重寄驗證信">重新寄送</button>`, { step: '2 / 5', back: 'register' });
}

function businessPage() {
  return authFrame(`${heading('建立商家', '營運模式日後仍可由 Owner 調整。')}${field('餐廳／品牌名稱', '輸入名稱')}${field('所屬公司（可略過）', '輸入公司名稱')}<div class="auth-choice-grid"><button class="active" data-shell-action="中小餐廳／單店"><span>${icon('building')}</span><strong>中小餐廳／單店</strong></button><button data-shell-action="連鎖餐飲／多門市"><span>${icon('building')}</span><strong>連鎖餐飲／多門市</strong></button></div>${button('下一步', 'first-store')}`, { step: '3 / 5', back: 'verify' });
}

function firstStorePage() {
  return authFrame(`${heading('建立第一間門市')}${field('門市名稱', '例如：大安店')}${field('門市代碼', '例如：BEAPE01')}${field('所在縣市', '請選擇', 'select')}${field('員工登入方式', '姓名／暱稱＋6 位 PIN', 'select')}${button('下一步', 'first-manager')}`, { step: '4 / 5', back: 'business' });
}

function firstManagerPage() {
  return authFrame(`${heading('建立第一位管理者', '新增員工會在進入管理首頁後完成，不阻塞商家建立。')}${field('姓名', '輸入姓名')}${field('角色', 'Owner／店長／主管', 'select')}${button('完成設定', 'owner-done')}`, { step: '5 / 5', back: 'first-store' });
}

function donePage(kind) {
  const employee = kind === 'employee-done';
  const management = kind === 'management-done';
  const title = employee || management ? '登入完成' : '商家建立完成';
  const copy = employee ? '準備進入今天的工作' : management ? '已辨識為店長／主管角色' : '接著可從設定新增員工與權限';
  const role = employee ? 'STAFF' : management ? 'SUPERVISOR' : 'OWNER';
  return authFrame(`<section class="auth-done"><span>${icon('tasks')}</span><h1>${title}</h1><p>${copy}</p><button class="auth-primary" type="button" data-enter-role="${role}">${employee ? '進入員工首頁' : '進入管理首頁'}</button></section>`);
}

export function appShellAuthPage(route) {
  const pages = {
    welcome: welcomePage,
    'employee-store': employeeStorePage,
    'employee-store-confirm': employeeStoreConfirmPage,
    'employee-identity': employeeIdentityPage,
    'employee-confirm': employeeConfirmPage,
    'employee-pin': employeePinPage,
    management: managementPage,
    register: registrationPage,
    verify: verifyPage,
    business: businessPage,
    'first-store': firstStorePage,
    'first-manager': firstManagerPage,
  };
  if (route === 'employee-done' || route === 'owner-done' || route === 'management-done') return donePage(route);
  return (pages[route] || welcomePage)();
}
