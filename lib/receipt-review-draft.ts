import {numericFields,type ReceiptField} from './receipt-workflow';

export type ReceiptReviewMappingMode='KEEP'|'NONE'|'SELECT'|'CREATE';
export type ReceiptReviewMapping={product_id:string;name?:string|null;unit?:string|null;specification?:string|null};
export type ReceiptReviewSnapshot={batchId:string;runId:string;row:string;fields:ReceiptField[];mapping?:ReceiptReviewMapping|null};
export type ReceiptReviewDraft={
  batchId:string;runId:string;row:string;snapshot:ReceiptField[];values:Record<string,string>;
  initialMapping:ReceiptReviewMapping|null;mappingMode:ReceiptReviewMappingMode;productId:string;acknowledged:boolean;
};
export type ReceiptReviewPayload={
  batch_id:string;run_id:string;row_key:string;fields:{id:string;old:unknown;value:unknown}[];
  previous_product_id:string|null;mapping_mode:ReceiptReviewMappingMode;product_id:string|null;
};
export type ReceiptReviewReconciliation={draft:ReceiptReviewDraft;status:'unchanged'|'refreshed'|'saved'|'conflict'|'missing'|'version-changed'};
export type ReceiptReviewDrafts=Record<string,ReceiptReviewDraft>;

const identityFields=new Set(['product','unit','specification']);
const modes=new Set<ReceiptReviewMappingMode>(['KEEP','NONE','SELECT','CREATE']);
const text=(value:unknown)=>value===null||value===undefined?'':String(value);
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function equal(a:unknown,b:unknown):boolean{
  if(a===b)return true;
  if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((value,i)=>equal(value,b[i]));
  if(record(a)&&record(b)){const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&equal(a[key],b[key]));}
  return false;
}
function fieldValue(draft:ReceiptReviewDraft,field:ReceiptField):unknown{
  const input=draft.values[field.id];
  if(typeof input!=='string')throw Error('INVALID_APP_INPUT');
  // Untouched evidence stays byte-for-byte equivalent to the server value.
  if(input===text(field.value))return field.value??null;
  const value=input.trim();
  if(value==='')return null;
  if(!numericFields.has(field.field_name))return value;
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)||!Number.isFinite(Number(value)))throw Error('NUMBER_REQUIRED');
  return Number(value);
}
function valueByName(draft:ReceiptReviewDraft,name:string){
  const field=draft.snapshot.find(field=>field.field_name===name);
  return field?fieldValue(draft,field):null;
}
export function createReceiptReviewDraft(source:ReceiptReviewSnapshot):ReceiptReviewDraft{
  const snapshot=structuredClone(source.fields.filter(field=>field.row_key===source.row));
  const mapping=source.row==='document'?null:structuredClone(source.mapping??null);
  return {batchId:source.batchId,runId:source.runId,row:source.row,snapshot,
    values:Object.fromEntries(snapshot.map(field=>[field.id,text(field.value)])),initialMapping:mapping,
    mappingMode:'KEEP',productId:mapping?.product_id||'',acknowledged:false};
}
export function updateReceiptReviewField(draft:ReceiptReviewDraft,id:string,value:string):ReceiptReviewDraft{
  const field=draft.snapshot.find(field=>field.id===id);
  if(!field)throw Error('OCR_LINE_NOT_FOUND');
  if(draft.values[id]===value)return draft;
  const next={...draft,values:{...draft.values,[id]:value},acknowledged:false};
  if(draft.row!=='document'&&identityFields.has(field.field_name)&&text(draft.values[id]).trim()!==value.trim()){
    next.mappingMode='NONE';next.productId='';
  }
  return next;
}
export function updateReceiptReviewMapping(draft:ReceiptReviewDraft,mode:ReceiptReviewMappingMode,productId=''):ReceiptReviewDraft{
  if(!modes.has(mode))throw Error('INVALID_APP_INPUT');
  if(draft.row==='document')return draft;
  const selected=mode==='KEEP'?draft.initialMapping?.product_id||'':mode==='SELECT'?productId:'';
  if(mode===draft.mappingMode&&selected===draft.productId)return draft;
  return {...draft,mappingMode:mode,productId:selected,acknowledged:false};
}
export function isReceiptReviewDirty(draft:ReceiptReviewDraft):boolean{
  try{if(draft.snapshot.some(field=>!equal(fieldValue(draft,field),field.value??null)))return true;}
  catch{return true;}
  if(draft.row==='document'||draft.mappingMode==='KEEP')return false;
  if(draft.mappingMode==='CREATE')return true;
  return (draft.mappingMode==='SELECT'?draft.productId||null:null)!==(draft.initialMapping?.product_id||null);
}
export function receiptReviewDraftError(draft:ReceiptReviewDraft):string|null{
  if(!draft.batchId||!draft.runId||!draft.row||!modes.has(draft.mappingMode))return 'INVALID_APP_INPUT';
  if(!draft.snapshot.length)return 'OCR_LINE_NOT_FOUND';
  if(new Set(draft.snapshot.map(field=>field.id)).size!==draft.snapshot.length||draft.snapshot.some(field=>field.row_key!==draft.row))return 'INVALID_APP_INPUT';
  try{
    for(const field of draft.snapshot)fieldValue(draft,field);
    if(draft.row!=='document'&&draft.mappingMode==='SELECT'&&!draft.productId)return 'PRODUCT_MAPPING_REQUIRED';
    if(draft.row!=='document'&&draft.mappingMode==='CREATE'&&(!text(valueByName(draft,'product')).trim()||!text(valueByName(draft,'unit')).trim()))return 'PRODUCT_NAME_AND_UNIT_REQUIRED';
  }catch(error){return error instanceof Error?error.message:'INVALID_APP_INPUT';}
  return null;
}
export function buildReceiptReviewPayload(draft:ReceiptReviewDraft):ReceiptReviewPayload{
  const error=receiptReviewDraftError(draft);if(error)throw Error(error);
  return {batch_id:draft.batchId,run_id:draft.runId,row_key:draft.row,
    fields:draft.snapshot.map(field=>({id:field.id,old:structuredClone(field.value??null),value:structuredClone(fieldValue(draft,field))})),
    previous_product_id:draft.initialMapping?.product_id||null,mapping_mode:draft.row==='document'?'KEEP':draft.mappingMode,
    product_id:draft.row==='document'?null:draft.productId||null};
}
export function acknowledgeReceiptReviewSave(draft:ReceiptReviewDraft):ReceiptReviewDraft{
  // The RPC does not return new field values or a CREATE mapping ID.
  // Keep the original CAS baseline until a read confirms the accepted payload.
  buildReceiptReviewPayload(draft);
  return {...draft,acknowledged:true};
}
function sameFields(fields:ReceiptField[],values:{id:string;value:unknown}[]):boolean{
  return fields.length===values.length&&new Set(fields.map(field=>field.id)).size===fields.length&&values.every(value=>{
    const field=fields.find(field=>field.id===value.id);return !!field&&equal(field.value??null,value.value??null);
  });
}
function acceptedMapping(draft:ReceiptReviewDraft,latest:ReceiptReviewSnapshot):boolean{
  if(draft.row==='document')return true;
  const id=latest.mapping?.product_id||null;
  if(draft.mappingMode==='KEEP')return id===(draft.initialMapping?.product_id||null);
  if(draft.mappingMode==='NONE')return id===null;
  if(draft.mappingMode==='SELECT')return id===draft.productId;
  return !!id&&text(latest.mapping?.name).trim().toLowerCase()===text(valueByName(draft,'product')).trim().toLowerCase()
    &&text(latest.mapping?.unit)===text(valueByName(draft,'unit'));
}
export function reconcileReceiptReviewDraft(draft:ReceiptReviewDraft,latest:ReceiptReviewSnapshot):ReceiptReviewReconciliation{
  if(draft.batchId!==latest.batchId||draft.runId!==latest.runId)return {draft,status:'version-changed'};
  const fields=latest.fields.filter(field=>field.row_key===draft.row);
  if(draft.row!==latest.row||!fields.length)return {draft,status:'missing'};
  if(draft.acknowledged){
    try{if(sameFields(fields,buildReceiptReviewPayload(draft).fields)&&acceptedMapping(draft,latest))return {draft:createReceiptReviewDraft(latest),status:'saved'};}
    catch{/* Invalid cached input remains available for correction. */}
  }
  if(sameFields(fields,draft.snapshot)&&(draft.initialMapping?.product_id||null)===(latest.mapping?.product_id||null))return {draft,status:'unchanged'};
  if(isReceiptReviewDirty(draft)||draft.acknowledged)return {draft,status:'conflict'};
  return {draft:createReceiptReviewDraft(latest),status:'refreshed'};
}

