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
