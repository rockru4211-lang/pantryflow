"use client";

import {useEffect,useRef,useState,type ReactNode,type CSSProperties} from "react";
import {supabase} from "@/lib/supabase-browser";
import {workspaceStorage} from "@/lib/workspace-storage";
import {fieldNames,numericFields,receiptError,type ReceiptField} from "@/lib/receipt-workflow";
import {receiptSubtotal,receiptReviewTotals} from "@/lib/receipt-ledger";
import {
  createReceiptReviewDraft,updateReceiptReviewField,updateReceiptReviewMapping,
  isReceiptReviewDirty,receiptReviewDraftError,buildReceiptReviewPayload,
  acknowledgeReceiptReviewSave,reconcileReceiptReviewDraft,
  serializeReceiptReviewDrafts,parseReceiptReviewDrafts,receiptReviewDraftStorageKey,
} from "@/lib/receipt-review-draft";
import {useOperation} from "./operation-hooks";

export type ReceiptDesktopMapping={row_key:string;product_id:string;name:string;unit:string;specification?:string;code?:string};
export type ReceiptLineState={row_key:string;included:boolean;source:'AUTO'|'MANUAL';decision:'INCLUDE'|'IGNORE'|null};
export type ReceiptManualLine={id:string;supplier_name:string;product_name:string;specification:string;unit:string;quantity:number;unit_price_ex_tax:number|null;line_subtotal_ex_tax:number|null;note:string;deleted_at:string|null};
export type ReceiptDesktopSnapshot={fields:ReceiptField[];mappings:ReceiptDesktopMapping[];lineStates?:ReceiptLineState[];manualLines?:ReceiptManualLine[]};
type Draft=ReturnType<typeof createReceiptReviewDraft>;
type Drafts=Record<string,Draft>;
type Product={id:string;name:string;base_unit:string|null;specification:string|null};
type Props=ReceiptDesktopSnapshot&{
  storeId:string;userId:string;batchId:string;runId:string;chain:boolean;
  canReview:boolean;busy:boolean;pictures:ReactNode;navigation?:(disabled:boolean)=>ReactNode;
  onRefresh:()=>Promise<ReceiptDesktopSnapshot|undefined>;
  onComplete:()=>Promise<void>;
};
const labels:Record<string,string>={...fieldNames,product:"品名",specification:"規格",document_number:"貨單號碼",note:"備註",subtotal_ex_tax:"貨單未稅小計",total_inc_tax:"含稅金額",unit_price_ex_tax:"未稅單價"};
const columns=["product","specification","unit","quantity","unit_price_ex_tax"];
const orderedRows=(drafts:Drafts)=>Object.keys(drafts).sort((a,b)=>a==="document"?-1:b==="document"?1:a.localeCompare(b,"en",{numeric:true}));
const draftErrorMessage=(code:string)=>({NUMBER_REQUIRED:"數量及金額請填有效數字；未提供可留空。",PRODUCT_MAPPING_REQUIRED:"請選擇要對應的商品。",PRODUCT_NAME_AND_UNIT_REQUIRED:"建立商品前請填寫品名與單位。",OCR_LINE_NOT_FOUND:"這一列的辨識資料已更新，請重新開啟貨單。",INVALID_APP_INPUT:"資料格式無法確認，請重新讀取後檢查。"} as Record<string,string>)[code]||receiptError(Error(code));

