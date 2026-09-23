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
export type ReceiptDesktopSnapshot={fields:ReceiptField[];mappings:ReceiptDesktopMapping[]};
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

export default function ReceiptDesktopReview({storeId,userId,batchId,runId,fields,mappings,chain,canReview,busy,pictures,navigation,onRefresh,onComplete}:Props){
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
    await loadProducts();
    let next=draftsRef.current;
    let matched=0;
    for(const row of lineRows){
      const draft=next[row];if(!draft)continue;
      if(draft.initialMapping?.product_id||draft.mappingMode==="SELECT"&&draft.productId||draft.mappingMode==="CREATE")continue;
      const productName=String(draftValue(row,"product")||"").trim().toLocaleLowerCase();
      const unit=String(draftValue(row,"unit")||"").trim().toLocaleLowerCase();
      const candidates=products.filter(product=>product.name.trim().toLocaleLowerCase()===productName&&String(product.base_unit||"").trim().toLocaleLowerCase()===unit);
      if(candidates.length===1){
        next={...next,[row]:updateReceiptReviewMapping(draft,"SELECT",candidates[0].id)};
        matched++;
      }
    }
    if(matched){commit(next);setExpandedRows(rows=>[...new Set([...rows,...unmappedRows])]);setNotice(`已找到 ${matched} 項同名同單位商品，請儲存修改後再完成建檔。`);}
    else setNotice("沒有找到可安全自動對應的同名同單位商品，請逐項確認。");
  }
  async function completeReview(){
    if(lock.current||busy||!canReview||!ready)return;
    if(missingDocumentFields.length){setNotice("原單有未提供的金額欄位，請先確認「原單未提供」。");return;}
    if(unmappedRows.length){setExpandedRows(rows=>[...new Set([...rows,...unmappedRows])]);void loadProducts();setNotice(`尚有 ${unmappedRows.length} 項商品未對應，請先完成商品對應。`);return;}
    if(failedRowRef.current||hasChangedSource(draftsRef.current,latest.current)||Object.values(draftsRef.current).some(draft=>isReceiptReviewDirty(draft)||draft.acknowledged||receiptReviewDraftError(draft))){setNotice("請先儲存所有修改並修正提示，再完成資料核對。");return;}
    lock.current=true;setWorking(true);setNotice("");
    try{await onComplete();}
    catch(error){setNotice(receiptError(error));}
    finally{lock.current=false;if(mounted.current)setWorking(false);}
  }

  const rowKeys=orderedRows(drafts),lineRows=rowKeys.filter(row=>row!=="document");
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
  const totals=receiptReviewTotals(lineRows.map(row=>({quantity:draftValue(row,"quantity"),price:draftValue(row,"unit_price_ex_tax")})),draftValue("document","tax"));
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
    <div className="receipt-desktop-heading"><div><h2>進貨明細核對</h2><p>對照原單逐列核對・按 Tab 移到下一欄</p></div><button type="button" className="shell-secondary" onClick={()=>setSourceVisible(value=>!value)} aria-expanded={sourceVisible}>{sourceVisible?"收起原單":"顯示原單"}</button></div>
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
        <div className="receipt-desktop-table-wrap"><table className="receipt-desktop-table"><thead><tr><th>編碼</th>{columns.map(column=><th key={column}>{column==="specification"?"規格／備註":labels[column]}</th>)}<th>未稅金額</th><th><span className="sr-only">更多與狀態</span></th></tr></thead><tbody>{lineRows.map((row,index)=>{
          const draft=drafts[row],extras=draft.snapshot.filter(field=>!columns.includes(field.field_name)&&field.field_name!=="note"),expanded=expandedRows.includes(row);
          const subtotal=receiptSubtotal(draftValue(row,"quantity"),draftValue(row,"unit_price_ex_tax"));
          const error=rowErrors[row]||receiptReviewDraftError(draft),dirty=isReceiptReviewDirty(draft)||draft.acknowledged;
          return <ReceiptDesktopRow key={row} fields={<tr className={error?"has-error":dirty?"is-dirty":""}><td><button type="button" className="receipt-code" aria-label={`第 ${index+1} 項 編碼與商品對應`} aria-expanded={expanded} onClick={()=>toggleRow(row)}>{code(row)}</button></td>{columns.map(column=><td key={column}>{draft.snapshot.filter(field=>field.field_name===column||column==="specification"&&field.field_name==="note").map(field=>input(row,field))}{!draft.snapshot.some(field=>field.field_name===column)&&<span>未提供</span>}</td>)}<td className="receipt-line-amount">{money(subtotal)}</td><td><button type="button" className="receipt-row-toggle" aria-label={`第 ${index+1} 項 ${error?"檢查錯誤":dirty?"未儲存，更多資料":"更多資料"}`} aria-expanded={expanded} onClick={()=>toggleRow(row)}>{error?"!":dirty?"●":"⋯"}</button></td></tr>} details={<tr className="receipt-desktop-row-details" hidden={!expanded&&!error}><td colSpan={8}><span className="receipt-desktop-line-number">第 {index+1} 項・原始明細</span>{!!extras.length&&<div className="receipt-desktop-field-grid">{extras.map(field=>input(row,field))}</div>}{mapping(row)}{rowStatus(row)}</td></tr>}/>;
        })}</tbody></table></div>
        <section className="receipt-review-readiness">
          <div className="shell-section-head"><div><h2>完成前檢查</h2><small>確認這張貨單可以準確建檔。</small></div></div>
          <div className="receipt-review-readiness-grid">
            <div data-state={unmappedRows.length?"warn":"ok"}><span>商品對應</span><strong>{unmappedRows.length?unmappedRows.length+" 項待處理":"完成"}</strong>{unmappedRows.length>0&&<button type="button" className="text-button" disabled={disabled||productsLoading} onClick={()=>void applyExactProductMatches()}>{productsLoading?"讀取商品中…":"自動對應同名商品"}</button>}</div>
            <div data-state={missingDocumentFields.length?"warn":"ok"}><span>原單金額欄位</span><strong>{missingDocumentFields.length?missingDocumentFields.length+" 欄待確認":"完成"}</strong>{missingDocumentFields.length>0&&<button type="button" className="text-button" disabled={disabled} onClick={()=>void confirmMissingDocumentFields()}>確認原單未提供</button>}</div>
            <div data-state={totalsDiffer?"warn":"ok"}><span>金額試算</span><strong>{totalsDiffer?"需要核對":"通過"}</strong></div>
          </div>
        </section>
        <section className="receipt-desktop-totals" aria-label="本張貨單合計">
          <div><span>明細未稅合計</span><strong>{money(totals.subtotal)}</strong></div><div><span>原單稅額</span><strong>{money(totals.tax)}</strong></div><div><span>試算含稅合計</span><strong>{money(totals.total)}</strong></div>
          <p>原單未稅合計 {money(sourceSubtotal)}・原單含稅合計 {money(sourceTotal)}</p>
          {totalsDiffer&&<p role="status">明細計算與原單合計不同，請核對金額、折讓及稅額。</p>}
          {totals.tax===null&&<p>稅額未提供，請依原單確認；不自動套用稅率。</p>}
          {drafts.document&&<details><summary>修改原單合計與稅額</summary><div className="receipt-desktop-field-grid">{drafts.document.snapshot.filter(field=>["subtotal_ex_tax","tax","total_inc_tax"].includes(field.field_name)).map(field=>input("document",field))}</div></details>}
        </section>
      </div>
    </div>
    <div className="receipt-desktop-footer"><span>{dirtyRows.length?`${dirtyRows.length} 列尚未儲存`:pendingSync?"正在確認最新資料":"修改已儲存"}</span><button type="button" className="shell-secondary" disabled={disabled||(!dirtyRows.length&&!pendingSync)} onClick={()=>void saveRows(rowKeys.filter(row=>isReceiptReviewDirty(drafts[row])||drafts[row].acknowledged))}>{working?"處理中…":"儲存修改"}</button><button type="button" className="shell-primary" disabled={disabled||!!dirtyRows.length||pendingSync||invalid||!!failedRow||!lineRows.length} onClick={()=>void completeReview()}>完成資料核對</button></div>
    {(notice||pendingSync)&&<p className="receipt-desktop-notice" role="status">{notice||"修改已儲存，正在確認最新資料。"}<button type="button" className="text-button" disabled={busy||working} onClick={()=>void reload()}>重新讀取</button></p>}
  </section>;
}

function ReceiptDesktopRow({fields,details}:{fields:ReactNode;details:ReactNode}){return <>{fields}{details}</>;}
