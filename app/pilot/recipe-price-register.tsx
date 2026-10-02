'use client';

import {useRef,useState} from 'react';
import {Plus,Search} from 'lucide-react';
import {normalizeRecipePurchase,recipeUnit,type RecipeWorkspace} from '@/lib/recipe-cost';
import {priceHistory,priceNeedsAttention,priceNumber,pricePackage,priceRegisterRows,priceSource,priceSupplier,registerDraft,registerPriceInput,type PriceRegisterRow,type RegisterDraft} from '@/lib/recipe-price-register';
import type {RecipePriceInput} from './recipe-price-editor';
import RecipeModal from './recipe-modal';
import {recipeInputUnits} from './recipe-inline-price';

const units=(current:string)=>[...new Set([current,...recipeInputUnits])].filter(Boolean);
const statusLabel=(row:PriceRegisterRow)=>row.status==='missing'?'待補價格':row.status==='pending'?'待確認':row.status==='current'?'食譜使用中':'其他報價';
const safeLink=(url?:string)=>url&&/^https?:\/\//i.test(url)?url:undefined;
type Props={workspace:RecipeWorkspace;loaded:boolean;onSave:(data:RecipePriceInput)=>Promise<boolean>};

export default function RecipePriceRegister({workspace,loaded,onSave}:Props){
 const [search,setSearch]=useState(''),[supplier,setSupplier]=useState(''),[pendingOnly,setPendingOnly]=useState(false);
 const [editing,setEditing]=useState<{row?:PriceRegisterRow;draft:RegisterDraft}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('');
 const opener=useRef<HTMLElement|null>(null);
 const rows=priceRegisterRows(workspace),term=search.trim().toLowerCase();
 const suppliers=[...new Set(rows.map(r=>priceSupplier(r.price)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-TW'));
 const filtered=rows.filter(r=>(!term||`${r.name} ${priceSupplier(r.price)} ${r.price?.source_ref?.name||''} ${r.price?.source_ref?.specification||''}`.toLowerCase().includes(term))&&(!supplier||priceSupplier(r.price)===supplier)&&(!pendingOnly||priceNeedsAttention(r)));
 function open(row?:PriceRegisterRow){opener.current=document.activeElement as HTMLElement;setEditing({row,draft:registerDraft(row)});setError('');setSaved('');}
 const draft=editing?.draft;
 function change(patch:Partial<RegisterDraft>){setEditing(current=>current?{...current,draft:{...current.draft,...patch}}:current);setError('');}
 let preview:ReturnType<typeof registerPriceInput>|null=null,previewError='';
 if(draft)try{preview=registerPriceInput(draft);}catch(e){previewError=e instanceof Error?e.message:'請補齊計價資料。';}
 async function save(){
  if(!draft||busy||!workspace.can_price)return;
  let input:RecipePriceInput;try{input=registerPriceInput(draft);}catch(e){setError(e instanceof Error?e.message:'請核對價格。');return;}
  setBusy(true);setError('');try{if(await onSave(input)){setEditing(null);setSaved(`${input.name}價格已儲存，門市食譜共用。`);}else setError('尚未儲存成功，輸入內容已保留，請重試。');}catch{setError('尚未儲存成功，輸入內容已保留，請重試。');}finally{setBusy(false);}
 }
 const history=editing?.row?priceHistory(editing.row,workspace):[];
 return <section className="price-register" aria-label="食材價格對照表">
  <div className="price-register-heading"><div><h2>食材價格對照表</h2><p>供應商、採購規格與單位成本，門市食譜共用。</p></div>{workspace.can_price&&<button className="recipe-secondary" disabled={!loaded} onClick={()=>open()}><Plus size={16}/>新增價格</button>}</div>
  <div className="price-register-tools"><label className="recipe-search"><Search size={17}/><input aria-label="搜尋食材或供應商" placeholder="搜尋食材、供應商或規格" value={search} onChange={e=>setSearch(e.target.value)}/></label><select aria-label="篩選供應商" value={supplier} onChange={e=>setSupplier(e.target.value)}><option value="">所有供應商</option>{suppliers.map(s=><option key={s}>{s}</option>)}</select><button className="recipe-secondary" aria-pressed={pendingOnly} onClick={()=>setPendingOnly(!pendingOnly)}>待補資料 {rows.filter(priceNeedsAttention).length}</button></div>
  <p className="price-register-summary">{filtered.length} 筆對照 · 食譜使用已確認價格；近期進貨優先，缺價再用歷史食譜。</p>
  {saved&&<p className="price-register-saved" role="status">{saved}</p>}
  {!loaded?<p role="status">讀取食材價格…</p>:<div className="price-register-scroll"><table className="price-register-table"><thead><tr><th>食材／供應商</th><th>採購／原表單價</th><th>包裝與換算</th><th>最小計價單位</th><th>換算單價</th><th>價格來源</th><th>操作</th></tr></thead><tbody>{filtered.map(row=>{
   const p=row.price,q=p?.purchase,raw=q?q.amount/q.quantity:p?.price;
   return <tr key={row.id}><th scope="row"><strong>{row.name}</strong><small className={!priceSupplier(p)?'recipe-pending':''}>{priceSupplier(p)||'供應商待補'}</small><span className={`price-register-status ${row.status==='pending'||row.status==='missing'?'recipe-pending':''}`}>{statusLabel(row)}</span></th>
    <td>{raw===undefined?'—':`$${priceNumber(raw)}／${q?.unit||p?.unit}`}<small>{p?.source_kind==='history'?'原表計價基準':''}</small></td>
    <td>{p?pricePackage(p):'待補'}<small>{p?.source_ref?.specification}</small></td><td>{row.unit||'待補'}</td>
    <td><strong>{p?`$${priceNumber(p.cost_price??p.price)}／${p.unit}`:'待補價格'}</strong>{p?.cost_price!=null&&<small>高估計價 · 原價 ${priceNumber(p.price)}／{p.unit}</small>}{p&&row.status==='pending'&&<small>確認前不套用</small>}</td>
    <td>{p?priceSource(p):'—'}<small>{p?.effective_date||'日期未記載'}</small></td>
    <td><button className="text-button" onClick={()=>open(row)}>{workspace.can_price?(row.status==='missing'?'補價':row.status==='pending'?'確認':'編輯'):'查看'}</button></td></tr>;
  })}</tbody></table>{!filtered.length&&<p className="recipe-muted">{rows.length?'沒有符合條件的食材。':'建立價格後，新增食譜即可帶入對應成本。'}</p>}</div>}
  {editing&&draft&&<RecipeModal title={editing.row?`${draft.name}｜價格對照`:'新增食材價格'} busy={busy} onClose={()=>setEditing(null)} returnFocus={opener}>
   <form className="price-register-form" onSubmit={e=>{e.preventDefault();void save();}}>
    <fieldset disabled={busy||!workspace.can_price}><div className="price-register-fields">
     <label>食材名稱<input aria-label="對照食材名稱" value={draft.name} readOnly={!!editing.row} list="price-register-products" onChange={e=>{const name=e.target.value,matches=workspace.products.filter(p=>p.name===name);change({name,productId:matches.length===1?matches[0].id:''});}}/><datalist id="price-register-products">{workspace.products.map(p=><option key={p.id} value={p.name}>{p.specification}</option>)}</datalist></label>
     <label>供應商<input aria-label="食材供應商" list="price-register-suppliers" placeholder="搜尋或填寫供應商" value={draft.supplier} onChange={e=>{const name=e.target.value,matches=(workspace.suppliers||[]).filter(s=>s.name===name);change({supplier:name,supplierId:matches.length===1?matches[0].id:''});}}/><datalist id="price-register-suppliers">{[...new Set([...(workspace.suppliers||[]).map(s=>s.name),...suppliers])].map(s=><option key={s} value={s}/>)}</datalist></label>
     <label>採購／原表單價<input aria-label="採購單價" type="number" inputMode="decimal" step="any" min="0" value={draft.amount} onChange={e=>change({amount:e.target.value})}/></label>
     <label>採購單位<select aria-label="採購單位" value={draft.purchaseUnit} onChange={e=>change({purchaseUnit:e.target.value,content:''})}>{units(draft.purchaseUnit).map(u=><option key={u}>{u}</option>)}</select></label>
     <label>最小計價單位<select aria-label="最小計價單位" value={draft.unit} onChange={e=>change({unit:e.target.value,contentUnit:e.target.value})}>{units(draft.unit).map(u=><option key={u}>{u}</option>)}</select></label>
     <label>品牌／規格<input aria-label="食材品牌或規格" placeholder="可填品牌或其他規格" value={draft.specification} onChange={e=>change({specification:e.target.value})}/></label>
     {recipeUnit(draft.purchaseUnit)!==recipeUnit(draft.unit)&&<><label>每 1 {draft.purchaseUnit} 內容量<input aria-label="每採購單位內容量" type="number" inputMode="decimal" min="0" step="any" placeholder="例如 750" value={draft.content} onChange={e=>change({content:e.target.value})}/></label><label>內容量單位<select aria-label="內容量單位" value={draft.contentUnit} onChange={e=>change({contentUnit:e.target.value})}>{units(draft.contentUnit).map(u=><option key={u}>{u}</option>)}</select></label></>}
    </div></fieldset>
    <div className="price-register-preview" role="status">{preview?<><span>{pricePackage({...preview,key:'preview'})}</span><strong>${priceNumber(preview.price)}／{preview.unit}</strong>{draft.estimate&&<small>成本採高估價：${priceNumber(normalizeRecipePurchase(preview.purchase,preview.unit).costPrice??preview.price)}／{preview.unit}</small>}</>:<span>{previewError}</span>}</div>
    {recipeUnit(draft.purchaseUnit)==='ml'&&recipeUnit(draft.unit)==='g'&&<p className="recipe-muted">容量與重量需填實際換算量；系統不預設 1L＝1000g。</p>}
    {editing.row?.price?.source_kind==='history'&&<p className="recipe-muted">此筆沿用歷史食譜的計價基準；包裝資料請以原始來源核對。</p>}
    <details className="price-register-more"><summary>高估單價、來源與日期</summary><fieldset disabled={busy||!workspace.can_price}><div className="price-register-fields"><label>高估成本單價（元／{draft.purchaseUnit}）<input aria-label="高估成本單價" type="number" min="0" step="any" inputMode="decimal" placeholder="留空採原價" value={draft.estimate} onChange={e=>change({estimate:e.target.value})}/></label><label>價格日期<input aria-label="價格日期" type="date" value={draft.date} onChange={e=>change({date:e.target.value})}/></label><label className="price-register-wide">價格來源<input aria-label="價格來源" value={draft.source} onChange={e=>change({source:e.target.value})}/></label></div></fieldset>{editing.row?.price?.source_ref?.review_note&&<p>{editing.row.price.source_ref.review_note}</p>}{safeLink(editing.row?.price?.source_ref?.url)&&<a href={safeLink(editing.row?.price?.source_ref?.url)} target="_blank" rel="noreferrer">查看原始來源 ↗</a>}</details>
    {editing.row?.uses.length?<p className="recipe-muted">使用配方：{editing.row.uses.join('、')}</p>:null}
    {error&&<p className="recipe-alert" role="alert">{error}</p>}
    <div className="price-register-footer"><button type="button" className="recipe-secondary" disabled={busy} onClick={()=>setEditing(null)}>關閉</button>{workspace.can_price&&<button className="shell-primary" type="submit" disabled={busy}>{busy?'儲存中…':editing.row?.status==='pending'?'確認並儲存價格':'儲存價格'}</button>}</div>
   </form>
   {!!history.length&&<details className="price-register-history"><summary>價格紀錄（{history.length} 筆）</summary>{history.map(p=><div key={p.reference_id}><strong>{priceSupplier(p)||'供應商未記載'} · ${priceNumber(p.cost_price??p.price)}／{p.unit}</strong><small>{pricePackage(p)} · {p.effective_date||'日期未記載'} · {priceSource(p)}{p.review_status==='pending'?' · 待確認':''}</small></div>)}</details>}
  </RecipeModal>}
 </section>;
}
