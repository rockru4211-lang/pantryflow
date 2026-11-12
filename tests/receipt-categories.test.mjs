import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptCategories,receiptCategoryOptions,matchesReceiptCategory} from '../lib/receipt-categories.ts';
import {reviewDraft,reviewPayload} from '../lib/receipt-review.ts';
import {acceptReceiptSave,rebaseReceiptDraft} from '../lib/receipt-autosave.ts';
const account={batch_id:'a',supplier_name:'甲',receipt_date:'2026-10-17',document_number:'',note:'',tax:null,total:null,source_fingerprint:'x',revision:1,run_id:'r',lines:[],receipt_categories:['食材']};
test('invoice categories are optional, trim duplicates and retain custom labels',()=>{
 assert.deepEqual(receiptCategories([' 食材 ','食材','清潔用品',null]),['食材','清潔用品']);assert.deepEqual(receiptCategories('食材'),[]);
 assert.deepEqual(receiptCategoryOptions([{receipt_categories:['清潔用品','耗材']}]),['食材','酒水','耗材','清潔用品']);
 const draft=reviewDraft(account);assert.deepEqual(draft.receiptCategories,['食材']);assert.deepEqual(reviewPayload(account,draft,false).receipt_categories,['食材']);
 assert.deepEqual(reviewPayload(account,{...draft,receiptCategories:[]},false).receipt_categories,[]);
});
test('category filtering selects whole invoices and handles explicit unclassified documents',()=>{
 assert.equal(matchesReceiptCategory(['食材','耗材'],'耗材'),true);assert.equal(matchesReceiptCategory(['食材'],'酒水'),false);assert.equal(matchesReceiptCategory(undefined,'__uncategorized'),true);assert.equal(matchesReceiptCategory(['食材'],'__uncategorized'),false);
});

test('late save response retains a more recently selected classification',()=>{
 const sent=reviewDraft(account);const current={...sent,receiptCategories:['酒水']};assert.deepEqual(acceptReceiptSave(account,sent,current).receiptCategories,['酒水']);
});
test('category rebase compares array values and reports real concurrent classification edits',()=>{
 const mine=reviewDraft(account);assert.deepEqual(rebaseReceiptDraft(account,mine,{...account,note:'遠端備註'}).conflicts,[]);
 const result=rebaseReceiptDraft(account,{...mine,receiptCategories:['耗材']},{...account,receipt_categories:['酒水']});assert.match(result.conflicts[0],/貨單分類/);
});
