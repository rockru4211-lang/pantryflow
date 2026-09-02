import { authShellLayout, shellLayout } from './components/app-shell-layout.js';
import { appShellAuthPage } from './pages/app-shell-auth.js';
import { appShellPage } from './pages/app-shell-pages.js';
import { BUSINESS_TYPES, SHELL_ROLES, hashFor, roleOptions, routeFromHash } from './services/app-shell-routes.js';

const root = document.querySelector('#shell-root');
const toast = document.querySelector('#shell-toast');
const roleKinds = { employee: 'STAFF', manager: 'SUPERVISOR', logistics: 'LOGISTICS', area: 'LOGISTICS', backoffice: 'LOGISTICS', owner: 'OWNER' };

function businessFromLocation() {
  const kind = String(location.hash).replace(/^#\/?/, '').split('/').filter(Boolean)[0];
  const query = new URLSearchParams(location.search).get('business')?.toUpperCase();
  if (BUSINESS_TYPES[query]) return query;
  return kind === 'backoffice' ? 'INDEPENDENT_RESTAURANT' : 'CHAIN_RESTAURANT';
}

function roleFromLocation() {
  const kind = String(location.hash).replace(/^#\/?/, '').split('/').filter(Boolean)[0];
  const queryRole = new URLSearchParams(location.search).get('role')?.toUpperCase();
  return roleKinds[kind] || (SHELL_ROLES[queryRole] ? queryRole : 'STAFF');
}

let activeBusinessType = businessFromLocation();
let activeRole = roleFromLocation();

function syncPreviewToolbar() {
  const options = roleOptions(activeBusinessType);
  document.querySelectorAll('[data-business]').forEach(button => button.classList.toggle('active', button.dataset.business === activeBusinessType));
  document.querySelector('[data-business-summary]').textContent = BUSINESS_TYPES[activeBusinessType].copy;
  document.querySelectorAll('[data-role]').forEach(button => {
    const option = options.find(item => item.role === button.dataset.role);
    button.hidden = !option;
    button.disabled = Boolean(option?.future);
    if (option) button.textContent = `${option.label}${option.future ? '（未來）' : ''}`;
    button.classList.toggle('active', Boolean(option) && !option.future && button.dataset.role === activeRole);
  });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function setRoute(route) {
  const next = hashFor(activeRole, route, activeBusinessType);
  if (location.hash === next) {
    showToast('這個抽屜的資料功能會在下一階段接入');
    return;
  }
  location.hash = next;
}

function setAuthRoute(route) {
  location.hash = `#/auth/${route}`;
}

function render() {
  activeRole = roleFromLocation();
  const route = routeFromHash();
  const isAuth = String(location.hash).replace(/^#\/?/, '').split('/').filter(Boolean)[0] === 'auth';
  document.body.classList.toggle('admin-auth-view', isAuth);
  root.innerHTML = isAuth ? authShellLayout(appShellAuthPage(route)) : shellLayout({ role: activeRole, route, businessType: activeBusinessType, content: appShellPage(activeRole, route, activeBusinessType) });
  syncPreviewToolbar();
  document.querySelector('[data-auth-preview]')?.classList.toggle('active', isAuth);

  root.querySelectorAll('[data-route]').forEach(button => button.addEventListener('click', () => setRoute(button.dataset.route)));
  root.querySelectorAll('[data-auth-route]').forEach(button => button.addEventListener('click', () => setAuthRoute(button.dataset.authRoute)));
  const authViewRoutes = {
    identity: 'welcome',
    manager: 'management',
    'employee-store': 'employee',
    register: 'register',
    'forgot-password': 'forgot-password',
    'business-setup': 'business',
    'first-store': 'first-store',
  };
  root.querySelectorAll('[data-auth-view]').forEach(button => button.addEventListener('click', () => setAuthRoute(authViewRoutes[button.dataset.authView] || 'welcome')));
  root.querySelectorAll('[data-sign-out]').forEach(button => button.addEventListener('click', () => setAuthRoute('welcome')));

  const authForms = {
    'staff-identity': () => setAuthRoute('employee-pin'),
    'staff-pin-login': () => { activeRole = 'STAFF'; location.hash = hashFor(activeRole, 'home', activeBusinessType); },
    'management-login': () => { activeRole = 'SUPERVISOR'; location.hash = hashFor(activeRole, 'home', activeBusinessType); },
    'owner-registration': () => setAuthRoute('register-sent'),
    'owner-business': () => setAuthRoute('first-store'),
    'owner-store': () => setAuthRoute('first-manager'),
    'owner-business-setup': () => setAuthRoute('owner-done'),
    'forgot-password': () => setAuthRoute('forgot-password-sent'),
  };
  Object.entries(authForms).forEach(([id, submit]) => root.querySelector(`#${id}`)?.addEventListener('submit', event => {
    event.preventDefault();
    submit();
  }));
  root.querySelectorAll('[data-enter-role]').forEach(button => button.addEventListener('click', () => {
    activeRole = button.dataset.enterRole;
    location.hash = hashFor(activeRole, 'home', activeBusinessType);
  }));
  root.querySelector('[data-shell-back]')?.addEventListener('click', () => {
    if (history.length > 1) history.back();
    else setRoute('home');
  });
  root.querySelectorAll('[data-shell-action]').forEach(button => button.addEventListener('click', () => showToast(`${button.dataset.shellAction}：外殼位置已保留，尚未接真實功能`)));
  root.querySelectorAll('[data-expiry-choice]').forEach(button => button.addEventListener('click', () => {
    const group = button.closest('[data-expiry-choice-group]');
    group?.querySelectorAll('[data-expiry-choice]').forEach(choice => choice.classList.toggle('active', choice === button));
    const groups = [...root.querySelectorAll('[data-expiry-choice-group]')];
    const complete = root.querySelector('[data-expiry-complete]');
    if (complete) complete.disabled = !groups.every(item => item.querySelector('[data-expiry-choice].active'));
  }));
  window.scrollTo({ top: 0, behavior: 'instant' });
}

document.querySelectorAll('[data-role]').forEach(button => button.addEventListener('click', () => {
  if (button.disabled) return;
  activeRole = button.dataset.role;
  location.hash = hashFor(activeRole, 'home', activeBusinessType);
}));
document.querySelectorAll('[data-business]').forEach(button => button.addEventListener('click', () => {
  activeBusinessType = button.dataset.business;
  const allowed = roleOptions(activeBusinessType).filter(option => !option.future).map(option => option.role);
  if (!allowed.includes(activeRole)) activeRole = 'STAFF';
  const previewUrl = new URL(location.href);
  previewUrl.searchParams.set('business', activeBusinessType);
  history.replaceState(null, '', `${previewUrl.pathname}${previewUrl.search}${previewUrl.hash}`);
  location.hash = hashFor(activeRole, 'home', activeBusinessType);
  render();
}));
document.querySelector('[data-auth-preview]')?.addEventListener('click', () => { location.hash = '#/auth/welcome'; });

window.addEventListener('hashchange', render);
window.addEventListener('error', event => {
  console.error(event.error || event.message);
  showToast('外殼載入時發生錯誤，請重新整理');
});

const build = window.PILOT_BUILD || { branch: 'feature/app-shell-20260901', sha: 'local', deployedAt: '尚未部署' };
document.querySelector('#shell-build').textContent = `Branch: ${build.branch}｜Git SHA: ${build.sha}｜部署時間: ${build.deployedAt}`;

if (!location.hash) location.hash = hashFor(activeRole, 'home', activeBusinessType);
else render();
