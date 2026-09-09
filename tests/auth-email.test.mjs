import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const vite = await createServer({ configFile: false, appType: 'custom', cacheDir: 'node_modules/.vite/email-tests', server: { middlewareMode: true } });
after(() => vite.close());
const { verifyEmailCode, requestAuthEmail, mailResult, remainingMailSeconds, readMailDraft, signupDraftKey, recoveryDraftKey } = await vite.ssrLoadModule('/lib/auth-email.ts');
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
test('project mail quota failures do not invent a reset time and remain visible after draft restoration', () => {
  const status = mailResult({ status: 429, code: 'over_email_send_rate_limit' }, 'recovery', 1000);
  assert.equal(status.state, 'error'); assert.match(status.message, /本次未寄出/);
  assert.equal(remainingMailSeconds(status, 1000), 0);
  assert.match(status.message, /未提供恢復時間/);
  assert.equal(remainingMailSeconds(status, 61001), 0);
  const restored = readMailDraft(JSON.stringify({ email: 'existing@example.test', awaiting: true, mail: status }));
  assert.equal(restored.mail.message, status.message);
  const html = renderToStaticMarkup(React.createElement(MailNotice, { status: restored.mail, seconds: 0 }));
  assert.match(html, /role="alert"/); assert.match(html, /本次未寄出/);
  assert.doesNotMatch(html, /秒後/);
  assert.notEqual(signupDraftKey, recoveryDraftKey);
});
test('only an explicit Auth retry interval starts a countdown, including after reopening', () => {
  const status = mailResult({ status: 429, code: 'over_request_rate_limit', message: 'For security purposes, you can only request this after 42 seconds.' }, 'signup', 1000);
  assert.equal(remainingMailSeconds(status, 1000), 42);
  const restored = readMailDraft(JSON.stringify({ email: 'pending@example.test', awaiting: true, mail: status }));
  assert.equal(remainingMailSeconds(restored.mail, 2000), 41);
  assert.equal(remainingMailSeconds(restored.mail, 43001), 0);
  assert.equal(mailResult({ status: 429, message: 'rate limit exceeded' }, 'signup', 1000).retryAt, 0);
});
test('reopening a legacy quota failure removes the guessed timer and retains the recipient and failure', () => {
  const restored = readMailDraft(JSON.stringify({ email: 'pending@example.test', awaiting: true, mail: { state: 'error', message: '寄信服務已達寄送上限，本次未寄出。請稍後重新寄送。', retryAt: Date.now() + 60000 } }));
  assert.equal(restored.email, 'pending@example.test'); assert.equal(restored.awaiting, true);
  assert.equal(restored.mail.retryAt, 0); assert.match(restored.mail.message, /未提供恢復時間/);
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
test('signup retains the original email and password form, with inline status, resend, edit and a separate code form', () => {
  const base = { mode: 'signup', email: 'pending@example.test', password: '', awaiting: true, recipientLocked: true, busy: false, seconds: 25, mail: mailResult(null, 'signup'), onEmailChange() {}, onPasswordChange() {}, onSubmit() {}, onEditEmail() {}, code: '', codeError: '', onCodeChange() {}, onVerify() {} };
  const html = renderToStaticMarkup(React.createElement(EmailAccountForm, base));
  assert.match(html, /id="account-signup"/); assert.match(html, /id="signup-email"/);
  assert.match(html, /name="password"/); assert.match(html, /重新寄送驗證信/); assert.match(html, /修改 Email/);
  assert.match(html, /25 秒後可再次嘗試寄送/);
  assert.ok(html.indexOf(base.mail.message) < html.indexOf('25 秒'));
  assert.match(html, /id="signup-code-form"/); assert.match(html, /name="email_verification_code"/);
  assert.match(html, /id="signup-email-code"/); assert.match(html, /section-signup-code one-time-code/);
  const verifyButton = html.match(/<button[^>]*>驗證並繼續<\/button>/)[0];
  assert.doesNotMatch(verifyButton, /disabled/);
  assert.ok(html.indexOf('</form>') < html.indexOf('id="signup-code-form"'));
  assert.doesNotMatch(html.match(/<input[^>]+name="email_verification_code"[^>]*>/)[0], /pending@example.test/);
  const login = renderToStaticMarkup(React.createElement(EmailAccountForm, { ...base, mode: 'login', email: '', awaiting: false }));
  assert.match(login, /id="login-email"/); assert.match(login, /section-login current-password/);
  assert.doesNotMatch(login, /pending@example.test|重新寄送|readonly|Email 驗證碼|驗證並繼續/);
  const noDraft = renderToStaticMarkup(React.createElement(EmailAccountForm, { ...base, email: '', recipientLocked: false }));
  assert.doesNotMatch(noDraft.match(/<input[^>]+name="email"[^>]*>/)[0], /readonly/);
});
test('malformed or stale-shape drafts do not leak into another auth flow', () => {
  for (const value of [null, '{', '{}', JSON.stringify({ email: 'test', awaiting: true, mail: { state: 'error', message: 'failed', retryAt: '60' } })]) assert.equal(readMailDraft(value), null);
});


test('valid email codes call official verification even after a resend is rate limited', async () => {
  const calls = [];
  const session = { user: { id: 'existing-auth-user' } };
  const auth = {
    resend: async () => ({ error: { status: 429, code: 'over_email_send_rate_limit' } }),
    verifyOtp: async data => { calls.push(data); return { data: { session }, error: null }; },
  };
  const mail = await requestAuthEmail(auth, 'signup', 'pending@example.test');
  assert.equal(mail.state, 'error'); assert.equal(mail.retryAt, 0);
  const result = await verifyEmailCode(auth, ' pending@example.test ', '123456');
  assert.equal(result.session, session); assert.equal(result.error, '');
  assert.deepEqual(calls, [{ email: 'pending@example.test', token: '123456', type: 'email' }]);
  const props = { mode: 'signup', email: 'pending@example.test', password: '', awaiting: true, recipientLocked: true, busy: false, seconds: 60, mail, code: '123456', codeError: '', onEmailChange() {}, onPasswordChange() {}, onSubmit() {}, onEditEmail() {}, onCodeChange() {}, onVerify() {} };
  const html = renderToStaticMarkup(React.createElement(EmailAccountForm, props));
  assert.match(html, /disabled="">重新寄送驗證信/);
  assert.doesNotMatch(html.match(/<button[^>]*>驗證並繼續<\/button>/)[0], /disabled/);
  assert.match(html, /本次未寄出/);
});
test('wrong, expired or used codes never open an authenticated workspace', async () => {
  for (const error of [{ code: 'otp_expired', message: 'Token has expired or is invalid' }, { code: 'unexpected_failure', message: 'failed' }]) {
    const result = await verifyEmailCode({ verifyOtp: async () => ({ data: { session: null }, error }) }, 'pending@example.test', '123456');
    assert.equal(result.session, null); assert.ok(result.error);
    if (error.code === 'otp_expired') assert.match(result.error, /驗證碼不正確或已過期/);
  }
  const missingSession = await verifyEmailCode({ verifyOtp: async () => ({ data: { session: null }, error: null }) }, 'pending@example.test', '123456');
  assert.equal(missingSession.session, null); assert.match(missingSession.error, /驗證未完成/);
});
test('Email in the code field and missing Email are rejected without a request', async () => {
  let calls = 0;
  const auth = { verifyOtp: async () => { calls++; } };
  for (const [email, code] of [['pending@example.test', 'pending@example.test'], ['', '123456'], ['pending@example.test', '123']]) {
    const result = await verifyEmailCode(auth, email, code);
    assert.equal(result.session, null); assert.ok(result.error);
  }
  assert.equal(calls, 0);
});
test('verification errors render next to the code without changing the recipient or mail status', () => {
  const html = renderToStaticMarkup(React.createElement(EmailAccountForm, { mode: 'signup', email: 'pending@example.test', password: '', awaiting: true, recipientLocked: true, busy: false, seconds: 60, mail: mailResult({ status: 429, code: 'over_email_send_rate_limit' }, 'signup'), code: '123456', codeError: '驗證碼不正確或已過期', onEmailChange() {}, onPasswordChange() {}, onSubmit() {}, onEditEmail() {}, onCodeChange() {}, onVerify() {} }));
  assert.match(html, /id="signup-code-error"[^>]*role="alert"/);
  assert.match(html, /aria-describedby="signup-code-error"/);
  assert.match(html, /value="pending@example.test"/); assert.match(html, /value="123456"/);
  assert.match(html, /本次未寄出/); assert.match(html, /驗證碼不正確或已過期/);
});
