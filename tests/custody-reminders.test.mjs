import test from 'node:test';import assert from 'node:assert/strict';
import {matchingReminders,reminderLabel} from '../lib/custody-reminders.ts';
import {reviewPayload,reviewDraft} from '../lib/receipt-review.ts';
const rows=[{id:'r',name:'火腿',supplier:'供應商',unit:'包',remaining:100,kind:'supplier'}];
test('only exact supplier, item and compatible literal unit are offered; no guessed package conversion',()=>{
 assert.equal(matchingReminders(rows,{product_name:'火腿',unit:'包'},'供應商').length,1);
 for(const line of [{product_name:'火腿',unit:'公斤'},{product_name:'火腿片',unit:'包'}])assert.equal(matchingReminders(rows,line,'供應商').length,0);
 assert.equal(matchingReminders(rows,{product_name:'火腿',unit:'包'},'別家').length,0);
 assert.equal(matchingReminders([{...rows[0],remaining:0}],{product_name:'火腿',unit:'包'},'供應商').length,0);
 assert.equal(reminderLabel('supplier'),'寄庫');assert.equal(reminderLabel('reserved'),'保留貨');
});
test('reminder link roundtrips and does not alter receipt prices; clearing remains explicit',()=>{
 const row={supplier_name:'供應商',receipt_date:'2026-10-11',note:'',lines:[{row_key:'1',product_name:'火腿',unit:'包',quantity:2,unit_price:50,subtotal:100,category:'食材',note:'',specification:'',custody_reminder_id:'r'}]};
 const d=reviewDraft(row);let payload=reviewPayload(row,d,false);assert.equal(payload.lines[0].custody_reminder_id,'r');assert.equal(payload.lines[0].subtotal,100);assert.equal(payload.lines[0].unit_price,50);
 d.lines[0].custody_reminder_id='';payload=reviewPayload(row,d,false);assert.equal(payload.lines[0].custody_reminder_id,'');
});
