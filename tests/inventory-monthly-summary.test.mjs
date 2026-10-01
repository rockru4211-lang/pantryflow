import test from 'node:test';
import assert from 'node:assert/strict';
import {monthlyDisplayRows,inventoryActiveRows,inventoryPurchases,inventoryExportRows} from '../lib/inventory-monthly.ts';
const row={product_id:'almond',row_key:'new',name:'杏仁粉',unit:'kg',current_quantity:.2,previous_quantity:null,zones:[{zone:'乾貨',note:'已開封'}]};
test('pairs baseline by stable identity and equivalent units, never by name or incompatible units',()=>{
 const old={...row,row_key:'old',unit:'公斤',current_quantity:null,previous_quantity:.5};
 assert.equal(monthlyDisplayRows([row,old]).length,1);assert.equal(monthlyDisplayRows([row,old])[0].previous_quantity,.5);
 assert.equal(monthlyDisplayRows([row,{...old,product_id:'other'}]).length,2);
 assert.equal(monthlyDisplayRows([row,{...old,unit:'包'}]).length,2);
 assert.equal(monthlyDisplayRows([row,{...row,row_key:'other'},old]).length,3);
 assert.equal(row.previous_quantity,null);
});
test('removed zero rows stay out, history and period activity survive',()=>{
 const removed=[{product_id:'almond',removed_at:'2026-09-15'}];
 assert.equal(inventoryActiveRows([{...row,current_quantity:0}],removed,'2026-09').length,0);
 assert.equal(inventoryActiveRows([row],removed,'2026-09').length,1);
 assert.equal(inventoryActiveRows([{...row,current_quantity:0}],removed,'2026-08').length,1);
 assert.equal(inventoryActiveRows([{...row,current_quantity:0,previous_quantity:2}],removed,'2026-09').length,1);
});
test('receiving subtotal deduplicates row IDs, excludes removed/test, wrong months, pending and incompatible units',()=>{
 const line={batch_id:'r1',row_key:'l1',product_id:'almond',unit:'公斤',quantity:2,status:'COMPLETE',receipt_date:'2026-09-01'};
 const entries=[line,line,{...line,batch_id:'test'},{...line,batch_id:'pending',status:'PENDING'},{...line,batch_id:'other-month',receipt_date:'2026-08-31'},{...line,batch_id:'pack',unit:'包'}];
 const [r]=inventoryPurchases([row],entries,[{entity_id:'test',state:'TEST'}],'2026-09');
 assert.equal(r.purchase_quantity,2);assert.match(r.purchase_status,/尚待補齊/);
 assert.equal(inventoryPurchases([row],[],[],'2026-09')[0].purchase_quantity,null);
 const out=inventoryExportRows([r])[0];assert.equal(out['期末'],.2);assert.equal(out['本月進貨'],2);assert.equal(out['現場備註'],'乾貨：已開封');
});
