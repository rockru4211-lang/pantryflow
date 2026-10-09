import test from 'node:test';
import assert from 'node:assert/strict';
import {supplierItems,applySupplierItem} from '../lib/receipt-supplier-items.ts';
const line={product_name:'牛邊條',unit:'公斤',specification:'',unit_price:380};
const account=(id,date,overrides={})=>({batch_id:id,receipt_date:date,supplier_name:'肉商',record_state:'LIVE',edit_revision:1,status:'UNCHECKED',lines:[line],...overrides});
test('supplier history is exact, recent-first, distinct by specification/unit and excludes unreviewed or removed data',()=>{
 const rows=[account('old','2026-09-01'),account('new','2026-10-01',{lines:[{...line,unit_price:400}]}),account('current','2026-10-09'),account('other','2026-10-09',{supplier_name:'另一肉商'}),account('removed','2026-10-09',{record_state:'REMOVED'}),account('raw','2026-10-09',{edit_revision:0})];
 const items=supplierItems(rows,'肉商','current');assert.equal(items.length,1);assert.equal(items[0].price,400);assert.equal(items[0].date,'2026-10-01');
});
test('choosing a common item leaves entered quantity and current price untouched',()=>{
 const draft={lines:[{product_name:'',unit:'',specification:'',quantity:'3',unit_price:'420',subtotal:'1260'}]};
 const result=applySupplierItem(draft,0,{name:'牛邊條',unit:'公斤',specification:'',price:380,date:'2026-10-01'});
 assert.equal(result.lines[0].product_name,'牛邊條');assert.equal(result.lines[0].unit,'公斤');assert.equal(result.lines[0].quantity,'3');assert.equal(result.lines[0].unit_price,'420');assert.equal(result.lines[0].subtotal,'1260');
});
