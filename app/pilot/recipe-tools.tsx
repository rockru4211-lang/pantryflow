'use client';
import {useEffect,useRef,useState} from 'react';
import {Download,Printer} from 'lucide-react';
import {appError,parseAppContext,readWorkspace,writeOperation,type AppStore} from '@/lib/app-workspace';
import {supabase} from '@/lib/supabase-browser';
import {recipeDisplayName,type RecipeWorkspace} from '@/lib/recipe-cost';
import {exportRecipeWorkbook,openRecipePrint,recipeExportEntries} from '@/lib/recipe-export';
import RecipeModal from './recipe-modal';
type Plan={token:string;source_name:string;target_name:string;recipes:{id:string;name:string;revision:number;mode:'move'|'copy'}[];duplicate_names:string[]};
type Props={mode:'export'|'transfer';store:AppStore;userId:string;onClose:()=>void;onMoved:(ids:string[])=>void};
function explain(error:unknown){const raw=error&&typeof error==='object'&&'message' in error?String(error.message):String(error);if(/RECIPE_TRANSFER_CHANGED|REVISION_CONFLICT/.test(raw))return '食譜已更新，請重新按「儲存」。';if(/RECIPE_SHARED_MAIN/.test(raw))return '這份主食譜被其他食譜引用，請先確認引用關係，避免影響原門市。';if(/RECIPE_MAIN_REQUIRED/.test(raw))return '食譜可能已移轉，請關閉視窗重新同步。';if(/INVALID_RECIPE_REFERENCE/.test(raw))return '附屬配方有缺漏，請先補齊配方對應再移轉。';return /[\u3400-\u9fff]/.test(raw)?raw:appError(error);}
export default function RecipeTools({mode,store,userId,onClose,onMoved}:Props){
 const [workspace,setWorkspace]=useState<RecipeWorkspace|null>(null),[stores,setStores]=useState<AppStore[]>([]),[selected,setSelected]=useState<string[]>([]),[target,setTarget]=useState(''),[cost,setCost]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[plan,setPlan]=useState<Plan|null>(null);
 const [loadAttempt,setLoadAttempt]=useState(0);
 const flight=useRef(false),mounted=useRef(true),request=useRef<{encoded:string;id:string}|null>(null);
 useEffect(()=>{let alive=true;mounted.current=true;setError('');void (async()=>{try{const data=await readWorkspace<RecipeWorkspace>(store.id,'recipes.saved');if(!alive)return;setWorkspace(data);setSelected(data.recipes.filter(r=>r.document.kind==='dish').map(r=>r.id).slice(0,mode==='transfer'?1:undefined));if(mode==='transfer'){const context=await supabase.rpc('get_app_context');if(context.error)throw context.error;const options=parseAppContext(context.data).stores.filter(s=>s.id!==store.id&&s.organization_id===store.organization_id&&s.is_active!==false&&s.access_mode!=='VIEW'&&['OWNER','LOGISTICS'].includes(s.role));if(alive){setStores(options);setTarget(options[0]?.id||'');}}}catch(e){if(alive)setError(explain(e));}})();return()=>{alive=false;mounted.current=false;};},[mode,store.id,store.organization_id,loadAttempt]);
 const dishes=workspace?.recipes.filter(card=>card.document.kind==='dish')||[],entries=workspace?recipeExportEntries(workspace,selected):[];
 function changeSelected(ids:string[]){setSelected(ids);setPlan(null);setError('');request.current=null;}
 async function transfer(){
  if(flight.current||!target||selected.length!==1)return;flight.current=true;setBusy(true);setError('');
  try{
   const confirmedPlan=plan||await readWorkspace<Plan>(store.id,'recipe.transfer',{id:selected[0],target_store_id:target});
   if(!mounted.current)return;
   setPlan(confirmedPlan);
   const data={id:selected[0],target_store_id:target,token:confirmedPlan.token},encoded=JSON.stringify(data),key=`recipe-transfer:${userId}:${store.id}`;
   if(request.current?.encoded!==encoded){let saved:null|{encoded:string;id:string}=null;try{saved=JSON.parse(sessionStorage.getItem(key)||'null');}catch{/* A fresh request still has server-side revision protection. */}request.current=saved?.encoded===encoded?saved:{encoded,id:crypto.randomUUID()};try{sessionStorage.setItem(key,JSON.stringify(request.current));}catch{/* In-memory retry remains available. */}}
   const result=await writeOperation<{moved_ids:string[]}>(store.id,'recipe.transfer',data,request.current.id);
   try{sessionStorage.removeItem(key);}catch{/* Confirmed response is authoritative. */}
   if(mounted.current)onMoved(result.moved_ids);
  }catch(e){if(mounted.current){setError(explain(e));if(/RECIPE_TRANSFER_CHANGED|REVISION_CONFLICT/.test(String((e as {message?:string})?.message))){setPlan(null);request.current=null;}}}finally{flight.current=false;if(mounted.current)setBusy(false);}
 }
 async function excel(){if(flight.current||!workspace)return;flight.current=true;setBusy(true);setError('');try{await exportRecipeWorkbook(store.name,workspace,selected,cost);}catch(e){setError(explain(e));}finally{flight.current=false;setBusy(false);}}
 return <RecipeModal title={mode==='export'?'匯出食譜':'更換門市'} busy={busy} onClose={onClose}><div className="recipe-tools-panel">
  <p>目前門市：<strong>{store.name}</strong></p>{error&&<p className="recipe-alert" role="alert">{error}</p>}
  {!workspace?(error?<button className="recipe-secondary" onClick={()=>setLoadAttempt(n=>n+1)}>重新讀取</button>:<p role="status">讀取食譜…</p>):!dishes.length?<p>此門市尚無主食譜。請先建立並儲存食譜。</p>:<>
   {mode==='export'?<><div className="recipe-tools-select-all"><label><input type="checkbox" checked={selected.length===dishes.length} disabled={busy} onChange={e=>changeSelected(e.target.checked?dishes.map(r=>r.id):[])}/>全選主食譜</label><span>{selected.length} 份已選取</span></div><div className="recipe-tools-choices">{dishes.map(card=><label key={card.id}><input type="checkbox" disabled={busy} checked={selected.includes(card.id)} onChange={e=>changeSelected(e.target.checked?[...selected,card.id]:selected.filter(id=>id!==card.id))}/><span>{recipeDisplayName(card.document)}</span></label>)}</div><p className="recipe-muted">附屬配方一併匯出，共 {entries.length} 份配方；共用配方只列一次。</p><label className="recipe-tools-check"><input type="checkbox" checked={cost} disabled={busy} onChange={e=>setCost(e.target.checked)}/>包含成本、價格來源與待補項目</label><p className="recipe-muted">保留門市、實際用量、單位與備註。未完整的成本不以零元代替。</p><div className="recipe-tools-actions"><button className="shell-primary" disabled={busy||!selected.length} onClick={()=>void excel()}><Download size={16}/>{busy?'匯出中…':'匯出 Excel'}</button><button className="recipe-secondary" disabled={busy||!selected.length} onClick={()=>{try{openRecipePrint(store.name,workspace,selected,cost);}catch(e){setError(explain(e));}}}><Printer size={16}/>列印／另存 PDF</button></div><small>PDF：開啟列印版後，按「列印／另存 PDF」，將目的地選為「另存為 PDF」。</small></>:<>
    <label className="recipe-tools-field">食譜<select value={selected[0]||''} disabled={busy} onChange={e=>changeSelected([e.target.value])}>{dishes.map(card=><option value={card.id} key={card.id}>{recipeDisplayName(card.document)}</option>)}</select></label>
    <label className="recipe-tools-field">改至門市<select value={target} disabled={busy||!stores.length} onChange={e=>{setTarget(e.target.value);setPlan(null);request.current=null;}}>{!stores.length&&<option value="">沒有可移轉的其他門市</option>}{stores.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
    <p className="recipe-muted">整份食譜與已存成本一起移動。</p>
    <div className="recipe-tools-actions"><button className="shell-primary" disabled={busy||!target||selected.length!==1} onClick={()=>void transfer()}>{busy?'儲存中…':'儲存'}</button></div>
   </>}
  </>}
 </div></RecipeModal>;
}
