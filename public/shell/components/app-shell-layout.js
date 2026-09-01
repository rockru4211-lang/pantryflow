import { daisyMark, icon } from './icons.js';
import { MAIN_NAV, hashFor, roleMeta } from '../services/app-shell-routes.js';

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[character]));

export function shellLayout({ role, route, content, businessType = 'CHAIN_RESTAURANT', storeName = 'BeApe 大安店' }) {
  const meta = roleMeta(role, businessType);
  return `<div class="shell-preview-role role-${meta.accent}">
    <div class="phone-app" data-shell-role="${role}">
      <header class="shell-topbar">
        <button class="shell-store" type="button" data-route="profile">
          <span>${escapeHtml(storeName)}</span><b>⌄</b>
        </button>
        <span class="shell-brand">${daisyMark}<b>序</b></span>
        <div class="shell-top-actions">
          ${['LOGISTICS', 'OWNER'].includes(role) ? `<button type="button" data-shell-action="搜尋">${icon('search')}<span class="sr-only">搜尋</span></button>` : ''}
          <button type="button" data-route="notifications">${icon('bell')}<span class="notification-dot"></span><span class="sr-only">通知</span></button>
        </div>
      </header>
      <div class="role-ribbon"><span>${escapeHtml(meta.label)}</span><small>${businessType === 'CHAIN_RESTAURANT' ? '連鎖餐飲' : '獨立餐廳'}</small></div>
      <main class="shell-content">${content}</main>
      <nav class="shell-bottom-nav" aria-label="主要導覽">
        ${MAIN_NAV.map(item => `<button type="button" data-route="${item.id}" class="${route === item.id ? 'active' : ''}" aria-current="${route === item.id ? 'page' : 'false'}">${icon(item.icon)}<span>${item.label}</span></button>`).join('')}
      </nav>
    </div>
  </div>`;
}

export function authShellLayout(content) {
  return `<div class="shell-preview-role role-green"><div class="phone-app auth-phone">${content}</div></div>`;
}

export function shellBack(title = '返回上一頁') {
  return `<button class="shell-back" type="button" data-shell-back>‹ <span>${escapeHtml(title)}</span></button>`;
}

export function sectionHeading(title, note = '') {
  return `<div class="shell-section-head"><h2>${escapeHtml(title)}</h2>${note ? `<span>${escapeHtml(note)}</span>` : ''}</div>`;
}

export function iconTile(item, { future = false } = {}) {
  return `<button class="shell-icon-tile${future ? ' is-future' : ''}" type="button" data-route="${item.id}">
    <span>${icon(item.icon)}</span><strong>${escapeHtml(item.label)}</strong>${future ? '<small>未來選配</small>' : ''}
  </button>`;
}

export function listRow({ route, iconName = 'tasks', title, copy = '', count = '', tone = '' }) {
  return `<button class="shell-list-row ${tone}" type="button" data-route="${route}">
    <span class="row-icon">${icon(iconName)}</span>
    <span><strong>${escapeHtml(title)}</strong>${copy ? `<small>${escapeHtml(copy)}</small>` : ''}</span>
    ${count ? `<b class="row-count">${escapeHtml(count)}</b>` : '<b class="row-arrow">›</b>'}
  </button>`;
}

export function emptyPanel(title, copy) {
  return `<section class="shell-card shell-empty"><span>${icon('tasks')}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(copy)}</p></section>`;
}

export function routeLink(role, route, businessType) {
  return hashFor(role, route, businessType);
}

export { escapeHtml };
