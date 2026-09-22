'use client';
import {useEffect,useMemo,useState} from 'react';
import {ChevronRight,Plus,Store as StoreIcon,Trash2,Users} from 'lucide-react';
import {supabase} from '@/lib/supabase-browser';
import type {AppRole,AppStore} from '@/lib/app-workspace';

type PartnerStore={
  id:string;name:string;store_code:string;role:AppRole;login_identifier:string;
  can_manage_business:boolean;uses_pin:boolean;extra_permissions?:string[];
};
type Partner={
  user_id:string;display_name:string;company_title:string|null;role:AppRole|'ADMIN';
  is_owner:boolean;can_manage_business:boolean;company_member:boolean;email:string|null;stores:PartnerStore[];
};
type CompanyTitle='營運'|'行政'|'財務';
type Permission='DATA_EXPORT';

const companyOrder:Record<string,number>={老闆:1,營運:2,行政:3,財務:4};
const permissionLabels:Record<Permission,string>={
  DATA_EXPORT:'資料匯出',
};
const titleCopy:Record<CompanyTitle,string>={
  營運:'管理兩店營運、門市夥伴與現場作業。',
  行政:'整理進貨、調撥、廢棄、配方、合約與抽盤資料。',
  財務:'查看已確認金額、成本與報表；不修改現場資料。',
};

function titleOf(p:Partner){
  if(p.is_owner)return '老闆';
  return p.company_title|| (p.role==='LOGISTICS'?'行政':p.role==='SUPERVISOR'?'主管':'員工');
}
function avatar(name:string){return name.trim().slice(0,1)||'夥';}

