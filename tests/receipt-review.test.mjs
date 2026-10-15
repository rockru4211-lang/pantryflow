import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {receiptEntryAmounts,receiptMissingPrices,reviewDraft,reviewNet,reviewTotal,reviewPayload,changeReviewLine,changeReviewTax,nextReviewId} from '../lib/receipt-review.ts';
const row={batch_id:'a',supplier_name:'甲',receipt_date:'2026-09-01',document_number:'A',net:100,tax:5,total:105,adjustment:0,adjustment_note:'',note:'',revision:4,source_fingerprint:'version',can_edit:true,record_state:'LIVE',pending:false,status:'CHECKED',lines:[{row_key:'line-1',product_name:'麵粉',specification:'',quantity:2,unit:'包',unit_price:50,subtotal:100,category:'食材',note:''}]};
test('completed receipt has an editable draft with original row identity and revision',()=>{const d=reviewDraft(row);assert.equal(d.lines[0].quantity,'2');assert.equal(reviewPayload(row,d,true).revision,4);assert.equal(reviewPayload(row,d,true).source_fingerprint,'version');});
test('quantity and unit price update line net but never silently rewrite the printed total',()=>{const d=changeReviewLine(reviewDraft(row),0,'quantity','3');assert.equal(d.lines[0].subtotal,'150');assert.equal(reviewNet(d),150);assert.equal(reviewTotal(d),155);assert.equal(d.total,'105');assert.throws(()=>reviewPayload(row,d,true));assert.equal(reviewPayload(row,d,false).checked,false);d.total='155';assert.equal(reviewPayload(row,d,true).lines[0].quantity,3);});
test('missing tax and blank prices stay unknown; partial edits can be saved without being checked',()=>{const d=reviewDraft(row);d.tax='';assert.equal(reviewTotal(d),null);assert.equal(reviewPayload(row,d,false).tax,null);assert.throws(()=>reviewPayload(row,d,true));d.tax='0';d.total='100';assert.equal(reviewPayload(row,d,true).tax,0);const b=changeReviewLine(d,0,'unit_price','');assert.equal(reviewNet(b),null);assert.throws(()=>reviewPayload(row,b,true));});
test('adjustment explanations are optional for draft saves and completed checks; amount stays exact',()=>{const d=reviewDraft(row);d.adjustment='-10';d.total='95';assert.equal(reviewPayload(row,d,false).adjustment_note,'');assert.equal(reviewPayload(row,d,true).adjustment,-10);assert.equal(reviewNet(d),90);d.adjustmentNote='廠商折讓';assert.equal(reviewPayload(row,d,true).adjustment_note,'廠商折讓');});
test('blank optional adjustment defaults to no adjustment; unknown prices and tax remain unknown',()=>{const d=reviewDraft(row);d.adjustment='';d.tax='';d.lines[0].unit_price='';const payload=reviewPayload(row,d,false);assert.equal(payload.adjustment,0);assert.equal(payload.tax,null);assert.equal(payload.lines[0].unit_price,null);assert.equal(payload.checked,false);assert.equal(reviewNet(d),100);});
test('next receipt skips checked, removed, pending and unauthorized receipts without changing the list',()=>{const rows=[row,{...row,batch_id:'b'},{...row,batch_id:'p',pending:true,status:'PENDING'},{...row,batch_id:'c',status:'UNCHECKED'}];assert.equal(nextReviewId(rows,'a'),'c');assert.equal(nextReviewId(rows,'c'),null);assert.equal(rows[0].status,'CHECKED');});
test('raw evidence is not rewritten; scopes, source tokens and effective ledgers are explicitly tested',()=>{const sql=readFileSync(new URL('../supabase/migrations/20261004112000_receipt_review_workbench.sql',import.meta.url),'utf8');assert.doesNotMatch(sql,/disable trigger|update public\.goods_receipts|update public\.receipt_lines|update private\.staff_pin/i);assert.match(sql,/RECEIPT_LINES_CHANGED/);assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/p_store_id.*p_batch_id/s);assert.match(sql,/receipt_apply_account_edits/);assert.match(sql,/raw_fingerprint/);});
test('partial display subtotal never changes missing financial amounts; tax conversion requires explicit rate',async()=>{
 const {enteredSubtotal,taxExclusivePrice}=await import('../lib/receipt-review.ts');const d=reviewDraft(row);d.lines.push({...d.lines[0],row_key:'missing',quantity:'',unit_price:'',subtotal:''});d.tax='';
 assert.deepEqual(enteredSubtotal(d),{subtotal:100,missing:1});assert.equal(reviewNet(d),null);assert.equal(reviewTotal(d),null);assert.equal(reviewPayload(row,d,false).tax,null);
 assert.equal(taxExclusivePrice('105','5'),100);assert.equal(taxExclusivePrice('105','0'),105);assert.throws(()=>taxExclusivePrice('105',''));assert.throws(()=>taxExclusivePrice('105','-1'));
});

