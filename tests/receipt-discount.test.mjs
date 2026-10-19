import test from 'node:test';
import assert from 'node:assert/strict';
import {discountAmounts} from '../lib/receipt-discount.ts';
import {reviewDraft,reviewPayload,changeReviewLine,applyReceiptDiscount,receiptLineDifference} from '../lib/receipt-review.ts';
import {supplierItems} from '../lib/receipt-supplier-items.ts';
const row={batch_id:'a',supplier_name:'酒商',receipt_date:'2026-10-05',document_number:'',note:'',revision:1,source_fingerprint:'raw',adjustment:0,tax:430,total:9030,record_state:'LIVE',edit_revision:1,lines:[{row_key:'a',product_name:'白酒',unit:'瓶',specification:'',quantity:6,unit_price:1000,subtotal:6000,category:'酒水',note:'保留備註'}]};
test('percent discount stores effective net price and original metadata, reopening never discounts twice',()=>{
 const d=changeReviewLine(reviewDraft(row),0,'discountValue','30'),p=reviewPayload(row,d,false);
 assert.equal(d.lines[0].unit_price,'1000');assert.equal(d.lines[0].subtotal,'4200');assert.equal(receiptLineDifference(d.lines[0]),null);
 assert.equal(p.lines[0].unit_price,700);assert.deepEqual(p.lines[0].discount,{kind:'PERCENT',value:30,base_price:1000});assert.equal(p.lines[0].note,'保留備註');
 const saved={...row,lines:p.lines};assert.deepEqual(reviewPayload(saved,reviewDraft(saved),false).lines,p.lines);
 assert.equal(supplierItems([saved],'酒商','other')[0].price,700);
 const cleared=changeReviewLine(reviewDraft(saved),0,'discountValue','');assert.equal(cleared.lines[0].subtotal,'6000');assert.equal(reviewPayload(saved,cleared,false).lines[0].discount,null);
});
test('fixed amount is per line and recalculates unit cost when quantity changes',()=>{
 let d=changeReviewLine(reviewDraft(row),0,'discountKind','AMOUNT');d=changeReviewLine(d,0,'discountValue','1000');assert.equal(reviewPayload(row,d,false).lines[0].unit_price,833.3333);
 d=changeReviewLine(d,0,'quantity','5');assert.equal(d.lines[0].subtotal,'4000');assert.equal(reviewPayload(row,d,false).lines[0].unit_price,800);
});
test('apply all skips freight by name or handling and custody; leaves inputs immutable',()=>{
 const d=reviewDraft({...row,lines:[...row.lines,{...row.lines[0],row_key:'b',product_name:'冷藏配送費'},{...row.lines[0],row_key:'c',handling:'FREIGHT'},{...row.lines[0],row_key:'d',handling:'CUSTODY_RELEASE'}]});
 const next=applyReceiptDiscount(d,'PERCENT','30');assert.equal(next.lines[0].discountValue,'30');assert.ok(next.lines.slice(1).every(l=>!l.discountValue));assert.equal(d.lines[0].subtotal,'6000');
});
test('missing prices stay missing, zero and full discount work, invalid/excessive discounts are rejected',()=>{
 assert.deepEqual(discountAmounts(null,6,'PERCENT',30),{unit_price:null,subtotal:null});assert.deepEqual(discountAmounts(100,2,'PERCENT',100),{unit_price:0,subtotal:0});
 for(const [k,v] of [['PERCENT',101],['PERCENT',-1],['AMOUNT',201],['PERCENT',NaN]])assert.throws(()=>discountAmounts(100,2,k,v));
 const d=changeReviewLine(reviewDraft(row),0,'discountValue','101');assert.throws(()=>reviewPayload(row,d,false));
});
test('stale discount metadata from other price edits is not re-applied',()=>{
 const changed={...row,lines:[{...row.lines[0],unit_price:800,subtotal:4800,discount:{kind:'PERCENT',base_price:1000,value:30}}]};
 const d=reviewDraft(changed);assert.equal(d.lines[0].unit_price,'800');assert.equal(d.lines[0].discountValue,undefined);assert.equal(reviewPayload(changed,d,false).lines[0].discount,null);
});
