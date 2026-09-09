import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const vite = await createServer({ configFile: false, appType: 'custom', cacheDir: 'node_modules/.vite/email-tests', server: { middlewareMode: true } });
after(() => vite.close());
const { requestAuthEmail, mailResult, remainingMailSeconds, readMailDraft, signupDraftKey, recoveryDraftKey } = await vite.ssrLoadModule('/lib/auth-email.ts');
const { default: EmailAccountForm, MailNotice } = await vite.ssrLoadModule('/app/pilot/email-account-form.tsx');

test('confirmation retry resends an existing signup; recovery calls only resetPasswordForEmail', async () => {
  const calls = [];
  const auth = { resend: async data => { calls.push(['resend', data]); return { error: null }; }, resetPasswordForEmail: async (...args) => { calls.push(['recovery', ...args]); return { error: null }; } };
  const signup = await requestAuthEmail(auth, 'signup', ' pending@example.test ');
  const recovery = await requestAuthEmail(auth, 'recovery', ' existing@example.test ');
  assert.equal(signup.state, 'accepted'); assert.equal(recovery.state, 'accepted');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ['resend', { type: 'signup', email: 'pending@example.test', options: { emailRedirectTo: 'https://pantryflow-app-shell-preview.rockru4211.chatgpt.site/?auth=signup' } }]);
  assert.deepEqual(calls[1], ['recovery', 'existing@example.test', { redirectTo: 'https://pantryflow-app-shell-preview.rockru4211.chatgpt.site/?auth=recovery' }]);
});
test('mail failures remain visible after cooldown expires and after draft restoration', () => {
  const status = mailResult({ status: 429, code: 'over_email_send_rate_limit' }, 'recovery', 1000);
  assert.equal(status.state, 'error'); assert.match(status.message, /本次未寄出/);
  assert.equal(remainingMailSeconds(status, 1000), 60);
  assert.equal(remainingMailSeconds(status, 61001), 0);
  const restored = readMailDraft(JSON.stringify({ email: 'existing@example.test', awaiting: true, mail: status }));
  assert.equal(restored.mail.message, status.message);
  const html = renderToStaticMarkup(React.createElement(MailNotice, { status: restored.mail, seconds: 0 }));
  assert.match(html, /role="alert"/); assert.match(html, /本次未寄出/);
  assert.notEqual(signupDraftKey, recoveryDraftKey);
});
test('SMTP and network failures never claim sent or silently start a countdown', async () => {
  for (const error of [{ code: 'unexpected_failure', message: 'Error sending confirmation email', status: 500 }, { code: 'email_address_not_authorized', status: 422 }]) {
    const status = await requestAuthEmail({ resend: async () => ({ error }) }, 'signup', 'pending@example.test');
    assert.equal(status.state, 'error'); assert.equal(status.retryAt, 0);
    assert.match(status.message, /寄信/); assert.doesNotMatch(status.message, /已提交|已寄出/);
  }
  const status = await requestAuthEmail({ resetPasswordForEmail: async () => { throw new Error('offline'); } }, 'recovery', 'existing@example.test');
  assert.equal(status.state, 'error'); assert.equal(status.retryAt, 0); assert.match(status.message, /未完成寄送/);
});
test('signup request acceptance is not proof of delivery or a newly created account', () => {
  const status = mailResult(null, 'signup', 1000);
  assert.match(status.message, /若此 Email 尚待驗證/);
  assert.match(status.message, /已驗證的帳號請返回管理登入/);
  assert.doesNotMatch(status.message, /已寄出|寄送成功|已收到/);
});
test('signup retains the original email and password form, with inline status, resend and edit; no OTP', () => {
  const base = { mode: 'signup', email: 'pending@example.test', password: '', awaiting: true, recipientLocked: true, busy: false, seconds: 25, mail: mailResult(null, 'signup'), onEmailChange() {}, onPasswordChange() {}, onSubmit() {}, onEditEmail() {} };
  const html = renderToStaticMarkup(React.createElement(EmailAccountForm, base));
  assert.match(html, /id="account-signup"/); assert.match(html, /id="signup-email"/);
  assert.match(html, /name="password"/); assert.match(html, /重新寄送驗證信/); assert.match(html, /修改 Email/);
  assert.match(html, /25 秒後可再次寄送/);
  assert.ok(html.indexOf(base.mail.message) < html.indexOf('25 秒'));
  assert.doesNotMatch(html, /name="otp"|驗證碼|one-time-code/);
  const login = renderToStaticMarkup(React.createElement(EmailAccountForm, { ...base, mode: 'login', email: '', awaiting: false }));
  assert.match(login, /id="login-email"/); assert.match(login, /section-login current-password/);
  assert.doesNotMatch(login, /pending@example.test|重新寄送|readonly/);
  const noDraft = renderToStaticMarkup(React.createElement(EmailAccountForm, { ...base, email: '', recipientLocked: false }));
  assert.doesNotMatch(noDraft.match(/<input[^>]+name="email"[^>]*>/)[0], /readonly/);
});
test('malformed or stale-shape drafts do not leak into another auth flow', () => {
  for (const value of [null, '{', '{}', JSON.stringify({ email: 'test', awaiting: true, mail: { state: 'error', message: 'failed', retryAt: '60' } })]) assert.equal(readMailDraft(value), null);
});