test('pending prices distinguish empty, zero, and prepaid custody',()=>{
 assert.equal(receiptMissingPrices([{unit_price:null},{unit_price:''},{unit_price:0},{unit_price:'0'},{unit_price:null,handling:'CUSTODY_RELEASE'}]),2);
});

test('tax entry updates the persisted total immediately, including zero and decimal tax',()=>{
 const d=reviewDraft({...row,total:null,lines:[{...row.lines[0],subtotal:3088.8}]});
 const first=changeReviewTax(d,'154');assert.equal(first.total,'3243');assert.equal(reviewPayload(row,first,false).total,3243);
 assert.equal(changeReviewTax(first,'154.44').total,'3243.44');assert.equal(changeReviewTax(first,'0').total,'3089');
 assert.equal(changeReviewTax(first,'').tax,'');assert.equal(changeReviewTax(first,'bad').tax,'bad');
 const missing={...d,total:'',lines:[{...d.lines[0],subtotal:''}]};assert.equal(changeReviewTax(missing,'154').total,'');
});

test('entry rounds net once, preserves printed totals and keeps absent tax unknown',()=>{
 const d=reviewDraft({...row,tax:null,total:null,lines:[{...row.lines[0],quantity:3.51,unit_price:880,subtotal:3088.8}]});
 assert.equal(receiptEntryAmounts(d).total,3089);assert.equal(reviewPayload(row,d,false).tax,null);assert.equal(reviewPayload(row,d,false).total,3089);
 const taxed=changeReviewTax(d,'154');assert.equal(taxed.total,'3243');assert.equal(receiptEntryAmounts(taxed).difference,0.2);assert.equal(receiptEntryAmounts(taxed).roundedNet,true);
 taxed.total='3242';assert.equal(reviewPayload(row,taxed,false).total,3242);assert.equal(receiptEntryAmounts(taxed).roundedNet,false);
 assert.equal(reviewPayload(row,taxed,false).lines[0].unit_price,880);assert.equal(reviewPayload(row,taxed,false).lines[0].subtotal,3088.8);
 const two={...d,lines:[{...d.lines[0],subtotal:'1.2'},{...d.lines[0],row_key:'two',subtotal:'1.2'}]};assert.equal(receiptEntryAmounts(two).total,3);
});


test('line comparison preserves printed amounts and missing values',async()=>{
 const {receiptLineDifference}=await import('../lib/receipt-review.ts');
 assert.equal(receiptLineDifference({quantity:'5',unit_price:'65',subtotal:'325'}),null);
 assert.equal(receiptLineDifference({quantity:'5',unit_price:'65',subtotal:'330'}),5);
 assert.equal(receiptLineDifference({quantity:'',unit_price:'65',subtotal:'330'}),null);
 assert.equal(receiptLineDifference({quantity:'3',unit_price:'0.1',subtotal:'0.3'}),null);
 assert.equal(receiptLineDifference({handling:'CUSTODY_RELEASE',quantity:'5',unit_price:'65',subtotal:'0'}),null);
});

test('integer payment rounding keeps precise receipt costs and still rejects real mismatches',()=>{
 const d=reviewDraft(row);d.lines[0].quantity='1';d.lines[0].unit_price='22112.3344';d.lines[0].subtotal='22112.3344';d.tax='1106';d.total='23218';
 assert.equal(reviewPayload(row,d,true).lines[0].subtotal,22112.3344);
 assert.equal(receiptEntryAmounts(d).roundedTotal,true);
 d.total='23219';assert.throws(()=>reviewPayload(row,d,true));
 d.total='23218.1';assert.throws(()=>reviewPayload(row,d,true));
});
