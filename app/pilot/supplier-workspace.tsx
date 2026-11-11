'use client';
import MobileSupplierDirectory from './mobile-supplier-directory';
import {DirectoryAttachments,useAttachmentCounts} from './directory-attachments';
import SupplierIngredientHistory from './supplier-ingredient-history';
import {officeAccess,canData} from '@/lib/data-access';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ChevronDown,ChevronRight,Plus} from 'lucide-react';
import {supabase} from '@/lib/supabase-browser';
import {receiptRead,receiptReadError} from '@/lib/receipt-read';
import {safeSupplierLink,supplierMatches} from '@/lib/supplier-prices';
import {supplierPhones,supplierFields,supplierDraft,emptySupplier,supplierStatus,supplierPayload,supplierValidation,supplierFieldLimit,supplierExport,supplierImport,officeFields,type DirectorySupplier,type SupplierDraft,type DirectoryKey} from '@/lib/supplier-directory';
import type {AppStore} from '@/lib/app-workspace';
import {SUPPLIER_CATEGORIES} from '@/lib/supplier-categories';
import {useOperation} from './operation-hooks';
import './supplier-directory.css';
import './directory-lifecycle.css';
import {directoryState,lifecycleConfirmation,lifecycleLabels,type LifecycleOperation} from '@/lib/directory-lifecycle';
import {DirectoryLifecycleMenu} from './directory-lifecycle-menu';
import WorkspaceEditDialog from './workspace-edit-dialog';

const contactFields=['contact_name','phone','line_id','order_method','primary_supplies','order_url'] as const satisfies readonly DirectoryKey[];
const deliveryFields=supplierFields.filter(([key])=>!officeFields.has(key)&&!contactFields.some(field=>field===key));
const billingFields=supplierFields.filter(([key])=>officeFields.has(key)&&key!=='cooperation_note');
const profileSections=[
 {label:'訂貨與配送',keys:deliveryFields.map(([key])=>key).filter(key=>key!=='line_group')},
 {label:'帳務與合作',keys:supplierFields.map(([key])=>key).filter(key=>officeFields.has(key)&&key!=='billing_cycle'&&key!=='payment_terms')},
];

