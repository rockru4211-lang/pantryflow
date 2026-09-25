"use client";
import type {DevicePolicy} from '@/lib/login-device';
import {AuthShell,AuthTopbar} from './app-shell';
export default function DeviceChoice({policy,busy,message,onChoose,onBack}:{policy:DevicePolicy;busy:boolean;message:string;onChoose:(personal:boolean)=>void;onBack:()=>void}){
 return <AuthShell><section className="admin-login-stage"><div className="admin-login-frame"><AuthTopbar/><div className="admin-login-content">
    <h1>這是哪一種裝置？</h1><p>依照使用方式保留登入，下次回來可以接續作業。</p>
    <button className="primary full-button" disabled={busy||(!policy.personal_allowed&&!policy.can_authorize_personal)} onClick={()=>onChoose(true)}>{policy.personal_allowed?'這是我的裝置・保持登入':'主管授權此個人裝置並保持登入'}</button>
    <p className="auth-footnote">個人裝置連續 30 天未使用才需重新驗證。切換 App、鎖定螢幕及重新整理可繼續使用。</p>
    {!policy.personal_allowed&&!policy.can_authorize_personal&&<p className="helper">個人裝置需由主管授權；目前可先使用共用裝置模式。</p>}
    <button className="secondary full-button" disabled={busy} onClick={()=>onChoose(false)}>這是共用裝置</button>
    <p className="auth-footnote">只記住門市，閒置 15 分鐘後重新驗證。離開前可從設定登出並切換帳號。</p>
    {message&&<p className="pilot-message" role="status">{message}</p>}
    <button className="text-button full-button" disabled={busy} onClick={onBack}>返回登入</button>
  </div></div></section></AuthShell>;
}
