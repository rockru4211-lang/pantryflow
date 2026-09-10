import test from 'node:test';
import assert from 'node:assert/strict';
import { validCountQuantity, paperOrder, countExportRows } from '../lib/count-flow.ts';
test('count quantities distinguish missing, explicit zero, fractions and invalid input',()=>{
 for(const value of [undefined,'',' ','-1','Infinity','NaN']) assert.equal(validCountQuantity(value),false);
 for(const value of ['0','0.00','1.25']) assert.equal(validCountQuantity(value),true);
});
test('paper output restores file, worksheet, row order independent of count zones',()=>{
 const rows=[{id:'manual'},{id:'sheet2',file_name:'a.xlsx',file_order:'2026-09-07',sheet_order:2,source_row:2},{id:'row10',file_name:'a.xlsx',file_order:'2026-09-07',sheet_order:1,source_row:10},{id:'row2',file_name:'a.xlsx',file_order:'2026-09-07',sheet_order:1,source_row:2}];
 assert.deepEqual(paperOrder(rows).map(r=>r.id),['row2','row10','sheet2','manual']);
 assert.equal(rows[0].id,'manual');
});
test('staff export is an explicit whitelist with no baseline or unexpected API properties',()=>{
 const row={name:'奶油',zone:'未分類',unit:'瓶',quantity:0,opening_quantity:45,cost:999,raw_values:{secret:10},entered_at:'2026-09-08'};
 const safe=countExportRows([row],false)[0];assert.equal(safe['本次數量'],0);assert.ok(!JSON.stringify(safe).includes('45'));assert.ok(!JSON.stringify(safe).includes('999'));assert.ok(!Object.hasOwn(safe,'期初'));
 assert.equal(countExportRows([{...row,opening_quantity:null}],true)[0]['期初'],'未提供');
});
