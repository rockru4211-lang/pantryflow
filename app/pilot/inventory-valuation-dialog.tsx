'use client';

import {useEffect,useRef,useState} from 'react';
import {inventoryOriginalPurchaseLabel} from '@/lib/inventory-cost';
import {inventoryValuationPrice,inventoryWeightOption,type InventoryPriceOffer,type InventoryValuationChoice,type InventoryValuationQuote} from '@/lib/inventory-valuation';
import {moneyAmount} from '@/lib/operations-sheet';
import WorkspaceEditDialog from './workspace-edit-dialog';
import './inventory-valuation.css';

type Props={
 name:string;code:string;supplier:string;quantity:number;unit:string;cutoff:string;original?:InventoryValuationQuote;staged?:boolean;initialChoice?:InventoryValuationChoice;
 read:(query:string,cutoff:string,code:string,supplier:string,signal:AbortSignal)=>Promise<InventoryPriceOffer[]>;
 save:(choice:InventoryValuationChoice)=>Promise<void>;onClose:()=>void;
};

export default function InventoryValuationDialog({name,code,supplier,quantity,unit,cutoff,original,staged,initialChoice,read,save,onClose}:Props){
 const [term,setTerm]=useState(name);
 const [search,setSearch]=useState<{term:string;results:InventoryPriceOffer[];failed?:boolean}|null>(null);
 const [selected,setSelected]=useState<{quote:InventoryValuationQuote;stopped?:boolean;automatic?:boolean}|undefined>(initialChoice?{quote:initialChoice.quote,automatic:initialChoice.automatic}:original?.purchase?{quote:original,automatic:true}:undefined);
 const [conversion,setConversion]=useState(initialChoice?String(initialChoice.weight_kg??initialChoice.count_per_unit??''):''),[byWeight,setByWeight]=useState(initialChoice?.weight_kg!==undefined);
 const [attempt,retry]=useState(0);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const saving=useRef(false);
 const showSearch=!selected;
 const query=term.trim();
 const current=search?.term===query?search:null;
 useEffect(()=>{
  if(!showSearch||!query)return;
  const controller=new AbortController();
  const delay=setTimeout(()=>{
   void read(query,cutoff,code,supplier,controller.signal).then(results=>{
    if(!controller.signal.aborted)setSearch({term:query,results});
   }).catch(()=>{
    if(!controller.signal.aborted)setSearch({term:query,results:[],failed:true});
   });
  },230);
  return ()=>{clearTimeout(delay);controller.abort();};
 },[showSearch,query,cutoff,code,supplier,read,attempt]);
 const quote=selected?.quote;
 const choice:InventoryValuationChoice|undefined=quote?{quote,automatic:selected?.automatic===true,
  ...(conversion.trim()?byWeight?{weight_kg:Number(conversion)}:{count_per_unit:Number(conversion)}:{})}:undefined;
 const needsConversion=!!quote&&inventoryValuationPrice({quote,automatic:false},unit,quantity)===null;
 const price=choice?inventoryValuationPrice(choice,unit,quantity):null;
 const amount=price===null?'':moneyAmount(String(quantity),String(price));
 const format=(v:number,decimals=4)=>v.toLocaleString('zh-TW',{maximumFractionDigits:decimals});
 async function apply(){
  if(!choice||price===null||saving.current)return;
  saving.current=true;setBusy(true);setError('');
  try{await save(choice);onClose();}
  catch(e){setError(e instanceof Error?e.message:'價格尚未帶入，請重試。');}
  finally{saving.current=false;setBusy(false);}
 }
 return <WorkspaceEditDialog title="查食材價格" side busy={busy} onClose={onClose}>
  <div className="inventory-valuation">
   <p><strong>{name}</strong>{supplier&&<small>{supplier}</small>}{staged&&<small>帶入後與本次編輯一起儲存。</small>}</p>
   {showSearch&&<>
    <input type="search" data-initial-focus aria-label="搜尋食材價格表" placeholder="搜尋品名、編碼或供應商" value={term} maxLength={180} onChange={e=>{if(e.target.value.trim()!==query)setSearch(null);setTerm(e.target.value);}}/>
    {!query?<p role="status">輸入品名或編碼搜尋。</p>:current?.failed?<p role="alert">食材價格表讀取失敗。 <button type="button" className="sheet-link" onClick={()=>{setSearch(null);retry(n=>n+1);}}>重試</button></p>:
     !current?<p role="status">讀取食材價格表…</p>:
     !current.results.length?<p role="status">盤點日前沒有符合的已確認價格。</p>:
     <ul className="inventory-valuation-results">{current.results.map(({name,code,quote,stopped})=><li key={quote.reference_id}>
      <button type="button" onClick={()=>{setSelected({quote,stopped});setConversion('');setByWeight(false);setError('');}}>
       <span><strong>{name}</strong><small>{[code,quote.supplier_name,quote.specification].filter(Boolean).join(' · ')}</small><small>{[quote.date,quote.source,stopped?'已停供 · 歷史價格':''].filter(Boolean).join(' · ')}</small></span>
       <b>{inventoryOriginalPurchaseLabel(quote.purchase)}</b>
      </button>
     </li>)}</ul>}
   </>}
   {quote&&<>
    <div className="inventory-valuation-line"><span><strong>{quote.supplier_name||'食材價格表'}</strong><small>{[quote.specification,quote.date,quote.source,selected?.stopped?'已停供 · 歷史價格':''].filter(Boolean).join(' · ')}</small></span><b>{inventoryOriginalPurchaseLabel(quote.purchase)}</b></div>
    <button type="button" className="sheet-link" disabled={busy} onClick={()=>{setSelected(undefined);setConversion('');setByWeight(false);setError('');}}>搜尋其他進價</button>
    {needsConversion&&<div className="inventory-valuation-conversion">
      <div className="inventory-valuation-line"><strong>單位換算</strong>{inventoryWeightOption(quote,unit)&&<button type="button" className="sheet-link" disabled={busy} onClick={()=>{setByWeight(v=>!v);setConversion('');}}>{byWeight?'改用換算規格':'改用實秤重量'}</button>}</div>
      <label>{byWeight?`這 ${quantity} ${unit} 的實秤重量（公斤）`:`1 ${quote.purchase?.unit} 約有多少 ${unit}`}
       <input data-initial-focus type="number" min="0" step="any" inputMode="decimal" value={conversion} disabled={busy} onChange={e=>setConversion(e.target.value)}/>
      </label>
      {byWeight&&<small>實秤重量用於本次盤點。</small>}
    </div>}
    <div className="inventory-valuation-total">
     {price!==null&&<small>{format(quantity)} {unit} × NT$ {format(price)}／{unit}</small>}
     <div className="inventory-valuation-line"><strong>庫存金額預估</strong><b>{amount?`NT$ ${Number(amount).toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})}`:'—'}</b></div>
    </div>
    {error&&<p role="alert" className="workspace-edit-error">{error}</p>}
    <button type="button" className="shell-primary inventory-valuation-apply" disabled={busy||price===null} onClick={()=>void apply()}>{busy?'帶入中…':'帶入此列'}</button>
   </>}
  </div>
 </WorkspaceEditDialog>;
}
