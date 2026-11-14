'use client';

import {useEffect,useRef,useState} from 'react';
import {inventoryOriginalPurchaseLabel} from '@/lib/inventory-cost';
import {inventoryLookup,inventoryValuationPrice,inventoryWeightOption,type InventoryValuationChoice,type InventoryValuationQuote} from '@/lib/inventory-valuation';
import {moneyAmount} from '@/lib/operations-sheet';
import type {PriceSheetData} from '@/lib/ingredient-price-sheet';
import WorkspaceEditDialog from './workspace-edit-dialog';
import './inventory-valuation.css';

type Props={
 name:string;code:string;supplier:string;quantity:number;unit:string;cutoff:string;original?:InventoryValuationQuote;
 read:(signal:AbortSignal)=>Promise<PriceSheetData>;
 save:(choice:InventoryValuationChoice)=>Promise<void>;onClose:()=>void;
};

export default function InventoryValuationDialog({name,code,supplier,quantity,unit,cutoff,original,read,save,onClose}:Props){
 const [term,setTerm]=useState(code||name);
 const [data,setData]=useState<PriceSheetData|null>(null);
 const [selected,select]=useState<InventoryValuationQuote|undefined>(original?.purchase?original:undefined);
 const [conversion,setConversion]=useState(''),[byWeight,setByWeight]=useState(false);
 const [attempt,retry]=useState(0),[lookupError,setLookupError]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const saving=useRef(false);
 const showSearch=!selected;
 useEffect(()=>{
  if(!showSearch||data)return;
  const controller=new AbortController();
  void read(controller.signal).then(result=>{if(!controller.signal.aborted)setData(result);}).catch(()=>{
   if(!controller.signal.aborted)setLookupError(true);
  });
  return ()=>controller.abort();
 },[showSearch,data,read,attempt]);
 const results=showSearch&&data?inventoryLookup(data,term,cutoff,supplier,code):[];
 const choice:InventoryValuationChoice|undefined=selected?{quote:selected,automatic:selected===original,
  ...(conversion.trim()?byWeight?{weight_kg:Number(conversion)}:{count_per_unit:Number(conversion)}:{})}:undefined;
 const needsConversion=!!selected&&inventoryValuationPrice({quote:selected,automatic:false},unit,quantity)===null;
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
   <p><strong>{name}</strong>{supplier&&<small>{supplier}</small>}</p>
   {showSearch&&<>
    <input type="search" data-initial-focus aria-label="搜尋食材價格表" placeholder="搜尋品名、編碼或供應商" value={term} onChange={e=>setTerm(e.target.value)}/>
    {lookupError?<p role="alert">食材價格表讀取失敗。 <button type="button" className="sheet-link" onClick={()=>{setLookupError(false);retry(n=>n+1);}}>重試</button></p>:
     !data?<p role="status">讀取食材價格表…</p>:
     !results.length?<p role="status">{term.trim()?'盤點日前沒有符合的已確認價格。':'輸入品名或編碼搜尋。'}</p>:
     <ul className="inventory-valuation-results">{results.map(({name,code,quote},i)=><li key={i}>
      <button type="button" onClick={()=>{select(quote);setConversion('');setByWeight(false);setError('');}}>
       <span><strong>{name}</strong><small>{[code,quote.supplier_name,quote.specification].filter(Boolean).join(' · ')}</small><small>{[quote.date,quote.source].filter(Boolean).join(' · ')}</small></span>
       <b>{inventoryOriginalPurchaseLabel(quote.purchase)}</b>
      </button>
     </li>)}</ul>}
   </>}
   {selected&&<>
    <div className="inventory-valuation-line"><span><strong>{selected.supplier_name||'食材價格表'}</strong><small>{[selected.specification,selected.date,selected.source].filter(Boolean).join(' · ')}</small></span><b>{inventoryOriginalPurchaseLabel(selected.purchase)}</b></div>
    <button type="button" className="sheet-link" disabled={busy} onClick={()=>{select(undefined);setConversion('');setByWeight(false);setError('');}}>搜尋其他進價</button>
    {needsConversion&&<div className="inventory-valuation-conversion">
      <div className="inventory-valuation-line"><strong>單位換算</strong>{inventoryWeightOption(selected,unit)&&<button type="button" className="sheet-link" disabled={busy} onClick={()=>{setByWeight(v=>!v);setConversion('');}}>{byWeight?'改用換算規格':'改用實秤重量'}</button>}</div>
      <label>{byWeight?`這 ${quantity} ${unit} 的實秤重量（公斤）`:`1 ${selected.purchase?.unit} 約有多少 ${unit}`}
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
