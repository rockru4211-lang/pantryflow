import {reviewDraft,type ReviewAccount,type ReviewDraft} from './receipt-review.ts';
export function receiptDraftDirty(row:ReviewAccount,value:ReviewDraft){return JSON.stringify(value)!==JSON.stringify(reviewDraft(row));}
// Apply the server's normalized values, retaining fields typed after this request began.
export function acceptReceiptSave(saved:ReviewAccount,sent:ReviewDraft,current:ReviewDraft):ReviewDraft{
 const next=reviewDraft(saved);
 for(const key of Object.keys(next) as (keyof ReviewDraft)[]){
  if(key!=='lines'&&current[key]!==sent[key])next[key]=current[key];
 }
 next.lines=next.lines.map(line=>{
  const before=sent.lines.find(l=>l.row_key===line.row_key),latest=current.lines.find(l=>l.row_key===line.row_key);
  if(!before||!latest)return line;
  return {...line,...Object.fromEntries(Object.entries(latest).filter(([key,value])=>value!==before[key as keyof typeof before]))};
 });
 return next;
}

const fieldNames:Record<string,string>={ingredient_id:'對應食材',create_ingredient:'新增食材',supplier_item_name:'原貨單品名',supplier_item_unit:'原貨單單位',supplier_item_specification:'原貨單規格',ingredient_match_revision:'對應版本',supplier:'供應商',date:'日期',number:'單號',tax:'稅額',total:'含稅金額',note:'備註',adjustment:'調整金額',adjustmentNote:'調整說明',product_name:'品名',specification:'規格',unit:'單位',quantity:'數量',unit_price:'單價',subtotal:'未稅金額',category:'類別',handling:'貨物歸屬',custody_lot_id:'寄庫批次',custody_event_id:'寄庫紀錄'};
// Three-way merge: copy only the user's edits onto the latest server version.
// Concurrent changes to the same field require an explicit choice.
export function rebaseReceiptDraft(base:ReviewAccount,current:ReviewDraft,latest:ReviewAccount){
 const original=reviewDraft(base),next=reviewDraft(latest),conflicts:string[]=[];
 const structural=base.run_id!==latest.run_id||current.lines.length!==next.lines.length||current.lines.some(line=>!next.lines.some(n=>n.row_key===line.row_key));
 if(structural)return {value:current,conflicts:['貨單明細或辨識版本已變更，請核對原貨單後重新編輯。'],structural:true};
 const merge=(before:Record<string,unknown>,mine:Record<string,unknown>,theirs:Record<string,unknown>,label:string)=>{
  for(const key of Object.keys(fieldNames)){
   if(!(key in mine)||mine[key]===before[key])continue;
   if(theirs[key]!==before[key]&&theirs[key]!==mine[key])conflicts.push(`${label}${fieldNames[key]}：你的輸入「${mine[key]??''}」，已存資料「${theirs[key]??''}」`);
   theirs[key]=mine[key];
  }
 };
 merge(original,current,next,'');
 next.lines.forEach(line=>{
  const before=original.lines.find(l=>l.row_key===line.row_key),mine=current.lines.find(l=>l.row_key===line.row_key);
  if(before&&mine)merge(before,mine,line,`${mine.product_name||'品項'}・`);
 });
 return {value:next,conflicts,structural:false};
}
