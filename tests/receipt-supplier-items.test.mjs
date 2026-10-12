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
test('selection fills a blank price, computes amount, and never supplies quantity',()=>{
 const item={name:'火腿',unit:'包',specification:'',price:850,date:'2026-10-12'};
 const draft={lines:[{product_name:'火',unit:'',specification:'',quantity:'2',unit_price:'',subtotal:''}]};
 const result=applySupplierItem(draft,0,item);assert.equal(result.lines[0].unit_price,'850');assert.equal(result.lines[0].subtotal,'1700');
 draft.lines[0].quantity='';const blank=applySupplierItem(draft,0,item);assert.equal(blank.lines[0].quantity,'');assert.equal(blank.lines[0].subtotal,'');
});
test('all supplier history keeps source identities and excludes raw OCR and current batch',()=>{
 const rows=[account('a','2026-09-01'),account('b','2026-10-01',{supplier_name:'另一肉商'}),account('current','2026-10-10'),account('raw','2026-10-12',{edit_revision:0})];
 const items=supplierItems(rows,'','current');assert.equal(items.length,2);assert.equal(items[0].supplier,'另一肉商');
});
test('keyword search is normalized and does not lose matches beyond the first hundred items',async()=>{
 const {matchSupplierItems}=await import('../lib/receipt-supplier-items.ts');
 const rows=[account('many','2026-09-01',{lines:Array.from({length:150},(_,i)=>({...line,product_name:`品項${i}`}))})];
 assert.equal(matchSupplierItems(supplierItems(rows,'肉商','current'),'品項149').length,1);
 assert.equal(matchSupplierItems([{name:'ABC 火腿',unit:'包',specification:'切片',supplier:'歐陸',price:2,date:''}],'ａｂｃ 切片').length,1);
});
