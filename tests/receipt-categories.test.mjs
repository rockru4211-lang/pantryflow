import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptCategories,receiptCategoryOptions,lastSupplierReceiptCategories,matchesReceiptCategory} from '../lib/receipt-categories.ts';
import {reviewDraft,reviewPayload} from '../lib/receipt-review.ts';
import {acceptReceiptSave,rebaseReceiptDraft} from '../lib/receipt-autosave.ts';
const account={batch_id:'a',supplier_name:'甲',receipt_date:'2026-10-17',document_number:'',note:'',tax:null,total:null,source_fingerprint:'x',revision:1,run_id:'r',lines:[],receipt_categories:['食材']};
test('invoice categories are optional, trim duplicates and retain custom labels',()=>{
 assert.deepEqual(receiptCategories([' 食材 ','食材','清潔用品',null]),['食材','清潔用品']);assert.deepEqual(receiptCategories('食材'),[]);
 assert.deepEqual(receiptCategoryOptions([{receipt_categories:['清潔用品','耗材']}]),['食材','酒水','耗材','清潔用品']);
 const draft=reviewDraft(account);assert.deepEqual(draft.receiptCategories,['食材']);assert.deepEqual(reviewPayload(account,draft,false).receipt_categories,['食材']);
 assert.deepEqual(reviewPayload(account,{...draft,receiptCategories:[]},false).receipt_categories,[]);
});
test('last-used defaults require the exact supplier and saved live invoices, without modifying history',()=>{
 const rows=[{...account,record_state:'LIVE',edit_revision:1,batch_id:'old',receipt_date:'2026-10-01',receipt_categories:['酒水']},{...account,record_state:'TEST',edit_revision:4,batch_id:'test',receipt_categories:['測試']},{...account,record_state:'LIVE',edit_revision:0,batch_id:'draft',receipt_categories:['耗材']},{...account,record_state:'LIVE',edit_revision:1,batch_id:'other',supplier_name:'乙',receipt_categories:['耗材']}];
 const before=JSON.stringify(rows);assert.deepEqual(lastSupplierReceiptCategories(rows,'甲','a'),['酒水']);assert.deepEqual(lastSupplierReceiptCategories(rows,'甲','old'),[]);assert.equal(JSON.stringify(rows),before);
});
test('category filtering selects whole invoices and handles explicit unclassified documents',()=>{
 assert.equal(matchesReceiptCategory(['食材','耗材'],'耗材'),true);assert.equal(matchesReceiptCategory(['食材'],'酒水'),false);assert.equal(matchesReceiptCategory(undefined,'__uncategorized'),true);assert.equal(matchesReceiptCategory(['食材'],'__uncategorized'),false);
});

test('last saved classification wins even when entering older invoices and canonical aliases differ',()=>{
 const rows=[
  {...account,batch_id:'recent-date',supplier_name:'正式供應商',record_state:'LIVE',edit_revision:2,receipt_date:'2026-10-19',edited_at:'2026-10-19T07:00:00Z',receipt_categories:['食材']},
  {...account,batch_id:'saved-last',supplier_name:'舊稱',record_state:'LIVE',edit_revision:1,receipt_date:'2026-09-01',edited_at:'2026-10-19T08:00:00Z',receipt_categories:['耗材','清潔用品']},
  {...account,batch_id:'partial',supplier_name:'正式供應商分店',record_state:'LIVE',edit_revision:1,edited_at:'2026-10-19T09:00:00Z',receipt_categories:['酒水']},
 ];
 assert.deepEqual(lastSupplierReceiptCategories(rows,' 正式 供應商 ','a',['舊稱']),['耗材','清潔用品']);
 assert.deepEqual(lastSupplierReceiptCategories(rows,'正式','a'),[]);
 assert.deepEqual(lastSupplierReceiptCategories(rows,'正式供應商','saved-last',['舊稱']),['食材']);
});
test('late save response retains a more recently selected classification',()=>{
 const sent=reviewDraft(account);const current={...sent,receiptCategories:['酒水']};assert.deepEqual(acceptReceiptSave(account,sent,current).receiptCategories,['酒水']);
});
test('category rebase compares array values and reports real concurrent classification edits',()=>{
 const mine=reviewDraft(account);assert.deepEqual(rebaseReceiptDraft(account,mine,{...account,note:'遠端備註'}).conflicts,[]);
 const result=rebaseReceiptDraft(account,{...mine,receiptCategories:['耗材']},{...account,receipt_categories:['酒水']});assert.match(result.conflicts[0],/貨單分類/);
});