export default function PartnersStoresWorkspace({
  anchorStore,stores,onBack,onOpenPartners,onOpenStore,
}:{anchorStore:AppStore;stores:AppStore[];onBack:()=>void;onOpenPartners:(storeId:string,startNew?:boolean)=>void;onOpenStore:(storeId:string)=>void}){
  const[partners,setPartners]=useState<Partner[]>([]);
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState('');
  const[tab,setTab]=useState<'company'|'stores'>('company');
  const[page,setPage]=useState<'home'|'edit'|'add'>('home');
  const[selected,setSelected]=useState<Partner>();
  const[name,setName]=useState('');
  const[title,setTitle]=useState<CompanyTitle>('營運');
  const[selectedStores,setSelectedStores]=useState<string[]>([]);
  const[permissions,setPermissions]=useState<Permission[]>([]);
  const[saving,setSaving]=useState(false);
  const[confirmRemove,setConfirmRemove]=useState(false);
  const[notice,setNotice]=useState('');

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

  const company=useMemo(
    ()=>partners.filter(p=>p.company_member).sort((a,b)=>(companyOrder[titleOf(a)]||9)-(companyOrder[titleOf(b)]||9)||a.display_name.localeCompare(b.display_name,'zh-TW')),
    [partners]
  );

  function openEdit(p:Partner){
    setSelected(p);setName(p.display_name);
    setTitle((p.company_title==='行政'||p.company_title==='財務'||p.company_title==='營運')?p.company_title:'營運');
    setSelectedStores(p.stores.map(s=>s.id));
    const extra=new Set<Permission>();
    for(const s of p.stores)for(const value of s.extra_permissions||[])if(value==='DATA_EXPORT')extra.add(value);
    setPermissions([...extra]);setConfirmRemove(false);setNotice('');setPage('edit');
  }

  function toggleStore(id:string){setSelectedStores(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id]);}
  function togglePermission(value:Permission){setPermissions(v=>v.includes(value)?v.filter(x=>x!==value):[...v,value]);}

  async function save(){
    if(!selected||selected.is_owner)return;
    setSaving(true);setError('');
    const{error}=await supabase.rpc('save_baihuayuan_company_partner',{
      p_store_id:anchorStore.id,p_user_id:selected.user_id,p_display_name:name.trim(),
      p_company_title:title,p_store_ids:selectedStores,p_permissions:permissions
    });
    if(error){setError('公司職稱或權限儲存失敗，請稍後重試。');setSaving(false);return;}
    setSaving(false);setNotice('夥伴資料已更新。');setPage('home');await load();
  }

  async function removePartner(){
    if(!selected||selected.is_owner)return;
    setSaving(true);setError('');
    const{error}=await supabase.rpc('remove_baihuayuan_partner',{p_store_id:anchorStore.id,p_user_id:selected.user_id});
    if(error){
      setError(error.message.includes('PARTNER_HAS_HISTORY')?'此夥伴已有營運歷史紀錄，為保留經手紀錄不能完全刪除；可改為停用門市權限。':'移除成員失敗，請稍後重試。');
      setSaving(false);setConfirmRemove(false);return;
    }
    setSaving(false);setConfirmRemove(false);setSelected(undefined);setPage('home');setNotice('成員已自百花猿名單完全移除。');await load();
  }

  if(page==='edit'&&selected)return <section className="partners-stores-workspace">
    <button className="shell-back" type="button" onClick={()=>{setPage('home');setSelected(undefined);setConfirmRemove(false);}}>‹ <span>返回夥伴與門市</span></button>
    <div className="workspace-heading"><h1>編輯成員</h1></div>
    {error&&<p className="pilot-message" role="alert">{error}</p>}
    <section className="shell-card partner-edit-card">
      <div className="partner-edit-person"><span className="partner-avatar">{avatar(selected.display_name)}</span><strong>{selected.display_name}</strong>{selected.is_owner&&<em>老闆</em>}</div>
      <label>姓名<input value={name} disabled={selected.is_owner||saving} onChange={e=>setName(e.target.value)} /></label>
      {selected.email&&<label>聯絡 Email<input value={selected.email} disabled /></label>}
      <label>公司職稱<select value={selected.is_owner?'營運':title} disabled={selected.is_owner||saving} onChange={e=>setTitle(e.target.value as CompanyTitle)}>
        {selected.is_owner&&<option value="營運">老闆（固定）</option>}
        {!selected.is_owner&&<><option value="營運">營運</option><option value="行政">行政</option><option value="財務">財務</option></>}
      </select></label>
      {selected.is_owner?<p className="shell-note">老闆：全部門市、全部公司管理權限。</p>:<p className="shell-note">{titleCopy[title]}</p>}
      <fieldset><legend>負責門市</legend>
        {activeStores.map(s=><label className="checkbox-row" key={s.id}><input type="checkbox" checked={selected.is_owner||selectedStores.includes(s.id)} disabled={selected.is_owner||saving} onChange={()=>toggleStore(s.id)}/>{s.name}（{s.store_code}）</label>)}
      </fieldset>
      {!selected.is_owner&&<details className="setup-panel"><summary>進階權限</summary><fieldset><legend>額外權限</legend>{(Object.keys(permissionLabels) as Permission[]).map(key=><label className="checkbox-row" key={key}><input type="checkbox" checked={permissions.includes(key)} disabled={saving} onChange={()=>togglePermission(key)}/>{permissionLabels[key]}</label>)}<p className="shell-note">營運／行政預設可管理人員與門市；財務預設只查看已確認資料。這裡只處理少量例外權限。</p></fieldset></details>}
    </section>
    {!selected.is_owner&&<><div className="shell-button-stack"><button type="button" className="shell-secondary" disabled={saving} onClick={()=>setPage('home')}>取消</button><button type="button" className="shell-primary" disabled={saving||!name.trim()||selectedStores.length===0} onClick={()=>void save()}>{saving?'儲存中…':'儲存'}</button></div>
      <button type="button" className="partner-remove-button" disabled={saving} onClick={()=>setConfirmRemove(true)}><Trash2/>完全移除成員</button></>}
    {confirmRemove&&<div className="partner-remove-backdrop" role="presentation"><section className="partner-remove-dialog" role="dialog" aria-modal="true" aria-labelledby="remove-partner-title"><Trash2/><h2 id="remove-partner-title">完全移除成員</h2><p>確定要從百花猿完全移除「{selected.display_name}」嗎？移除後會解除所有門市關聯；若已有營運歷史，系統會阻止刪除以保留紀錄。</p><div><button type="button" className="shell-secondary" disabled={saving} onClick={()=>setConfirmRemove(false)}>取消</button><button type="button" className="shell-primary danger" disabled={saving} onClick={()=>void removePartner()}>{saving?'處理中…':'確認移除'}</button></div></section></div>}
  </section>;

  if(page==='add')return <section className="partners-stores-workspace">
    <button className="shell-back" type="button" onClick={()=>setPage('home')}>‹ <span>返回夥伴與門市</span></button>
    <div className="workspace-heading"><h1>新增成員</h1><p>依工作位置選擇新增方式，避免同一人重複建立帳號。</p></div>
    <div className="partner-add-choice">
      <button type="button" className="shell-card" onClick={()=>onOpenPartners(anchorStore.id,true)}><Users/><span><strong>新增公司管理層</strong><small>營運、行政、財務；使用 Email／Google 管理帳號</small></span><ChevronRight/></button>
      {activeStores.map(s=><button type="button" className="shell-card" key={s.id} onClick={()=>onOpenPartners(s.id,true)}><StoreIcon/><span><strong>新增 {s.name} 門市夥伴</strong><small>主管、員工；使用門市代號＋PIN</small></span><ChevronRight/></button>)}
    </div>
  </section>;

  return <section className="partners-stores-workspace">
    <button className="shell-back" type="button" onClick={onBack}>‹ <span>返回設定</span></button>
    <div className="partner-workspace-title"><div><h1>夥伴與門市</h1><p>管理公司成員、各門市夥伴與權限。</p></div><button type="button" className="partner-add-top" onClick={()=>setPage('add')}><Plus/>新增成員</button></div>
    {notice&&<p className="count-notice" role="status">{notice}</p>}
    {error&&<p className="pilot-message" role="alert">{error}<button className="text-button" onClick={()=>void load()}>重新讀取</button></p>}
    <div className="partner-section-tabs" role="tablist"><button type="button" className={tab==='company'?'active':''} onClick={()=>setTab('company')}>公司管理層</button><button type="button" className={tab==='stores'?'active':''} onClick={()=>setTab('stores')}>門市夥伴</button></div>
    {loading?<p role="status">正在讀取夥伴與門市…</p>:tab==='company'?<section className="shell-section">
      <div className="shell-section-head"><div><h2>公司管理層（{company.length}）</h2><small>老闆優先顯示；營運、行政可依授權管理人員與門市。</small></div></div>
      <div className="shell-card partner-company-list">
        {company.map(p=><button type="button" className="partner-company-row" key={p.user_id} onClick={()=>openEdit(p)}>
          <span className={p.is_owner?'partner-avatar owner':'partner-avatar'}>{avatar(p.display_name)}</span>
          <span><strong>{p.display_name}<em>{titleOf(p)}</em></strong><small>{p.is_owner?'全部門市':p.stores.map(s=>s.name).join('・')||'尚未分配門市'}</small></span><ChevronRight/>
        </button>)}
        {!company.length&&<p className="shell-note">目前尚未設定公司管理層。</p>}
      </div>
    </section>:<section className="shell-section">
      <div className="shell-section-head"><div><h2>各門市夥伴</h2><small>各店主管與員工在所屬門市管理。</small></div></div>
      <div className="partner-store-stack">
        {activeStores.map(s=>{
          const rows=partners.filter(p=>!p.company_member&&p.stores.some(ps=>ps.id===s.id));
          const supervisors=rows.filter(p=>p.stores.some(ps=>ps.id===s.id&&ps.role==='SUPERVISOR')).length;
          const staff=Math.max(0,rows.length-supervisors);
          return <article className="shell-card partner-store-card" key={s.id}>
            <button type="button" className="partner-store-main" onClick={()=>onOpenPartners(s.id)}>
              <span className="partner-store-icon"><StoreIcon/></span><span><strong>{s.name}</strong><small>門市代號 {s.store_code}</small><em>主管 {supervisors} 人・員工 {staff} 人</em></span><span className="partner-store-status">營業中</span><ChevronRight/>
            </button>
            <div className="partner-store-actions"><button type="button" className="text-button" onClick={()=>onOpenPartners(s.id)}>管理夥伴</button><button type="button" className="text-button" onClick={()=>onOpenStore(s.id)}>門市設定</button></div>
          </article>;
        })}
      </div>
    </section>}
  </section>;
}
