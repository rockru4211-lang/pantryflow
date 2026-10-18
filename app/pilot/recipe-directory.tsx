'use client';
import {canData} from '@/lib/data-access';
import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {ChevronDown,Plus,Search} from 'lucide-react';
import {supabase} from '@/lib/supabase-browser';
import {appError,type AppStore} from '@/lib/app-workspace';
import type {Json} from '@/lib/database.types';
import {recipeLineCode} from '@/lib/recipe-cost';
import {recipeNotesView,recipeSourceUrl,recipeDisplayName,type RecipeCard,type RecipeWorkspace} from '@/lib/recipe-model';
import {recipeSeasons,recipeStatusTabs,lifecycleLabels,menuStateLabels,recipeCategory,recipeDirectoryMatches,recipeLifecycle,type RecipeLifecycle,type RecipeMenu} from '@/lib/recipe-organization';
import {recipeCostChange} from '@/lib/recipe-price-draft';
import {recipeMoney} from './recipe-editor';
import RecipeModal from './recipe-modal';
import './recipe-directory.css';
type Props={initialSearch?:string;store:AppStore;recipes:RecipeCard[];workspace?:RecipeWorkspace;onReview?:()=>void;loaded:boolean;actions:ReactNode;headerActions?:ReactNode;moreActions?:ReactNode;onNew:()=>void;onOpen:(card:RecipeCard)=>void;onView:(card:RecipeCard)=>void;reload:()=>Promise<unknown>;beforeUpdate:(ids:string[])=>boolean};
export default function RecipeDirectory({initialSearch,store,recipes,workspace,onReview,loaded,actions,headerActions,moreActions,onNew,onOpen,onView,reload,beforeUpdate}:Props){
 const [originalText,setOriginalText]=useState<string|null>(null);
 const [menus,setMenus]=useState<RecipeMenu[]>([]),[menusReady,setMenusReady]=useState(false);
 const [search,setSearch]=useState(initialSearch||''),[category,setCategory]=useState(''),[menuFilter,setMenuFilter]=useState(''),[kind,setKind]=useState('dish');
 const [status,setStatus]=useState<RecipeLifecycle|'all'>('all'),[expanded,setExpanded]=useState(''),[selected,setSelected]=useState<string[]>([]);
 const [batchCategory,setBatchCategory]=useState(''),[batchStatus,setBatchStatus]=useState(''),[batchMenu,setBatchMenu]=useState('');
 const [page,setPage]=useState(1),[season,setSeason]=useState('');
 const [detailMode,setDetailMode]=useState<'ingredients'|'menus'>('ingredients');
 function showDetail(id:string,mode:'ingredients'|'menus'){setExpanded(id);setDetailMode(mode);}
 const [showMenus,setShowMenus]=useState(false),[menuName,setMenuName]=useState(''),[editingMenu,setEditingMenu]=useState<RecipeMenu|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const working=useRef(false),requests=useRef(new Map<string,string>()),newMenuId=useRef('');
 const editable=store.role!=='STAFF'&&store.access_mode!=='VIEW'&&canData(store,'RECIPE',true);
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
 const visible=base.filter(r=>(status==='all'||recipeLifecycle(r.document,menus)===status)&&(!season||r.document.season===season)&&(!category||recipeCategory(r.document)===category)&&(!menuFilter||r.document.menu_ids?.includes(menuFilter))&&recipeDirectoryMatches(r,recipes,search));
 const pageCount=Math.max(1,Math.ceil(visible.length/20)),currentPage=Math.min(page,pageCount),pageRows=visible.slice((currentPage-1)*20,currentPage*20);
 const picked=recipes.filter(r=>selected.includes(r.id));
 const ready=editable&&loaded&&menusReady&&!busy;
 function selectAll(){setSelected(current=>pageRows.every(r=>current.includes(r.id))?current.filter(id=>!pageRows.some(r=>r.id===id)):[...new Set([...current,...pageRows.map(r=>r.id)])]);}
 function update(cards:RecipeCard[],patch:Record<string,string>,extra:Record<string,string>={}){
  if(!cards.length){setError('請先勾選食譜。');return;}
  if(!beforeUpdate(cards.map(c=>c.id))){setError('選取的食譜有編輯中的草稿，請先儲存或完成編輯，再修改分類。');return;}
  void run('update',{rows:cards.map(c=>({id:c.id,revision:c.revision})),patch,...extra},`已更新 ${cards.length} 筆食譜，原成本保留。`,()=>{setSelected([]);setBatchCategory('');setBatchStatus('');setBatchMenu('');});
 }
 function saveMenu(menu?:RecipeMenu,state?:RecipeMenu['state']){
  const name=menu?menu.name:menuName.trim();if(!name){setError('請填寫菜單名稱。');return;}
  if(!newMenuId.current)newMenuId.current=crypto.randomUUID();
  void run('menu_save',{id:menu?.id||editingMenu?.id||newMenuId.current,revision:menu?.revision||editingMenu?.revision||0,name,state:state||editingMenu?.state||'draft'},'菜單已儲存。',()=>{setMenuName('');setEditingMenu(null);newMenuId.current='';});
 }
 return <section className="recipe-directory" aria-label="食譜分類與菜單管理">
  {originalText!==null&&<RecipeModal title="匯入原文" onClose={()=>setOriginalText(null)}><pre className="recipe-original-text">{originalText}</pre></RecipeModal>}
  <header className="rd-heading"><div><h1>{kind==='prep'?'共用配件':'食譜成本'}</h1><small>{store.name} · 已儲存成本</small></div><div className="rd-header-actions">{headerActions}<button className="text-button" onClick={()=>{setKind(kind==='dish'?'prep':'dish');setPage(1);setSelected([]);}}>{kind==='dish'?'共用配件':'返回食譜'}</button></div></header>
  {error&&<p role="alert" className="recipe-alert">{error} {!menusReady&&<button className="text-button" onClick={()=>void loadMenus().catch(e=>setError(appError(e)))}>重新讀取</button>}</p>}
  {notice&&<p role="status" className="recipe-save-success">{notice}</p>}
  {showMenus&&<section className="rd-menu-manager" aria-label="季節菜單"><div className="rd-menu-form"><input aria-label="菜單名稱" placeholder="菜單名稱，例如 2026 秋冬、商業午餐" value={menuName} maxLength={100} onChange={e=>setMenuName(e.target.value)}/><button className="recipe-secondary" disabled={!ready} onClick={()=>saveMenu()}>{editingMenu?'儲存名稱':'新增菜單'}</button>{editingMenu&&<button className="text-button" onClick={()=>{setEditingMenu(null);setMenuName('');}}>取消</button>}</div>{!menus.length&&<p className="recipe-muted">尚未建立菜單。可先整理分類，之後再加入季節菜單。</p>}{menus.map(m=><div className="rd-menu-row" key={m.id}><strong>{m.name}</strong><span>{menuStateLabels[m.state]}</span><small>{base.filter(r=>r.document.menu_ids?.includes(m.id)).length} 份{kind==='dish'?'主食譜':'配件'}</small><button className="text-button" disabled={!ready} onClick={()=>{setEditingMenu(m);setMenuName(m.name);}}>改名</button>{m.state!=='active'&&<button className="text-button" disabled={!ready} onClick={()=>saveMenu(m,'active')}>{m.state==='closed'?'重新供應':'開始供應'}</button>}{m.state==='active'&&<button className="text-button" disabled={!ready} onClick={()=>saveMenu(m,'closed')}>結束菜單</button>}</div>)}<small>結束菜單後保留紀錄；仍在其他供應中菜單的食譜會繼續顯示供應中。</small></section>}
  <nav className="rd-status-tabs" aria-label="食譜分類">{(['all',...recipeStatusTabs,...(base.some(r=>recipeLifecycle(r.document,menus)==='research')?['research']:[])] as const).map(value=><button key={value} aria-pressed={status===value} onClick={()=>{setStatus(value as RecipeLifecycle|'all');setPage(1);setSelected([]);}}>{value==='all'?'全部':lifecycleLabels[value as RecipeLifecycle]}<small>{value==='all'?base.length:base.filter(r=>recipeLifecycle(r.document,menus)===value).length}</small></button>)}</nav>
  <div className="rd-toolbar"><label className="recipe-search"><Search size={17}/><input aria-label="搜尋菜名或食材" placeholder="搜尋食譜名稱、編碼或食材" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></label><select aria-label="適用季節" value={season} onChange={e=>{setSeason(e.target.value);setPage(1);}}><option value="">適用季節：全部</option>{recipeSeasons.map(v=><option key={v}>{v}</option>)}</select><select aria-label="篩選分類" value={category} onChange={e=>{setCategory(e.target.value);setPage(1);}}><option value="">全部分類</option>{categories.map(c=><option key={c}>{c}</option>)}</select><button className="shell-primary" disabled={!ready} onClick={onNew}><Plus size={17}/>新增</button>{actions}<details className="rd-more"><summary aria-label="分類與菜單工具">⋯</summary><div className="rd-more-panel">{moreActions}<button className="text-button" onClick={()=>setShowMenus(!showMenus)}>菜單管理</button><select aria-label="篩選菜單" value={menuFilter} onChange={e=>{setMenuFilter(e.target.value);setPage(1);}}><option value="">全部菜單</option>{menus.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></div></details></div>
  <datalist id="recipe-category-options">{categories.map(c=><option key={c} value={c}/>)}</datalist>
  {!!selected.length&&<div className="rd-batch" aria-label="批次整理食譜"><span>已勾選 {selected.length} 筆</span><input list="recipe-category-options" aria-label="批次分類名稱" placeholder="批次分類（留空不更動）" value={batchCategory} maxLength={100} onChange={e=>setBatchCategory(e.target.value)}/><select aria-label="批次供應狀態" value={batchStatus} onChange={e=>setBatchStatus(e.target.value)}><option value="">變更狀態（不更動）</option>{Object.entries(lifecycleLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><select aria-label="批次加入菜單" value={batchMenu} onChange={e=>setBatchMenu(e.target.value)}><option value="">加入菜單（不加入）</option>{menus.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select><button className="shell-primary" disabled={!ready||!picked.length||(!batchCategory.trim()&&!batchStatus&&!batchMenu)} onClick={()=>update(picked,{...(batchCategory.trim()?{category:batchCategory.trim()}:{}),...(batchStatus?{lifecycle:batchStatus}:{})},batchMenu?{menu_id:batchMenu,membership:'add'}:{})}>套用變更</button><button className="text-button" disabled={busy} onClick={()=>{setSelected([]);setBatchCategory('');setBatchStatus('');setBatchMenu('');}}>取消勾選</button></div>}

  <div className="rd-table-scroll"><table className="rd-table"><thead><tr><th><input type="checkbox" aria-label="勾選目前篩選的全部食譜" disabled={!ready||!visible.length} checked={!!visible.length&&pageRows.every(r=>selected.includes(r.id))} onChange={selectAll}/></th><th>食譜名稱</th><th className="rd-code">編碼</th><th>季節</th><th>分類</th><th>每份成本</th><th>操作</th></tr></thead><tbody>{pageRows.map(card=>{
   const sourceUrl=recipeSourceUrl(card.document.source_url);
   const notesView=recipeNotesView(card.document.notes);
   const d=card.document,active=expanded===card.id,state=recipeLifecycle(d,menus);
   const movement=workspace?recipeCostChange(card,workspace):null;
   const componentCount=new Set([...(d.component_order||[]),...d.lines.flatMap(l=>l.recipe_id?[l.recipe_id]:[])]).size;
   const amount=card.cost.total??(card.cost.lines.some(l=>l.amount!==null)?card.cost.subtotal:null),unitAmount=amount===null?null:Number(d.yield)>0?amount/Number(d.yield):amount;
   return <RecipeDirectoryRows key={card.id} row={<tr data-recipe-row="true" className={active||selected.includes(card.id)?'rd-selected':''}><td><input type="checkbox" aria-label={`勾選${recipeDisplayName(d)}`} disabled={!ready} checked={selected.includes(card.id)} onChange={()=>setSelected(current=>current.includes(card.id)?current.filter(id=>id!==card.id):[...current,card.id])}/></td><th scope="row"><button className="rd-name" onClick={()=>onView(card)}>{recipeDisplayName(d)}<ChevronDown size={14}/></button>{sourceUrl&&<a className="recipe-source-link" href={sourceUrl} target="_blank" rel="noopener noreferrer">↗ 開啟原始食譜表</a>}{componentCount>0&&<button className="rd-component-link" onClick={()=>showDetail(card.id,'ingredients')}>含 {componentCount} 個配件</button>}{d.derived_from&&<small>改良版本 · 原版第 {d.derived_revision} 版</small>}{recipeCategory(d)!=='待分類'&&<small>{recipeCategory(d)}</small>}</th><td className="rd-code">{card.recipe_code||'—'}</td><td><span className="rd-season">{d.season||'未設定'}</span></td><td><span className={`rd-state rd-${state}`}>{lifecycleLabels[state]}</span></td><td className="rd-cost"><strong>{recipeMoney(unitAmount)}</strong><small>{Number(d.yield)>0?`每 ${d.unit}`:'整份配方'}{card.cost.total!==null?' · 已鎖定':amount!==null?' · 已計入金額':''}</small>{movement&&<button className="rd-price-alert" onClick={onReview}>最新進價有變動</button>}</td><td><div className="rd-row-actions"><button className="recipe-secondary" disabled={busy} onClick={()=>onView(card)}>檢視食譜</button><RecipeRowMenu label={`${recipeDisplayName(d)}更多操作`}>{editable&&<button disabled={!ready} onClick={()=>onOpen(card)}>編輯食譜</button>}
 {d.derived_from&&<button onClick={()=>{const original=recipes.find(r=>r.id===d.derived_from);if(original)onOpen(original);else setError('原食譜已移至其他門市，原版紀錄仍保留。');}}>查看原版</button>}
 <button disabled={!ready} onClick={()=>void run('clone',{id:card.id,revision:card.revision},'已複製食譜及配件為研發版本，原版與成本紀錄保留。',()=>{setStatus('research');setCategory('');setMenuFilter('');setSearch('');})}>複製改良</button>
 <button onClick={()=>showDetail(card.id,'menus')}>加入菜單</button>
 {notesView.imported&&<button onClick={()=>{setOriginalText(notesView.original);}}>查看匯入原文</button>}
 </RecipeRowMenu></div></td></tr>} detail={active?<tr className="rd-expanded-row"><td colSpan={7}><div className="rd-detail rd-focused-detail"><header><div><strong>{recipeDisplayName(d)} · {detailMode==='ingredients'?'配件與用量':'加入菜單'}</strong><small>原分類：{d.source_category||'未標示'} · 出餐用料 {d.lines.length} 項</small></div><button className="text-button" onClick={()=>setExpanded('')}>收合 <ChevronDown size={14}/></button></header>
 {detailMode==='ingredients'&&<div className="rd-usage-preview">{[{name:d.kind==='prep'?'配方用料':'主配方',lines:d.lines.filter(l=>!l.recipe_id)},{name:'配件',lines:d.lines.filter(l=>l.recipe_id)}].filter(group=>group.lines.length).map(group=><section key={group.name}><h3>{group.name}</h3><div className="rd-usage-heading"><span className="rd-code">編號</span><span>用料名稱</span><span>使用量</span><span>已保存成本</span></div>{group.lines.map(line=>{const cost=card.cost.lines.find(c=>c.id===line.id);return <div className="rd-usage-row" key={line.id}><span className="rd-code">{recipeLineCode(line,workspace)}</span><span>{line.name||'未命名品項'}{line.recipe_id&&<small>配件</small>}</span><span>{line.quantity} {line.unit}</span><strong>{recipeMoney(cost?.amount??null)}</strong></div>;})}</section>)}{!d.lines.length&&<p>尚未加入用料</p>}{sourceUrl&&<a className="recipe-source-link" href={sourceUrl} target="_blank" rel="noopener noreferrer">↗ 查看原始試算表</a>}{!sourceUrl&&notesView.imported&&editable&&<button className="text-button" onClick={()=>onOpen(card)}>＋ 補上原始試算表連結</button>}{notesView.text&&<details><summary>做法與備註</summary><p className="rd-recipe-notes">{notesView.text}</p></details>}<button className="text-button" onClick={()=>onOpen(card)}>{editable?'編輯食譜內容':'查看食譜內容'}</button></div>}
 {detailMode==='menus'&&<div className="rd-memberships"><span>加入菜單：</span>{menus.map(m=><label key={m.id}><input type="checkbox" disabled={!ready} checked={!!d.menu_ids?.includes(m.id)} onChange={e=>update([card],{},{menu_id:m.id,membership:e.target.checked?'add':'remove'})}/>{m.name}<small>{menuStateLabels[m.state]}</small></label>)}{!menus.length&&<button className="text-button" onClick={()=>setShowMenus(true)}>先建立菜單</button>}</div>}
 </div></td></tr>:null}/>;
  })}</tbody></table></div>
  {!loaded&&<p role="status">正在讀取已保存食譜與成本…</p>}{loaded&&!visible.length&&<p className="rd-empty">沒有符合條件的食譜，可調整分類、狀態或搜尋文字。</p>}
  <footer className="rd-footer"><span>共 {visible.length} 份{kind==='prep'?'配件':'食譜'}</span><div className="rd-pagination"><button disabled={currentPage===1} aria-label="上一頁" onClick={()=>setPage(currentPage-1)}>‹</button><span>{currentPage} ／ {pageCount}</span><button disabled={currentPage===pageCount} aria-label="下一頁" onClick={()=>setPage(currentPage+1)}>›</button></div></footer><p className="rd-cost-note">新食譜：待確認 → 待上線 → 使用中　｜　換季暫收：季節備用　｜　不再供應：舊食譜</p>
 </section>;
}
function RecipeDirectoryRows({row,detail}:{row:ReactNode;detail:ReactNode}){return <>{row}{detail}</>;}

// Native popover renders above the scrolling table and closes on Escape/outside click.
function RecipeRowMenu({label,children}:{label:string;children:ReactNode}){
 const trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
 const [open,setOpen]=useState(false);
 function position(){const button=trigger.current,menu=panel.current;if(!button||!menu)return;const rect=button.getBoundingClientRect();const width=Math.min(220,window.innerWidth-24),height=menu.offsetHeight;menu.style.width=`${width}px`;menu.style.left=`${Math.max(12,Math.min(rect.right-width,window.innerWidth-width-12))}px`;menu.style.top=`${Math.max(12,rect.bottom+height+8>window.innerHeight?rect.top-height-6:rect.bottom+6)}px`;}
 useEffect(()=>{if(!open)return;const close=()=>panel.current?.hidePopover();window.addEventListener('resize',close);window.addEventListener('scroll',close,true);return()=>{window.removeEventListener('resize',close);window.removeEventListener('scroll',close,true);};},[open]);
 return <><button ref={trigger} className="recipe-secondary" aria-label={label} aria-expanded={open} onClick={()=>{if(!panel.current)return;if(open)panel.current.hidePopover();else{panel.current.showPopover();position();}}}>⋯</button><div ref={panel} popover="auto" className="rd-row-menu" aria-label={label} onToggle={e=>setOpen(e.newState==='open')} onClick={e=>{if((e.target as HTMLElement).closest('button:not(:disabled)'))panel.current?.hidePopover();}}>{children}</div></>;
}
