'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {operationRecordStatus} from '@/lib/operation-integrity';
import {validatePurchaseSpecification} from '@/lib/purchase-specification';
import {automaticCostGuard,applyCostQuotes,loadUncountedInventoryPrices,costBasisNote,restoreCostBasis,type CostQuote} from '@/lib/cost-price';
import OperationsSheet from './operations-sheet';
import InventoryValuationDialog from './inventory-valuation-dialog';
import type {InventoryPriceOffer,InventoryValuationChoice} from '@/lib/inventory-valuation';
import ReceiptReviewWorkbench from './receipt-review-workbench';
import ReceiptOriginalDialog from './receipt-original-dialog';
import './receipt-handling.css';
import {supabase} from '@/lib/supabase-browser';
import {operationDeadline} from '@/lib/operation-deadline';
import {readScopedReceiptAccounts,saveReceiptReview} from '@/lib/receipt-accounting-api';
import {receiptCustodyLabel,receiptFinanceSent,reviewDraft,reviewPayload,type ReviewAccount} from '@/lib/receipt-review';
import {canExportData,writeOperation,type AppStore} from '@/lib/app-workspace';
import {inventoryPurchases,monthlyDisplayRows,inventoryFieldNotes,inventoryStorageZones,inventoryEditExpected,type InventoryMonth,type InventoryRow} from '@/lib/inventory-monthly';
import {inventoryAccountLines,inventoryMonthEnd,inventoryOriginalPurchaseLabel,inventoryPriceSource} from '@/lib/inventory-cost';
import {type CatalogItem} from './inventory-catalog';
import type {CountIngredientName} from '@/lib/ingredient-usage-names';
import {type Movement} from './transfers-workspace';
import {wasteReasons,type ExpiryWorkspaceData,type WasteRecord} from '@/lib/expiry-waste';
import {PRODUCT_CATEGORIES} from '@/lib/product-categories';
import {sheetRowInDateRange,sheetNumber,sheetMerge,transferDirectionValues,costingUnits,moneyAmount,type SheetKind,type SheetColumn,type SheetRow} from '@/lib/operations-sheet';
import {workMonthRange, splitWorkDateRange, validWorkDateRange, type WorkDateRange} from '@/lib/work-date-selection';
import type {SheetDraft} from '@/lib/operations-sheet-draft';
import {appendInventoryWorkbook,type InventoryExportLine} from '@/lib/inventory-workbook';
import {readInventoryExportData,readInventorySuppliers} from '@/lib/inventory-export-data';
import {supplierNameIndex,supplierNameKey} from '@/lib/supplier-prices';
type Props={userId:string;kind:SheetKind;store:AppStore;registerLeave?:(guard:(()=>Promise<boolean>)|null)=>void;onSpecial:(name:string,id?:string)=>void;initialMonth?:string;onMonthChange?:(month:string)=>void;initialDateRange?:WorkDateRange;onDateRangeChange?:(range:WorkDateRange)=>void;integrated?:boolean;refreshRevision?:number};
type TransferData={records:(Movement&{occurred_at?:string})[];products:{id:string;name:string;unit:string}[]};
type InventoryMeta={row?:InventoryRow;catalog?:CatalogItem};
const text=(v:unknown)=>v==null?'':String(v);
const day=(v:string)=>v?new Date(v).toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}):'';
const monthNow=()=>day(new Date().toISOString()).slice(0,7);
async function rpc(name:string,args:Record<string,unknown>,cancel?:AbortSignal){const r=await operationDeadline(signal=>(supabase.rpc as unknown as (n:string,a:Record<string,unknown>)=>{abortSignal:(signal:AbortSignal)=>PromiseLike<{data:unknown;error:{message:string}|null}>})(name,args).abortSignal(cancel?AbortSignal.any([signal,cancel]):signal));if(r.error)throw Error(r.error.message);return r.data;}
function friendly(error:unknown){const m=error&&typeof error==='object'&&'message' in error?String(error.message):String(error);if(m==='RECEIPT_PRICE_CHANGE_CANCELLED')return '進價待確認，貨單輸入已保留。';if(/REQUEST_TIMEOUT|timeout|timed out/i.test(m))return '連線逾時，輸入已保留。讀取請按「保留輸入並重試讀取」，儲存請重試原要求。';if(/INVALID_INVENTORY_VALUATION/.test(m))return '請核對計價單位與換算數量。';if(/COST_QUOTE_CHANGED/.test(m))return '進價已更新，尚未儲存。請重新讀取最新進價並確認後再儲存；原輸入保留。';if(/REVISION_CONFLICT|CHANGED/.test(m))return '資料已更新或這次要求已保存；輸入保留，請核對後重新讀取，避免覆蓋他人修改。';if(/PRODUCT_MATCH_REQUIRED/.test(m))return '品名與單位尚未對應唯一食材，請使用表格下拉建議的品名與單位。';if(/PRODUCT_REMOVED_OR_DISABLED/.test(m))return '品項已移除或停用，請先在已移除清單還原，或由品項管理重新啟用。';if(/COUNT_IN_PROGRESS/.test(m))return '此品項已有進行中的盤點數量，需完成盤點後再移除；原數量與歷史會保留。';if(/QUANTITY_LOCKED|UNIT_LOCKED|DIRECTION_LOCKED/.test(m))return '這筆已影響庫存或效期紀錄，數量、單位或方向須保留；仍可修改價格與備註。';return m;}
export default function UnifiedOperationsWorkspace({userId,kind,store,registerLeave,onSpecial,initialMonth,onMonthChange,initialDateRange,onDateRangeChange,integrated=false,refreshRevision=0}:Props){
 const [receiptTarget,setReceiptTarget]=useState<{batchId:string;rowKey?:string}|null>(null);
 const [priceOriginalId,setPriceOriginalId]=useState<string|null>(null);
 const [valuationTarget,setValuationTarget]=useState<SheetRow|null>(null);
 const readIngredientPrices=useCallback((query:string,cutoff:string,code:string,supplier:string,signal:AbortSignal)=>
  rpc('baihuayuan_inventory_price_lookup',{p_store_id:store.id,p_query:query,p_count_date:cutoff,
   p_preferred_code:code,p_supplier:supplier},signal) as Promise<InventoryPriceOffer[]>,[store.id]);
 const [showInventoryOpening,setShowInventoryOpening]=useState(false);
 const [month,setMonth]=useState(initialMonth||monthNow),[rows,setRows]=useState<SheetRow[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[products,setProducts]=useState<string[]>([]),[inventory,setInventory]=useState<InventoryMonth>(),[canAmount,setCanAmount]=useState(true);
 const [dateRange,setDateRange]=useState(() => initialDateRange && validWorkDateRange(initialDateRange) ? initialDateRange : workMonthRange(initialMonth || monthNow()));
 const rangeStart=dateRange.from,rangeEnd=dateRange.to;
 const draftMonth=kind==='inventory'?month:rangeStart.slice(0,7);
 const cloudDraft=useMemo(()=>({read:()=>rpc('baihuayuan_sheet_draft',{p_store_id:store.id,p_scope:kind,p_month:draftMonth}) as Promise<SheetDraft|null>,save:(rows:SheetRow[],expected:string|null,token:string)=>rpc('baihuayuan_sheet_draft',{p_store_id:store.id,p_scope:kind,p_month:draftMonth,p_action:'save',p_rows:rows,p_expected:expected,p_token:token}) as Promise<SheetDraft>}),[store.id,kind,draftMonth]);
 const accounts=useRef(new Map<string,ReviewAccount>()),generation=useRef(0),readController=useRef<AbortController|null>(null);
 const load=useCallback(async()=>{const seq=++generation.current;readController.current?.abort();const controller=new AbortController();readController.current=controller;setLoading(true);setError('');try{let next:SheetRow[]=[];let names:string[]=[];
 // Keep the month used by existing drafts available while filtering the visible rows by the applied dates.
 const readFrom=draftMonth+'-01';
 const readTo=rangeEnd>inventoryMonthEnd(draftMonth)?rangeEnd:inventoryMonthEnd(draftMonth);
 const range={from:`${readFrom}T00:00:00+08:00`,to:new Date(Date.parse(`${readTo}T00:00:00+08:00`)+86400000).toISOString()};
  if(kind==='receipt'){const list=await readScopedReceiptAccounts(store.id,controller.signal,readFrom,readTo,'ALL');if(seq!==generation.current)return;accounts.current=new Map(list.map(a=>[a.batch_id,a]));next=list.flatMap(a=>a.lines.map(l=>({id:`${a.batch_id}:${l.row_key}`,state:a.record_state,locked:!a.can_edit,values:{date:reviewDraft(a).date,supplier:a.supplier_name,receipt_categories:(a.receipt_categories||[]).join('、'),name:l.product_name,category:l.category,unit:l.unit,specification:l.specification,quantity:text(l.quantity),price:text(l.unit_price),amount:text(l.subtotal),note:l.note,handling:l.handling||'NORMAL',custody_remaining:text(l.custody_remaining),review_status:a.review_completed?'已完成核對':a.edit_revision?'待核對':'待建檔',finance_status:a.status==='CHECKED'?'已對帳':(a.entry_completed||a.review_completed||receiptFinanceSent(a))?'待對帳':'建檔中'},meta:{batch:a.batch_id,key:l.row_key,workDate:a.work_date,receipt_categories:a.receipt_categories||[]}})));}
  else if(kind==='inventory'){const [data,catalog,receipt,identities,suppliers]=await Promise.all([
   rpc('baihuayuan_inventory_month',{p_store_id:store.id,p_month:month+'-01',p_action:'read',p_data:{}}) as Promise<InventoryMonth>,
   rpc('get_pilot_inventory_catalog',{p_store_id:store.id}) as Promise<CatalogItem[]>,
   readScopedReceiptAccounts(store.id,controller.signal,'',inventoryMonthEnd(month),'ALL'),
   integrated?(rpc('get_count_ingredient_names',{p_store_id:store.id}) as Promise<CountIngredientName[]>).catch(()=>[]):[],
   integrated?readInventorySuppliers(store.id,controller.signal).catch(()=>[]):[],
  ]);
  const codes=new Map((identities||[]).map(identity=>[identity.product_id,identity.code]));
  data.rows=inventoryPurchases(data.rows,inventoryAccountLines(receipt),[],data.month);if(seq!==generation.current)return;setInventory(data);const current=monthlyDisplayRows(data.rows).filter(r=>!integrated||r.current_quantity!==null);next=current.map(r=>({id:r.row_key,state:!data.historical&&!data.closed&&catalog.find(c=>c.product_id===r.product_id)?.is_removed?'REMOVED':'LIVE',locked:data.closed||data.historical,values:{...(integrated?{code:codes.get(r.product_id)||'',original_purchase:inventoryOriginalPurchaseLabel(r.price_purchase)||inventoryOriginalPurchaseLabel(r.unit_price==null?null:{amount:r.unit_price,quantity:1,unit:r.unit}),price_pending:r.unit_price===null&&!!r.inventory_cost_quote?.purchase?'conversion':''}:{}),name:r.name,supplier:r.supplier,category:r.category,unit:r.unit,opening:text(r.previous_quantity),purchases:text(r.purchase_quantity),quantity:text(r.current_quantity),price:text(r.unit_price),amount:text(r.amount),price_source:inventoryPriceSource(r),price_batch_id:r.price_batch_id||'',note:r.review_note,field_note:inventoryFieldNotes(r),zone:inventoryStorageZones(r,catalog,data.closed||data.historical)},meta:{row:r,catalog:catalog.find(c=>c.product_id===r.product_id)}}));const used=new Set(current.map(r=>r.product_id));if(!integrated&&!data.historical&&!data.closed)next.push(...catalog.filter((c,i)=>!used.has(c.product_id)&&catalog.findIndex(x=>x.product_id===c.product_id)===i).map(c=>({id:`catalog:${c.product_id}`,state:c.is_removed?'REMOVED':'LIVE',locked:c.product_is_active===false||data.closed||data.historical,values:{name:c.name,supplier:c.supplier||'',category:'',unit:c.unit,opening:'',purchases:'',quantity:'',price:'',amount:'',price_source:'尚未讀取有效進價',note:'尚未列入此月份盤點',zone:c.zone},meta:{catalog:c}})));if(!data.historical&&!data.closed)next=await loadUncountedInventoryPrices(next,items=>rpc('baihuayuan_cost_quotes',{p_store_id:store.id,p_items:items.map(item=>({...item,date:inventoryMonthEnd(month)}))}) as Promise<CostQuote[]>);names=catalog.map(c=>c.name);
   if(suppliers.length){
    const index=supplierNameIndex(suppliers);
    next=next.map(row=>{
     const original=row.values.supplier||'';
     const matches=index.get(supplierNameKey(original));
     if(matches?.size!==1)return row;
     const supplier=[...matches.values()][0];
     return {...row,values:{...row.values,supplier:supplier.name,supplier_search:[original,...(supplier.aliases||[])].join(' ')}};
    });
   }
  }
  else {const flags=await rpc('get_baihuayuan_record_flags',{p_store_id:store.id,p_entity_type:kind==='transfer'?'TRANSFER':'WASTE'}) as {entity_id:string;state:string}[];const state=(id:string)=>flags.find(f=>f.entity_id===id)?.state||'LIVE';
   if(kind==='transfer'){const data=await rpc('app_workspace',{p_store_id:store.id,p_section:'transfers',p_filter:range},controller.signal) as TransferData;names=data.products.map(p=>p.name);next=data.records.filter(r=>r.kind==='TRANSFER').map(r=>({id:r.id,state:state(r.id),values:{date:day(r.occurred_at||r.created_at),from:r.from_name,to:r.to_name,direction:r.from_name==='BeApe'&&r.to_name==='Gras'?'一店→二店':r.from_name==='Gras'&&r.to_name==='BeApe'?'二店→一店':`${r.from_name}→${r.to_name}`,name:r.name,quantity:text(r.quantity),unit:r.unit,price:text(r.reference_price),amount:text(r.transfer_amount),actor:r.actor_name||'',note:r.note||'',price_source:r.note?.match(/〔進價來源：([^〕]*)〕/)?.[1]||(r.reference_price==null?'缺少相符價格或換算':'紀錄保存價格'),status:operationRecordStatus(r)},meta:{...r,...(r.review_status==='PENDING'&&r.cost_quote?{costQuote:r.cost_quote}:{})}}));}
   else{
    const waste:WasteRecord[]=[];
    for(const dates of splitWorkDateRange({from:readFrom,to:readTo},366)){
     const data=await rpc('get_pilot_expiry_waste',{p_store_id:store.id,p_from:dates.from,p_until:dates.to},controller.signal) as ExpiryWorkspaceData;
     if(seq!==generation.current)return;
     setCanAmount(data.can_view_amount===true&&data.permissions.audit);
     names=data.products.map(p=>p.name);
     waste.push(...data.waste);
    }
    next=waste.map(r=>({id:r.id,state:state(r.id),values:{date:r.work_date||day(r.created_at),name:r.name,quantity:text(r.review?.confirmed_quantity??r.quantity),unit:r.unit,price:text(r.reference_price),amount:text(r.reference_amount),reason:r.reason,actor:r.actor_name,note:r.note||'',price_source:r.note?.match(/〔進價來源：([^〕]*)〕/)?.[1]||(r.reference_price==null?'缺少相符價格或換算':'紀錄保存價格'),status:operationRecordStatus(r)},meta:r}));}
  }if(seq===generation.current){setRows(next.map(r=>({...r,values:kind==='receipt'?r.values:restoreCostBasis(r.values),meta:{...(r.meta as Record<string,unknown>),originalValues:{...r.values}}})));setProducts([...new Set(names)]);}
 }catch(e){if(seq===generation.current)setError(friendly(e));}finally{if(seq===generation.current)setLoading(false);}},[kind,store.id,month,integrated,draftMonth,rangeEnd]);
 useEffect(()=>{const counter=generation;const timer=setTimeout(()=>void load(),0);return()=>{clearTimeout(timer);counter.current++;readController.current?.abort();};},[load,refreshRevision]);
 const col=(key:string,label:string,extra:Partial<SheetColumn>={}):SheetColumn=>({key,label,...extra});
 const priceColumns=()=>[col('purchase_price','進價',{type:'number',display:r=>!r.values.purchase_price?'':Number(r.values.purchase_price).toLocaleString('zh-TW',{maximumFractionDigits:4})}),col('price_unit','計價規格',{pricingBasis:true,options:costingUnits,display:r=>[r.values.price_unit||r.values.unit,r.values.purchase_specification?`（${r.values.purchase_specification}）`:''].join('')})];
 const columns:SheetColumn[]=kind==='receipt'?[col('date','日期',{type:'date',required:true}),col('supplier','供應商',{required:true}),col('receipt_categories','貨單分類',{readonly:true}),col('name','品名',{required:true}),col('category','分類',{options:[...PRODUCT_CATEGORIES],select:true}),col('quantity','數量',{type:'number'}),col('unit','單位',{options:costingUnits,select:true,required:true}),col('specification','包裝內容（選填）',{placeholder:'例如 454克'}),col('price','未稅單價',{type:'number'}),col('amount','未稅金額',{readonly:true}),col('note','備註'),col('review_status','核對進度',{readonly:true}),col('finance_status','對帳進度',{readonly:true})]:kind==='inventory'?[
  ...(integrated?[col('code','編碼',{readonly:true,display:r=>r.values.code||'—'})]:[]),
  col('name','品名',{required:true}),
  col('supplier','供應商',{readonly:true}),
  col('zone','儲物區',{editable:r=>!!r.fresh}),
  ...(integrated?[col('opening','期初庫存',{readonly:true,display:r=>r.values.opening||'—'})]:[]),
  col('quantity',integrated?'期末庫存':'實盤數量',{type:'number',placeholder:'未盤點',importAliases:integrated?['實盤數量']:undefined,display:r=>r.values.quantity===''?'':r.values.quantity,editable:r=>(r.meta as InventoryMeta)?.row?.current_quantity!=null&&!!inventory?.source_id}),col('unit','單位',{options:costingUnits,select:true,required:true,editable:r=>r.fresh||!(r.meta as InventoryMeta)?.row||(r.meta as InventoryMeta)?.row?.current_quantity!=null}),col('purchase_price','進價',{type:'number',display:r=>!r.values.purchase_price?'':Number(r.values.purchase_price).toLocaleString('zh-TW',{maximumFractionDigits:4})}),col('price_unit','計價規格',{pricingBasis:true,options:costingUnits,display:r=>[r.values.price_unit||r.values.unit,r.values.purchase_specification?`（${r.values.purchase_specification}）`:''].join('')}),col('amount','庫存金額',{readonly:true,display:r=>r.values.quantity===''?'':r.values.amount===''?'':Number(r.values.amount).toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})}),col('field_note','現場備註',{readonly:true}),
  col('note',integrated?'備註':'核對備註',{
   importAliases:integrated?['核對備註']:undefined,
   display:integrated?r=>[r.values.field_note==='—'?'':r.values.field_note,r.values.note].filter(Boolean).join(' · '):undefined,
   editable:r=>(r.meta as InventoryMeta)?.row?.current_quantity!=null&&!!inventory?.source_id,
  }),
 ]:[col('date','日期',{type:'date',required:true}),...(kind==='transfer'?[col('direction','調撥方向',{options:['一店→二店','二店→一店'],select:true,required:true,editable:r=>!!r.fresh})]:[]),col('name','品名',{options:products,required:true}),col('quantity','數量',{type:'number',required:true,editable:r=>kind!=='transfer'||r.fresh||(r.meta as Movement)?.review_status==='PENDING'}),col('unit','單位',{options:costingUnits,select:true,required:true,editable:r=>!!r.fresh}),...(canAmount?[...priceColumns(),col('amount','金額',{readonly:true,display:r=>r.values.amount===''?'':Number(r.values.amount).toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})})]:[]),...(kind==='waste'?[col('reason','原因',{options:wasteReasons,select:true,required:true})]:[]),col('actor','經手人'),col('note','備註')];
 const defaults={date:kind==='inventory'?month+'-01':day(new Date().toISOString()),name:'',unit:'',quantity:'',price:'',...(kind!=='receipt'?{purchase_price:'',price_unit:'',purchase_specification:'',content_quantity:'',content_unit:''}:{}),note:'',zone:'未分類',reason:wasteReasons[0],from:store.name,to:store.name==='BeApe'?'Gras':'BeApe',direction:store.name==='BeApe'?'一店→二店':'二店→一店',supplier:'',category:kind==='receipt'?'待分類':'食材'};
 async function save(row:SheetRow){try{if(kind!=='receipt')validatePurchaseSpecification(row.values.purchase_specification);const v:Record<string,string>={...transferDirectionValues(row.values),...(kind!=='receipt'?{note:costBasisNote(row.values)}:{})},request=row.requestId||crypto.randomUUID();const quote=(row.meta as {costQuote?:CostQuote}|undefined)?.costQuote;if(quote?.price!=null&&Number(v.price)===quote.price){const label=[quote.source,quote.date].filter(Boolean).join(' · ').replace(/[\r\n〔〕]/g,' ');v.note=[(v.note||'').replace(/\n?〔進價來源：[^〕]*〕/g,'').trim(),`〔進價來源：${label}〕`].filter(Boolean).join('\n');}
  if(kind==='receipt'&&!row.fresh){const meta=row.meta as {batch:string;key:string};const a=accounts.current.get(meta.batch);if(!a)throw Error('原貨單讀取未完成。');const draft=reviewDraft(a);const original=(row.meta as {originalValues:Record<string,string>}).originalValues;const latest=a.lines.find(l=>l.row_key===meta.key);if(!latest)throw Error('REVISION_CONFLICT');const merged=sheetMerge(original,v,{supplier:a.supplier_name,date:reviewDraft(a).date,name:latest.product_name,category:latest.category,quantity:text(latest.quantity),unit:latest.unit,specification:latest.specification,price:text(latest.unit_price),note:latest.note},['supplier','date','name','category','quantity','unit','specification','price','note']);draft.supplier=merged.supplier;draft.date=merged.date;draft.lines=draft.lines.map(l=>l.row_key===meta.key?{...l,product_name:merged.name,category:merged.category,quantity:merged.quantity,unit:merged.unit,specification:merged.specification,unit_price:merged.price,subtotal:merged.quantity!==text(latest.quantity)||merged.price!==text(latest.unit_price)?merged.quantity&&merged.price?moneyAmount(merged.quantity,merged.price):'':l.subtotal,note:merged.note}:l);const saved=await saveReceiptReview(store.id,a.batch_id,{...reviewPayload(a,draft,false),reviewed:false},request,!!(a.review_completed||a.entry_completed||a.received_at));accounts.current.set(a.batch_id,saved);}
  else if(kind==='inventory'){const meta=row.meta as InventoryMeta|undefined;if(row.fresh){if(v.quantity?.trim())throw Error('新增品項先建立名稱、單位與單價；期末數量由該月份盤點帶入。');await rpc('save_baihuayuan_sheet_row',{p_store_id:store.id,p_kind:'inventory',p_id:null,p_value:{...v,...automaticCostGuard(row)},p_expected:{},p_request_id:request});}
   else if(meta?.row&&meta.row.current_quantity!=null&&inventory?.source_id){const r=meta.row;await rpc('save_baihuayuan_inventory_inline_v3',{p_store_id:store.id,p_month:month+'-01',p_session_id:inventory?.source_id,p_row_key:r.row_key,p_expected:{...inventoryEditExpected(r),...automaticCostGuard(row)},p_name:v.name,p_unit:v.unit,p_quantity:sheetNumber(v.quantity),p_unit_price:sheetNumber(v.price),p_note:v.note||'行政表格修正'});}
   else if(meta?.catalog){const c=meta.catalog;await operationDeadline(signal=>writeOperation(store.id,'count.catalog-edit',{id:c.product_id,name:v.name,unit:v.unit,specification:c.specification,updated_at:c.updated_at,unit_price:sheetNumber(v.price)},request,signal));}else throw Error('此筆尚無可修改的本月盤點來源，請先確認月份。');
  }else{const old=row.meta as Movement|WasteRecord|undefined;const expected=kind==='transfer'?{revision:(old as Movement)?.revision}:old?{name:old.name,quantity:old.quantity,unit:old.unit,price:(old as WasteRecord).reference_price,note:(old as WasteRecord).note||'',reason:(old as WasteRecord).reason,actor:(old as WasteRecord).actor_name,date:(old as WasteRecord).work_date}:{};await rpc('save_baihuayuan_sheet_row',{p_store_id:store.id,p_kind:kind,p_id:row.fresh?null:row.id,p_value:{...v,...automaticCostGuard(row)},p_expected:expected,p_request_id:request});}
 }catch(e){throw Error(friendly(e));}}
 async function remove(selected:SheetRow[],restore:boolean){try{if(kind==='inventory'){const ids=[...new Set(selected.map(r=>{const meta=r.meta as InventoryMeta;return meta.row?.product_id||meta.catalog?.product_id;}))];await operationDeadline(signal=>writeOperation(store.id,'count.catalog-lifecycle',{ids,mode:restore?'RESTORE':'REMOVE'},crypto.randomUUID(),signal));}else{const ids=[...new Set(selected.map(r=>kind==='receipt'?(r.meta as {batch:string}).batch:r.id))];for(const id of ids)await rpc('set_baihuayuan_record_state',{p_store_id:store.id,p_entity_type:kind==='receipt'?'RECEIPT_BATCH':kind==='transfer'?'TRANSFER':'WASTE',p_entity_id:id,p_state:restore?'LIVE':'REMOVED',p_reason:restore?null:'行政表格移除'});}}catch(e){throw Error(friendly(e));}}
 async function quotePrices(targets:SheetRow[]){const quotes:CostQuote[]=[];for(let start=0;start<targets.length;start+=100){const chunk=targets.slice(start,start+100);quotes.push(...await rpc('baihuayuan_cost_quotes',{p_store_id:store.id,p_items:chunk.map(r=>({name:r.values.name,unit:r.values.unit,date:kind==='inventory'?(inventory?.count_date||inventoryMonthEnd(month)):r.values.date,purpose:kind==='inventory'&&integrated?'inventory':undefined,supplier:kind==='inventory'?(r.meta as InventoryMeta)?.row?.supplier:undefined,from:kind==='transfer'?transferDirectionValues(r.values).from:undefined,product_id:kind==='inventory'?(r.meta as InventoryMeta)?.row?.product_id||(r.meta as InventoryMeta)?.catalog?.product_id:undefined}))}) as CostQuote[]);}return applyCostQuotes(targets,quotes);}
 async function exportInventory(selected:SheetRow[],fileName:string){
  const [{identities,suppliers},XLSX]=await Promise.all([readInventoryExportData(store.id),import('xlsx')]);
  const lines=selected.map(({id,meta,values}):InventoryExportLine=>{
   const {row,catalog}=(meta as InventoryMeta|undefined)||{};
   return row??{
    row_key:id,product_id:catalog?.product_id||'',name:values.name,supplier:values.supplier,
    category:values.category,unit:values.unit,current_quantity:null,amount:null,
    unit_price:values.price?Number(values.price):null,review_note:values.note||'',
    price_purchase:values.purchase_price&&values.price_unit?{amount:Number(values.purchase_price),quantity:1,unit:values.price_unit}:null,
   };
  });
  const book=XLSX.utils.book_new();
  appendInventoryWorkbook(XLSX,book,lines,identities,suppliers);
  XLSX.writeFile(book,`${fileName}.xlsx`);
 }
 const valuationRow=(valuationTarget?.meta as InventoryMeta|undefined)?.row;
 async function saveValuation(choice:InventoryValuationChoice){
  if(!valuationRow||!inventory?.source_id)throw Error('本月盤點尚未載入。');
  try{
   await rpc('save_baihuayuan_inventory_valuation',{p_store_id:store.id,p_month:month+'-01',p_session_id:inventory.source_id,
    p_row_key:valuationRow.row_key,p_expected:inventoryEditExpected(valuationRow),p_choice:choice});
   await load();
  }catch(e){throw Error(friendly(e));}
 }
 const title={receipt:'進貨明細',inventory:'庫存明細',transfer:'調撥明細',waste:'廢棄明細'}[kind];
 const entryIds=kind==='receipt'?[...new Set(rows.filter(row=>row.state==='LIVE'&&!row.locked&&sheetRowInDateRange(row,dateRange)).map(row=>(row.meta as {batch:string}).batch))]:[];
 const entryIndex=receiptTarget?entryIds.indexOf(receiptTarget.batchId):-1;
 return <>{valuationTarget&&valuationRow&&valuationRow.current_quantity!=null&&inventory?.count_date&&<InventoryValuationDialog key={valuationTarget.id} name={valuationRow.name} code={valuationTarget.values.code} supplier={valuationTarget.values.supplier} quantity={valuationRow.current_quantity} unit={valuationRow.unit} cutoff={inventory.count_date} original={valuationRow.inventory_cost_quote??undefined} read={readIngredientPrices} save={saveValuation} onClose={()=>setValuationTarget(null)}/>} {priceOriginalId&&<ReceiptOriginalDialog batchId={priceOriginalId} onClose={()=>setPriceOriginalId(null)}/>} {receiptTarget&&<ReceiptReviewWorkbench key={receiptTarget.batchId} storeId={store.id} batchId={receiptTarget.batchId} initialRowKey={receiptTarget.rowKey} nextId={entryIndex>=0?entryIds[entryIndex+1]||null:null} previousId={entryIds[entryIndex-1]||null} positionLabel={entryIndex>=0?`${entryIndex+1} / ${entryIds.length}`:undefined} onNavigate={batchId=>setReceiptTarget({batchId})} manualEntry onClose={()=>setReceiptTarget(null)} onSaved={()=>void load()}/>}<OperationsSheet openReceiptEditor={kind==='receipt'} onAdd={kind==='receipt'?()=>onSpecial('photos'):undefined} addLabel={kind==='receipt'?'貨單建檔':undefined} autoRefresh={kind==='inventory'&&!valuationTarget} reportDate={kind==='inventory'?inventory?.count_date:undefined} nameBadge={kind==='receipt'?r=>{const label=receiptCustodyLabel({handling:r.values.handling,custody_remaining:r.values.custody_remaining,unit:r.values.unit});return label?<small className="receipt-custody-badge" title="此張貨單記載的餘量">{label}</small>:null;}:undefined} inventoryLayout={integrated} inventoryOpening={integrated?{visible:showInventoryOpening,onChange:setShowInventoryOpening}:undefined} onInventoryPriceSource={setPriceOriginalId} onInventoryValuation={integrated&&inventory?.count_date?setValuationTarget:undefined} reportLabel={{receipt:'未稅合計',inventory:inventory?.rows.some(row=>row.quantity_pending||row.current_quantity===null)?'目前小計・尚有未盤品項':inventory?.summary?.missing_prices?'已計價小計':'庫存總金額',transfer:'調撥總金額',waste:'廢棄總金額'}[kind]} reportSummary={kind==='receipt'?visible=>{
 const ids=new Set(visible.map(r=>(r.meta as {batch?:string})?.batch).filter(Boolean));const selected=[...ids].flatMap(id=>accounts.current.get(id!)?[accounts.current.get(id!)!]:[]);
 const complete=selected.every(a=>a.lines.every(l=>visible.some(r=>r.id===`${a.batch_id}:${l.row_key}`)))&&visible.every(r=>!r.fresh&&JSON.stringify(r.values)==JSON.stringify(rows.find(o=>o.id===r.id)?.values));
 const total=(key:'tax'|'total')=>{const values=selected.map(a=>a[key]).filter((v):v is number=>v!==null);return values.length||!selected.length?'NT$ '+values.reduce((a,b)=>a+b,0).toLocaleString('zh-TW',{maximumFractionDigits:2}):'';};
 return <>{complete?<><span>稅額：{total('tax')}</span><strong>含稅合計：{total('total')}</strong>{selected.some(a=>a.tax===null||a.total===null)&&<small>貨單金額未完整</small>}</>:<small>稅額與含稅金額請查看完整貨單</small>}</>;
 }:undefined} compactDetails={kind==='transfer'||kind==='waste'} cloudDraft={cloudDraft} key={`${userId}:${kind}:${store.id}:${draftMonth}`} userId={userId} title={title} scope={`${kind}-${store.id}`} rows={rows} columns={columns} defaults={defaults} loading={loading} error={error} month={draftMonth} onMonth={value=>{setRows([]);setLoading(true);setMonth(value);onMonthChange?.(value);}}
 dateRange={kind==='inventory'?undefined:dateRange} onDateRange={value=>{
  if(value.from.slice(0,7)!==draftMonth||value.to!==rangeEnd){setRows([]);setLoading(true);}
  setDateRange(value);onDateRangeChange?.(value);
 }} onRefresh={load} onSave={save} onExport={kind==='inventory'?selected=>exportInventory(selected,`${store.name}-庫存明細-${month}`):undefined} onPrice={canAmount&&kind!=='receipt'?quotePrices:undefined} onRemove={remove} registerLeave={registerLeave} readOnly={kind==='inventory'&&(inventory?.closed||inventory?.historical)} canExport={canExportData(store)} deleteNote={kind==='receipt'?'同張貨單的全部明細一併移除，原貨單與歷史保留。':kind==='inventory'?'僅移除本店品項，歷史盤點保留。':undefined} special={<>{kind==='inventory'&&!integrated&&<><button className="sheet-button" onClick={()=>onSpecial('spot')}>抽盤</button><button className="sheet-button" onClick={()=>onSpecial('inventory')}>確認月份</button></>}</>} onSource={kind==='receipt'?row=>{const {batch,key}=row.meta as {batch:string;key:string};setReceiptTarget({batchId:batch,rowKey:key});}:undefined}/></>;
}
