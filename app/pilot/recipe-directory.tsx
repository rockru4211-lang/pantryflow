'use client';
import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {ChevronDown,Plus,Search} from 'lucide-react';
import {supabase} from '@/lib/supabase-browser';
import {appError,type AppStore} from '@/lib/app-workspace';
import type {Json} from '@/lib/database.types';
import {recipeDisplayName,type RecipeCard} from '@/lib/recipe-model';
import {lifecycleLabels,menuStateLabels,recipeCategory,recipeDirectoryMatches,recipeLifecycle,type RecipeLifecycle,type RecipeMenu} from '@/lib/recipe-organization';
import {recipeMoney} from './recipe-editor';
import './recipe-directory.css';
type Props={initialSearch?:string;store:AppStore;recipes:RecipeCard[];loaded:boolean;actions:ReactNode;onNew:()=>void;onOpen:(card:RecipeCard)=>void;reload:()=>Promise<unknown>;beforeUpdate:(ids:string[])=>boolean};
export default function RecipeDirectory({initialSearch,store,recipes,loaded,actions,onNew,onOpen,reload,beforeUpdate}:Props){
 const [menus,setMenus]=useState<RecipeMenu[]>([]),[menusReady,setMenusReady]=useState(false);
 const [search,setSearch]=useState(initialSearch||''),[category,setCategory]=useState(''),[menuFilter,setMenuFilter]=useState(''),[kind,setKind]=useState('dish');
 const [status,setStatus]=useState<RecipeLifecycle|'all'>('all'),[expanded,setExpanded]=useState(''),[selected,setSelected]=useState<string[]>([]);
 const [editing,setEditing]=useState(''),[editCategory,setEditCategory]=useState(''),[editStatus,setEditStatus]=useState('');
 const [batch,setBatch]=useState(false),[batchCategory,setBatchCategory]=useState(''),[batchStatus,setBatchStatus]=useState(''),[batchMenu,setBatchMenu]=useState('');
 const [showMenus,setShowMenus]=useState(false),[menuName,setMenuName]=useState(''),[editingMenu,setEditingMenu]=useState<RecipeMenu|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const working=useRef(false),requests=useRef(new Map<string,string>()),newMenuId=useRef('');
 const editable=store.role!=='STAFF'&&store.access_mode!=='VIEW';
 const loadMenus=useCallback(async()=>{const {data,error}=await supabase.rpc('recipe_organization',{p_store_id:store.id});if(error)throw error;setMenus((data as unknown as {menus:RecipeMenu[]}).menus);setMenusReady(true);},[store.id]);
 useEffect(()=>{let active=true;const read=()=>{if(active&&!working.current)void loadMenus().catch(e=>{if(active)setError(appError(e));});};read();window.addEventListener('focus',read);const timer=setInterval(read,30000);return()=>{active=false;window.removeEventListener('focus',read);clearInterval(timer);};},[loadMenus]);
 async function run(action:string,payload:Record<string,unknown>,success:string,after?:(result:Record<string,unknown>)=>void){
  if(working.current)return;working.current=true;setBusy(true);setError('');setNotice('');
  const key=JSON.stringify([action,payload]);let request=requests.current.get(key);if(!request){request=crypto.randomUUID();requests.current.set(key,request);}
  try{
   const {data,error}=await supabase.rpc('recipe_organization',{p_store_id:store.id,p_action:action,p_data:payload as Json,p_request_id:request}).abortSignal(AbortSignal.timeout(20000));
   if(error)throw error;
   // Keep the same request token until both mutation and refresh are acknowledged.
   await Promise.all([reload(),loadMenus()]);requests.current.delete(key);setNotice(success);after?.(data as Record<string,unknown>);
  }catch(e){setError(appError(e));}finally{working.current=false;setBusy(false);}
 }
 const categories=[...new Set(recipes.map(r=>recipeCategory(r.document)))].sort((a,b)=>a.localeCompare(b,'zh-TW'));
 const base=recipes.filter(r=>r.document.kind===kind);
 const visible=base.filter(r=>(status==='all'||recipeLifecycle(r.document,menus)===status)&&(!category||recipeCategory(r.document)===category)&&(!menuFilter||r.document.menu_ids?.includes(menuFilter))&&recipeDirectoryMatches(r,recipes,search));
 const picked=recipes.filter(r=>selected.includes(r.id));
 const ready=editable&&loaded&&menusReady&&!busy;
 function selectAll(){setSelected(current=>visible.every(r=>current.includes(r.id))?current.filter(id=>!visible.some(r=>r.id===id)):[...new Set([...current,...visible.map(r=>r.id)])]);}
 function update(cards:RecipeCard[],patch:Record<string,string>,extra:Record<string,string>={}){
  if(!cards.length){setError('請先勾選食譜。');return;}
  if(!beforeUpdate(cards.map(c=>c.id))){setError('選取的食譜有編輯中的草稿，請先儲存或完成編輯，再修改分類。');return;}
  void run('update',{rows:cards.map(c=>({id:c.id,revision:c.revision})),patch,...extra},`已更新 ${cards.length} 筆食譜，原成本保留。`,()=>{setEditing('');setBatch(false);setSelected([]);});
 }
 function edit(card:RecipeCard){setEditing(card.id);setEditCategory(recipeCategory(card.document));setEditStatus(card.document.lifecycle||'unset');}
 function saveMenu(menu?:RecipeMenu,state?:RecipeMenu['state']){
  const name=menu?menu.name:menuName.trim();if(!name){setError('請填寫菜單名稱。');return;}
  if(!newMenuId.current)newMenuId.current=crypto.randomUUID();
  void run('menu_save',{id:menu?.id||editingMenu?.id||newMenuId.current,revision:menu?.revision||editingMenu?.revision||0,name,state:state||editingMenu?.state||'draft'},'菜單已儲存。',()=>{setMenuName('');setEditingMenu(null);newMenuId.current='';});
 }
 return <section className="recipe-directory" aria-label="食譜分類與菜單管理">
  <header className="rd-heading"><div><h1>食譜管理</h1><small>{store.name} · 分類、菜單與歷史食譜</small></div><button className="recipe-secondary" onClick={()=>setShowMenus(!showMenus)}>菜單管理<ChevronDown size={15}/></button></header>
  {error&&<p role="alert" className="recipe-alert">{error} {!menusReady&&<button className="text-button" onClick={()=>void loadMenus().catch(e=>setError(appError(e)))}>重新讀取</button>}</p>}
  {notice&&<p role="status" className="recipe-save-success">{notice}</p>}
  {showMenus&&<section className="rd-menu-manager" aria-label="季節菜單"><div className="rd-menu-form"><input aria-label="菜單名稱" placeholder="菜單名稱，例如 2026 秋冬、商業午餐" value={menuName} maxLength={100} onChange={e=>setMenuName(e.target.value)}/><button className="recipe-secondary" disabled={!ready} onClick={()=>saveMenu()}>{editingMenu?'儲存名稱':'新增菜單'}</button>{editingMenu&&<button className="text-button" onClick={()=>{setEditingMenu(null);setMenuName('');}}>取消</button>}</div>{!menus.length&&<p className="recipe-muted">尚未建立菜單。可先整理分類，之後再加入季節菜單。</p>}{menus.map(m=><div className="rd-menu-row" key={m.id}><strong>{m.name}</strong><span>{menuStateLabels[m.state]}</span><small>{base.filter(r=>r.document.menu_ids?.includes(m.id)).length} 份{kind==='dish'?'主食譜':'配件'}</small><button className="text-button" disabled={!ready} onClick={()=>{setEditingMenu(m);setMenuName(m.name);}}>改名</button>{m.state!=='active'&&<button className="text-button" disabled={!ready} onClick={()=>saveMenu(m,'active')}>{m.state==='closed'?'重新供應':'開始供應'}</button>}{m.state==='active'&&<button className="text-button" disabled={!ready} onClick={()=>saveMenu(m,'closed')}>結束菜單</button>}</div>)}<small>結束菜單後保留紀錄；仍在其他供應中菜單的食譜會繼續顯示供應中。</small></section>}
  <nav className="rd-status-tabs" aria-label="食譜供應狀態">{(['all','serving','research','archived','unset'] as const).map(s=><button key={s} aria-pressed={status===s} onClick={()=>{setStatus(s);setSelected([]);}}>{s==='all'?'全部食譜':lifecycleLabels[s]}<small>{base.filter(r=>s==='all'||recipeLifecycle(r.document,menus)===s).length}</small></button>)}</nav>
  <div className="rd-toolbar"><label className="recipe-search"><Search size={17}/><input aria-label="搜尋菜名或食材" placeholder="搜尋菜名、食材或配件" value={search} onChange={e=>setSearch(e.target.value)}/></label><select aria-label="篩選分類" value={category} onChange={e=>setCategory(e.target.value)}><option value="">全部分類</option>{categories.map(c=><option key={c}>{c}</option>)}</select><select aria-label="篩選菜單" value={menuFilter} onChange={e=>setMenuFilter(e.target.value)}><option value="">全部菜單</option>{menus.map(m=><option key={m.id} value={m.id}>{m.name} · {menuStateLabels[m.state]}</option>)}</select><select aria-label="食譜類型" value={kind} onChange={e=>{setKind(e.target.value);setSelected([]);}}><option value="dish">主食譜</option><option value="prep">配件</option></select><button className="recipe-secondary" disabled={!ready} onClick={()=>setBatch(!batch)}>批次分類{selected.length?`（${selected.length}）`:''}</button><button className="shell-primary" disabled={!ready} onClick={onNew}><Plus size={17}/>新增食譜</button>{actions}</div>
  <datalist id="recipe-category-options">{categories.map(c=><option key={c} value={c}/>)}</datalist>
  {batch&&<div className="rd-batch"><span>已勾選 {selected.length} 筆</span><input list="recipe-category-options" aria-label="批次分類名稱" placeholder="分類（留空不更動）" value={batchCategory} maxLength={100} onChange={e=>setBatchCategory(e.target.value)}/><select aria-label="批次供應狀態" value={batchStatus} onChange={e=>setBatchStatus(e.target.value)}><option value="">狀態不更動</option>{Object.entries(lifecycleLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><select aria-label="批次加入菜單" value={batchMenu} onChange={e=>setBatchMenu(e.target.value)}><option value="">不加入菜單</option>{menus.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select><button className="shell-primary" disabled={!ready||!picked.length||(!batchCategory.trim()&&!batchStatus&&!batchMenu)} onClick={()=>update(picked,{...(batchCategory.trim()?{category:batchCategory.trim()}:{}),...(batchStatus?{lifecycle:batchStatus}:{})},batchMenu?{menu_id:batchMenu,membership:'add'}:{})}>儲存分類</button><button className="text-button" disabled={busy} onClick={()=>setBatch(false)}>取消</button></div>}
  <div className="rd-category-tabs"><button aria-pressed={!category} onClick={()=>setCategory('')}>全部</button>{categories.map(c=><button key={c} aria-pressed={category===c} onClick={()=>setCategory(category===c?'':c)}>{c}</button>)}</div>
  <div className="rd-table-scroll"><table className="rd-table"><thead><tr><th><input type="checkbox" aria-label="勾選目前篩選的全部食譜" disabled={!ready||!visible.length} checked={!!visible.length&&visible.every(r=>selected.includes(r.id))} onChange={selectAll}/></th><th>菜名</th><th>分類</th><th>菜單</th><th>單位成本</th><th>狀態</th><th>操作</th></tr></thead><tbody>{visible.map(card=>{
   const d=card.document,active=expanded===card.id,isEditing=editing===card.id,membership=menus.filter(m=>d.menu_ids?.includes(m.id)),state=recipeLifecycle(d,menus);
   const amount=card.cost.total??(card.cost.lines.some(l=>l.amount!==null)?card.cost.subtotal:null),unitAmount=amount===null?null:Number(d.yield)>0?amount/Number(d.yield):amount;
   return <RecipeDirectoryRows key={card.id} row={<tr className={active?'rd-selected':''}><td><input type="checkbox" aria-label={`勾選${recipeDisplayName(d)}`} disabled={!ready} checked={selected.includes(card.id)} onChange={()=>setSelected(current=>current.includes(card.id)?current.filter(id=>id!==card.id):[...current,card.id])}/></td><th scope="row"><button className="rd-name" aria-expanded={active} onClick={()=>setExpanded(active?'':card.id)}>{recipeDisplayName(d)}<ChevronDown size={14}/></button>{d.derived_from&&<small>改良版本 · 原版第 {d.derived_revision} 版</small>}</th><td>{isEditing?<input aria-label="修改分類" list="recipe-category-options" maxLength={100} value={editCategory} onChange={e=>setEditCategory(e.target.value)}/>:recipeCategory(d)}</td><td>{membership.length?membership.map(m=><span className="rd-menu-label" key={m.id}>{m.name}</span>):<span className="recipe-muted">尚未加入</span>}</td><td className="rd-cost"><strong>{recipeMoney(unitAmount)}</strong><small>{Number(d.yield)>0?`每 ${d.unit}`:'整份配方'}{card.cost.total!==null?' · 已鎖定':amount!==null?' · 已計入金額':''}</small></td><td>{isEditing?<select aria-label="修改供應狀態" value={editStatus} onChange={e=>setEditStatus(e.target.value)}><option value="menu">依菜單狀態</option>{Object.entries(lifecycleLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>:<span className={`rd-state rd-${state}`}>{lifecycleLabels[state]}</span>}</td><td><div className="rd-row-actions">{isEditing?<><button className="text-button" disabled={!ready} onClick={()=>update([card],{category:editCategory.trim()||'待分類',lifecycle:editStatus})}>儲存</button><button className="text-button" disabled={busy} onClick={()=>setEditing('')}>取消</button></>:<><button className="text-button" disabled={!ready} onClick={()=>edit(card)}>分類</button><button className="recipe-secondary" disabled={busy} onClick={()=>onOpen(card)}>{editable?'編輯':'查看'}</button></>}</div></td></tr>} detail={active?<tr><td colSpan={7}><div className="rd-detail"><div><strong>{recipeDisplayName(d)}</strong><small>原分類：{d.source_category||'未標示'} · 出餐用料 {d.lines.length} 項</small>{d.derived_from&&<button className="text-button" onClick={()=>{const original=recipes.find(r=>r.id===d.derived_from);if(original)onOpen(original);else setError('原食譜已移至其他門市，原版紀錄仍保留。');}}>查看原食譜</button>}</div><div className="rd-row-actions"><button className="recipe-secondary" onClick={()=>onOpen(card)}>查看配件與用量</button><button className="shell-primary" disabled={!ready} onClick={()=>void run('clone',{id:card.id,revision:card.revision},'已複製食譜及配件為研發版本，原版與成本紀錄保留。',()=>{setStatus('research');setCategory('');setMenuFilter('');setSearch('');})}>複製改良</button></div><div className="rd-memberships"><span>加入菜單：</span>{menus.map(m=><label key={m.id}><input type="checkbox" disabled={!ready} checked={!!d.menu_ids?.includes(m.id)} onChange={e=>update([card],{},{menu_id:m.id,membership:e.target.checked?'add':'remove'})}/>{m.name}<small>{menuStateLabels[m.state]}</small></label>)}{!menus.length&&<button className="text-button" onClick={()=>setShowMenus(true)}>先建立菜單</button>}</div></div></td></tr>:null}/>;
  })}</tbody></table></div>
  {!loaded&&<p role="status">正在讀取已保存食譜與成本…</p>}{loaded&&!visible.length&&<p className="rd-empty">沒有符合條件的食譜，可調整分類、狀態或搜尋文字。</p>}
  <footer className="rd-footer">顯示 {visible.length} 筆 · 未設定分類、菜單或狀態仍可儲存食譜。</footer>
 </section>;
}
function RecipeDirectoryRows({row,detail}:{row:ReactNode;detail:ReactNode}){return <>{row}{detail}</>;}
