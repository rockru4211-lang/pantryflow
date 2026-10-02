'use client';

import {useEffect,useRef,useState} from 'react';
import {CheckCircle2,Plus,Search} from 'lucide-react';
import {normalizeRecipePurchase,recipeUnit,type RecipeWorkspace} from '@/lib/recipe-cost';
import {priceHistory,priceMovement,priceMode,priceNeedsAttention,priceNumber,pricePackage,priceRegisterRows,priceSource,priceSupplier,registerDraft,registerPriceInput,type PriceRegisterRow,type RegisterDraft} from '@/lib/recipe-price-register';
import type {RecipePriceInput} from './recipe-price-editor';
import RecipeModal from './recipe-modal';
import {recipeInputUnits} from './recipe-inline-price';

const units=(current:string)=>[...new Set([current,...recipeInputUnits])].filter(Boolean);
const statusLabel=(row:PriceRegisterRow)=>row.status==='missing'?'待補價格':row.status==='pending'?'待確認':row.status==='current'?'食譜使用中':'其他報價';
const safeLink=(url?:string)=>url&&/^https?:\/\//i.test(url)?url:undefined;
type Props={workspace:RecipeWorkspace;loaded:boolean;onSave:(data:RecipePriceInput)=>Promise<boolean>;registerLeave?:(handler:(()=>Promise<boolean>)|null)=>void};

