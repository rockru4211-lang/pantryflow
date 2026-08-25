import { escapeHtml, formalUiText } from '../components/layout.js';

function shell(title, copy, content) {
  return `<div class="admin-login-stage onboarding-stage">
    <section class="admin-login-frame onboarding-frame" aria-labelledby="onboarding-title">
      <header class="admin-login-topbar"><strong>PantryFlow</strong></header>
      <div class="admin-login-content">
        <div class="admin-login-heading">
          <p class="eyebrow">門市優先設定</p>
          <h1 id="onboarding-title">${escapeHtml(title)}</h1>
          <p>${escapeHtml(copy)}</p>
        </div>
        ${content}
        <button class="secondary onboarding-sign-out" data-sign-out type="button">登出</button>
      </div>
    </section>
  </div>`;
}

function storeFields({ prefix = '', submitLabel }) {
  return `<label class="field">第一間門市名稱
      <input name="${prefix}storeName" maxlength="100" required>
    </label>
    <label class="field">門市代碼
      <input name="${prefix}storeCode" pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,31}" maxlength="32" autocapitalize="characters" required>
    </label>
    <label class="field">員工登入識別方式
      <select name="${prefix}loginMode" required>
        <option value="NAME_OR_NICKNAME">登入暱稱＋6 位 PIN</option>
        <option value="EMPLOYEE_NUMBER">員工編號＋6 位 PIN</option>
      </select>
    </label>
    <p class="error admin-login-error" data-error aria-live="polite"></p>
    <button class="primary" type="submit">${escapeHtml(submitLabel)}</button>`;
}

export function ownerBusinessOnboardingPage(profile = {}) {
  return shell(
    '建立商家與第一間門市',
    '先完成商家與門市，之後才能建立店長、主管或員工身分。',
    `<div class="steps" aria-label="設定步驟"><span class="step-dot active">1</span><span>商家</span><span class="step-line"></span><span class="step-dot active">2</span><span>第一間門市</span></div>
    <form id="create-owner-business" class="admin-login-form">
      <label class="field">商家名稱
        <input name="organizationName" maxlength="100" required>
      </label>
      <label class="field">商家類型
        <select name="businessType" required>
          <option value="SINGLE_RESTAURANT">單一餐廳</option>
          <option value="CHAIN_RESTAURANT">連鎖餐飲</option>
        </select>
      </label>
      ${storeFields({ submitLabel: '建立商家與第一間門市' })}
    </form>
    <div class="helper">目前登入身分：${escapeHtml(formalUiText(profile.display_name, '管理者'))}</div>`,
  );
}

export function firstStoreOnboardingPage(organization = {}) {
  return shell(
    '建立第一間門市',
    '目前商家尚無門市；建立成功後才會開放門市成員設定。',
    `<section class="onboarding-context card">
      <small>所屬商家</small>
      <strong>${escapeHtml(formalUiText(organization.name, '尚未設定商家'))}</strong>
    </section>
    <form id="create-first-store" class="admin-login-form">
      ${storeFields({ submitLabel: '建立第一間門市' })}
    </form>`,
  );
}
