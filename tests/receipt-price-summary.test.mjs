import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptPriceSummary} from '../lib/receipt-price-summary.ts';
test('prices preserve units, weight known quantities, and do not infer dates or missing prices',()=>{
 const line={product_id:'flour',name:'Flour',unit:'公斤',quantity:2,unit_price:40,receipt_date:'2026-09-01',supplier_name:'A',source_batch_id:'a'};
 const result=receiptPriceSummary([line,{...line,quantity:1,unit_price:70,receipt_date:'2026-09-03',source_batch_id:'b'},{...line,unit:'袋',quantity:1,unit_price:500},{...line,quantity:10,unit_price:null},{...line,product_id:'unknown',name:'Unknown',unit_price:12,receipt_date:null}]);
 assert.equal(result.length,3);assert.equal(result[0].weightedAverage,50);assert.equal(result[0].latest,70);assert.equal(result[0].source,'b');assert.equal(result[1].latest,500);assert.equal(result[2].latest,null);
});
