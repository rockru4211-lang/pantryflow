'use client';
/* eslint-disable @next/next/no-html-link-for-pages -- Full navigation resets the isolated demo transport before real sign-in. */
import {useRef,useState} from 'react';
import {ArrowRight,RotateCcw,Users,FlaskConical} from 'lucide-react';
import {configureDemo,demoContext,resetDemo,selectDemoStore} from '@/lib/demo-client.mjs';
import {roleLabel,type AppRole,type AppStore} from '@/lib/app-workspace';
import type {Session} from '@supabase/supabase-js';
import {clearDemoDrafts} from '@/lib/workspace-storage';
import AuthenticatedWorkspace from '../pilot/authenticated-workspace';
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
  const beforeLeave=useRef<(()=>Promise<boolean>)|null>(null);
  async function choose(){if(beforeLeave.current&&!await beforeLeave.current())return;setChoosing(true);}
  function enter(){const next=configureDemo(role,businessType,admin) as Context;setContext(next);setStoreId(next.stores[0].id);setRevision(v=>v+1);setChoosing(false);}
  async function refresh(){setContext(demoContext() as Context);}
  const guide=<details className="demo-guide"><summary>這個身分可以怎麼體驗？</summary><p>{descriptions[role]}</p><p>{role==='STAFF'?'先完成冷藏區盤點，再到效期提醒將鮮奶標記為已使用完；切換主管後可查看同一門市的更新。':role==='SUPERVISOR'?'從今日營運重點查看異常，到「我的 → 員工與權限」試改範例成員資料。':role==='LOGISTICS'?'從報表中心查看進貨明細；獨立餐廳可維護商品與供應商，連鎖餐飲可比較門市進度。':'從「我的 → 員工與權限」編輯範例成員，可增加報表、匯出或商家管理權限。'}</p><p>收貨使用預設辨識結果；照片上傳、Excel 匯入、寄信、PIN、裝置授權與管理責任交接不在此次示範範圍。</p></details>;
  return <div className="demo-experience">
    <header className="demo-bar"><span><FlaskConical size={17}/> 免登入體驗 <b>示範資料</b></span><nav>{context&&!choosing&&<button onClick={()=>void choose()}><Users size={16}/>切換身分</button>}<a href="/">前往登入 <ArrowRight size={15}/></a></nav></header>
    {choosing?<main className="demo-picker"><AuthBrand/><p className="demo-eyebrow">先看看，序如何陪你工作</p><h1>選一個身分，<br/>從今天的工作開始。</h1><p className="demo-intro">不需帳號、門市代號或 PIN。<br/>使用範例門市，直接體驗正式版的操作畫面。</p>
      <fieldset className="demo-business"><legend>餐廳類型</legend>{[['SINGLE_RESTAURANT','獨立餐廳'],['CHAIN_RESTAURANT','連鎖餐飲']].map(([value,label])=><button type="button" key={value} aria-pressed={businessType===value} onClick={()=>setBusinessType(value)}>{label}</button>)}</fieldset>
      <fieldset className="demo-roles"><legend>這次想以誰的角度看看？</legend>{roleChoices.map(value=><button type="button" key={value} aria-pressed={role===value} onClick={()=>{setRole(value);setAdmin(false);}}><span className={`demo-avatar demo-avatar-${value.toLowerCase()}`}>{roleLabel(value,businessType).slice(0,1)}</span><span><strong>{roleLabel(value,businessType)}</strong><small>{descriptions[value]}</small></span><i aria-hidden="true">{role===value?'●':'○'}</i></button>)}</fieldset>
      {role!=='STAFF'&&role!=='OWNER'&&<label className="demo-admin"><input type="checkbox" checked={admin} onChange={e=>setAdmin(e.target.checked)}/><span>同時具有商家管理權限<small>查看同一工作身分在增加權限後的功能。</small></span></label>}
      <button className="demo-enter" onClick={enter}>{context?'切換並進入':'開始體驗'} <ArrowRight size={18}/></button>
      {context&&<button className="demo-cancel" onClick={()=>{setChoosing(false);setBusinessType(context.stores[0].business_type);setRole(context.stores[0].role);setAdmin(!!context.stores[0].can_manage_business);}}>返回目前身分首頁</button>}
      <p className="demo-footnote">所有變更只留在這次體驗，重新整理即可重來。<br/>切換身分時，共用同一組範例門市資料。</p>
    </main>:context&&<>
      <section className="demo-context" aria-label="目前體驗身分"><span>{businessType==='CHAIN_RESTAURANT'?'連鎖餐飲':'獨立餐廳'} · <strong>{roleLabel(role,businessType)}</strong>{admin&&role!=='OWNER'?' · 商家管理權限':''}</span><button onClick={async()=>{if(beforeLeave.current&&!await beforeLeave.current())return;clearDemoDrafts();resetDemo();enter();}} title="重設本次所有示範操作"><RotateCcw size={14}/>重設範例</button></section>
      <AuthenticatedWorkspace key={`${businessType}:${role}:${revision}`} demo registerLeave={handler=>{beforeLeave.current=handler;}} session={{user:context.user}} profile={context.profile} stores={context.stores} selectedStoreId={storeId} versionPanel={guide}
        onStoreChange={async id=>{selectDemoStore(id);setStoreId(id);}} onChanged={refresh} onSignOut={async()=>{window.location.assign('/');}}/>
    </>}
  </div>;
}
