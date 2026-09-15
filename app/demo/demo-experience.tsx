'use client';
/* eslint-disable @next/next/no-html-link-for-pages -- Full navigation resets the isolated demo transport before real sign-in. */
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,RotateCcw,Users,FlaskConical} from 'lucide-react';
import {configureDemo,demoContext,resetDemo,selectDemoStore,inspectDemoInvitation,activateDemoInvitation} from '@/lib/demo-client.mjs';
import {roleLabel,type AppRole,type AppStore} from '@/lib/app-workspace';
import type {Session} from '@supabase/supabase-js';
import {clearDemoDrafts} from '@/lib/workspace-storage';
import AuthenticatedWorkspace from '../pilot/authenticated-workspace';
import {readStaffInvitation,staffInvitationError} from '@/lib/staff-invitation';
import {AuthBrand} from '../pilot/app-shell';

type Context={user:Session['user'];profile:{display_name:string;role:string};stores:AppStore[]};
const roleChoices:AppRole[]=['STAFF','SUPERVISOR','LOGISTICS','OWNER'];
const descriptions:Record<AppRole,string>={STAFF:'盤點、收貨、效期與交接，走過一天的現場工作。',SUPERVISOR:'查看共同進度、處理異常，管理門市成員。',LOGISTICS:'核對營運資料、報表與商品，掌握負責門市。',OWNER:'從營運總覽到商家設定，查看人員與權限。'};

