import test from 'node:test';
import assert from 'node:assert/strict';
import { purchaseDisposition } from '../supabase/functions/_shared/receipt-purchase-evidence.ts';
import { pendingReceiptPurchases, receiptReviewFields } from '../lib/receipt-workflow.ts';

test('catalog price and package sizes never become purchases',()=>{
 assert.equal(purchaseDisposition({purchase_evidence:'CATALOG',unit:{value:'3KG'},unit_price_ex_tax:{value:150}}),'skip');
 assert.equal(purchaseDisposition({purchase_evidence:'QUANTITY',quantity:{value:null},unit:{value:'20KG'}}),'review');
 assert.equal(purchaseDisposition({purchase_evidence:'TRANSACTION_AMOUNT',unit_price_ex_tax:{value:150}}),'review');
});
test('quantity-only custody, printed purchases, and explicit marks are preserved',()=>{
 assert.equal(purchaseDisposition({purchase_evidence:'QUANTITY',quantity:{value:2}}),'purchase');
 assert.equal(purchaseDisposition({purchase_evidence:'TRANSACTION_AMOUNT',subtotal_ex_tax:{value:600}}),'purchase');
 assert.equal(purchaseDisposition({purchase_evidence:'MARKED'}),'purchase');
 assert.equal(purchaseDisposition({product:{value:'蝸牛肉'}}),'review');
});
test('pending purchase review preserves readable values and hides decided candidates',()=>{
 const fields=[
  {row_key:'candidate-0001',field_name:'product',value:'蝸牛肉',review_status:'TRUSTED'},
  {row_key:'candidate-0001',field_name:'quantity',value:null,raw_value:'字跡不清'},
  {row_key:'candidate-0002',field_name:'product',value:'已確認列'},
 ];
 assert.deepEqual(pendingReceiptPurchases(receiptReviewFields(fields,[{row_key:'candidate-0002',decision:'IGNORE'}])),
  [{key:'candidate-0001',name:'蝸牛肉',quantity:'字跡不清',amount:''}]);
});
