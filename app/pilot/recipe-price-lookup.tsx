'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase-browser';
import {operationDeadline} from '@/lib/operation-deadline';
import {recipeLookupLabels,recipeLookupOptions,recipeLookupOffers,recipeLookupDraft,recipeLookupPreview,type RecipeLookupOption,type RecipeLookupSource} from '@/lib/recipe-price-lookup';
import {recipePurchaseDisplay,recipePurchaseUnitAmount,type RecipeLine,type RecipeWorkspace} from '@/lib/recipe-cost';
import type {RecipePriceDraft} from '@/lib/recipe-price-draft';
import type {InventoryPriceOffer} from '@/lib/inventory-valuation';
import RecipeModal from './recipe-modal';
import './recipe-price-lookup.css';
const number=(v:number)=>v.toLocaleString('zh-TW',{maximumFractionDigits:6});
export default function RecipePriceLookup({storeId,line,workspace,sourceText,onApply,onClose}:{storeId:string;line:RecipeLine;workspace:RecipeWorkspace;sourceText:string;onApply:(draft:RecipePriceDraft)=>boolean;onClose:()=>void}){
 const [term,setTerm]=useState(line.name),[source,setSource]=useState('all'),[supplier,setSupplier]=useState('all');
 const [response,setResponse]=useState<{query:string;options:RecipeLookupOption[];error?:string}|null>(null),[attempt,retry]=useState(0);
 const [selected,setSelected]=useState<{query:string;option:RecipeLookupOption;draft:RecipePriceDraft}|null>(null),[error,setError]=useState('');
 const query=term.trim();
 useEffect(()=>{
  if(!query)return;
  const controller=new AbortController(),timer=setTimeout(()=>{
   void operationDeadline(async signal=>{
    const result=await supabase.rpc('baihuayuan_inventory_price_lookup' as never,{p_store_id:storeId,p_query:query,p_count_date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date()),p_preferred_code:'',p_supplier:''} as never).abortSignal(AbortSignal.any([signal,controller.signal]));
    if(result.error)throw result.error;
    return recipeLookupOffers(result.data as unknown as InventoryPriceOffer[]);
   }).then(options=>{if(!controller.signal.aborted)setResponse({query,options});}).catch(()=>{if(!controller.signal.aborted)setResponse({query,options:[],error:'進貨價格暫時無法讀取。'});});
  },230);
  return()=>{clearTimeout(timer);controller.abort();};
 },[storeId,query,attempt]);
 const current=response?.query===query?response:null,options=recipeLookupOptions(workspace,query,current?.options||[]);
 const suppliers=[...new Set(options.map(option=>option.supplier).filter(Boolean))];
 const visible=options.filter(option=>(source==='all'||option.source===source)&&(supplier==='all'||option.supplier===supplier));
 const choice=selected?.query===query&&visible.some(option=>option.id===selected.option.id)?selected:null;
 const preview=choice?recipeLookupPreview(line,choice.draft,workspace,sourceText):null;
 function choose(option:RecipeLookupOption){setError('');setSelected({query,option,draft:recipeLookupDraft(line,option,workspace)});}
 return <RecipeModal title="查價" className="recipe-lookup-dialog" closeLabel="關閉查價" onClose={onClose}><div className="recipe-lookup">
  <p><strong>{line.name}</strong><small>選取後帶入本次草稿，隨「儲存全部」保存。</small></p>
  <input type="search" data-initial-focus aria-label="搜尋食譜價格" placeholder="搜尋品名、編碼或供應商" maxLength={180} value={term} onChange={e=>{setTerm(e.target.value);setSelected(null);setSupplier('all');setError('');}}/>
  <div className="recipe-lookup-filters"><select aria-label="價格來源" value={source} onChange={e=>setSource(e.target.value)}><option value="all">全部來源</option>{Object.entries(recipeLookupLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><select aria-label="價格供應商" value={supplier} onChange={e=>setSupplier(e.target.value)}><option value="all">全部供應商</option>{suppliers.map(name=><option key={name}>{name}</option>)}</select></div>
  {query&&!current&&<p role="status">讀取進貨價格…</p>}{current?.error&&<p role="alert">{current.error} <button type="button" className="text-button" onClick={()=>retry(n=>n+1)}>重新讀取</button></p>}
  <div className="recipe-lookup-results" role="radiogroup" aria-label="選擇食材價格">{visible.map(option=>{
   const p=option.price,purchase=p.purchase?recipePurchaseDisplay(p.purchase):null,amount=recipePurchaseUnitAmount({...p,purchase});
   const missing=option.pending||p.source_ref?.missing_price||!Number.isFinite(p.price)||p.price<0;
   return <button type="button" role="radio" aria-checked={choice?.option.id===option.id} disabled={missing} key={option.id} className="recipe-lookup-offer" onClick={()=>choose(option)}>
    <span className="recipe-lookup-offer-meta"><span className="recipe-tag">{recipeLookupLabels[option.source as RecipeLookupSource]}</span><span>{option.supplier||'供應商未記載'}</span><time>{p.effective_date||'日期未記載'}</time></span>
    <span className="recipe-lookup-offer-price"><strong>{option.name}</strong><b>{option.pending?'待確認價格':missing||amount===null?'待補價格':`$${number(amount)}／${purchase?.unit||p.unit}`}</b></span>
    <small>{[option.code,option.specification,purchase?.content_quantity?`每 ${purchase.unit} ${number(purchase.content_quantity)} ${purchase.content_unit}`:'',option.stopped?'已停供 · 歷史價格':''].filter(Boolean).join(' · ')}</small>
    {!missing&&(()=>{const unitCost=recipeLookupPreview(line,recipeLookupDraft(line,option,workspace),workspace,sourceText).unitCost;return <small>{unitCost===null?'待確認單位換算':`食譜單價 $${number(unitCost)}／${line.unit}`}</small>;})()}
   </button>;
  })}{!visible.length&&current&&<p role="status">沒有符合的價格，可更換關鍵字搜尋。</p>}{!query&&<p>輸入品名、編碼或供應商搜尋。</p>}</div>
  {choice&&preview?.unitCost===null&&<label className="recipe-lookup-conversion">每 1 {choice.draft.unit} 有多少 {line.unit}<input type="number" min="0" step="any" aria-label="查價單位換算數量" value={choice.draft.content} onChange={e=>setSelected({...choice,draft:{...choice.draft,content:e.target.value,contentUnit:line.unit}})}/><small>確認規格後才能換算成本。</small></label>}
  {choice&&<div className="recipe-lookup-total">本菜使用 {line.quantity||'待填'} {line.unit}<strong>{preview?.amount==null?'使用成本待補齊':`成本 $${number(preview.amount)}`}</strong></div>}
  {error&&<p role="alert">{error}</p>}
  <footer className="recipe-lookup-actions"><button type="button" className="recipe-secondary" onClick={onClose}>取消</button><button type="button" className="shell-primary" disabled={!choice||preview?.unitCost==null||!!choice.option.price.source_ref?.missing_price} onClick={()=>{if(choice){if(onApply(choice.draft))onClose();else setError('草稿未能保留，請保持此頁並重試。');}}}>帶入這筆價格</button></footer>
 </div></RecipeModal>;
}