export function receiptReviewDraftStorageKey(userId:string,storeId:string,batchId:string,runId:string):string{
  return `receipt-review-drafts:${[userId,storeId,batchId,runId].map(encodeURIComponent).join(':')}`;
}
export function serializeReceiptReviewDrafts(drafts:ReceiptReviewDrafts):string{
  return JSON.stringify({version:1,drafts:Object.fromEntries(Object.entries(drafts).filter(([,draft])=>isReceiptReviewDirty(draft)||draft.acknowledged))});
}
export function parseReceiptReviewDrafts(raw:string|null):ReceiptReviewDrafts{
  const empty=()=>Object.create(null) as ReceiptReviewDrafts;
  try{
    const saved:unknown=JSON.parse(raw||'null');
    if(!record(saved)||saved.version!==1||!record(saved.drafts))return empty();
    const drafts=empty();
    for(const [row,value] of Object.entries(saved.drafts)){
      if(!record(value)||value.row!==row||typeof value.batchId!=='string'||typeof value.runId!=='string'||!Array.isArray(value.snapshot)||!record(value.values)
        ||!modes.has(value.mappingMode as ReceiptReviewMappingMode)||typeof value.productId!=='string'||typeof value.acknowledged!=='boolean')continue;
      const mapping=value.initialMapping;
      if(mapping!==null&&(!record(mapping)||typeof mapping.product_id!=='string'))continue;
      if(!value.snapshot.length||!value.snapshot.every(field=>record(field)&&typeof field.id==='string'&&field.row_key===row&&typeof field.field_name==='string'&&typeof (value.values as Record<string,unknown>)[field.id]==='string'))continue;
      if(new Set(value.snapshot.map(field=>field.id)).size!==value.snapshot.length)continue;
      drafts[row]=value as ReceiptReviewDraft;
    }
    return drafts;
  }catch{return empty();}
}
export function hasStoredReceiptDraft(storage:Pick<Storage,'getItem'>,userId:string,storeId:string,batchId:string,runId:string):boolean{
  const drafts=parseReceiptReviewDrafts(storage.getItem(receiptReviewDraftStorageKey(userId,storeId,batchId,runId)));
  return Object.values(drafts).some(draft=>draft.batchId===batchId&&draft.runId===runId&&(isReceiptReviewDirty(draft)||draft.acknowledged));
}