export default function ReceiptDesktopReview({storeId,userId,batchId,runId,fields,mappings,lineStates=[],manualLines=[],chain,canReview,busy,pictures,navigation,onRefresh,onComplete}:Props){
  const storageKey=receiptReviewDraftStorageKey(userId,storeId,batchId,runId);
  const snapshotFor=(row:string,snapshot:ReceiptDesktopSnapshot)=>({batchId,runId,row,fields:snapshot.fields,mapping:snapshot.mappings.find(mapping=>mapping.row_key===row)});
  const createDrafts=(snapshot:ReceiptDesktopSnapshot):Drafts=>Object.fromEntries([...new Set(snapshot.fields.map(field=>field.row_key))].map(row=>[row,createReceiptReviewDraft(snapshotFor(row,snapshot))]));
  const [drafts,setDrafts]=useState<Drafts>(()=>createDrafts({fields,mappings}));
  const draftsRef=useRef(drafts);
  const initial=useRef({fields,mappings});
  const latest=useRef({fields,mappings,canReview,busy});
  const lock=useRef(false);
  const mounted=useRef(true);
  const [ready,setReady]=useState(false);
  const [restored,setRestored]=useState(false);
  const [storageError,setStorageError]=useState("");
  const [notice,setNotice]=useState("");
  const [rowErrors,setRowErrors]=useState<Record<string,string>>({});
  const [failedRow,setFailedRow]=useState<string|null>(null);
  const failedRowRef=useRef<string|null>(null);
  const [working,setWorking]=useState(false);
  const [savingRow,setSavingRow]=useState<string|null>(null);
  const [sourceVisible,setSourceVisible]=useState(true);
  const [sourceWidth,setSourceWidth]=useState(48);
  const [expandedRows,setExpandedRows]=useState<string[]>([]);
  const [manualOpen,setManualOpen]=useState(false);
  const [manualEditId,setManualEditId]=useState<string|null>(null);
  const [manualDraft,setManualDraft]=useState({supplier_name:"",product_name:"",specification:"",unit:"",quantity:"",unit_price:"",note:""});
  const layoutRef=useRef<HTMLDivElement>(null);
  const [products,setProducts]=useState<Product[]>([]);
  const [productsLoading,setProductsLoading]=useState(false);
  const [productsError,setProductsError]=useState("");
  const productsRequested=useRef(false);
  const operation=useOperation(storeId,userId);

  function persist(next:Drafts){
    try{
      const storage=workspaceStorage(userId);
      if(Object.values(next).some(draft=>isReceiptReviewDirty(draft)||draft.acknowledged))storage.setItem(storageKey,serializeReceiptReviewDrafts(next));
      else storage.removeItem(storageKey);
      if(mounted.current)setStorageError("");
    }catch{if(mounted.current)setStorageError("本機草稿暫時無法保存，離開前請先儲存修改。");}
  }
  function commit(next:Drafts){draftsRef.current=next;persist(next);if(mounted.current)setDrafts(next);}
  function markFailure(row:string|null){failedRowRef.current=row;if(mounted.current)setFailedRow(row);}
  function hasChangedSource(current:Drafts,snapshot:ReceiptDesktopSnapshot){
    return Object.entries(current).some(([row,draft])=>["missing","version-changed","conflict"].includes(reconcileReceiptReviewDraft(draft,snapshotFor(row,snapshot)).status));
  }
  function merge(snapshot:ReceiptDesktopSnapshot,current:Drafts=draftsRef.current){
    const next=createDrafts(snapshot);
    const conflicts:Record<string,string>={};
    for(const [row,draft] of Object.entries(current)){
      const result=reconcileReceiptReviewDraft(draft,snapshotFor(row,snapshot));
      next[row]=result.draft;
      if(result.status==="conflict")conflicts[row]="原資料已更新，您的修改仍保留。請核對原單；需要重新開始時可還原本列。";
      if(result.status==="missing"||result.status==="version-changed")conflicts[row]="辨識資料已更新，草稿仍保留，請重新開啟這張貨單。";
      if(result.status==="saved"&&failedRowRef.current===row)markFailure(null);
    }
    commit(next);
    if(mounted.current)setRowErrors(previous=>{
      const kept=Object.fromEntries(Object.entries(previous).filter(([row])=>next[row]&&(isReceiptReviewDirty(next[row])||next[row].acknowledged)));
      return {...kept,...conflicts};
    });
    return next;
  }
  useEffect(()=>{
    mounted.current=true;
    let active=true;
    queueMicrotask(()=>{
      if(!active)return;
      let cached:Drafts={};
      try{cached=parseReceiptReviewDrafts(workspaceStorage(userId).getItem(storageKey)||"");}
      catch{setStorageError("無法讀取本機草稿，請確認尚未儲存的內容。");}
      const restoredDrafts=Object.fromEntries(Object.entries(cached).filter(([,draft])=>draft.batchId===batchId&&draft.runId===runId));
      merge(initial.current,{...draftsRef.current,...restoredDrafts});
      setRestored(Object.values(restoredDrafts).some(draft=>isReceiptReviewDirty(draft)||draft.acknowledged));
      setReady(true);
    });
    return()=>{active=false;mounted.current=false;};
    // The parent keys this component by actor/store/batch/run. Polling is handled separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[storageKey,userId,batchId,runId]);
  useEffect(()=>{
    latest.current={fields,mappings,canReview,busy};
    if(!ready)return;
    merge({fields,mappings});
    // Preserve every dirty row's original CAS snapshot while clean rows follow polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[fields,mappings,canReview,busy,ready]);

  function editField(row:string,id:string,value:string){
    if(lock.current||busy||!canReview||!ready)return;
    const draft=draftsRef.current[row];if(!draft||draft.acknowledged||failedRowRef.current===row)return;
    commit({...draftsRef.current,[row]:updateReceiptReviewField(draft,id,value)});
    setRowErrors(previous=>({...previous,[row]:""}));setNotice("");
  }
  function editMapping(row:string,value:string){
    if(lock.current||busy||!canReview||!ready)return;
    const draft=draftsRef.current[row];if(!draft||draft.acknowledged||failedRowRef.current===row||chain&&value==="__new")return;
    commit({...draftsRef.current,[row]:updateReceiptReviewMapping(draft,value==="__new"?"CREATE":value?"SELECT":"NONE",value==="__new"?"":value)});
    setRowErrors(previous=>({...previous,[row]:""}));setNotice("");
  }
  async function loadProducts(force=false){
    if(productsRequested.current&&!force)return;
    productsRequested.current=true;setProductsLoading(true);setProductsError("");
    try{
      const result=await supabase.rpc("app_workspace",{p_store_id:storeId,p_section:"product-options",p_filter:{}});
      if(result.error)throw result.error;
      const data=result.data as unknown as {products?:Product[]};
      if(!Array.isArray(data.products))throw Error("PRODUCT_OPTIONS_UNAVAILABLE");
      if(mounted.current)setProducts(data.products);
    }catch{if(mounted.current)setProductsError("商品清單未能讀取，已填內容仍保留。");}
    finally{if(mounted.current)setProductsLoading(false);}
  }
  async function refreshDrafts(){
    const snapshot=await onRefresh();
    if(!snapshot)return undefined;
    return merge(snapshot);
  }
  async function saveRows(requested:string[]){
    if(lock.current||busy||!canReview||!ready)return;
    const retry=failedRowRef.current;
    if(retry&&!requested.includes(retry)){setNotice("請先重試尚未完成儲存的資料，或還原該列後再繼續。");return;}
    const targets=retry?[retry,...requested.filter(row=>row!==retry)]:requested;
    lock.current=true;setWorking(true);setNotice("");
    try{
      for(const row of targets){
        if(!latest.current.canReview||latest.current.busy)throw Error("RECEIPT_REVIEWER_REQUIRED");
        let draft=draftsRef.current[row];if(!draft)continue;
        if(draft.acknowledged){
          const synced=await refreshDrafts();
          if(!synced||synced[row]?.acknowledged){setNotice("修改已送出，正在確認最新資料；請重新讀取後再繼續。");return;}
          draft=synced[row];
        }
        if(!isReceiptReviewDirty(draft)){
          if(failedRowRef.current===row){setNotice("這列仍有尚未確認的儲存結果，請重新讀取並還原本列後再繼續。");return;}
          continue;
        }
        if(chain&&draft.mappingMode==="CREATE"){setRowErrors(previous=>({...previous,[row]:"連鎖門市請選擇既有商品，或保留為尚未對應。"}));return;}
        const error=receiptReviewDraftError(draft);
        if(error){setRowErrors(previous=>({...previous,[row]:draftErrorMessage(error)}));return;}
        setSavingRow(row);setRowErrors(previous=>({...previous,[row]:""}));
        const result=await operation.run("receipt.edit-card",buildReceiptReviewPayload(draft));
        if(!result){
          markFailure(row);
          setRowErrors(previous=>({...previous,[row]:"儲存尚未確認，修改內容已保留，請重試儲存本列。"}));
          return;
        }
        markFailure(null);
        commit({...draftsRef.current,[row]:acknowledgeReceiptReviewSave(draft)});
        const synced=await refreshDrafts();
        if(!synced||synced[row]?.acknowledged){setNotice("修改已儲存，最新資料尚未讀取完成；請重新讀取後再繼續。");return;}
      }
      setNotice("修改已儲存。");
    }catch(error){setNotice(receiptError(error));}
    finally{lock.current=false;if(mounted.current){setWorking(false);setSavingRow(null);}}
  }
  async function reload(){
    if(lock.current||busy)return;
    lock.current=true;setWorking(true);setNotice("");
    try{if(!await refreshDrafts())setNotice("最新資料尚未讀取完成，您的修改仍保留，請再試一次。");}
    catch(error){setNotice(receiptError(error));}
    finally{lock.current=false;if(mounted.current)setWorking(false);}
  }
  async function resetRow(row:string){
    if(lock.current||busy||!canReview)return;
    lock.current=true;setWorking(true);setNotice("");
    try{
      const snapshot=await onRefresh();
      if(!snapshot){setNotice("尚未取得最新資料，修改仍保留。");return;}
      const next=merge(snapshot);
      commit({...next,[row]:createReceiptReviewDraft(snapshotFor(row,snapshot))});
      setRowErrors(previous=>({...previous,[row]:""}));if(failedRowRef.current===row)markFailure(null);
    }catch(error){setNotice(receiptError(error));}
    finally{lock.current=false;if(mounted.current)setWorking(false);}
  }
  async function setLineDecision(row:string,decision:'INCLUDE'|'IGNORE'){
    if(lock.current||busy||!canReview||!ready)return;
    lock.current=true;setWorking(true);setNotice("");
    try{
      const result=await supabase.rpc("set_baihuayuan_receipt_line_decision",{
        p_store_id:storeId,p_batch_id:batchId,p_run_id:runId,p_row_key:row,p_decision:decision
      });
      if(result.error)throw result.error;
      const refreshed=await onRefresh();
      if(refreshed)merge(refreshed);
      setNotice(decision==='IGNORE'?"已忽略此列；原始辨識資料仍保留。":"已納入本次進貨，請確認內容後再完成建檔。");
    }catch(error){setNotice(receiptError(error));}
    finally{lock.current=false;if(mounted.current)setWorking(false);}
  }
  async function confirmMissingDocumentFields(){
    if(lock.current||busy||!canReview||!missingDocumentFields.length)return;
    lock.current=true;setWorking(true);setNotice("");
    try{
      const result=await supabase.rpc("confirm_baihuayuan_receipt_missing_fields",{
        p_store_id:storeId,
        p_batch_id:batchId,
        p_run_id:runId,
        p_field_ids:missingDocumentFields.map(field=>field.id),
      });
      if(result.error)throw result.error;
      const refreshed=await onRefresh();
      if(refreshed)merge(refreshed);
      setNotice("已確認原單未提供這些金額欄位。");
    }catch(error){setNotice(receiptError(error));}
    finally{lock.current=false;if(mounted.current)setWorking(false);}
  }
  async function applyExactProductMatches(){
    if(lock.current||busy||!canReview||!ready)return;
    let options=products;
    if(!options.length){
      setProductsLoading(true);setProductsError("");
      try{
        const result=await supabase.rpc("app_workspace",{p_store_id:storeId,p_section:"product-options",p_filter:{}});
        if(result.error)throw result.error;
        const data=result.data as unknown as {products?:Product[]};
        if(!Array.isArray(data.products))throw Error("PRODUCT_OPTIONS_UNAVAILABLE");
        options=data.products;
        if(mounted.current)setProducts(options);
      }catch{if(mounted.current)setProductsError("商品清單未能讀取，請改用逐項確認。");return;}
      finally{if(mounted.current)setProductsLoading(false);}
    }
    let next=draftsRef.current;
    let matched=0;
    for(const row of lineRows){
      const draft=next[row];if(!draft)continue;
      if(draft.initialMapping?.product_id||draft.mappingMode==="SELECT"&&draft.productId||draft.mappingMode==="CREATE")continue;
      const productName=String(draftValue(row,"product")||"").trim().toLocaleLowerCase();
      const unit=String(draftValue(row,"unit")||"").trim().toLocaleLowerCase();
      const candidates=options.filter(product=>product.name.trim().toLocaleLowerCase()===productName&&String(product.base_unit||"").trim().toLocaleLowerCase()===unit);
      if(candidates.length===1){
        next={...next,[row]:updateReceiptReviewMapping(draft,"SELECT",candidates[0].id)};
        matched++;
      }
    }
    if(matched){commit(next);setExpandedRows(rows=>[...new Set([...rows,...unmappedRows])]);setNotice(`已找到 ${matched} 項同名同單位商品，請儲存修改後再完成建檔。`);}
    else setNotice("沒有找到可安全自動對應的同名同單位商品，請逐項確認。");
  }
  async function saveManualLine(){
    if(lock.current||busy||!canReview||!ready)return;
    const quantity=Number(manualDraft.quantity),price=manualDraft.unit_price.trim()===""?null:Number(manualDraft.unit_price);
    if(!manualDraft.product_name.trim()||!manualDraft.unit.trim()||!Number.isFinite(quantity)||quantity<=0||price!==null&&(!Number.isFinite(price)||price<0)){
      setNotice("請填寫品名、單位與有效數量；單價可留空。");return;
    }
    lock.current=true;setWorking(true);setNotice("");
    try{
      const result=await supabase.rpc("save_baihuayuan_manual_receipt_line",{
        p_store_id:storeId,p_batch_id:batchId,p_run_id:runId,
        p_supplier_name:manualDraft.supplier_name.trim()||String(draftValue("document","supplier_name")||""),
        p_product_name:manualDraft.product_name.trim(),p_specification:manualDraft.specification.trim(),
        p_unit:manualDraft.unit.trim(),p_quantity:quantity,p_unit_price:price,p_note:manualDraft.note.trim(),
        p_line_id:manualEditId
      });
      if(result.error)throw result.error;
      setManualDraft({supplier_name:"",product_name:"",specification:"",unit:"",quantity:"",unit_price:"",note:""});
      setManualEditId(null);setManualOpen(false);await onRefresh();setNotice("新增明細已儲存。");
    }catch(error){setNotice(receiptError(error));}
    finally{lock.current=false;if(mounted.current)setWorking(false);}
  }
  async function setManualDeleted(line:ReceiptManualLine,deleted:boolean){
    if(lock.current||busy||!canReview||!ready)return;
    lock.current=true;setWorking(true);setNotice("");
    try{
      const result=await supabase.rpc("set_baihuayuan_manual_receipt_line_deleted",{p_store_id:storeId,p_batch_id:batchId,p_line_id:line.id,p_deleted:deleted});
      if(result.error)throw result.error;
      await onRefresh();setNotice(deleted?"已刪除這筆新增明細；仍可復原。":"已復原這筆新增明細。");
    }catch(error){setNotice(receiptError(error));}
    finally{lock.current=false;if(mounted.current)setWorking(false);}
  }
  async function completeReview(){
    if(lock.current||busy||!canReview||!ready)return;
    if(failedRowRef.current||hasChangedSource(draftsRef.current,latest.current)||Object.values(draftsRef.current).some(draft=>isReceiptReviewDirty(draft)||draft.acknowledged||receiptReviewDraftError(draft))){setNotice("請先儲存所有修改，再完成建檔。");return;}
    lock.current=true;setWorking(true);setNotice("");
    try{await onComplete();}
    catch(error){setNotice(receiptError(error));}
    finally{lock.current=false;if(mounted.current)setWorking(false);}
  }

  const rowKeys=orderedRows(drafts),allLineRows=rowKeys.filter(row=>row!=="document");
  const stateMap=new Map(lineStates.map(item=>[item.row_key,item]));
  const lineRows=allLineRows.filter(row=>stateMap.get(row)?.included!==false);
  const ignoredRows=allLineRows.filter(row=>stateMap.get(row)?.included===false);
  const activeManualLines=manualLines.filter(line=>!line.deleted_at);
  const deletedManualLines=manualLines.filter(line=>!!line.deleted_at);
  const missingDocumentFields=fields.filter(field=>field.row_key==="document"&&["subtotal_ex_tax","tax","total_inc_tax"].includes(field.field_name)&&field.review_status!=="TRUSTED"&&!field.corrected&&(field.value===null||field.value===undefined||field.value===""));
  const unmappedRows=lineRows.filter(row=>{
    const draft=drafts[row];
    if(!draft)return false;
    if(draft.mappingMode==="SELECT"&&draft.productId)return false;
    if(draft.mappingMode==="CREATE")return false;
    const mapped=draft.initialMapping?.product_id||"";
    return !mapped;
  });
  const dirtyRows=rowKeys.filter(row=>isReceiptReviewDirty(drafts[row]));
  const pendingSync=rowKeys.some(row=>drafts[row].acknowledged);
  const invalid=hasChangedSource(drafts,{fields,mappings})||rowKeys.some(row=>!!receiptReviewDraftError(drafts[row]));
  const disabled=!ready||busy||working||operation.busy||!canReview;
  const input=(row:string,field:ReceiptField)=>{
    const draft=drafts[row],label=labels[field.field_name]||"其他資料";
    return <label className="receipt-desktop-input" key={field.id}><span>{label}</span><input aria-label={`${row==="document"?"貨單":`第 ${lineRows.indexOf(row)+1} 項`} ${label}`} type="text" inputMode={numericFields.has(field.field_name)?"decimal":undefined} value={draft.values[field.id]??""} placeholder="未提供" disabled={disabled||draft.acknowledged||failedRow===row} onChange={event=>editField(row,field.id,event.target.value)}/></label>;
  };
  const rowStatus=(row:string)=>{
    const draft=drafts[row],dirty=isReceiptReviewDirty(draft),validation=receiptReviewDraftError(draft),error=rowErrors[row]||(validation?draftErrorMessage(validation):null);
    return <div className="receipt-desktop-row-status" data-state={error?"error":dirty?"dirty":"saved"}><span>{savingRow===row?"儲存中…":draft.acknowledged?"已儲存，待讀取確認":dirty?"尚未儲存":"已儲存"}</span>{error&&<p role="alert">{failedRow===row&&operation.error?operation.error:error}</p>}{(dirty||draft.acknowledged||failedRow===row)&&<div><button type="button" className="shell-secondary" disabled={disabled||!!failedRow&&failedRow!==row} onClick={()=>void saveRows([row])}>{failedRow===row?"重試儲存":"儲存本列"}</button><button type="button" className="text-button" disabled={disabled} onClick={()=>void resetRow(row)}>還原本列（捨棄修改）</button></div>}</div>;
  };
  const mapping=(row:string)=>{
    const draft=drafts[row],original=draft.initialMapping;
    const title=draft.mappingMode==="NONE"?"尚未對應":draft.mappingMode==="CREATE"?"建立新商品":products.find(product=>product.id===draft.productId)?.name||(draft.productId===original?.product_id?original.name:"已選商品")||"尚未對應";
    return <details className="receipt-desktop-mapping" onToggle={event=>{if(event.currentTarget.open)void loadProducts();}}><summary>商品對應・{title}</summary><label className="field">對應商品<select aria-label={`第 ${lineRows.indexOf(row)+1} 項 對應商品`} value={draft.mappingMode==="CREATE"?"__new":draft.productId} disabled={disabled||productsLoading||draft.acknowledged||failedRow===row} onChange={event=>editMapping(row,event.target.value)}><option value="">未確認，保留原始資料</option>{original?.product_id&&!products.some(product=>product.id===original.product_id)&&<option value={original.product_id}>{original.name||"原對應商品"}</option>}{draft.mappingMode==="SELECT"&&draft.productId!==original?.product_id&&!products.some(product=>product.id===draft.productId)&&<option value={draft.productId}>已選商品</option>}{products.map(product=><option key={product.id} value={product.id}>{product.name}・{product.base_unit} {product.specification}</option>)}{!chain&&<option value="__new">依本次品名與單位建立商品</option>}</select></label>{productsError&&<p role="alert">{productsError}<button type="button" className="text-button" onClick={()=>void loadProducts(true)}>重新讀取商品</button></p>}</details>;
  };
  const draftValue=(row:string,name:string)=>{const field=drafts[row]?.snapshot.find(field=>field.field_name===name);return field?drafts[row].values[field.id]:null;};
  const ocrTotals=receiptReviewTotals(lineRows.map(row=>({quantity:draftValue(row,"quantity"),price:draftValue(row,"unit_price_ex_tax")})),draftValue("document","tax"));
  const manualSubtotal=activeManualLines.reduce((sum,line)=>sum+Number(line.line_subtotal_ex_tax||0),0);
  const totals={...ocrTotals,subtotal:ocrTotals.subtotal===null&&activeManualLines.length?manualSubtotal:ocrTotals.subtotal===null?null:ocrTotals.subtotal+manualSubtotal,total:ocrTotals.total===null?null:ocrTotals.total+manualSubtotal};
  const money=(value:unknown)=>{const amount=receiptSubtotal(1,value);return amount===null?"未提供":`NT$ ${amount.toLocaleString("zh-TW",{maximumFractionDigits:2})}`;};
  const sourceSubtotal=receiptSubtotal(1,draftValue("document","subtotal_ex_tax")),sourceTotal=receiptSubtotal(1,draftValue("document","total_inc_tax"));
  const totalsDiffer=(totals.subtotal!==null&&sourceSubtotal!==null&&Math.abs(totals.subtotal-sourceSubtotal)>.01)||(totals.total!==null&&sourceTotal!==null&&Math.abs(totals.total-sourceTotal)>.01);
  const toggleRow=(row:string)=>setExpandedRows(current=>current.includes(row)?current.filter(value=>value!==row):[...current,row]);
  const code=(row:string)=>{
    const draft=drafts[row];
    if(draft.mappingMode==="NONE")return "待對應";
    if(draft.mappingMode==="CREATE")return "儲存後帶入";
    return mappings.find(item=>item.row_key===row&&item.product_id===draft.productId)?.code|| (draft.productId?"儲存後帶入":"待對應");
  };
  return <section className="receipt-desktop-review">
    <div className="receipt-desktop-heading"><div><h2>貨單內容核對</h2><p>系統已先整理資料；有錯就修改、多抓就刪除、漏抓就新增。</p></div><button type="button" className="shell-secondary" onClick={()=>setSourceVisible(value=>!value)} aria-expanded={sourceVisible}>{sourceVisible?"收起原單":"顯示原單"}</button></div>
    {navigation?.(disabled||!!storageError&&!!dirtyRows.length)}
    {restored&&<p className="receipt-desktop-notice" role="status">已恢復這張貨單尚未完成的修改。</p>}
    {storageError&&<p className="receipt-desktop-notice" role="alert">{storageError}</p>}
    {!canReview&&<p className="receipt-desktop-notice">目前無法修改這張貨單，已填草稿仍保留。</p>}
    <div ref={layoutRef} className={`receipt-desktop-layout${sourceVisible?"":" source-hidden"}`} style={{"--receipt-source-width":`${sourceWidth}%`} as CSSProperties}>
      {sourceVisible&&<><aside className="receipt-desktop-source" aria-label="原始貨單">{pictures}</aside><div className="receipt-desktop-divider" role="separator" aria-label="調整原單寬度" aria-orientation="vertical" aria-valuemin={30} aria-valuemax={65} aria-valuenow={sourceWidth} tabIndex={0}
        onKeyDown={event=>{if(event.key==="ArrowLeft"||event.key==="ArrowRight"){event.preventDefault();setSourceWidth(width=>Math.min(65,Math.max(30,width+(event.key==="ArrowRight"?2:-2))));}}}
        onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();}}
        onPointerMove={event=>{if(!event.currentTarget.hasPointerCapture(event.pointerId))return;const rect=layoutRef.current?.getBoundingClientRect();if(rect)setSourceWidth(Math.min(65,Math.max(30,Math.round((event.clientX-rect.left)/rect.width*100))));}}
        onPointerUp={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}/></>}
      <div className="receipt-desktop-content">
        {drafts.document&&<section className="receipt-desktop-document">
          <div className="receipt-desktop-basics">{drafts.document.snapshot.filter(field=>field.field_name==="supplier_name").map(field=>input("document",field))}
            <div className="receipt-desktop-date"><span>進貨日期</span><strong>{draftValue("document","receipt_date")||"待確認"}</strong><details><summary>修改日期</summary>{drafts.document.snapshot.filter(field=>field.field_name==="receipt_date").map(field=>input("document",field))}</details></div>
          </div>
          <div className="receipt-desktop-document-meta"><span>單號：{draftValue("document","document_number")||"未提供"}</span><details className="receipt-desktop-more"><summary>更多資料</summary><div className="receipt-desktop-field-grid">{drafts.document.snapshot.filter(field=>!["supplier_name","receipt_date","subtotal_ex_tax","tax","total_inc_tax"].includes(field.field_name)).map(field=>input("document",field))}</div></details></div>
          {(isReceiptReviewDirty(drafts.document)||drafts.document.acknowledged||rowErrors.document)&&rowStatus("document")}
        </section>}
        <div className="receipt-desktop-table-wrap"><table className="receipt-desktop-table receipt-simple-table"><thead><tr>{columns.map(column=><th key={column}>{column==="specification"?"規格／備註":labels[column]}</th>)}<th>未稅金額</th><th>操作</th></tr></thead><tbody>{lineRows.map((row,index)=>{
          const draft=drafts[row],extras=draft.snapshot.filter(field=>!columns.includes(field.field_name)&&field.field_name!=="note"),expanded=expandedRows.includes(row);
          const subtotal=receiptSubtotal(draftValue(row,"quantity"),draftValue(row,"unit_price_ex_tax"));
          const error=rowErrors[row]||receiptReviewDraftError(draft),dirty=isReceiptReviewDirty(draft)||draft.acknowledged;
          return <ReceiptDesktopRow key={row} fields={<tr className={error?"has-error":dirty?"is-dirty":""}>{columns.map(column=><td key={column}>{draft.snapshot.filter(field=>field.field_name===column||column==="specification"&&field.field_name==="note").map(field=>input(row,field))}{!draft.snapshot.some(field=>field.field_name===column)&&<span className="receipt-missing">需確認</span>}</td>)}<td className="receipt-line-amount">{money(subtotal)}</td><td><div className="receipt-row-actions"><button type="button" className="text-button" onClick={()=>toggleRow(row)}>修改</button><button type="button" className="text-button danger-text" onClick={()=>void setLineDecision(row,'IGNORE')}>刪除</button></div></td></tr>} details={<tr className="receipt-desktop-row-details" hidden={!expanded&&!error}><td colSpan={7}><span className="receipt-desktop-line-number">第 {index+1} 項</span>{!!extras.length&&<div className="receipt-desktop-field-grid">{extras.map(field=>input(row,field))}</div>}{rowStatus(row)}</td></tr>}/>;
        })}
        {activeManualLines.map(line=><tr key={line.id} className="manual-receipt-row"><td><strong>{line.product_name}</strong></td><td>{line.specification||"—"}</td><td>{line.unit}</td><td>{line.quantity}</td><td>{line.unit_price_ex_tax===null?"—":money(line.unit_price_ex_tax)}</td><td>{line.line_subtotal_ex_tax===null?"—":money(line.line_subtotal_ex_tax)}</td><td><div className="receipt-row-actions"><button type="button" className="text-button" onClick={()=>{setManualEditId(line.id);setManualDraft({supplier_name:line.supplier_name,product_name:line.product_name,specification:line.specification,unit:line.unit,quantity:String(line.quantity),unit_price:line.unit_price_ex_tax===null?"":String(line.unit_price_ex_tax),note:line.note});setManualOpen(true);}}>修改</button><button type="button" className="text-button danger-text" onClick={()=>void setManualDeleted(line,true)}>刪除</button></div></td></tr>)}
        </tbody></table></div>
        <div className="receipt-add-row-bar"><button type="button" className="text-button receipt-add-missing" disabled={disabled} onClick={()=>{setManualEditId(null);setManualDraft({supplier_name:String(draftValue("document","supplier_name")||""),product_name:"",specification:"",unit:"",quantity:"",unit_price:"",note:""});setManualOpen(true);}}>＋ 補上漏掉的品項</button><span>只有原單有、系統沒抓到時才需要。</span></div>
        {manualOpen&&<section className="shell-card receipt-manual-form"><div className="shell-section-head"><h2>{manualEditId?"修改新增明細":"新增進貨明細"}</h2></div><div className="receipt-manual-grid"><label><span>供應商</span><input value={manualDraft.supplier_name} onChange={e=>setManualDraft({...manualDraft,supplier_name:e.target.value})} placeholder={String(draftValue("document","supplier_name")||"本張貨單供應商")}/></label><label><span>品名</span><input value={manualDraft.product_name} onChange={e=>setManualDraft({...manualDraft,product_name:e.target.value})} required/></label><label><span>規格／備註</span><input value={manualDraft.specification} onChange={e=>setManualDraft({...manualDraft,specification:e.target.value})}/></label><label><span>單位</span><input value={manualDraft.unit} onChange={e=>setManualDraft({...manualDraft,unit:e.target.value})} required/></label><label><span>數量</span><input type="number" min="0.000001" step="any" value={manualDraft.quantity} onChange={e=>setManualDraft({...manualDraft,quantity:e.target.value})} required/></label><label><span>未稅單價</span><input type="number" min="0" step="any" value={manualDraft.unit_price} onChange={e=>setManualDraft({...manualDraft,unit_price:e.target.value})}/></label></div><label className="receipt-manual-note"><span>備註</span><input value={manualDraft.note} onChange={e=>setManualDraft({...manualDraft,note:e.target.value})}/></label><div className="receipt-manual-actions"><button type="button" className="shell-secondary" onClick={()=>{setManualOpen(false);setManualEditId(null);}}>取消</button><button type="button" className="shell-primary" disabled={working} onClick={()=>void saveManualLine()}>{working?"儲存中…":"儲存明細"}</button></div></section>}
        {(ignoredRows.length>0||deletedManualLines.length>0)&&<details className="receipt-ignored-lines"><summary>已刪除（{ignoredRows.length+deletedManualLines.length} 項）</summary><div className="shell-card shell-list">{ignoredRows.map(row=><div className="shell-list-row" key={row}><span><strong>{String(draftValue(row,"product")||"未命名品項")}</strong><small>{String(draftValue(row,"unit")||"單位未提供")}・原始 OCR 保留</small></span><button type="button" className="text-button" onClick={()=>void setLineDecision(row,'INCLUDE')}>復原</button></div>)}{deletedManualLines.map(line=><div className="shell-list-row" key={line.id}><span><strong>{line.product_name}</strong><small>{line.quantity} {line.unit}</small></span><button type="button" className="text-button" onClick={()=>void setManualDeleted(line,false)}>復原</button></div>)}</div></details>}
        <section className="receipt-desktop-totals" aria-label="本張貨單合計">
          <div><span>明細未稅合計</span><strong>{money(totals.subtotal)}</strong></div><div><span>原單稅額</span><strong>{money(totals.tax)}</strong></div><div><span>試算含稅合計</span><strong>{money(totals.total)}</strong></div>
          <p>原單未稅合計 {money(sourceSubtotal)}・原單含稅合計 {money(sourceTotal)}</p>
          {totalsDiffer&&<p role="status">目前明細金額與原單不同，請對照原單確認。</p>}
          {drafts.document&&<details><summary>需要時修改原單金額</summary><div className="receipt-desktop-field-grid">{drafts.document.snapshot.filter(field=>["subtotal_ex_tax","tax","total_inc_tax"].includes(field.field_name)).map(field=>input("document",field))}</div></details>}
        </section>
      </div>
    </div>
    <div className="receipt-desktop-footer"><span>{dirtyRows.length?`${dirtyRows.length} 列尚未儲存`:pendingSync?"正在確認最新資料":"修改已儲存"}</span><button type="button" className="shell-secondary" disabled={disabled||(!dirtyRows.length&&!pendingSync)} onClick={()=>void saveRows(rowKeys.filter(row=>isReceiptReviewDirty(drafts[row])||drafts[row].acknowledged))}>{working?"處理中…":"儲存修改"}</button><button type="button" className="shell-primary" disabled={disabled||!!dirtyRows.length||pendingSync||invalid||!!failedRow||(!lineRows.length&&!activeManualLines.length)} onClick={()=>void completeReview()}>完成建檔</button></div>
    {(notice||pendingSync)&&<p className="receipt-desktop-notice" role="status">{notice||"修改已儲存，正在確認最新資料。"}<button type="button" className="text-button" disabled={busy||working} onClick={()=>void reload()}>重新讀取</button></p>}
  </section>;
}

function ReceiptDesktopRow({fields,details}:{fields:ReactNode;details:ReactNode}){return <>{fields}{details}</>;}
