"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Bell,
  ClipboardList,
  Home,
  ListChecks,
  UserRound,
} from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import { displayTime } from "./inventory-catalog";
import DaisyLogo from "./daisy-logo";

export type ShellRole = "STAFF" | "SUPERVISOR" | "LOGISTICS" | "OWNER";
export type ShellView = "home" | "count" | "manual" | "settings" | "activity" | "tasks" | "notifications";

const roleMeta: Record<ShellRole, { label: string; tone: string; homeTitle: string; homeCopy: string }> = {
  STAFF: { label: "員工", tone: "green", homeTitle: "歡迎回來", homeCopy: "先完成今天的工作" },
  SUPERVISOR: { label: "店長／主管", tone: "orange", homeTitle: "今日營運重點", homeCopy: "處理門市事項，確認營運順暢" },
  LOGISTICS: { label: "後勤／管理", tone: "blue", homeTitle: "後勤工作台", homeCopy: "核對資料，掌握營運成果" },
  OWNER: { label: "Owner／管理者", tone: "purple", homeTitle: "營運總覽", homeCopy: "管理商家，掌握全局" },
};

function navIcon(name: string) {
  const props = { className: "ui-icon", strokeWidth: 2 };
  if (name === "activity") return <ClipboardList {...props} />;
  if (name === "tasks") return <ListChecks {...props} />;
  if (name === "notifications") return <Bell {...props} />;
  if (name === "profile") return <UserRound {...props} />;
  return <Home {...props} />;
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="formal-auth-stage">
      <div className="shell-preview-role role-green">
        <div className="phone-app auth-phone">{children}</div>
      </div>
    </main>
  );
}

export function AuthBrand() {
  return (
    <div className="brand-lockup">
      <span className="brand-glyph"><DaisyLogo title="序" /></span>
      <span><strong>序</strong><small>讓餐廳，自然有序。</small></span>
    </div>
  );
}

export function AuthTopbar() {
  return (
    <header className="admin-login-topbar">
      <span className="topbar-daisy"><DaisyLogo title="序" /></span>
      <strong>序</strong>
    </header>
  );
}

