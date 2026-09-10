'use client';
import {useState,type FormEvent} from 'react';
import PasswordInput from './password-input';
export default function ChangePasswordForm({onChangePassword}:{onChangePassword:(current:string,next:string)=>Promise<string|null>}){
 const[busy,setBusy]=useState(false);const[error,setError]=useState('');
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;setError('');const form=new FormData(event.currentTarget);
  const next=String(form.get('next_password')||'');
  if(next!==form.get('confirm_password')){setError('兩次新密碼不相同，請重新輸入。');return;}
  if(next===form.get('current_password')){setError('新密碼不能與原密碼相同。');return;}
  setBusy(true);try{setError(await onChangePassword(String(form.get('current_password')||''),next)||'');}catch{setError('密碼未能更新，請確認連線後重試。');}finally{setBusy(false);}
 }
 return <details className="shell-card password-change"><summary>變更密碼</summary><form className="admin-login-form" onSubmit={submit}>
  <label className="field" htmlFor="change-current-password">目前密碼<PasswordInput id="change-current-password" name="current_password" autoComplete="section-change current-password" required/></label>
  <label className="field" htmlFor="change-next-password">新密碼<PasswordInput strength id="change-next-password" name="next_password" autoComplete="section-change new-password" minLength={8} required/></label>
  <label className="field" htmlFor="change-confirm-password">再次輸入新密碼<PasswordInput id="change-confirm-password" name="confirm_password" autoComplete="section-change new-password" minLength={8} required/></label>
  {error&&<p className="pilot-message" role="alert">{error}</p>}
  <p className="auth-footnote">更新後請使用新密碼重新登入。</p>
  <button className="shell-primary" disabled={busy}>{busy?'更新中…':'更新密碼'}</button>
 </form></details>;
}
