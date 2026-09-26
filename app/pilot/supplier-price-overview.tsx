'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {receiptRead,receiptReadRows,receiptReadError} from '@/lib/receipt-read';
import {supplierPriceItems,supplierPriceLabel,priorPriceMonth,type SupplierProfile,type SupplierProduct,type SupplierReceiptLine} from '@/lib/supplier-prices';
const money=(n:number|null)=>n===null?'—':`NT$ ${n.toLocaleString('zh-TW',{maximumFractionDigits:4})}`;
export default function SupplierPriceOverview({storeId,month,search,onReceipt}:{storeId:string;month:string;search:string;onReceipt:(id:string)=>void}){
 const [data,setData]=useState<{storeId:string;suppliers:SupplierProfile[];products:SupplierProduct[];lines:SupplierReceiptLine[]}|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[reload,setReload]=useState(0);
 useEffect(()=>{const controller=new AbortController();let current=true;
  const run=async()=>{setLoading(true);try{
   const result=await Promise.all(['suppliers','catalog','historical-prices'].map(section=>receiptRead(signal=>supabase.rpc('app_workspace',{p_store_id:storeId,p_section:section,p_filter:{}}).abortSignal(signal),controller.signal)));
   for(const r of result)if(r.error)throw r.error;
   const [ledger,flags]=await Promise.all([receiptRead(signal=>supabase.rpc('get_pilot_receipt_ledger',{p_store_id:storeId}).abortSignal(signal),controller.signal),receiptRead(signal=>supabase.rpc('get_baihuayuan_record_flags',{p_store_id:storeId,p_entity_type:'RECEIPT_BATCH'}).abortSignal(signal),controller.signal)]);
   const hidden=new Set(receiptReadRows<{entity_id:string;state:string}>(flags).filter(x=>x.state!=='LIVE').map(x=>x.entity_id));
   const suppliers=(result[0].data as unknown as {suppliers:SupplierProfile[]}).suppliers,products=(result[1].data as unknown as {products:SupplierProduct[]}).products;
   if(!Array.isArray(suppliers)||!Array.isArray(products))throw Error('INVALID_RESPONSE');
   if(current){setData({storeId,suppliers,products,lines:[...receiptReadRows<SupplierReceiptLine>(ledger).filter(l=>!hidden.has(l.batch_id)),...receiptReadRows<SupplierReceiptLine>(result[2])]});setError('');}
  }catch(e){if(current)setError(receiptReadError(e));}finally{if(current)setLoading(false);}};
  void run();const refresh=()=>void run();window.addEventListener('focus',refresh);return()=>{current=false;controller.abort();window.removeEventListener('focus',refresh);};
 },[storeId,reload]);
 const items=data?.storeId===storeId?data.suppliers.flatMap(s=>supplierPriceItems(s,data.products,data.lines,data.suppliers,month).map(item=>({...item,supplier:s.name}))).filter(i=>`${i.supplier} ${i.name} ${i.specification}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())):[];
 if(loading)return <p role="status">正在讀取進價比對…</p>;
 if(error)return <p role="alert">{error}<button onClick={()=>setReload(n=>n+1)}>重新讀取</button></p>;
 return <><p className="shell-note">{month} 與 {priorPriceMonth(month)} 最後有效進價比較；同供應商、品項、規格、單位及稅別。</p><div className="supplier-table-wrap"><table className="supplier-table"><thead><tr><th>供應商／品項</th><th>規格／單位</th><th>上期單價</th><th>本期單價</th><th>漲跌</th><th>來源</th></tr></thead><tbody>{items.map(i=><tr key={i.supplier+i.key}><td><strong>{i.name}</strong><small>{i.supplier}</small></td><td>{i.specification}<small>{i.unit}</small></td><td>{money(i.previous)}{i.referenceOnly&&<small>原表參考・稅別待確認</small>}</td><td>{money(i.latest)}</td><td>{supplierPriceLabel(i)}</td><td><details><summary>查看來源</summary>{[i.latestSource,i.previousSource].map((r,index)=>r&&<div key={index}><small>{index?'上期':'本期'}：{r.receipt_date}</small>{r.source_kind==='HISTORICAL'?<small>{r.source_file}<br/>{r.source_location}</small>:<button className="text-button" onClick={()=>onReceipt(r.batch_id)}>查看貨單</button>}</div>)}</details></td></tr>)}</tbody></table></div>{!items.length&&<p className="shell-note">沒有符合條件的品項。</p>}</>;
}