type Props={mobileMode?:boolean;store:AppStore;userId:string;onBack:()=>void;registerLeave?:(handler:(()=>Promise<boolean>)|null)=>void};
export default function SupplierWorkspace({mobileMode=false,store,userId,onBack,registerLeave}:Props){
 const attachmentCounts=useAttachmentCounts(store.id,'supplier',!mobileMode&&officeAccess(store));
 const attachments=(s:{id:string;is_removed?:boolean},expanded=false)=><DirectoryAttachments key={`${store.id}:${s.id}:${expanded}`} storeId={store.id} kind="supplier" targetId={s.id} count={attachmentCounts[s.id]||0} editable={editable&&!s.is_removed} saved={!!s.id} expanded={expanded} disabled={saving}/>;
 const office=['OWNER','LOGISTICS'].includes(store.role);
 const canEditSuppliers=canData(store,'SUPPLIERS',true);
 const[profiles,setProfiles]=useState<DirectorySupplier[]>([]),[editable,setEditable]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const[search,setSearch]=useState(''),[category,setCategory]=useState(''),[tab,setTab]=useState('使用中'),[selected,setSelected]=useState<string|null>(null);
 const[drafts,setDrafts]=useState<SupplierDraft[]|null>(null),[batch,setBatch]=useState(false),[saving,setSaving]=useState(false);
 const operation=useOperation(store.id,userId),flight=useRef<AbortController|null>(null),editing=useRef(false),saveLock=useRef(false),importInput=useRef<HTMLInputElement>(null),manageMenu=useRef<HTMLDetailsElement>(null);
 editing.current=!!drafts||saving;
 const refresh=useCallback(async(background=false)=>{
  if(background&&(editing.current||flight.current||document.visibilityState!=='visible'))return;
  flight.current?.abort();const controller=new AbortController();flight.current=controller;setLoading(true);
  try{const r=await receiptRead(signal=>supabase.rpc('app_workspace',{p_store_id:store.id,p_section:'suppliers',p_filter:{}}).abortSignal(signal),controller.signal);if(r.error)throw r.error;const data=r.data as unknown as {suppliers:DirectorySupplier[];editable:boolean};if(!Array.isArray(data?.suppliers))throw Error('INVALID_RESPONSE');if(!controller.signal.aborted){setProfiles(data.suppliers);setEditable(data.editable&&canEditSuppliers);setError('');}}
  catch(e){if(!controller.signal.aborted){setError(receiptReadError(e));setEditable(false);}}
  finally{if(flight.current===controller){flight.current=null;setLoading(false);}}
 },[store.id,canEditSuppliers]);
 useEffect(()=>{void refresh();const run=()=>void refresh(true);window.addEventListener('focus',run);window.addEventListener('online',run);const timer=setInterval(run,60000);const active=flight;return()=>{active.current?.abort();clearInterval(timer);window.removeEventListener('focus',run);window.removeEventListener('online',run);};},[refresh]);
 useEffect(()=>{registerLeave?.(async()=>!saveLock.current&&(!editing.current||window.confirm('供應商資料尚未儲存，確定離開？')));const warn=(e:BeforeUnloadEvent)=>{if(editing.current){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>{registerLeave?.(null);window.removeEventListener('beforeunload',warn);};},[registerLeave]);
 const visible=profiles.filter(s=>(office||s.is_active)&&directoryState(s)===tab&&(!category||s.supplier_category===category)&&[s.name,s.primary_supplies,s.contact_name,s.phone,s.line_id,s.line_group,...(s.aliases||[])].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
 const detailDraft=drafts?.find(s=>s.clientKey===selected),detail=profiles.find(s=>s.id===selected);
 const change=(key:string,field:keyof SupplierDraft,value:string|boolean)=>setDrafts(rows=>rows?.map(s=>s.clientKey===key?{...s,[field]:value}:s)||null);
 const start=(rows:SupplierDraft[],all=false)=>{operation.setError('');setError('');setNotice('');setDrafts(rows);setBatch(all);setSelected(all?null:rows[0].clientKey);};
 const cancel=()=>{if(saving)return;if(window.confirm('放棄尚未儲存的修改？')){setDrafts(null);setSelected(batch?null:detailDraft?.id||null);setBatch(false);operation.setError('');}};
 const showSupplier=(id:string)=>{operation.setError('');setSelected(id);};
 const closeDetail=()=>{if(!saving){setSelected(null);operation.setError('');}};
 const manage=(action:()=>void)=>{if(manageMenu.current)manageMenu.current.open=false;action();};
 const save=async()=>{
  if(!drafts||!editable||saveLock.current)return;
  for(const d of drafts){const problem=supplierValidation(d);if(problem){operation.setError(`${d.name||'新供應商'}：${problem}`);return;}if(profiles.some(s=>s.id!==d.id&&supplierMatches(s,d.name))){operation.setError(`已有「${d.name}」，請編輯既有供應商。`);return;}}
  saveLock.current=true;setSaving(true);let count=0;
  try{for(const d of drafts){const original=profiles.find(s=>s.id===d.id);if(original&&JSON.stringify(supplierDraft(original))===JSON.stringify(d))continue;
    const result=await operation.run<{id:string;value:DirectorySupplier}>('supplier.save',supplierPayload(d));if(!result){setNotice(`已儲存 ${count} 筆，其餘修改保留，可重試。`);return;}
    const saved={...result.value,id:result.id};setProfiles(rows=>[...rows.filter(s=>s.id!==saved.id),saved].sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant')));setDrafts(rows=>rows?.filter(s=>s.clientKey!==d.clientKey)||null);count++;
   }
   setDrafts(null);setSelected(null);setBatch(false);setNotice(`已儲存 ${count} 筆供應商資料。`);await refresh();
  }finally{saveLock.current=false;setSaving(false);}
 };
 const changeLifecycle=async(s:DirectorySupplier,action:LifecycleOperation)=>{
  if(saveLock.current||drafts||!editable||!window.confirm(lifecycleConfirmation(s.name,action,true)))return;
  saveLock.current=true;setSaving(true);setNotice('');
  try{const result=await operation.run('directory.lifecycle',{kind:'supplier',id:s.id,operation:action,updated_at:s.updated_at});if(!result)return;
   setSelected(null);setNotice(`已${lifecycleLabels[action]}「${s.name}」。`);await refresh();
  }finally{saveLock.current=false;setSaving(false);}
 };
 const importFile=async(file:File)=>{if(file.size>5*1024*1024){setError('檔案請小於 5 MB。');return;}try{const XLSX=await import('xlsx');const book=XLSX.read(await file.arrayBuffer(),{type:'array'});const rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(book.Sheets[book.SheetNames[0]],{defval:'',raw:false});start(supplierImport(rows,profiles),true);setNotice('已載入匯入預覽，已移除的供應商會略過；既有停用狀態保留，確認後按「儲存全部」。');}catch(e){setError(e instanceof Error?e.message:'檔案無法讀取。');}};
 const exportFile=async()=>{try{const XLSX=await import('xlsx');const book=XLSX.utils.book_new();const rows=supplierExport(visible);const sheet=XLSX.utils.json_to_sheet(rows.length?rows:[{'供應商名稱':'','分類':'','合作狀態':'','其他名稱':'',...Object.fromEntries(supplierFields.map(([,label])=>[label,'']))}]);XLSX.utils.book_append_sheet(book,sheet,'供應商');XLSX.writeFile(book,'供應商資料.xlsx');}catch{setError('匯出失敗，請重試。');}};
 const copy=async(value:string)=>{try{await navigator.clipboard.writeText(value);setNotice('已複製 LINE 群組／社群名稱。');}catch{setNotice(`無法自動複製，請長按複製：${value}`);}};
 const contacts=(s:DirectorySupplier|SupplierDraft)=>{const link=safeSupplierLink(s.order_url);const phones=supplierPhones(s.phone);return <div className="sd-contact"><small>{s.contact_name||'聯絡人未填'}</small><div className="sd-contact-links">{phones.map((p,i)=>p.href?<a key={i} href={p.href}>{p.label}</a>:<span key={i}>{p.label}</span>)}{link?<a href={link} target="_blank" rel="noopener noreferrer">{/line/i.test(s.order_method||'')||/(^|\.)line\.me$/.test(new URL(link).hostname)?'LINE':'訂貨連結'} ↗</a>:s.order_method&&<span>{s.order_method}</span>}{s.line_id&&<span>LINE ID：{s.line_id}</span>}{s.line_group&&<button onClick={()=>void copy(s.line_group!)} title="複製群組名稱">{s.line_group}</button>}{!phones.length&&!link&&!s.order_method&&!s.line_id&&!s.line_group&&<span className="sd-muted">聯絡方式可後補</span>}</div></div>;};
 const reminders=(s:DirectorySupplier|SupplierDraft)=><>{s.cutoff_time&&<small className="sd-reminder">收單：{s.cutoff_time}</small>}{s.delivery_note&&<small className="sd-reminder">{s.delivery_note}</small>}{s.supply_note&&<small className="sd-reminder">{s.supply_note}</small>}</>;
 const details=(s:DirectorySupplier|SupplierDraft)=><dl className="sd-details">{supplierFields.filter(([key])=>office||!officeFields.has(key)).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{key==='order_url'&&safeSupplierLink(s[key])?<a href={safeSupplierLink(s[key])!} target="_blank" rel="noopener noreferrer">開啟訂貨連結 ↗</a>:s[key]||'尚未填寫'}</dd></div>)}</dl>;
 const input=(d:SupplierDraft,key:DirectoryKey|'name',focus=false)=><input data-initial-focus={focus||undefined} aria-label={`${d.name||'新供應商'} ${key==='name'?'供應商名稱':supplierFields.find(([k])=>k===key)?.[1]}`} value={d[key]} maxLength={key==='name'?160:supplierFieldLimit(key)} disabled={saving} onChange={e=>change(d.clientKey,key,e.target.value)}/>;
 const editField=(d:SupplierDraft,key:DirectoryKey)=>{
  const label=supplierFields.find(([field])=>field===key)?.[1];
  return <label key={key} className={key.endsWith('note')?'workspace-edit-wide':undefined}>
   {label}{key.endsWith('note')?<textarea rows={1} disabled={saving} maxLength={supplierFieldLimit(key)} value={d[key]} onChange={e=>change(d.clientKey,key,e.target.value)}/>:input(d,key)}
  </label>;
 };
 const closeEditor=()=>{if(batch)setSelected(null);else cancel();};
 const viewFields=(supplier:DirectorySupplier,fields:readonly DirectoryKey[])=><dl className="sd-details">
  {fields.map(key=>{
   const value=supplier[key];
   if(!value?.trim())return null;
   const label=supplierFields.find(([field])=>field===key)?.[1];
   const link=key==='order_url'?safeSupplierLink(value):null;
   return <div key={key}><dt>{label}</dt><dd>
    {link?<a href={link} target="_blank" rel="noopener noreferrer">開啟訂貨連結 ↗</a>
     :key==='phone'?supplierPhones(value).map((phone,i)=><span key={i}>{i>0?'、':''}{phone.href?<a href={phone.href}>{phone.label}</a>:phone.label}</span>)
     :key==='line_group'?<button type="button" className="sd-text-action" onClick={()=>void copy(value)} title="複製群組名稱">{value}</button>
     :value}
   </dd></div>;
  })}
 </dl>;
 const orderMethod=(supplier:DirectorySupplier)=>{
  const link=safeSupplierLink(supplier.order_url);
  if(supplier.order_method?.trim())return supplier.order_method;
  if(supplier.line_group?.trim())return 'LINE 群組';
  if(supplier.line_id?.trim()||(link&&/(^|\.)line\.me$/.test(new URL(link).hostname)))return 'LINE';
  if(link)return '訂貨連結';
  return supplier.phone?.trim()?'電話':'—';
 };
 const editFields=detailDraft&&<>
  <div className="workspace-edit-fields">
   <label>供應商名稱{input(detailDraft,'name',true)}</label>
   <label>分類<select aria-label="供應商預設分類" disabled={saving} value={detailDraft.supplier_category} onChange={e=>change(detailDraft.clientKey,'supplier_category',e.target.value)}><option value="">未分類</option>{SUPPLIER_CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></label>
   {contactFields.map(key=>editField(detailDraft,key))}
  </div>
  <details className="workspace-edit-more"><summary>訂貨與配送</summary><div className="workspace-edit-fields">{deliveryFields.map(([key])=>editField(detailDraft,key))}</div></details>
  <details className="workspace-edit-more"><summary>帳務與付款</summary><div className="workspace-edit-fields">{billingFields.map(([key])=>editField(detailDraft,key))}</div></details>
  <details className="workspace-edit-more"><summary>別名、合作與附件</summary><div className="workspace-edit-fields">
   <label>合作類型<select disabled={saving} value={detailDraft.cooperation_status} onChange={e=>change(detailDraft.clientKey,'cooperation_status',e.target.value)}><option value="COMMON">常用</option><option value="BACKUP">備用</option></select></label>
   <label>貨單別名（以頓號分隔）<textarea rows={1} disabled={saving} value={detailDraft.aliases} onChange={e=>change(detailDraft.clientKey,'aliases',e.target.value)}/></label>
   {editField(detailDraft,'cooperation_note')}
   <div className="workspace-edit-wide">{attachments(detailDraft)}</div>
  </div></details>
  {operation.error&&<p role="alert" className="workspace-edit-error">{operation.error}</p>}
  <div className="workspace-edit-actions"><button type="button" className="shell-secondary" disabled={saving} onClick={closeEditor}>{batch?'回到清單':'取消'}</button>{!batch&&<button type="button" className="shell-primary" disabled={saving||!editable} onClick={()=>void save()}>{saving?'儲存中…':'儲存'}</button>}</div>
 </>;

 const rows=batch&&drafts?drafts:visible;
 if(mobileMode)return <MobileSupplierDirectory profiles={profiles} search={search} category={category} loading={loading} error={error} notice={notice} onSearch={setSearch} onCategory={setCategory} onRefresh={()=>void refresh()} onBack={onBack} onCopy={value=>void copy(value)}/>;
 const content=<div className="supplier-workspace sd-directory">
  <button className="shell-back" disabled={saving} onClick={()=>{if(!drafts||window.confirm('供應商資料尚未儲存，確定離開？'))onBack();}}>‹ 返回首頁</button>
  <div className="sd-tabs">{(office?['使用中','已停用','已移除']:['使用中']).map(t=><button key={t} aria-pressed={tab===t} disabled={!!drafts} onClick={()=>setTab(t)}>{t} <small>{profiles.filter(s=>directoryState(s)===t).length}</small></button>)}</div>
  <div className="sd-heading">
   <div><h1>{office?'供應商':'供應商訂貨'}</h1><p>{office?'兩店共用':'查詢訂貨方式、收單時間與配送資訊。'}</p></div>
   {office&&editable&&!drafts&&<div className="sd-tools">
    <details className="sd-manage" ref={manageMenu}>
     <summary>管理清單 <ChevronDown size={14} aria-hidden="true"/></summary>
     <div>
      <button type="button" disabled={loading||!visible.some(s=>!s.is_removed)} onClick={()=>manage(()=>start(visible.filter(s=>!s.is_removed).map(supplierDraft),true))}>批次編輯</button>
      <button type="button" disabled={loading} onClick={()=>manage(()=>importInput.current?.click())}>匯入</button>
      <button type="button" onClick={()=>manage(()=>void exportFile())}>匯出</button>
      <button type="button" disabled={loading} onClick={()=>manage(()=>void refresh())}>重新讀取</button>
     </div>
    </details>
    <button type="button" className="shell-primary" disabled={loading} onClick={()=>start([{...emptySupplier}])}><Plus size={15} aria-hidden="true"/>新增供應商</button>
   </div>}
   {office&&<input ref={importInput} hidden type="file" accept=".xlsx,.xls,.csv" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void importFile(file);}}/>}
  </div>
  <div className="sd-toolbar">
   <input type="search" aria-label="搜尋供應商、別名或品項" placeholder="搜尋供應商、別名或品項" value={search} disabled={!!drafts} onChange={e=>setSearch(e.target.value)}/>
   <select aria-label="分類篩選" value={category} disabled={!!drafts} onChange={e=>setCategory(e.target.value)}><option value="">全部分類</option>{SUPPLIER_CATEGORIES.map(c=><option key={c}>{c}</option>)}</select>
   {(!office||!editable)&&<button disabled={loading||!!drafts} onClick={()=>void refresh()}>重新讀取</button>}
  </div>
  {!office&&<nav className="mobile-supplier-categories" aria-label="供應商分類">{['',...SUPPLIER_CATEGORIES].map(c=><button key={c} aria-pressed={category===c} onClick={()=>setCategory(c)}>{c||'全部'}</button>)}</nav>}
  {loading&&<p role="status">讀取中…</p>}{error&&<p className="shell-note" role="alert">{error}</p>}{notice&&(!detail||!!detailDraft)&&<p className="shell-note" role="status">{notice}</p>}{operation.error&&!detail&&!detailDraft&&<p className="shell-note" role="alert">{operation.error}</p>}
  {batch&&drafts&&<div className="sd-editbar"><span>{drafts.length} 筆待確認</span><button disabled={saving} onClick={cancel}>取消</button><button disabled={saving||!editable} onClick={()=>void save()}>{saving?'儲存中…':'儲存全部'}</button></div>}
  {office?<div className="sd-table-wrap">
   <table className={batch&&drafts?'sd-table sd-table-batch':'sd-table'}>
    <thead><tr><th scope="col">供應商</th><th scope="col">分類</th><th scope="col">主要供應</th><th scope="col">{batch&&drafts?'聯絡方式':'訂貨方式'}</th><th scope="col" aria-label="操作"/></tr></thead>
    <tbody>{batch&&drafts?drafts.map(d=><tr key={d.clientKey}>
     <td>{input(d,'name')}</td>
     <td><select aria-label={`${d.name}的供應商分類`} value={d.supplier_category} disabled={saving} onChange={e=>change(d.clientKey,'supplier_category',e.target.value)}><option value="">未分類</option>{SUPPLIER_CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></td>
     <td>{input(d,'primary_supplies')}</td>
     <td><div className="sd-contact-edit">{input(d,'contact_name')}{input(d,'phone')}{input(d,'order_method')}</div></td>
     <td><button type="button" className="sd-view" disabled={saving} onClick={()=>showSupplier(d.clientKey)}>詳細編輯</button></td>
    </tr>):visible.map(s=><tr key={s.id}>
     <td><strong className="sd-name">{s.name}</strong></td>
     <td><span className="sd-category">{s.supplier_category||'未分類'}</span></td>
     <td>{s.primary_supplies||'—'}</td>
     <td>{orderMethod(s)}</td>
     <td><button type="button" className="sd-view" aria-label={`查看 ${s.name}`} disabled={saving||!!drafts} onClick={()=>showSupplier(s.id)}>查看 <ChevronRight size={14} aria-hidden="true"/></button></td>
    </tr>)}</tbody>
   </table>
  </div>:<div className="sd-cards">{visible.map(s=><article className="sd-mobile-contact" key={s.id}><div className="sd-mobile-heading"><h2>{s.name}</h2><span className="sd-status">{directoryState(s)}{s.is_active?` · ${supplierStatus(s)}`:''}</span></div><p>{s.primary_supplies||s.supplier_category||'尚未設定'}</p>{contacts(s)}{reminders(s)}<details className="sd-supplier-row"><summary><span>更多訂貨資料</span><span aria-hidden="true">⌄</span></summary><div className="sd-supplier-body">{details(s)}</div></details></article>)}</div>}

  {!loading&&!rows.length&&<p className="shell-note">目前沒有符合條件的供應商。</p>}
  {batch&&detailDraft&&<WorkspaceEditDialog title={detailDraft.id?'編輯供應商':'新增供應商'} busy={saving} onClose={closeEditor}>{editFields}</WorkspaceEditDialog>}
  {office&&!batch&&(detailDraft||detail)&&<WorkspaceEditDialog
   title={detailDraft?(detailDraft.id?'編輯供應商':'新增供應商'):detail?.name||'供應商'}
   busy={saving} onClose={detailDraft?closeEditor:closeDetail} side
  >
   {detailDraft?editFields:detail&&<div className="sd-profile">
    <div className="sd-profile-summary">
     <span className="sd-category">{detail.supplier_category||'未分類'}</span>
     <span className="sd-muted">{directoryState(detail)}{detail.is_active?` · ${supplierStatus(detail)}`:''}</span>
    </div>
    {viewFields(detail,['primary_supplies','order_method','contact_name','phone','line_group','line_id','order_url','billing_cycle','payment_terms'])}
    {!!detail.aliases?.length&&<dl className="sd-details"><div><dt>貨單別名</dt><dd>{detail.aliases.join('、')}</dd></div></dl>}
    {profileSections.map(({label,keys})=>keys.some(key=>detail[key]?.trim())&&
     <details key={label} className="sd-profile-more"><summary>{label}</summary>{viewFields(detail,keys)}</details>
    )}
    <div className="sd-profile-related">{attachments(detail,true)}{officeAccess(store)&&canData(store,'RECIPE')&&<SupplierIngredientHistory storeId={store.id} supplierId={detail.id} name={detail.name}/>}</div>
    {notice&&<p className="workspace-edit-notice" role="status">{notice}</p>}
    {operation.error&&<p className="workspace-edit-error" role="alert">{operation.error}</p>}
    {editable&&<div className="workspace-edit-actions sd-profile-actions">
     <DirectoryLifecycleMenu row={detail} disabled={saving} canDelete={officeAccess(store)} onAction={action=>void changeLifecycle(detail,action)}/>
     {!detail.is_removed&&<button type="button" className="shell-primary" disabled={saving} onClick={()=>start([supplierDraft(detail)])}>編輯</button>}
    </div>}
   </div>}
  </WorkspaceEditDialog>}
  {detail&&!detailDraft&&!office&&<div className="supplier-modal-backdrop"><section className="supplier-modal sd-detail" role="dialog" aria-modal="true" aria-label="供應商詳細資料"><div className="supplier-contact-heading"><h2>{detail.name}</h2><button onClick={()=>setSelected(null)}>關閉</button></div><p>{supplierStatus(detail)} · {detail.supplier_category||'尚未設定'}</p>{contacts(detail)}{details(detail)}</section></div>}
 </div>;
 return batch&&drafts?<WorkspaceEditDialog title="編輯供應商清單" busy={saving} onClose={cancel} wide>{content}</WorkspaceEditDialog>:content;
}
