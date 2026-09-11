'use client';
import {useRef,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {roleLabel,type AppRole} from '@/lib/app-workspace';
import {AuthShell,AuthTopbar} from './app-shell';
export type ManagementInvitation={id:string;email:string;organization_name:string;store_name:string;store_id:string;business_type:string;role:AppRole;expires_at:string;valid:boolean};
export default function InvitationConfirmation({invitations,onChanged,onSignOut}:{invitations:ManagementInvitation[];onChanged:()=>Promise<void>;onSignOut:()=>Promise<void>}){
 const[busy,setBusy]=useState(false);const[error,setError]=useState('');const locked=useRef(false);
 async function respond(id:string,action:'accept'|'decline'){
  if(locked.current)return;locked.current=true;setBusy(true);setError('');
  try{
   const result=await supabase.rpc('management_invitation',{p_action:action,p_invite_id:id});
   if(result.error)throw result.error;
   await onChanged();
  }catch(e){const message=String((e as {message?:string})?.message||'');setError(/INVITE_NOT_VALID|INVITER_ACCESS_REVOKED/.test(message)?'此邀請已過期或管理者已撤銷權限，請聯絡商家重新邀請。':/EMAIL_MISMATCH|VERIFIED_EMAIL_REQUIRED/.test(message)?'請使用受邀的 Email 完成驗證並登入。':/MEMBER_DISABLED/.test(message)?'此帳號授權已停用，請聯絡商家管理者。':'加入未完成，請重試；不會重複建立商家。');}
  finally{locked.current=false;setBusy(false);}
 }
 return <AuthShell><section className="admin-login-stage"><div className="admin-login-frame"><AuthTopbar/><div className="admin-login-content"><div className="admin-login-heading"><h1>確認加入商家</h1><p>沿用您的個人帳號，確認受邀的商家與工作身分。</p></div>{invitations.map(i=><article className="shell-card settings-card" key={i.id}><h2>{i.organization_name}</h2><p>{i.store_name}・{roleLabel(i.role,i.business_type)}</p><p>{i.email}</p><p className="shell-note">加入既有商家，不會另建商家。其他權限由商家管理者後續授予。</p>{!i.valid&&<p role="status">此邀請已過期或授權失效，請聯絡管理者重新邀請。</p>}<button type="button" className="primary full-button" disabled={busy||!i.valid} onClick={()=>void respond(i.id,'accept')}>{busy?'處理中…':'確認加入'}</button><button type="button" className="text-button full-button" disabled={busy} onClick={()=>void respond(i.id,'decline')}>不加入此商家</button></article>)}{error&&<p className="pilot-message" role="alert">{error}</p>}<button type="button" className="text-button full-button" disabled={busy} onClick={()=>void onSignOut()}>返回登入</button></div></div></section></AuthShell>;
}