export default function DemoExperience(){
  const [businessType,setBusinessType]=useState('SINGLE_RESTAURANT');
  const [role,setRole]=useState<AppRole>('STAFF');
  const [admin,setAdmin]=useState(false);
  const [context,setContext]=useState<Context>();
  const [storeId,setStoreId]=useState('');
  const [revision,setRevision]=useState(0);
  const [choosing,setChoosing]=useState(true);
  const [invite,setInvite]=useState<{token:string;status:string;displayName?:string;storeName?:string}>();
  const [pin,setPin]=useState('');const [pinConfirm,setPinConfirm]=useState('');const[inviteError,setInviteError]=useState('');const[activating,setActivating]=useState(false);
  useEffect(()=>{const token=readStaffInvitation(window.location.hash);if(token)void inspectDemoInvitation(token).then(value=>setInvite({token,...value}));},[]);
  async function activate(){if(!invite||activating)return;if(!/^\d{6}$/.test(pin)||pin!==pinConfirm){setInviteError('請輸入一致的六位數 PIN。');return;}setActivating(true);try{const next=await activateDemoInvitation(invite.token,pin) as Context&{selectedStore:string};setContext(next);setStoreId(next.selectedStore);setBusinessType(next.stores[0].business_type);setRole(next.stores[0].role);setChoosing(false);setInvite(undefined);setPin('');setPinConfirm('');window.history.replaceState(null,'',window.location.pathname);}catch(e){setInviteError(staffInvitationError(e instanceof Error?e.message:''));}finally{setActivating(false);}}
  const beforeLeave=useRef<(()=>Promise<boolean>)|null>(null);
  async function choose(){if(beforeLeave.current&&!await beforeLeave.current())return;setChoosing(true);}
  function enter(){const next=configureDemo(role,businessType,admin) as Context;setContext(next);setStoreId(next.stores[0].id);setRevision(v=>v+1);setChoosing(false);}
  async function refresh(){const next=demoContext() as Context;setContext(next);setStoreId(current=>next.stores.some(s=>s.id===current)?current:next.stores[0]?.id||'');}
  const guide=<details className="demo-guide"><summary>這個身分可以怎麼體驗？</summary><p>{descriptions[role]}</p><p>{role==='STAFF'?'先完成冷藏區盤點，再到效期提醒將鮮奶標記為已使用完；切換主管後可查看同一門市的更新。':role==='SUPERVISOR'?'從今日營運重點查看異常，到「我的 → 員工與權限」試改範例成員資料。':role==='LOGISTICS'?'從報表中心查看進貨明細；獨立餐廳可維護商品與供應商，連鎖餐飲可比較門市進度。':'從「我的 → 員工與權限」編輯範例成員，可增加報表、匯出或商家管理權限。'}</p><p>收貨使用預設辨識結果；檔案匯入、邀請啟用、借貸與分區使用隔離資料。掃描 PDF 辨識、真實寄信、裝置授權與管理責任交接須登入後操作。</p></details>;
  return <div className="demo-experience">
    <header className="demo-bar"><span><FlaskConical size={17}/> 免登入體驗 <b>示範資料</b></span><nav>{context&&!choosing&&<button onClick={()=>void choose()}><Users size={16}/>切換身分</button>}<a href="/">前往登入 <ArrowRight size={15}/></a></nav></header>
    {invite?<main className="demo-picker"><AuthBrand/><h1>首次設定 PIN</h1>{invite.status==='VALID'?<form onSubmit={e=>{e.preventDefault();void activate();}}><p>{invite.displayName}・{invite.storeName}</p><label className="field">6 位 PIN<input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,''))}/></label><label className="field">再次輸入 PIN<input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pinConfirm} onChange={e=>setPinConfirm(e.target.value.replace(/\D/g,''))}/></label><button className="shell-primary full" disabled={activating}>設定 PIN 並登入</button></form>:<p role="alert">{staffInvitationError(invite.status)}</p>}{inviteError&&<p role="alert">{inviteError}</p>}<button className="text-button" onClick={()=>{setInvite(undefined);window.history.replaceState(null,'',window.location.pathname);}}>返回體驗入口</button></main>:choosing?<main className="demo-picker"><AuthBrand/><p className="demo-eyebrow">先看看，序如何陪你工作</p><h1>選一個身分，<br/>從今天的工作開始。</h1><p className="demo-intro">不需帳號、門市代號或 PIN。<br/>使用範例門市，直接體驗正式版的操作畫面。</p>
      <fieldset className="demo-business"><legend>餐廳類型</legend>{[['SINGLE_RESTAURANT','獨立餐廳'],['CHAIN_RESTAURANT','連鎖餐飲']].map(([value,label])=><button type="button" key={value} aria-pressed={businessType===value} onClick={()=>setBusinessType(value)}>{label}</button>)}</fieldset>
      <fieldset className="demo-roles"><legend>這次想以誰的角度看看？</legend>{roleChoices.map(value=><button type="button" key={value} aria-pressed={role===value} onClick={()=>{setRole(value);setAdmin(false);}}><span className={`demo-avatar demo-avatar-${value.toLowerCase()}`}>{roleLabel(value,businessType).slice(0,1)}</span><span><strong>{roleLabel(value,businessType)}</strong><small>{descriptions[value]}</small></span><i aria-hidden="true">{role===value?'●':'○'}</i></button>)}</fieldset>
      {role!=='STAFF'&&role!=='OWNER'&&<label className="demo-admin"><input type="checkbox" checked={admin} onChange={e=>setAdmin(e.target.checked)}/><span>同時具有商家管理權限<small>查看同一工作身分在增加權限後的功能。</small></span></label>}
      <button className="demo-enter" onClick={enter}>{context?'切換並進入':'開始體驗'} <ArrowRight size={18}/></button>
      {context&&<button className="demo-cancel" onClick={()=>{setChoosing(false);setBusinessType(context.stores[0].business_type);setRole(context.stores[0].role);setAdmin(!!context.stores[0].can_manage_business);}}>返回目前身分首頁</button>}
      <p className="demo-footnote">示範變更只存在此瀏覽器，保留七天；可隨時重設範例。<br/>切換身分時，共用同一組範例門市資料。</p>
    </main>:context&&<>
      <section className="demo-context" aria-label="目前體驗身分"><span>{businessType==='CHAIN_RESTAURANT'?'連鎖餐飲':'獨立餐廳'} · <strong>{roleLabel(role,businessType)}</strong>{admin&&role!=='OWNER'?' · 商家管理權限':''}</span><button onClick={async()=>{if(beforeLeave.current&&!await beforeLeave.current())return;clearDemoDrafts();await resetDemo();enter();}} title="重設本次所有示範操作"><RotateCcw size={14}/>重設範例</button></section>
      <AuthenticatedWorkspace key={`${businessType}:${role}:${revision}`} demo registerLeave={handler=>{beforeLeave.current=handler;}} session={{user:context.user}} profile={context.profile} stores={context.stores} selectedStoreId={storeId} versionPanel={guide}
        onStoreChange={async id=>{selectDemoStore(id);setStoreId(id);await refresh();}} onChanged={refresh} onSignOut={async()=>{window.location.assign('/');}}/>
    </>}
  </div>;
}
