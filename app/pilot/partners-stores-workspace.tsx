'use client';
import {useEffect,useMemo,useState} from 'react';
import {Users,Store as StoreIcon,Plus,Settings2} from 'lucide-react';
import {supabase} from '@/lib/supabase-browser';
import type {AppRole,AppStore} from '@/lib/app-workspace';

type PartnerStore={id:string;name:string;store_code:string;role:AppRole;login_identifier:string;can_manage_business:boolean;uses_pin:boolean};
type Partner={user_id:string;display_name:string;role:AppRole|'ADMIN';is_owner:boolean;can_manage_business:boolean;email:string|null;stores:PartnerStore[]};

function partnerLabel(p:Partner){
  if(p.is_owner)return '老闆';
  if(p.role==='LOGISTICS')return '行政／後勤';
  if(p.role==='SUPERVISOR'&&p.can_manage_business)return '營運';
  if(p.role==='SUPERVISOR')return '主管';
  if(p.role==='STAFF')return '員工';
  return '管理';
}
function avatar(name:string){return name.trim().slice(0,1)||'夥';}

export default function PartnersStoresWorkspace({
  anchorStore,
  stores,
  onBack,
  onOpenPartners,
  onOpenStore,
}:{anchorStore:AppStore;stores:AppStore[];onBack:()=>void;onOpenPartners:(storeId:string)=>void;onOpenStore:(storeId:string)=>void}){
  const[partners,setPartners]=useState<Partner[]>([]);
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState('');
  const activeStores=useMemo(()=>stores.filter(s=>s.is_active!==false&&['BeApe','Gras'].includes(s.name)),[stores]);

  async function load(){
    setLoading(true);setError('');
    const{data,error}=await supabase.rpc('get_baihuayuan_partners',{p_store_id:anchorStore.id});
    if(error){setError('夥伴與門市資料載入失敗，請重新整理。');setLoading(false);return;}
    const rows=(data as unknown as {partners?:Partner[]})?.partners;
    setPartners(Array.isArray(rows)?rows:[]);
    setLoading(false);
  }
  useEffect(()=>{void load();},[anchorStore.id]);

  const shared=partners.filter(p=>p.is_owner||p.can_manage_business||p.role==='LOGISTICS'||p.stores.length>1);

  return <section className="partners-stores-workspace">
    <button className="shell-back" type="button" onClick={onBack}>‹ <span>返回設定</span></button>
    <div className="workspace-heading"><h1>夥伴與門市</h1><p>門市設定與夥伴權限放在一起，需要調整時直接找到那家店。</p></div>
    {error&&<p className="pilot-message" role="alert">{error}<button className="text-button" onClick={()=>void load()}>重新讀取</button></p>}
    {loading?<p role="status">正在讀取夥伴與門市…</p>:<>
      <section className="shell-section">
        <div className="shell-section-head"><div><h2>共享夥伴</h2><small>可同時參與 BeApe、Gras 的營運與管理</small></div></div>
        <div className="shell-card partner-shared-card">
          {shared.map(p=><article className="partner-shared-row" key={p.user_id}>
            <span className="partner-avatar">{avatar(p.display_name)}</span>
            <span><strong>{p.display_name}<em>{partnerLabel(p)}</em></strong><small>{p.is_owner?'可管理全部門市':p.role==='LOGISTICS'?'行政支援・可跨店作業':p.can_manage_business?'營運管理・可跨店支援':p.stores.map(s=>s.name).join('・')}</small></span>
            <b>{p.stores.length>1||p.is_owner?'共用兩店':'›'}</b>
          </article>)}
          {!shared.length&&<p className="shell-note">目前尚無跨店夥伴。</p>}
        </div>
      </section>

      <section className="shell-section">
        <div className="shell-section-head"><div><h2>各門市設定與夥伴</h2><small>選門市就能一起調整基本資料與人員權限</small></div></div>
        <div className="partner-store-stack">
          {activeStores.map(s=>{
            const storePartners=partners.filter(p=>p.stores.some(ps=>ps.id===s.id));
            return <article className="shell-card partner-store-card" key={s.id}>
              <header><span className="partner-store-icon"><StoreIcon/></span><div><strong>{s.name}</strong><small>門市代號：{s.store_code}</small></div><span className="partner-store-status">營業中</span></header>
              <div className="partner-store-people-head"><strong>夥伴成員（{storePartners.length}）</strong><button type="button" className="text-button" onClick={()=>onOpenPartners(s.id)}>管理夥伴 ›</button></div>
              <div className="partner-store-people">
                {storePartners.slice(0,5).map(p=><span key={p.user_id}><i>{avatar(p.display_name)}</i><small>{p.display_name}</small><em>{partnerLabel(p)}</em></span>)}
                <button type="button" className="partner-add-person" aria-label={`新增 ${s.name} 夥伴`} onClick={()=>onOpenPartners(s.id)}><Plus/><small>新增</small></button>
              </div>
              <button type="button" className="partner-store-settings" onClick={()=>onOpenStore(s.id)}><Settings2/><span><strong>門市設定</strong><small>基本資料、門市代號、作業設定</small></span><b>›</b></button>
            </article>;
          })}
        </div>
      </section>
    </>}
  </section>;
}