export function FormalAppShell({
  role,
  storeName,
  stores,
  storeId,
  onStoreChange,
  view,
  onNavigate,
  children,
}: {
  role: ShellRole;
  storeName: string;
  stores: { id: string; name: string }[];
  storeId: string;
  onStoreChange: (storeId: string) => void;
  view: ShellView;
  onNavigate: (view: ShellView) => void;
  children: ReactNode;
}) {
  const meta = roleMeta[role];
  return (
    <main className="formal-app-stage">
      <div className={`shell-preview-role role-${meta.tone}`}>
        <div className="phone-app" data-shell-role={role}>
          <header className="shell-topbar">
            {stores.length > 1 ? <label className="shell-store shell-store-picker"><select aria-label="目前門市" value={storeId} onChange={event => onStoreChange(event.target.value)}>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select><b aria-hidden="true">⌄</b></label> : <span className="shell-store">{storeName}</span>}
            <span className="shell-brand"><DaisyLogo title="序" /><b>序</b></span>
            <div className="shell-top-actions">
              <button type="button" aria-label="我的" onClick={()=>onNavigate("settings")}><UserRound className="ui-icon" /></button>
            </div>
          </header>
          <div className="role-ribbon"><span>{meta.label}</span><small>{storeName}</small></div>
          <div className="shell-content">{children}</div>
          <nav className="shell-bottom-nav" aria-label="主要導覽">
            {[
              ["home", "首頁"],
              ["activity", "作業紀錄"],
              ["tasks", "待辦"],
              ["notifications", "通知"],
              ["profile", "我的"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={(id === "home" && view === "home") || (id === "profile" && view === "settings") ? "active" : ""}
                aria-current={(id === "home" && view === "home") || (id === "profile" && view === "settings") ? "page" : undefined}

                onClick={() => {
                  if (id === "home") onNavigate("home");
                  if (id === "profile") onNavigate("settings");
                  if (id === "activity" || id === "tasks" || id === "notifications") onNavigate(id);
                }}
              >
                {navIcon(id)}<span>{label}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>
    </main>
  );
}

export function FormalHome({role,storeId,businessType,onImport,onCount,onManagement,versionPanel}:{role:ShellRole;storeId:string;businessType:string;onImport:()=>void;onCount:(start?:boolean)=>void;onManagement:()=>void;versionPanel:ReactNode}) {
 const meta=roleMeta[role];const [state,setState]=useState<{status:string;items:number;completed:string|null;pending:number;zones:number;total:number}>({status:"loading",items:0,completed:null,pending:0,zones:0,total:0});
 useEffect(()=>{let active=true;async function refresh(){
  if(businessType==='CHAIN_RESTAURANT'&&['STAFF','SUPERVISOR'].includes(role)) await supabase.rpc('ensure_pilot_daily_count',{p_store_id:storeId});
  const [sessions,zones]=await Promise.all([supabase.from('inventory_count_sessions').select('id,status,completed_at,paper_required,paper_completed_at,paper_reviewed_at,snapshot').eq('store_id',storeId).order('started_at',{ascending:false}),supabase.from('count_zones').select('id,zone_products(product_id)').eq('store_id',storeId).eq('is_active',true)]);
  if(!active)return; const latest=sessions.data?.[0];const itemCount=zones.data?.reduce((n,z)=>n+z.zone_products.length,0)||0;const scope=(latest?.snapshot as {zones?:{zone_id:string}[]}|null)?.zones;const counting=latest&&['DRAFT','IN_PROGRESS'].includes(latest.status);
  setState({status:sessions.error||zones.error?'error':latest?.status||'empty',items:counting&&scope?scope.length:itemCount,completed:latest?.completed_at||null,pending:sessions.data?.filter(s=>s.status==='REVIEWING'||(s.paper_required&&!s.paper_reviewed_at)).length||0,zones:counting&&scope?new Set(scope.map(r=>r.zone_id)).size:zones.data?.filter(z=>z.zone_products.length).length||0,total:sessions.data?.filter(s=>['CLOSED','REVIEWING'].includes(s.status)).length||0});
 } void refresh();const timer=setInterval(()=>void refresh(),20000);window.addEventListener('focus',refresh);return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',refresh);};},[storeId,businessType,role]);
 const doing=['DRAFT','IN_PROGRESS'].includes(state.status);const done=['CLOSED','REVIEWING'].includes(state.status);const field=role==='STAFF'||role==='SUPERVISOR';
 const label=doing?'繼續盤點':done?'查看盤點結果':state.items?'開始盤點':'盤點';
 return <><div className="role-home-title"><div><span>{new Date().toLocaleDateString('zh-TW')}</span><h1>{meta.homeTitle}</h1><p>{meta.homeCopy}</p></div></div>
 <section className="shell-section"><div className="shell-section-head"><h2>{role==='STAFF'?'今天先看':role==='SUPERVISOR'?'今日重點':'今日待核對'}</h2></div><div className="shell-card shell-list"><button className="shell-list-row" disabled={state.status==='loading'||state.status==='error'} onClick={()=>onCount(!doing&&!done&&role!=='STAFF'&&state.items>0)}><span><strong>{state.status==='loading'?'正在讀取盤點':state.status==='error'?'盤點資料暫時無法讀取':done?'盤點完成':doing?'本店盤點進行中':state.items?'尚未開始盤點':'尚無盤點品項'}</strong><small>{state.completed?displayTime(state.completed):`${state.zones} 個區域・${state.items} 項`}</small></span><b>›</b></button></div></section>
 {field?<section className="shell-section"><div className="shell-section-head"><h2>每日作業</h2></div><div className="shell-tile-grid"><button className="shell-icon-tile" disabled={state.status==='loading'||state.status==='error'} onClick={()=>onCount(!doing&&!done&&role==='SUPERVISOR'&&state.items>0)}><span><ClipboardList className="ui-icon"/></span><strong>{label}</strong></button></div></section>:<section className="shell-section"><div className="shell-section-head"><h2>營運成果</h2></div><div className="shell-metric-grid"><div><span>已保存盤點</span><strong>{state.total} 次</strong></div><div><span>待確認</span><strong>{state.pending} 次</strong></div></div><button className="shell-secondary full" onClick={()=>onCount()}>查看盤點完整資料</button></section>}
 {role!=='STAFF'&&<section className="shell-section"><div className="shell-section-head"><h2>{role==='SUPERVISOR'?'需要處理':role==='OWNER'?'管理設定':'管理功能'}</h2></div>{state.pending>0&&<button className="shell-secondary full" onClick={()=>onCount()}>待確認盤點（{state.pending}）</button>}{state.items===0&&role==='SUPERVISOR'&&<button className="shell-secondary full" onClick={onImport}>匯入品項檔案</button>}<button className="text-button" onClick={onManagement}>盤點設定與資料 ›</button></section>}
 {versionPanel}</>;
}

export function WorkspaceBack({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return <><button className="shell-back" type="button" onClick={onBack}>‹ <span>返回首頁</span></button>{children}</>;
}
