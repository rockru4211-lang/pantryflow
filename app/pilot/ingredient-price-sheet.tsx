'use client';
import {Fragment,useEffect,useRef,useState} from 'react';
import {ingredientSourceLabel,ingredientPurchase,ingredientSaveData,formatPurchaseSpecification,usesPackageSpecification} from '@/lib/ingredient-catalog';
import {baselineCategory,baselinePriceDate,priceCategories,baselineName,baselineGroups,baselinePurchaseDate,emptyPriceSheet,isIngredientStopped,priceCandidate,priceSearch,priceEdit,candidatePurchase,supplierOptions,ingredientReceiptPrices,ingredientPackageLabel,ingredientPackageKey,ingredientPerBaseUnit,ingredientReviewGroups,type PriceSheetData,type PriceIngredient,type SupplyState,type PriceSheetEdit} from '@/lib/ingredient-price-sheet';
import {resolveIngredientImport} from '@/lib/ingredient-code';
import RecipeRowMenu from './recipe-row-menu';
import RecipeModal from './recipe-modal';
import './ingredient-price-sheet.css';
type Props={cloudDraft?:{read:()=>Promise<{token:string;edits:Record<string,PriceSheetEdit>}|null>;save:(edits:Record<string,PriceSheetEdit>,expected:string|null,token:string)=>Promise<{token:string}>};saveRecipeAlias?:(id:string,alias:string,previous:string|undefined,requestId:string)=>Promise<void>;data:PriceSheetData;loaded:boolean;failed:boolean;syncing?:boolean;canExport:boolean;draftKey:string;save:(action:string,data:Record<string,unknown>,requestId:string)=>Promise<void>;registerLeave?:(handler:(()=>Promise<boolean>)|null)=>void};
const money=(v:number|null|undefined)=>v==null?'':`NT$ ${v.toLocaleString('zh-TW',{maximumFractionDigits:6})}`;
const date=(v?:string|null)=>v&&!Number.isNaN(Date.parse(v))?new Date(v).toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}).replaceAll('-','/') :'';
const units=['待補單位','g','公斤','台斤','ml','L','包','盒','瓶','罐','箱','顆','片','卷','份','隻','條','塊'];
const reasons=['價格偏高','品質不佳','規格不符','交貨不穩','停止供貨','菜單停用','其他'];
export default function IngredientPriceSheet({data=emptyPriceSheet,loaded,failed,syncing,canExport,draftKey,save,saveRecipeAlias,registerLeave,cloudDraft}:Props){
 const [tab,setTab]=useState('common'),[search,setSearch]=useState(''),[page,setPage]=useState(0);
 const [category,setCategory]=useState(''),[supplier,setSupplier]=useState(''),[selected,setSelected]=useState<string[]>([]);
 const [edits,setEdits]=useState<Record<string,PriceSheetEdit>>({}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [decision,setDecision]=useState<{row:PriceIngredient;key:string;restore:boolean;reason:string;disposition:string;note:string;revision:number;requestId:string}|null>(null);
 const [recipeAlias,setRecipeAlias]=useState<{row:PriceIngredient;value:string;previous?:string;requestId:string}|null>(null);
 const [recipeAliasError,setRecipeAliasError]=useState('');
 const aliasSaving=useRef(false);
 const aliasReturnFocus=useRef<HTMLElement|null>(null);
 const [more,setMore]=useState<string|null>(null);
 const [categoryPending,setCategoryPending]=useState<{id:string;category:string;revision:number;requestId:string}|null>(null);
 const [aliasTarget,setAliasTarget]=useState<Record<string,string>>({});
 const [mergeTarget,setMergeTarget]=useState<Record<string,string>>({});
 const mergeRequest=useRef<{key:string;id:string}|null>(null);
 const [recovery,setRecovery]=useState<Record<string,PriceSheetEdit>|null>(null);const input=useRef<HTMLInputElement>(null);
 useEffect(()=>{const timer=setTimeout(()=>{try{const value=JSON.parse(localStorage.getItem(draftKey)||'null');if(value&&Object.keys(value).length)setRecovery(value);}catch{/* No cloud values are replaced by malformed drafts. */}},0);return()=>clearTimeout(timer);},[draftKey]);
 const editRef=useRef(edits);
 const cloudToken=useRef<string|null>(null),cloudReady=useRef(false);
 useEffect(()=>{if(!cloudDraft)return;let active=true;void cloudDraft.read().then(value=>{if(!active)return;cloudToken.current=value?.token||null;cloudReady.current=true;if(value&&Object.keys(value.edits).length){if(!Object.keys(editRef.current).length)setRecovery(local=>local||value.edits);setMessage('系統有已保存草稿，可恢復後接續。');}}).catch(()=>{if(active)setMessage('系統草稿讀取失敗，本機修改仍保留，請重新同步後重試。');});return()=>{active=false;};},[cloudDraft]);
 async function persistCloud(next:Record<string,PriceSheetEdit>){if(!cloudDraft)return;if(!cloudReady.current)throw Error('系統草稿尚未讀取，請重新同步。');const saved=await cloudDraft.save(next,cloudToken.current,crypto.randomUUID());cloudToken.current=saved.token;}
 async function discardEdits(){if(!window.confirm('捨棄尚未儲存的修改及已保存草稿？'))return;setBusy(true);setError('');try{await persistCloud({});setRecovery(null);updateEdits({});}catch{setError('草稿清除失敗，修改仍保留，請重試。');}finally{setBusy(false);}}
 async function keepCloud(){setBusy(true);setError('');try{await persistCloud(edits);setMessage('草稿已保存至系統，同帳號換裝置可接續；尚未更新正式價格。');}catch(e){setError(String(e&&typeof e==='object'&&'message' in e?e.message:e).includes('DRAFT_CHANGED')?'其他裝置已更新草稿，本頁輸入保留，請重新同步後核對。':'草稿保存失敗，輸入保留，請重試。');}finally{setBusy(false);}}

 useEffect(()=>{const keep=()=>{try{localStorage.setItem(draftKey,JSON.stringify(editRef.current));return true;}catch{setError('無法暫存，請先儲存修改。');return false;}};registerLeave?.(async()=>busy?false:keep());const warn=(e:BeforeUnloadEvent)=>{if(Object.keys(editRef.current).length){keep();e.preventDefault();}};window.addEventListener('beforeunload',warn);return()=>{registerLeave?.(null);window.removeEventListener('beforeunload',warn);};},[draftKey,registerLeave,busy]);
 function updateEdits(next:Record<string,PriceSheetEdit>){setEdits(next);editRef.current=next;try{localStorage.setItem(draftKey,JSON.stringify(next));}catch{setError('無法暫存，請先儲存修改。');}}
 function edit(row?:PriceIngredient){if(!row){setTab('all');setPage(0);setCategory('');setSupplier('');setSearch('');}const key=row?.id||`new:${crypto.randomUUID()}`;updateEdits({...edits,[key]:{row,draft:priceEdit(row),requestId:crypto.randomUUID()}});}
 function change(key:string,field:string,value:string){const current=edits[key];updateEdits({...edits,[key]:{...current,requestId:crypto.randomUUID(),draft:{...current.draft,[field]:value,...(field==='unit'&&!usesPackageSpecification(value)?{specification:'',content:'',contentUnit:''}:{}),...(['price','unit','content','contentUnit','specification'].includes(field)?{reference:''}:{})}}});}
 const states=data.supply_states||[];
 const active=data.ingredients.filter(r=>!isIngredientStopped(r,states));
 const groups=baselineGroups(active);
 const reviewGroups=ingredientReviewGroups(groups);
 const editCount=Object.keys(edits).length;
 const reading=!editCount;
 const matches=(r:PriceIngredient)=>priceSearch(r,search)&&(!category||baselineCategory(r)===category)&&(!supplier||r.supplier_name===supplier||(r.sources||[]).some(s=>(s.receipt_supplier||s.supplier_name)===supplier));
 const filteredGroups=groups.filter(g=>(tab==='all'||tab==='removed'||(tab==='history'?g.history:!g.history))&&g.rows.some(matches));
 const removed=states.filter(s=>s.stopped);
 const removedRows=removed.filter(s=>{const r=data.ingredients.find(r=>r.id===s.ingredient_id);return r&&(!category||baselineCategory(r)===category)&&(!supplier||s.supplier_name===supplier)&&(priceSearch(r,search)||`${s.reason} ${s.note} ${s.supplier_name}`.includes(search));});
 const filteredReview=reviewGroups.filter(g=>g.rows.some(matches));
 const selectedGroups=filteredGroups.filter(g=>selected.includes(g.rows[0].id));
 const count=tab==='review'?filteredReview.length:tab==='removed'?removedRows.length:filteredGroups.length, pages=Math.max(1,Math.ceil(count/50)),p=Math.min(page,pages-1);
 const pageGroups=filteredGroups.slice(p*50,p*50+50);
 const visible=pageGroups.map(g=>g.rows[0]);
 const rowGroups=new Map(pageGroups.flatMap(g=>g.rows.map(r=>[r.id,g] as const)));
 const canWrite=data.can_price&&loaded&&!failed&&!busy;
 function openRecipeAlias(row:PriceIngredient,action:HTMLButtonElement,previous?:string){
  aliasReturnFocus.current=action.closest?.('.rd-row-menu')?action.closest('td')?.querySelector('button')||null:action;
  setRecipeAliasError('');
  setRecipeAlias({row,value:previous||'',previous,requestId:crypto.randomUUID()});
 }
 async function submitRecipeAlias(){
  if(!recipeAlias||!saveRecipeAlias||!canWrite||aliasSaving.current||!recipeAlias.value.trim())return;
  aliasSaving.current=true;
  setBusy(true);
  setRecipeAliasError('');
  try{
   await saveRecipeAlias(recipeAlias.row.id,recipeAlias.value,recipeAlias.previous,recipeAlias.requestId);
   setRecipeAlias(null);
   setMessage('食譜別名已儲存，可用別名搜尋。');
  }catch(e){setRecipeAliasError(e instanceof Error?e.message:'別名尚未儲存，請重試。');}
  finally{aliasSaving.current=false;setBusy(false);}
 }
 async function mergeDuplicate(row:PriceIngredient,target:PriceIngredient){
  const key=[row.id,row.revision,target.id,target.revision].join(':');
  if(mergeRequest.current?.key!==key)mergeRequest.current={key,id:crypto.randomUUID()};
  if(!window.confirm(`已核對為同一商品？將「${row.ingredient_code||row.name}」歸入「${target.ingredient_code||target.name}」。原規格與價格紀錄都會保留。`))return;
  if(await run('merge_duplicate',{id:row.id,revision:row.revision,target_id:target.id,target_revision:target.revision},mergeRequest.current.id)){
   mergeRequest.current=null;
   setMessage('已歸入主編碼，原始編碼與價格紀錄可從明細查看。');
  }
 }
 function reviewEdit(row:PriceIngredient){
  setTab('all');setPage(0);setSearch(row.ingredient_code||row.name);setCategory('');setSupplier('');
  edit(row);setMore(row.id);
 }
 async function run(action:string,payload:Record<string,unknown>,requestId=crypto.randomUUID()){setBusy(true);setError('');setMessage('');try{await save(action,payload,requestId);return true;}catch(e){setError(e instanceof Error?e.message:'尚未完成，請重試。');return false;}finally{setBusy(false);}}
 async function saveCategory(row:PriceIngredient,category:string){
  if(!canWrite||Object.keys(edits).length)return;
  const pending=categoryPending?.id===row.id&&categoryPending.category===category&&categoryPending.revision===row.revision?categoryPending:{id:row.id,category,revision:row.revision,requestId:crypto.randomUUID()};
  setCategoryPending(pending);
  if(await run('category',{id:pending.id,revision:pending.revision,category:pending.category},pending.requestId)){setCategoryPending(null);setMessage('已儲存品項分類，下次選取此品項時沿用。');}
 }
 async function saveEdits(){setBusy(true);setError('');const remaining={...edits};let done=0;try{for(const [key,e] of Object.entries(edits)){if(e.row&&JSON.stringify(e.draft)===JSON.stringify(priceEdit(e.row))){delete remaining[key];updateEdits(remaining);continue;}const payload={...ingredientSaveData(e.draft,e.row),supplier_id:e.draft.supplier_id||null,category:e.draft.category||'待分類'};await save('save',payload,e.requestId);delete remaining[key];updateEdits(remaining);done++;}if(cloudDraft&&cloudReady.current)await persistCloud(remaining);setMessage(`已儲存 ${done} 項，原有交易及鎖定食譜保留。`);}catch(e){setError(`已儲存 ${done} 項；其餘輸入保留。${e instanceof Error?e.message:''}`);}finally{setBusy(false);}}
 function stop(row:PriceIngredient,state?:SupplyState){setDecision({row,key:state?.supplier_key||'*',restore:!!state?.stopped,reason:state?.reason||'價格偏高',disposition:state?.disposition||'可重新詢價',note:'',revision:state?.revision||0,requestId:crypto.randomUUID()});}
 async function submitDecision(){if(!decision)return;const current=states.find(s=>s.ingredient_id===decision.row.id&&s.supplier_key===decision.key);if(decision.restore&&!decision.note.trim()){setError('請簡短記錄恢復採購的原因。');return;}if(await run(decision.restore?'restore':'stop',{id:decision.row.id,revision:decision.row.revision,supplier_key:decision.key,supply_revision:current?.revision||0,reason:decision.reason,disposition:decision.disposition,note:decision.note},decision.requestId)){setDecision(null);setMessage('已保存紀錄；歷次停用與恢復原因均保留。');}}
 async function confirm(row:PriceIngredient,keep=false){const q=priceCandidate(row,states);if(!q)return;const newPrice=candidatePurchase(q);if(!keep&&!window.confirm(`${row.name}：改用 ${money(newPrice.amount)}／${newPrice.unit}？新作業立即生效，既有交易及鎖定食譜不變。`))return;await run(keep?'keep':'confirm',{id:row.id,revision:row.revision,reference_id:q.id,expected_price:q.price,effective_date:new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}),change_reason:keep?'保留標準進價':'確認貨單新價'});}
 async function exportRows(){try{const x=await import('xlsx');const values=tab==='removed'?removedRows.map(s=>({食材編碼:data.ingredients.find(r=>r.id===s.ingredient_id)?.ingredient_code||'',食材:data.ingredients.find(r=>r.id===s.ingredient_id)?.name,供應商:s.supplier_name,停用原因:s.reason,處理方式:s.disposition,備註:s.note,日期:date(s.updated_at)})):filteredGroups.filter(g=>!selectedGroups.length||selected.includes(g.rows[0].id)).map(g=>g.rows[0]).map(r=>{const v=priceEdit(r);return {食材編碼:r.ingredient_code||'',識別碼:r.id,歸組名稱:baselineName(r.name),來源:ingredientSourceLabel(r),價格日期:baselinePriceDate(r),分類:baselineCategory(r),最近請購:baselinePurchaseDate(r),食材:r.name,別名:r.aliases.map(a=>a.name).join('、'),供應商:r.supplier_name||'',單位:v.unit,價格:v.price,規格:v.specification??formatPurchaseSpecification(v.content,v.contentUnit)};});const book=x.utils.book_new();x.utils.book_append_sheet(book,x.utils.json_to_sheet(values),'食材價格');x.writeFile(book,'食材價格表.xlsx');}catch{setError('匯出失敗，請重試。');}}
 async function importFiles(files:FileList|null){if(!files)return;try{const x=await import('xlsx'),next={...edits};for(const file of Array.from(files)){const book=x.read(await file.arrayBuffer());const items=x.utils.sheet_to_json<Record<string,unknown>>(book.Sheets[book.SheetNames[0]],{defval:''});for(const item of items){const name=String(item['食材']||item['食材名稱']||'').trim();if(!name)continue;const id=String(item['識別碼']||'');const row=resolveIngredientImport(data.ingredients,item); if(id&&!row)throw Error('檔案含其他門市或不存在的識別碼。');if(row&&isIngredientStopped(row,states))throw Error(`${name}已移除，請先查看停用紀錄，匯入不會自動恢復。`);const key=row?.id||`import:${name}:${String(item['單位']||'')}`;if(next[key])continue;const supplier=String(item['供應商']||'').trim();const sp=data.suppliers.find(s=>s.name===supplier);if(supplier&&!sp)throw Error(`供應商「${supplier}」尚未建立，請先至供應商管理建立。`);const importedCategory=String(item['分類']||baselineCategory(row));if(!priceCategories.includes(importedCategory))throw Error(`「${name}」分類請使用食材、耗材、調料、酒水或待分類。`);const draft={...priceEdit(row),name,category:importedCategory,unit:String(item['單位']||row?.unit||'待補單位'),price:String(item['價格']??''),reference:'',supplier_id:sp?.id||'',...(item['規格']!==undefined?{specification:String(item['規格'])}:{}),content:String(item['內容量']||''),contentUnit:String(item['內容單位']||'g')};ingredientSaveData(draft,row);next[key]={row,draft,requestId:crypto.randomUUID()};}}updateEdits(next);setTab('all');setCategory('');setSupplier('');setSearch('');setSelected([]);setPage(0);setMessage('已匯入編輯列，檢查後按儲存才會寫入。');}catch(e){setError(e instanceof Error?e.message:'無法讀取檔案。');}if(input.current)input.current.value='';}
 function editCells(key:string,e:PriceSheetEdit){return <Fragment key={key}><tr className="price-edit-row">
 <td/><td className="ingredient-code">{e.row?.canonical_code||e.row?.ingredient_code||'儲存後產生'}</td><td><input aria-label="食材名稱" value={e.draft.name} disabled={busy} onChange={v=>change(key,'name',v.target.value)}/></td>
 <td><select aria-label="食材分類" value={e.draft.category||'待分類'} disabled={busy} onChange={v=>change(key,'category',v.target.value)}>{priceCategories.map(c=><option key={c}>{c}</option>)}</select></td>
 <td><select aria-label="供應商" value={e.draft.supplier_id} disabled={busy} onChange={v=>change(key,'supplier_id',v.target.value)}><option value="">{e.row?.supplier_name||'請選擇'}</option>{data.suppliers.map(sp=><option key={sp.id} value={sp.id}>{sp.name}</option>)}</select></td>
 <td><div className="ingredient-unit-edit"><input aria-label="確認價格" type="number" min="0" step="any" placeholder="可後補" value={e.draft.price} disabled={busy} onChange={v=>change(key,'price',v.target.value)}/><span>／</span><select aria-label="進貨單位" value={e.draft.unit} disabled={busy} onChange={v=>change(key,'unit',v.target.value)}>{[...new Set([e.draft.unit,...units])].map(u=><option key={u}>{u}</option>)}</select></div><input className="ingredient-spec-input" aria-label="規格" disabled={busy||!usesPackageSpecification(e.draft.unit)} placeholder={usesPackageSpecification(e.draft.unit)?'例如：450克（可後補）':''} value={e.draft.specification??formatPurchaseSpecification(e.draft.content,e.draft.contentUnit)} onChange={v=>change(key,'specification',v.target.value)}/></td>
 <td><input aria-label="生效日期" type="date" max={new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'})} value={e.draft.effective_date||''} disabled={busy} onChange={v=>change(key,'effective_date',v.target.value)}/></td>
 <td><button disabled={busy} onClick={()=>{const next={...edits};delete next[key];updateEdits(next);}}>取消</button><button disabled={busy} aria-expanded={more===key} onClick={()=>setMore(more===key?null:key)}>{more===key?'收起':'更多'}</button></td></tr>
 {more===key&&<tr className="ingredient-inline-details"><td colSpan={8}><div className="ingredient-detail-grid"><label>調價原因<select aria-label="調價原因" disabled={busy} value={e.draft.change_reason||'供應商調價'} onChange={v=>change(key,'change_reason',v.target.value)}>{['供應商調價','蔬菜／季節價格變動','更換供應商','包裝規格變更','修正原資料','確認標準進價','其他'].map(reason=><option key={reason}>{reason}</option>)}</select></label></div></td></tr>}</Fragment>;}
 function details(row:PriceIngredient){const group=rowGroups.get(row.id);const members=group?.rows||[row];
 const receipts=ingredientReceiptPrices(members);
 const byPackage=new Map<string,typeof receipts[number]>();
 for(const receipt of receipts){
  const key=ingredientPackageKey(receipt.purchase);
  if(!byPackage.has(key))byPackage.set(key,receipt);
 }
 const standard=ingredientPurchase(row);
 const priceHistory=(data.price_history||[]).filter(v=>members.some(m=>m.id===v.ingredient_id));
 const aliases=[...new Set(members.flatMap(r=>[r.name,...r.aliases.map(a=>a.name)]).filter(n=>n!==baselineName(row.name)))];const value=priceEdit(row);return <tr className="ingredient-inline-details"><td colSpan={reading?7:8}><div className="ingredient-detail-grid"><p>食材編碼：{row.canonical_code||row.ingredient_code||'—'}</p><p>舊碼：{members.filter(m=>m.id!==row.id).map(m=>m.ingredient_code).filter(Boolean).join('、')||'無'}</p><p>正式品名：{baselineName(row.name)}</p><p>其他名稱：{aliases.join('、')||'—'}</p>{!!row.recipe_aliases?.length&&<p>食譜別名：{row.recipe_aliases.join('、')}</p>}<p>包裝規格：{formatPurchaseSpecification(value.content,value.contentUnit)||value.unit}</p>{data.can_price&&<div className="ingredient-category-control"><label>品項分類<select aria-label={`${baselineName(row.name)}的品項分類`} disabled={!canWrite||Object.keys(edits).length>0} value={categoryPending?.id===row.id?categoryPending.category:baselineCategory(row)} onChange={e=>void saveCategory(row,e.target.value)}><option value="待分類">未分類</option>{['食材','酒水','耗材',...(baselineCategory(row)==='調料'?['調料']:[])].map(c=><option key={c}>{c}</option>)}</select></label>{categoryPending?.id===row.id&&!busy&&<><button disabled={!canWrite} onClick={()=>void saveCategory(row,categoryPending.category)}>重試儲存分類</button><button disabled={busy} onClick={()=>{setCategoryPending(null);setError('');}}>取消</button></>}<small>{categoryPending?.id===row.id&&busy?'儲存分類中…':'下次選取此品項時沿用'}</small></div>}</div>{data.can_price&&<div className="ingredient-detail-edit"><button disabled={!canWrite} onClick={()=>{edit(row);setMore(row.id);}}>編輯資料</button></div>}
 {priceCandidate(row,states)&&<p className="ingredient-change-note">有新進價可核對。{data.can_price&&<><button disabled={!canWrite} onClick={()=>void confirm(row)}>核對新價</button><button disabled={!canWrite} onClick={()=>void confirm(row,true)}>保留目前價格</button></>}</p>}
 <p><strong>標準價</strong>　{row.review_status==='confirmed'&&row.cost_price!==null?`${money(standard?.amount??row.cost_price)}／${standard?.unit||row.unit}`:'待確認'} <small>{date(baselinePriceDate(row))}</small></p>
 {byPackage.size>0&&<section className="ingredient-purchase-details"><h3>各規格最新未稅進價</h3><table><thead><tr><th>規格</th><th>供應商／日期</th><th>未稅進價</th><th>換算單價</th></tr></thead><tbody>{[...byPackage.values()].map(r=>{
  const converted=ingredientPerBaseUnit(r.purchase);
  return <tr key={r.id}><td>{ingredientPackageLabel(r.purchase)}</td><td>{r.supplier||'—'} · {date(r.date)}</td><td>{money(r.purchase.amount)}／{r.purchase.unit}</td><td>{converted?`${money(converted.price)}／${converted.label}`:'—'}</td></tr>;
 })}</tbody></table></section>}
 {receipts.length>0&&<details className="ingredient-purchase-details"><summary>已核對進貨紀錄（{receipts.length}）</summary><table><thead><tr><th>日期</th><th>供應商</th><th>規格</th><th>未稅進價</th></tr></thead><tbody>{receipts.map(r=><tr key={r.id}><td>{date(r.date)}</td><td>{r.supplier||'—'}</td><td>{ingredientPackageLabel(r.purchase)}</td><td>{money(r.purchase.amount)}／{r.purchase.unit}</td></tr>)}</tbody></table></details>}
 {priceHistory.length>0&&<details><summary>標準價異動（{priceHistory.length}）</summary>{priceHistory.map(v=>{const p=ingredientPurchase(v.snapshot);return <p key={v.id}>{date(v.effective_date)} · {money(p?.amount??v.snapshot.cost_price)||'待補價格'}／{p?.unit||v.snapshot.unit} · {v.reason}</p>;})}</details>}

 {members.length>1&&<details><summary>同名原始紀錄（{members.length}）</summary>{members.map(m=><p key={m.id}>{m.ingredient_code} · {m.name} · {date(baselinePriceDate(m))||'日期未填'} · {money(ingredientPurchase(m)?.amount??m.cost_price)}／{ingredientPurchase(m)?.unit||m.unit} {data.can_price&&!m.canonical_ingredient_id&&<button disabled={!canWrite} onClick={()=>{edit(m);setMore(m.id);}}>編輯此紀錄</button>}</p>)}</details>}
 {data.can_price&&members.some(m=>m.aliases.length)&&<details><summary>整理別名</summary>{members.flatMap(m=>m.aliases.map(a=><label className="ingredient-alias-edit" key={a.id}>{a.name}<select aria-label={`調整 ${a.name} 歸屬`} value={aliasTarget[a.id]||''} onChange={e=>setAliasTarget({...aliasTarget,[a.id]:e.target.value})}><option value="">選擇其他食材</option>{data.ingredients.filter(r=>r.id!==m.id&&r.unit===a.unit&&!isIngredientStopped(r,states)).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select><button disabled={!canWrite||!aliasTarget[a.id]} onClick={async()=>{const to=data.ingredients.find(r=>r.id===aliasTarget[a.id])!;if(await run('alias',{id:m.id,revision:m.revision,alias_id:a.id,target_id:to.id,target_revision:to.revision}))setMore(null);}}>確認歸屬</button></label>))}</details>}

 <p>停供、恢復與替代品請至「供應紀錄」管理。</p></td></tr>;}
 function switchTab(value:string){setTab(value);setPage(0);setSelected([]);setMore(null);}
 const canEditList=tab!=='removed'&&tab!=='review'&&data.can_price;
 const canExportList=canExport&&tab!=='review';
 return <section className="ingredient-price-sheet ingredient-baseline" aria-label="食材價格">
 <div className="price-sheet-controls">
  <nav className="price-sheet-tabs" aria-label="食材範圍">{[['common','常用食材'],['history','歷史食材'],['all','全部'],['review',loaded?`待確認 ${reviewGroups.length}`:'待確認']].map(([value,label])=><button key={value} disabled={busy} aria-pressed={tab===value} onClick={()=>switchTab(value)}>{label}</button>)}</nav>
  <div className="price-baseline-actions">
   {(canEditList||canExportList)&&<RecipeRowMenu label="更多食材價格表操作" triggerText="更多 ⌄">
    {canEditList&&<>
     <button type="button" disabled={!canWrite} onClick={()=>{const next={...edits};for(const r of (selectedGroups.length?selectedGroups:filteredGroups).map(g=>g.rows[0]))if(!next[r.id])next[r.id]={row:r,draft:priceEdit(r),requestId:crypto.randomUUID()};updateEdits(next);}}>{selectedGroups.length?'編輯所選':'編輯全部'}</button>
     <button type="button" disabled={!canWrite} onClick={()=>input.current?.click()}>匯入</button>
    </>}
    {canExportList&&<button type="button" disabled={!loaded||failed||busy||tab!=='removed'&&!filteredGroups.length} onClick={()=>void exportRows()}>匯出</button>}
   </RecipeRowMenu>}
   {canEditList&&<><button type="button" className="price-add" disabled={!canWrite} onClick={()=>edit()}>新增食材</button><input ref={input} hidden type="file" multiple accept=".xlsx,.xls,.csv" onChange={e=>void importFiles(e.target.files)}/></>}
  </div>
 </div>
 <div className="price-baseline-filters">
  <input type="search" aria-label="搜尋編碼、食材、別名、供應商" placeholder="搜尋編碼、品名、別名…" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);setSelected([]);}}/>
  <select aria-label="篩選分類" value={category} disabled={busy} onChange={e=>{setCategory(e.target.value);setPage(0);setSelected([]);}}><option value="">全部分類</option>{priceCategories.map(c=><option key={c}>{c}</option>)}</select>
  <select aria-label="篩選供應商" value={supplier} disabled={busy} onChange={e=>{setSupplier(e.target.value);setPage(0);setSelected([]);}}><option value="">全部供應商</option>{[...new Set(data.ingredients.map(r=>r.supplier_name).filter(Boolean))].sort().map(name=><option key={name}>{name}</option>)}</select>
 </div>
 {tab==='removed'&&<p>已停用紀錄 <button onClick={()=>switchTab('common')}>返回食材表</button></p>}
 {recovery&&<div role="status">有尚未儲存的修改。<button disabled={!canWrite} onClick={()=>{updateEdits(recovery);setRecovery(null);setTab('all');setCategory('');setSupplier('');setSearch('');setPage(0);}}>恢復草稿</button><button onClick={()=>void discardEdits()}>捨棄</button></div>}
 {error&&<p role="alert" className="price-sheet-error">{error}</p>}{message&&<p role="status">{message}</p>}
 {!loaded?(failed&&!syncing?null:<p role="status">讀取食材價格…</p>):tab==='review'?<div className="ingredient-review-list">
 {filteredReview.slice(p*50,p*50+50).map(g=>{
  const target=g.rows.find(r=>r.id===mergeTarget[g.key])||g.rows[0];
  return <section className="ingredient-review-group" key={g.key}><header><h2>{g.name}</h2><small>{g.missing?'包裝內容量待確認':'同名有不同品項或規格'}</small></header>
   {g.rows.length>1&&data.can_price&&<label className="ingredient-review-target">保留的主檔 <select value={target.id} onChange={e=>setMergeTarget(old=>({...old,[g.key]:e.target.value}))}>{g.rows.map(r=><option key={r.id} value={r.id}>{r.ingredient_code||r.name}</option>)}</select></label>}
   <div className="ingredient-review-compare">{g.rows.map(r=>{
    const price=priceEdit(r),purchase=ingredientPurchase(r);
    const canMerge=target.id!==r.id&&ingredientPackageKey({unit:purchase?.unit||r.unit})===ingredientPackageKey({unit:ingredientPurchase(target)?.unit||target.unit});
    return <article key={r.id}><strong>{r.id===target.id&&g.rows.length>1?'主檔 · ':''}{r.ingredient_code||'—'}</strong>
     <span>{baselineName(r.name)}</span><span>{r.supplier_name||'供應商未填'} · {ingredientPackageLabel(purchase||{unit:price.unit})}</span>
     <span>{price.price===''?'價格未填':`${money(Number(price.price))}／${price.unit}`}{baselinePriceDate(r)?` · ${date(baselinePriceDate(r))}`:''}</span>
     {data.can_price&&<div><button disabled={!canWrite} onClick={()=>reviewEdit(r)}>補規格</button>{canMerge&&<button disabled={!canWrite||!!editCount} onClick={()=>void mergeDuplicate(r,target)}>確認同商品並合併</button>}</div>}
    </article>;
   })}</div></section>;
 })}
 {!filteredReview.length&&<p className="price-empty">沒有符合的待確認品項。</p>}
 </div>:<div className="price-sheet-scroll"><table className={tab==='removed'?'price-removed-table':`price-baseline-table${reading?' price-baseline-reading':''}`}><thead>{tab==='removed'?<tr><th>食材名稱</th><th>供應商／範圍</th><th>停用原因</th><th>操作</th></tr>:<tr><th><input type="checkbox" aria-label="選取本頁食材" checked={visible.length>0&&visible.every(r=>selected.includes(r.id))} onChange={e=>setSelected(e.target.checked?[...new Set([...selected,...visible.map(r=>r.id)])]:selected.filter(id=>!visible.some(r=>r.id===id)))}/></th><th>編碼</th><th>供應商品名／食譜名稱</th><th>分類</th>{!reading&&<th>供應商</th>}<th className={reading?'ingredient-latest-head':undefined}>{reading?'最新未稅進價':'標準價'}</th>{reading?<th className="ingredient-price-source">供應商／日期</th>:<th>價格日期</th>}<th>操作</th></tr>}</thead><tbody>
 {tab==='removed'?removedRows.slice(p*50,p*50+50).map(st=>{const row=data.ingredients.find(r=>r.id===st.ingredient_id)!;return <tr key={`${row.id}:${st.supplier_key}`}><td>{baselineName(row.name)}</td><td>{st.supplier_name||'整項食材'}</td><td>{st.reason}<small>{st.note}</small></td><td>{data.can_price&&<button disabled={!canWrite} onClick={()=>stop(row,st)}>恢復</button>}</td></tr>;}):<>
 {Object.entries(edits).filter(([,e])=>!e.row||(!groups.some(g=>g.rows[0].id===e.row?.id)&&pageGroups.some(g=>g.rows.some(r=>r.id===e.row?.id)))).map(([key,e])=>editCells(key,e))}
 {visible.map(row=>{if(edits[row.id])return editCells(row.id,edits[row.id]);const v=priceEdit(row),purchase=ingredientPurchase(row);
 const receipts=ingredientReceiptPrices(rowGroups.get(row.id)?.rows||[row],supplier);
 const latest=receipts[0];
 const packageCount=new Set(receipts.map(r=>ingredientPackageKey(r.purchase))).size;
 const spec=ingredientPackageLabel(latest?.purchase||purchase||{unit:v.unit});
 const label=latest?null:row.review_status==='confirmed'&&row.manual?'標準價':v.price===''?'待補價格':'參考價';
 const amount=latest?money(latest.purchase.amount):v.price===''?'—':money(Number(v.price));
 const unit=latest?.purchase.unit||v.unit;
 const supplierName=latest?.supplier||row.supplier_name;
 const priceDate=date(latest?.date||(v.price===''?'':baselinePriceDate(row)));
 const sourceNote=[priceDate,label].filter(Boolean).join(' · ');
 return <Fragment key={row.id}><tr className="ingredient-baseline-row">
 <td><input type="checkbox" aria-label={`選取 ${baselineName(row.name)}`} checked={selected.includes(row.id)} onChange={e=>setSelected(old=>e.target.checked?[...old,row.id]:old.filter(id=>id!==row.id))}/></td>
 <td className="ingredient-code">{row.canonical_code||row.ingredient_code||'—'}</td><td><strong className="ingredient-primary-name" title={baselineName(row.name)}>{baselineName(row.name)}</strong><div className="ingredient-recipe-name"><small>食譜名稱：{row.recipe_aliases?.join('、')||'尚未設定'}</small>{data.can_price&&saveRecipeAlias&&<button type="button" className="ingredient-name-edit" aria-label={`編輯 ${baselineName(row.name)} 的食譜名稱`} disabled={!canWrite} onClick={event=>openRecipeAlias(row,event.currentTarget,row.recipe_aliases?.[0])}>編輯</button>}</div><small className="price-package">{spec}{packageCount>1?` · 另有 ${packageCount-1} 種規格`:''}</small></td><td className="ingredient-price-category">{baselineCategory(row)==='待分類'?'—':baselineCategory(row)}</td>{!reading&&<td>{row.supplier_name||''}</td>}
 <td className={reading?'price-number ingredient-latest-price':'price-number'}>
  <strong>{amount}</strong>{amount!=='—'&&<span className="ingredient-price-unit">／{unit}</span>}
  {!reading&&<small className="price-package">{[label,supplierName,priceDate].filter(Boolean).join(' · ')}</small>}
  {reading&&<small className="ingredient-price-mobile-source">{[supplierName,sourceNote].filter(Boolean).join(' · ')}</small>}
 </td>
 {reading?<td className="ingredient-price-source" title={[supplierName,sourceNote].filter(Boolean).join(' · ')}>
  <span>{supplierName||'—'}</span>{sourceNote&&<small>{sourceNote}</small>}
 </td>:<td>{date(baselinePriceDate(row))}</td>}<td><div className="ingredient-row-actions">{data.can_price&&<button type="button" disabled={!canWrite} onClick={()=>edit(row)}>編輯</button>}<RecipeRowMenu label={`${baselineName(row.name)} 的操作`}>
 <button type="button" aria-expanded={more===row.id} onClick={()=>setMore(more===row.id?null:row.id)}>{more===row.id?'收起':'明細'} {more===row.id?'⌃':'⌄'}</button>
 {data.can_price&&saveRecipeAlias&&<><button type="button" disabled={!canWrite} onClick={event=>openRecipeAlias(row,event.currentTarget)}>加入食譜別名</button>{(row.recipe_aliases||[]).map(alias=><button type="button" key={alias} disabled={!canWrite} onClick={event=>openRecipeAlias(row,event.currentTarget,alias)}>編輯別名 · {alias}</button>)}</>}
 </RecipeRowMenu></div></td></tr>{more===row.id&&details(row)}</Fragment>;})}</>}
 </tbody></table>{count===0&&!Object.keys(edits).length&&<p className="price-empty">沒有符合的食材。可切換「全部」或調整篩選條件。</p>}</div>}
 {tab!=='review'&&<p className="price-baseline-note">叫貨請使用供應商品名；食譜名稱供廚房辨識，原有別名保留。各規格與歷史價格可在明細查看。</p>}

 {loaded&&<footer className="price-sheet-pagination"><span>{count} 項 · 每頁 50 項</span><button disabled={p===0} onClick={()=>setPage(p-1)}>上一頁</button><span>{p+1}／{pages}</span><button disabled={p+1>=pages} onClick={()=>setPage(p+1)}>下一頁</button></footer>}
 {Object.keys(edits).length>0&&<div className="price-sheet-save"><span>編輯中 {Object.keys(edits).length} 項 · 缺價可先儲存</span><button disabled={busy} onClick={()=>void discardEdits()}>取消編輯</button>{cloudDraft&&<button disabled={!canWrite} onClick={()=>void keepCloud()}>保存草稿</button>}<button disabled={!canWrite} onClick={()=>void saveEdits()}>{busy?'儲存中…':'儲存修改'}</button></div>}
 {recipeAlias&&<RecipeModal title={recipeAlias.previous?'編輯食譜別名':'加入食譜別名'} className="ingredient-recipe-alias-modal" busy={busy} returnFocus={aliasReturnFocus} onClose={()=>setRecipeAlias(null)}>
  <form className="ingredient-recipe-alias-form" onSubmit={event=>{event.preventDefault();void submitRecipeAlias();}}>
   <div className="ingredient-alias-identity"><strong>{baselineName(recipeAlias.row.name)}</strong><small>{[ingredientPackageLabel(ingredientPurchase(recipeAlias.row)||{unit:recipeAlias.row.unit}),recipeAlias.row.canonical_code||recipeAlias.row.ingredient_code].filter(Boolean).join(' · ')}</small></div>
   <label>食譜別名<input data-initial-focus value={recipeAlias.value} maxLength={160} required disabled={busy} placeholder="輸入廚房使用的名稱" onChange={event=>setRecipeAlias({...recipeAlias,value:event.target.value,requestId:crypto.randomUUID()})}/></label>
   {recipeAliasError&&<p className="price-sheet-error" role="alert">{recipeAliasError}</p>}
   <footer><button type="button" disabled={busy} onClick={()=>setRecipeAlias(null)}>取消</button><button type="submit" className="price-add" disabled={!canWrite||!recipeAlias.value.trim()}>{busy?'儲存中…':'儲存'}</button></footer>
  </form>
 </RecipeModal>}
 {decision&&<div className="price-sheet-dialog" role="dialog" aria-modal="true" aria-label="停用與恢復紀錄"><div><button className="close" disabled={busy} onClick={()=>setDecision(null)}>關閉</button><h2>{decision.restore?'恢復使用':'停用並保留紀錄'} · {decision.row.name}</h2><label>處理範圍<select disabled={decision.restore||busy} value={decision.key} onChange={e=>setDecision({...decision,key:e.target.value,requestId:crypto.randomUUID()})}><option value="*">整項食材暫停使用</option>{supplierOptions(decision.row).map(s=><option key={s.key} value={s.key}>僅停用 {s.name} 的此項供貨</option>)}{!supplierOptions(decision.row).some(s=>s.key===decision.key)&&decision.key!=='*'&&<option value={decision.key}>{states.find(s=>s.ingredient_id===decision.row.id&&s.supplier_key===decision.key)?.supplier_name}</option>}</select></label>
 {!decision.restore?<><label>停用原因<select value={decision.reason} onChange={e=>setDecision({...decision,reason:e.target.value,requestId:crypto.randomUUID()})}>{reasons.map(r=><option key={r}>{r}</option>)}</select></label><label>日後採購建議<select value={decision.disposition} onChange={e=>setDecision({...decision,disposition:e.target.value,requestId:crypto.randomUUID()})}>{['不建議再採購','可重新詢價','暫停使用'].map(r=><option key={r}>{r}</option>)}</select></label></>:<p className="price-sheet-error">先前原因：{decision.reason} · {decision.disposition}。恢復後仍保留此紀錄。</p>}
 <label>{decision.restore?'恢復原因':'補充實際情況（可後補）'}<textarea maxLength={3000} value={decision.note} onChange={e=>setDecision({...decision,note:e.target.value,requestId:crypto.randomUUID()})} placeholder={decision.restore?'例如：已重新試用，品質確認穩定':'例如：連續兩批品質不穩，已改向其他廠商採購'}/></label><p>原有進貨、庫存、調撥、廢棄與食譜紀錄保留。</p>{error&&<p role="alert" className="price-sheet-error">{error}</p>}<button disabled={!canWrite} onClick={()=>void submitDecision()}>{busy?'儲存中…':decision.restore?'確認恢復並留紀錄':'確認停用並留紀錄'}</button></div></div>}
 </section>;
}
