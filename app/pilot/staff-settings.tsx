"use client";
import {useRef,useState,type FormEvent} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {roleLabel,type AppRole} from '@/lib/app-workspace';
import StaffInvitationCard from './staff-invitation-card';
import {memberProvisionSucceeded} from '@/lib/member-provision-result';
type Login={storeCode:string;loginIdentifier:string;displayName:string;role:string;activationCode:string;expiresInDays:number};
type Result={staffId?:string;inviteId?:string;pending?:boolean;invited?:boolean;existing?:boolean;verificationSent?:boolean;email?:string;error?:string;login?:Login};
const managementError = (code?: string) => {
  if (code === "STAFF_ALREADY_EXISTS") return "此門市已有相同登入帳號。";
  if (code === "STORE_CODE_ALREADY_EXISTS") return "此門市代碼已被使用。";
  if (["ADMIN_REQUIRED", "STORE_MEMBERSHIP_REQUIRED", "ROLE_NOT_ALLOWED"].includes(code || "")) {
    return "目前帳號沒有管理此門市的權限。";
  }
  if (code === "INVALID_STAFF_INPUT") return "請確認姓名與登入帳號格式。";
  if (code === "MEMBER_OTHER_ORGANIZATION") return "此帳號已屬於另一個商家，請確認邀請的 Email。既有商家資料未變更。";
  if (code === "over_email_send_rate_limit") return "寄信服務暫時達到上限，邀請資料已保留，請稍後重寄。";
  if (code === "INVALID_INVITE") return "請確認管理成員的姓名、Email 與門市權限。";
  return "目前無法完成，請稍後再試。";
};


export default function StaffSettings({stores,allowedRoles=['STAFF'],onWorkspaceChanged,businessType='SINGLE_RESTAURANT'}:{stores:{id:string;name:string;store_code:string;staff_login_mode?:string}[];canManageStores:boolean;allowedRoles?:AppRole[];createOnly?:boolean;onWorkspaceChanged:()=>Promise<void>;businessType?:string}){
 const store=stores[0];const[role,setRole]=useState<AppRole>('STAFF');const[emailInvite,setEmailInvite]=useState(false);const[busy,setBusy]=useState(false);const[message,setMessage]=useState('');const[receipt,setReceipt]=useState<Login>();const lock=useRef(false);
 const managementOnly=role==='LOGISTICS'||role==='OWNER';
 const useManagementLogin=managementOnly||(role==='SUPERVISOR'&&emailInvite);
 async function create(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(lock.current||!store)return;lock.current=true;setBusy(true);setMessage('');const form=event.currentTarget;const values=new FormData(form);const name=String(values.get('display_name')||'').trim();
  try{
   const {data,error}=await supabase.functions.invoke<Result>('manage-staff',{body:{action:useManagementLogin?'invite_management':'create',storeId:store.id,displayName:name,role,email:String(values.get('email')||'').trim(),loginIdentifier:store.staff_login_mode==='EMPLOYEE_NUMBER'?'':name}});
   if(error||!data||!memberProvisionSucceeded(role,data)){let detail=data;if(error&&'context' in error&&error.context instanceof Response)try{detail=await error.context.json();}catch{}setMessage(managementError(detail?.error));return;}
   setReceipt(data.login);setMessage(data.login?'現場帳號已建立，請將邀請連結或 QR Code 交給本人設定 PIN。':data.pending?'管理帳號邀請已保留；本人可使用原帳號登入並確認加入。':`管理端邀請已寄至 ${data.email}，請本人確認加入。`);form.reset();await onWorkspaceChanged();
  }catch{setMessage('目前無法完成，輸入內容已保留，請稍後再試。');}finally{lock.current=false;setBusy(false);}
 }
 return <section className="shell-section"><h2>新增成員</h2><p>{store?.name}</p><article className="shell-card settings-card"><form className="compact-form" onSubmit={create}><label>姓名／暱稱<input name="display_name" required maxLength={64}/></label><label>工作身分<select value={role} onChange={e=>{const next=e.target.value as AppRole;setRole(next);setEmailInvite(next==='LOGISTICS'||next==='OWNER');}}>{allowedRoles.map(r=><option key={r} value={r}>{roleLabel(r,businessType)}</option>)}</select></label>{role==='STAFF'&&<p className="shell-note">門市現場登入：使用門市代碼、個人識別與 6 位 PIN。</p>}{role==='SUPERVISOR'&&<label>登入方式<select value={emailInvite?'EMAIL':'PIN'} onChange={e=>setEmailInvite(e.target.value==='EMAIL')}><option value="PIN">門市現場登入（門市代碼＋PIN）</option><option value="EMAIL">營運管理登入（Email／Google）</option></select></label>}{managementOnly&&<p className="shell-note">此身分使用營運／行政登入，不建立門市 PIN。</p>}{useManagementLogin&&<label>Email<input name="email" type="email" autoComplete="off" autoCapitalize="none" required/></label>}<p className="shell-note">先套用身分預設權限，需要時可從成員資料調整。</p><button className="shell-primary full" disabled={busy}>{busy?'建立中…':useManagementLogin?'寄送管理邀請':'建立現場帳號'}</button></form></article>{message&&<p className="count-notice" role="status">{message}</p>}{receipt&&<article className="shell-card settings-card login-receipt" aria-label="新帳號登入資料"><h3>{receipt.displayName}</h3><p>{receipt.storeCode}・{roleLabel(receipt.role as AppRole,businessType)}</p><p>現場登入使用：{receipt.loginIdentifier}</p><StaffInvitationCard token={receipt.activationCode} days={receipt.expiresInDays}/></article>}</section>;
}
