import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptReceiptSave,receiptDraftDirty,rebaseReceiptDraft} from '../lib/receipt-autosave.ts';
import {reviewDraft,changeReviewLine,reviewPayload} from '../lib/receipt-review.ts';
const row={batch_id:'a',supplier_name:'甲',receipt_date:'2026-09-01',document_number:'A',net:100,tax:5,total:105,adjustment:0,adjustment_note:'',note:'',revision:4,source_fingerprint:'version',can_edit:true,record_state:'LIVE',pending:false,status:'CHECKED',lines:[{row_key:'l1',product_name:'麵粉',specification:'',quantity:2,unit:'包',unit_price:50,subtotal:100,category:'食材',note:''}]};
test('save acknowledgement accepts server normalization and becomes clean',()=>{
 const sent={...reviewDraft(row),supplier:' 乙 '};
 const saved={...row,supplier_name:'乙',revision:5};
 const result=acceptReceiptSave(saved,sent,sent);
 assert.equal(result.supplier,'乙');assert.equal(receiptDraftDirty(saved,result),false);
});
test('typing price, quantity, note and header during a request survives its late acknowledgement',()=>{
 const sent=changeReviewLine(reviewDraft(row),0,'unit_price','60');
 const saved={...row,revision:5,lines:[{...row.lines[0],unit_price:60,subtotal:120}]};
 let current=changeReviewLine(sent,0,'quantity','3');current=changeReviewLine(current,0,'note','追加');current.supplier='乙';
 const result=acceptReceiptSave(saved,sent,current);
 assert.equal(result.lines[0].quantity,'3');assert.equal(result.lines[0].subtotal,'180');assert.equal(result.lines[0].note,'追加');assert.equal(result.supplier,'乙');
 assert.equal(receiptDraftDirty(saved,result),true);assert.equal(reviewPayload(saved,result,false).revision,5);
});
test('clearing a price while a save is pending remains unknown, never zero',()=>{
 const sent=reviewDraft(row),current=changeReviewLine(sent,0,'unit_price','');
 const result=acceptReceiptSave({...row,revision:5},sent,current),payload=reviewPayload({...row,revision:5},result,false);
 assert.equal(payload.lines[0].unit_price,null);assert.equal(payload.lines[0].subtotal,null);assert.equal(payload.checked,false);
});
test('line identity rather than position preserves edits when server returns another ordering',()=>{
 const source={...row,lines:[...row.lines,{...row.lines[0],row_key:'l2',product_name:'糖'}]};
 const sent=reviewDraft(source),current=changeReviewLine(sent,1,'note','第二列');
 const saved={...source,revision:5,lines:[...source.lines].reverse()};
 const result=acceptReceiptSave(saved,sent,current);
 assert.equal(result.lines[0].row_key,'l2');assert.equal(result.lines[0].note,'第二列');assert.equal(result.lines[1].note,'');
});

test('three-way merge preserves remote fields, adopts identical edits, and rejects changed row identities',()=>{
 const mine=changeReviewLine(reviewDraft(row),0,'quantity','3');
 const latest={...row,revision:5,note:'新備註',lines:[{...row.lines[0],quantity:3,subtotal:150}]};
 const merged=rebaseReceiptDraft(row,mine,latest);
 assert.equal(merged.conflicts.length,0);assert.equal(merged.value.note,'新備註');assert.equal(receiptDraftDirty(latest,merged.value),false);
 const changed=rebaseReceiptDraft(row,mine,{...latest,lines:[{...latest.lines[0],row_key:'new'}]});
 assert.equal(changed.structural,true);assert.equal(changed.value.lines[0].quantity,'3');assert.equal(changed.value.lines[0].row_key,'l1');
});
