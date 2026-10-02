export type BatchLine = {key:string;product_id:string;name:string;quantity:string;unit:string;manual:boolean};
export type BatchPayload = {from_store_id:string;to_store_id:string;note:string;items:{product_id:string|null;name:string;quantity:number;unit:string;manual:boolean}[]};
export type BatchRecord = {id:string;from_store_id:string;to_store_id:string;name:string;quantity:number;unit:string;product_id?:string|null;review_status?:string};
export type BatchResult = {items:BatchRecord[];count:number};
export type PendingBatch = {id:string;payload:Record<string,unknown>;legacy?:boolean};
export type BatchDraft = {version:1;from_store_id:string;to_store_id:string;note:string;items:BatchLine[];pending?:PendingBatch;completed?:BatchResult};
export const MAX_TRANSFER_ITEMS = 50;
export function emptyTransferBatch():BatchDraft {return {version:1,from_store_id:'',to_store_id:'',note:'',items:[]};}
export function readTransferBatch(raw:string):BatchDraft {
 const d=JSON.parse(raw) as BatchDraft;
 if(d?.version!==1||typeof d.from_store_id!=='string'||typeof d.to_store_id!=='string'||typeof d.note!=='string'||!Array.isArray(d.items)||d.items.length>MAX_TRANSFER_ITEMS||d.items.some(r=>!r||typeof r.key!=='string'||typeof r.product_id!=='string'||typeof r.name!=='string'||typeof r.unit!=='string'||typeof r.quantity!=='string'||typeof r.manual!=='boolean'))throw Error('INVALID_SAVED_TRANSFER');
 if(d.pending&&(!/^[a-f0-9-]{36}$/i.test(d.pending.id)||!d.pending.payload||typeof d.pending.payload!=='object'))throw Error('INVALID_SAVED_TRANSFER');
 if(d.completed&&(!Array.isArray(d.completed.items)||d.completed.count!==d.completed.items.length))throw Error('INVALID_SAVED_TRANSFER');
 return d;
}
export function migrateSingleTransfer(raw:string|null,retry:string|null,recordingStoreId:string):BatchDraft {
 const d=emptyTransferBatch();const old=raw?JSON.parse(raw):null;
 if(old&&typeof old==='object'){
  d.from_store_id=typeof old.from_store_id==='string'?old.from_store_id:old.to_store_id?recordingStoreId:'';
  d.to_store_id=typeof old.to_store_id==='string'?old.to_store_id:'';d.note=typeof old.note==='string'?old.note:'';
  if(old.product_id||old.name)d.items=[{key:'legacy-item',product_id:old.product_id||'',name:old.name||'',quantity:String(old.quantity||''),unit:old.unit||'',manual:!!old.manual}];
 }
 if(retry){const previous=JSON.parse(retry);const payload=JSON.parse(previous.signature);if(typeof previous.id!=='string'||!payload||typeof payload!=='object')throw Error('INVALID_SAVED_TRANSFER');d.pending={id:previous.id,payload,legacy:true};}
 return d;
}
export function addTransferProduct(d:BatchDraft,p:{id:string;name:string;unit:string},key:string):BatchDraft {
 if(d.pending||d.completed||d.items.some(r=>r.product_id===p.id))return d;
 if(d.items.length>=MAX_TRANSFER_ITEMS)throw Error('TOO_MANY_TRANSFER_ITEMS');
 return {...d,items:[...d.items,{key,product_id:p.id,name:p.name,quantity:'',unit:p.unit,manual:false}]};
}
export function transferBatchPayload(d:BatchDraft,catalog:{id:string;name:string;unit:string}[],directions:{from_store_id:string;to_store_id:string}[]):BatchPayload {
 if(!directions.some(r=>r.from_store_id===d.from_store_id&&r.to_store_id===d.to_store_id))throw Error('請先選擇調撥方向。');
 if(!d.items.length||d.items.length>MAX_TRANSFER_ITEMS)throw Error(`請加入 1–${MAX_TRANSFER_ITEMS} 個品項。`);
 const seen=new Set<string>();
 const items=d.items.map((row,index)=>{
  const p=catalog.find(p=>p.id===row.product_id);const name=row.manual?row.name.trim():p?.name||'';const unit=row.unit.trim();const quantity=Number(row.quantity);
  if((!row.manual&&!p)||(row.manual&&row.product_id)||!name||name.length>160||!unit||unit.length>30||!Number.isFinite(quantity)||quantity<=0||quantity>=1e9)throw Error(`第 ${index+1} 項：請確認品項、數量與單位。`);
  const key=p?`product:${p.id}`:`manual:${name.normalize('NFKC').toLowerCase()}:${unit}`;
  if(seen.has(key))throw Error(`第 ${index+1} 項重複，請合併數量。`);seen.add(key);
  return {product_id:p?.id||null,name,quantity,unit,manual:row.manual};
 });
 return {from_store_id:d.from_store_id,to_store_id:d.to_store_id,note:d.note.trim(),items};
}
export function confirmedTransferBatch(response:unknown,pending:PendingBatch,recordingStoreId:string):BatchResult {
 const result=response as {items?:BatchRecord[];count?:number}&BatchRecord;
 const expected=pending.legacy?[pending.payload]:pending.payload.items as Record<string,unknown>[];
 const rows=pending.legacy?[result]:result?.items;
 const from=pending.payload.from_store_id??recordingStoreId,to=pending.payload.to_store_id;
 if(!Array.isArray(rows)||!Array.isArray(expected)||rows.length!==expected.length||!rows.length||(!pending.legacy&&result.count!==rows.length)||new Set(rows.map(r=>r?.id)).size!==rows.length)throw Error('UNCONFIRMED_TRANSFER');
 rows.forEach((row,i)=>{const item=expected[i];if(!row?.id||row.from_store_id!==from||row.to_store_id!==to||Number(row.quantity)!==Number(item.quantity)||(row.product_id??null)!==(item.product_id||null)||typeof row.name!=='string'||!row.name||typeof row.unit!=='string'||!row.unit||(item.unit!==undefined&&row.unit!==item.unit)||(item.manual&&row.name!==String(item.name).trim()))throw Error('UNCONFIRMED_TRANSFER');});
 return {items:rows,count:rows.length};
}
/** Persist an immutable request BEFORE sending. On timeout, retain its exact payload/id.
 * The existing app_operation request cache and one SQL transaction cover every row. */
export async function submitTransferBatch(draft:BatchDraft,payload:BatchPayload|undefined,options:{recordingStoreId:string;requestId:()=>string;persist:(draft:BatchDraft)=>void;send:(payload:Record<string,unknown>,id:string)=>Promise<unknown>}):Promise<BatchDraft> {
 if(draft.completed)return draft;
 const pending=draft.pending??{id:options.requestId(),payload:payload as unknown as Record<string,unknown>};
 if(!pending.payload)throw Error('INVALID_TRANSFER_PAYLOAD');
 const frozen={...draft,pending};options.persist(frozen);
 let response:unknown;
 try{response=await options.send(pending.payload,pending.id);}catch(error){
  // A returned input-validation error is a rolled-back transaction, not a timeout.
  // Authentication/conflict/transport/unknown errors retain the immutable request.
  if((error as {code?:string})?.code==='22023')options.persist({...draft,pending:undefined});
  throw error;
 }
 const completed=confirmedTransferBatch(response,pending,options.recordingStoreId);
 const saved={...draft,pending:undefined,completed};options.persist(saved);return saved;
}
