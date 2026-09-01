import {
  businessSetupPage,
  employeeIdentityConfirmPage,
  employeeIdentityPage,
  employeePinPage,
  employeeStoreConfirmPage,
  employeeStorePage,
  firstManagerSetupPage,
  firstStoreSetupPage,
  forgotPasswordPage,
  loginPage,
  managementLoginPage,
  registrationPage,
} from './project-login.js';

const employeeContext = {
  storeCode: 'BEAPE01',
  storeName: 'BeApe 大安店',
  identifier: '王小明',
  mode: 'NAME_OR_NICKNAME',
  loginMode: 'NAME_OR_NICKNAME',
};

export function appShellAuthPage(route = 'welcome') {
  const pages = {
    welcome: () => loginPage(),
    management: () => managementLoginPage(),
    'employee-store': () => employeeStorePage({ storeCode: employeeContext.storeCode }),
    'employee-store-confirm': () => employeeStoreConfirmPage(employeeContext),
    'employee-identity': () => employeeIdentityPage(employeeContext),
    'employee-confirm': () => employeeIdentityConfirmPage(employeeContext),
    'employee-pin': () => employeePinPage(employeeContext),
    register: () => registrationPage(),
    'register-sent': () => registrationPage({ message: '請到信箱完成 Email 驗證。', email: 'example@email.com' }),
    business: () => businessSetupPage({ displayName: '林店長', organizationName: 'BeApe', businessType: 'SINGLE_RESTAURANT' }),
    'first-store': () => firstStoreSetupPage({ storeName: '大安店', storeCode: employeeContext.storeCode, loginMode: employeeContext.loginMode }),
    'first-manager': () => firstManagerSetupPage({ displayName: '林店長' }),
    'forgot-password': () => forgotPasswordPage(),
    'forgot-password-sent': () => forgotPasswordPage({ sent: true }),
  };

  return (pages[route] || pages.welcome)();
}
