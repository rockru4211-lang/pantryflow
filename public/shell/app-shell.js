import { authShellLayout, shellLayout } from './components/app-shell-layout.js';
import { appShellAuthPage } from './pages/app-shell-auth.js';
import { appShellPage } from './pages/app-shell-pages.js';
import { SHELL_ROLES, hashFor, routeFromHash } from './services/app-shell-routes.js';

const root = document.querySelector('#shell-root');
const toast = document.querySelector('#shell-toast');
const roleKinds = { employee: 'STAFF', manager: 'SUPERVISOR', logistics: 'LOGISTICS', owner: 'OWNER' };

function roleFromLocation() {
  const kind = String(location.hash).replace(/^#\/?/, '').split('/').filter(Boolean)[0];
  const queryRole = new URLSearchParams(location.search).get('role')?.toUpperCase();
  return roleKinds[kind] || (SHELL_ROLES[queryRole] ? queryRole : 'STAFF');
}

let activeRole = roleFromLocation();

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function setRoute(route) {
  const next = hashFor(activeRole, route);
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
  root.innerHTML = isAuth ? authShellLayout(appShellAuthPage(route)) : shellLayout({ role: activeRole, route, content: appShellPage(activeRole, route) });
  document.querySelectorAll('[data-role]').forEach(button => button.classList.toggle('active', button.dataset.role === activeRole));
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
    'staff-pin-login': () => { activeRole = 'STAFF'; location.hash = hashFor(activeRole, 'home'); },
    'management-login': () => { activeRole = 'SUPERVISOR'; location.hash = hashFor(activeRole, 'home'); },
    'owner-registration': () => setAuthRoute('register-sent'),
    'owner-business': () => setAuthRoute('first-store'),
    'owner-store': () => setAuthRoute('first-manager'),
    'owner-business-setup': () => setAuthRoute('operating-model'),
    'owner-operating-model': () => setAuthRoute('owner-done'),
    'forgot-password': () => setAuthRoute('forgot-password-sent'),
  };
  Object.entries(authForms).forEach(([id, submit]) => root.querySelector(`#${id}`)?.addEventListener('submit', event => {
    event.preventDefault();
    submit();
  }));
  root.querySelectorAll('[data-enter-role]').forEach(button => button.addEventListener('click', () => {
    activeRole = button.dataset.enterRole;
    location.hash = hashFor(activeRole, 'home');
  }));
  root.querySelector('[data-shell-back]')?.addEventListener('click', () => {
    if (history.length > 1) history.back();
    else setRoute('home');
  });
  root.querySelectorAll('[data-shell-action]').forEach(button => button.addEventListener('click', () => showToast(`${button.dataset.shellAction}：外殼位置已保留，尚未接真實功能`)));
  window.scrollTo({ top: 0, behavior: 'instant' });
}

document.querySelectorAll('[data-role]').forEach(button => button.addEventListener('click', () => {
  activeRole = button.dataset.role;
  location.hash = hashFor(activeRole, 'home');
}));
document.querySelector('[data-auth-preview]')?.addEventListener('click', () => { location.hash = '#/auth/welcome'; });

window.addEventListener('hashchange', render);
window.addEventListener('error', event => {
  console.error(event.error || event.message);
  showToast('外殼載入時發生錯誤，請重新整理');
});

const build = window.PILOT_BUILD || { branch: 'feature/app-shell-20260901', sha: 'local', deployedAt: '尚未部署' };
document.querySelector('#shell-build').textContent = `Branch: ${build.branch}｜Git SHA: ${build.sha}｜部署時間: ${build.deployedAt}`;

if (!location.hash) location.hash = hashFor(activeRole, 'home');
else render();