export default function RecipePriceRegister({workspace,loaded,onSave,registerLeave}:Props){
 const [search,setSearch]=useState(''),[supplier,setSupplier]=useState(''),[statusFilter,setStatusFilter]=useState('');
 const [editing,setEditing]=useState<{row?:PriceRegisterRow;draft:RegisterDraft}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('');
 useEffect(()=>{
  const dirty=!!editing&&JSON.stringify(editing.draft)!==JSON.stringify(registerDraft(editing.row));
  registerLeave?.(async()=>{if(busy||dirty){setError('請先儲存價格，或按「關閉」放棄這次編輯，再離開。');return false;}return true;});
  const warn=(event:BeforeUnloadEvent)=>{if(dirty||busy)event.preventDefault();};
  window.addEventListener('beforeunload',warn);
  return()=>{registerLeave?.(null);window.removeEventListener('beforeunload',warn);};
 },[editing,busy,registerLeave]);
 const opener=useRef<HTMLElement|null>(null);
 const rows=priceRegisterRows(workspace),term=search.trim().toLowerCase();
 const suppliers=[...new Set(rows.map(r=>priceSupplier(r.price)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-TW'));
 const filtered=rows.filter(r=>(!term||`${r.name} ${priceSupplier(r.price)} ${r.price?.source_ref?.name||''} ${r.price?.source_ref?.specification||''}`.toLowerCase().includes(term))&&(!supplier||priceSupplier(r.price)===supplier)&&(!statusFilter||(statusFilter==='pending'?priceNeedsAttention(r):statusFilter==='estimate'?priceMode(r.price)==='高估價':statusFilter==='history'?r.price?.source_kind==='history':(priceMovement(r.price)?.difference||0)>0)));
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
 return <section className="price-register" aria-label="食材價格表">
  <div className="price-register-heading"><div><h1>食材價格表</h1><p>進貨價格集中維護，食譜成本自動連動。</p></div>{workspace.can_price&&<button className="shell-primary" disabled={!loaded} onClick={()=>open()}><Plus size={16}/>新增食材</button>}</div>
  <div className="price-register-sync"><CheckCircle2 size={20}/><span>核對進貨後，自動更新已對應食材的配件與食譜成本。</span><small>自動連動</small></div>
  <div className="price-register-tools"><label className="recipe-search"><Search size={17}/><input aria-label="搜尋食材或供應商" placeholder="搜尋食材、供應商或規格" value={search} onChange={e=>setSearch(e.target.value)}/></label><select aria-label="篩選供應商" value={supplier} onChange={e=>setSupplier(e.target.value)}><option value="">所有供應商</option>{suppliers.map(s=><option key={s}>{s}</option>)}</select><select aria-label="篩選價格狀態" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="">全部狀態</option><option value="pending">待補資料（{rows.filter(priceNeedsAttention).length}）</option><option value="increase">進價上漲</option><option value="estimate">高估價</option><option value="history">歷史價格</option></select></div>
  <p className="price-register-summary">{filtered.length} 筆對照 · 漲跌比較同供應商、同規格的已確認進價。</p>
  {saved&&<p className="price-register-saved" role="status">{saved}</p>}
  {!loaded?<p role="status">讀取食材價格…</p>:<div className="price-register-scroll"><table className="price-register-table"><thead><tr><th>食材／供應商</th><th>包裝規格</th><th>最新進價</th><th>成本採用單價</th><th>進價漲跌</th><th>更新日期</th><th>操作</th></tr></thead><tbody>{filtered.map(row=>{
   const p=row.price,q=p?.purchase,raw=q?q.amount/q.quantity:p?.price,movement=priceMovement(p),mode=priceMode(p);
   return <tr key={row.id}><th scope="row"><strong>{row.name}</strong><small className={!priceSupplier(p)?'recipe-pending':''}>{priceSupplier(p)||'供應商待補'}</small>{row.status!=='current'&&<span className={`price-register-status ${row.status==='pending'||row.status==='missing'?'recipe-pending':''}`}>{statusLabel(row)}</span>}</th>
    <td>{p?pricePackage(p):'待補'}<small>{p?.source_ref?.specification}</small></td>
    <td>{raw===undefined?'—':`$${priceNumber(raw)}／${q?.unit||p?.unit}`}<small>{p?priceSource(p):''}{p?.source_kind==='history'?' · 沿用原表價格':''}</small></td>
    <td><strong>{p?`$${priceNumber(p.cost_price??p.price)}／${p.unit}`:'待補價格'}</strong>{p&&<span className={`price-register-mode ${mode==='高估價'?'price-mode-estimate':''}`}>{mode}</span>}{p&&row.status==='pending'&&<small>確認前不套用</small>}{p?.conversion_pending&&<small>新進貨規格不同，沿用上次價格</small>}</td>
    <td className={movement&&movement.difference>0?'price-rise':movement&&movement.difference<0?'price-fall':''}>{!movement?'—':Math.abs(movement.difference)<1e-10?'持平':movement.percent===null?'前次為零':`${movement.difference>0?'↑':'↓'} ${Math.abs(movement.percent).toLocaleString('zh-TW',{maximumFractionDigits:1})}%`}{movement&&p&&<small>${priceNumber(movement.previousAmount)} → ${priceNumber(movement.currentAmount)}／{movement.unit}</small>}</td>
    <td>{p?.effective_date||'日期未記載'}</td>
    <td><button className="text-button" onClick={()=>open(row)}>{workspace.can_price?(row.status==='missing'?'補價':row.status==='pending'?'確認':'編輯'):'查看'}</button></td></tr>;
  })}</tbody></table>{!filtered.length&&<p className="recipe-muted">{rows.length?'沒有符合條件的食材。':'建立價格後，新增食譜即可帶入對應成本。'}</p>}</div>}
  <details className="price-register-rules"><summary>計價方式 <span>高估價與最新進價，採較高者</span></summary><p>同一食材、供應商與換算資料確認後，核對完成的進貨會自動帶入。沒有新進貨時沿用已確認價格；資料不完整時顯示待補，不猜測包裝重量。</p><p>進價漲跌依實際單價比較，高估價只用於食譜成本。畫面每 30 秒及返回此頁時同步。</p></details>
  <p className="recipe-muted">食譜用量不變；歷史成本版本保留。</p>
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
    <details className="price-register-more"><summary>高估價、進貨對應與來源</summary><fieldset disabled={busy||!workspace.can_price}><div className="price-register-fields"><label>高估成本單價（元／{draft.purchaseUnit}）<input aria-label="高估成本單價" type="number" min="0" step="any" inputMode="decimal" placeholder="留空採原價" value={draft.estimate} onChange={e=>change({estimate:e.target.value})}/></label><label>價格日期<input aria-label="價格日期" type="date" value={draft.date} onChange={e=>change({date:e.target.value})}/></label><label className="price-register-wide">對應進貨品項<select aria-label="對應進貨品項" value={draft.matchedProductId} onChange={e=>change({matchedProductId:e.target.value})}><option value="">尚未對應，沿用已確認價格</option>{workspace.products.map(p=><option key={p.id} value={p.id}>{p.name}{p.specification?` · ${p.specification}`:''}</option>)}</select></label><label className="price-register-wide">價格來源<input aria-label="價格來源" value={draft.source} onChange={e=>change({source:e.target.value})}/></label></div></fieldset>{editing.row?.price?.source_ref?.review_note&&<p>{editing.row.price.source_ref.review_note}</p>}{safeLink(editing.row?.price?.source_ref?.url)&&<a href={safeLink(editing.row?.price?.source_ref?.url)} target="_blank" rel="noreferrer">查看原始來源 ↗</a>}</details>
    {editing.row?.uses.length?<p className="recipe-muted">使用配方：{editing.row.uses.join('、')}</p>:null}
    {error&&<p className="recipe-alert" role="alert">{error}</p>}
    <div className="price-register-footer"><button type="button" className="recipe-secondary" disabled={busy} onClick={()=>setEditing(null)}>關閉</button>{workspace.can_price&&<button className="shell-primary" type="submit" disabled={busy}>{busy?'儲存中…':editing.row?.status==='pending'?'確認並儲存價格':'儲存價格'}</button>}</div>
   </form>
   {editing.row?.price?.previous_price!=null&&<p className="recipe-muted">前次可比進價：${priceNumber(editing.row.price.previous_price)}／{editing.row.price.unit} · {editing.row.price.previous_date||'日期未記載'}</p>}
   {!!history.length&&<details className="price-register-history"><summary>價格紀錄（{history.length} 筆）</summary>{history.map(p=><div key={p.reference_id}><strong>{priceSupplier(p)||'供應商未記載'} · ${priceNumber(p.cost_price??p.price)}／{p.unit}</strong><small>{pricePackage(p)} · {p.effective_date||'日期未記載'} · {priceSource(p)}{p.review_status==='pending'?' · 待確認':''}</small></div>)}</details>}
  </RecipeModal>}
 </section>;
}
