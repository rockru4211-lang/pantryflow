import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  groupSuppliers,supplierKey,inArrivalRange,documentLines,sortLines,filterLines,
  finiteNumber,calculatedSubtotal,lineSubtotal,totals,cleanValues,exportMatrix,money,adminError,
} from '../lib/admin-receipt-register.ts';
const batch=(id,extra={})=>({id,store_id:'store-a',organization_id:'org-a',batch_number:`RC-${id}`,
  supplier:'大永食材',supplier_id:'supplier-a',uploaded_at:'2026-09-16T02:00:00Z',ocr_status:'SUCCEEDED',job_status:'SUCCEEDED',
  delivery:{arrived_on:'2026-09-12',arrived_time:null,revision:1,issues:[]},row_count:2,reviewed_count:0,...extra});
const line=(id,extra={})=>({id,batchId:'b',batchNumber:'RC-b',runId:'run-a',rowKey:id,arrivedOn:'2026-09-12',supplier:'大永食材',
  values:{product:'食材',quantity:2,unit_price_ex_tax:18,unit:'包'},original:{},revision:0,sourceToken:'token',reviewed:false,stale:false,...extra});
const doc=(extra={})=>({batch:{id:'b',store_id:'store-a',organization_id:'org-a',batch_number:'RC-b',delivery:{arrived_on:'2026-09-12',revision:1,issues:[]}},
  run:{id:'run-a',status:'SUCCEEDED'},documents:[],fields:[
    {id:'f1',row_key:'document',field_name:'supplier_name',value:'大永食材',raw_value:'大永食材'},
    {id:'f2',row_key:'1',field_name:'product',value:'細鹽',raw_value:'細鹽'},
    {id:'f3',row_key:'1',field_name:'quantity',value:2,raw_value:2}],admin:{rows:[],tokens:{'1':'current'}},...extra});

test('same supplier ID combines receipts and distinct counts',()=>{const [g]=groupSuppliers([batch('a'),batch('b',{row_count:5,reviewed_count:2})]);assert.equal(g.batches.length,2);assert.equal(g.rowCount,7);assert.equal(g.reviewedCount,2);});
test('different supplier IDs do not merge even with identical names',()=>assert.equal(groupSuppliers([batch('a'),batch('b',{supplier_id:'other'})]).length,2));
test('same supplier never merges across organizations or stores',()=>assert.equal(groupSuppliers([batch('a'),batch('b',{store_id:'other'}),batch('c',{organization_id:'other'})]).length,3));
test('missing IDs use exact names, not fuzzy aliases',()=>assert.equal(groupSuppliers([batch('a',{supplier_id:null,supplier:'瑞濱海產'}),batch('b',{supplier_id:null,supplier:'瑞濱海產有限公司'})]).length,2));
test('unassigned supplier is clearly separated from a real supplier',()=>assert.notEqual(supplierKey(batch('a',{supplier:null,supplier_id:null})),supplierKey(batch('b'))));
test('blank supplier name with batch number is not treated as a vendor',()=>assert.equal(groupSuppliers([batch('a',{supplier:'RC-a',supplier_id:null})])[0].name,'未辨識供應商（待歸戶）'));
test('latest arrival uses delivery dates, never upload timestamps',()=>assert.equal(groupSuppliers([batch('a'),batch('b',{delivery:{arrived_on:null,revision:0,issues:[]},uploaded_at:'2030-01-01'})])[0].latestArrival,'2026-09-12'));
test('range includes undated data only when explicitly enabled',()=>{const b=batch('a',{delivery:{arrived_on:null,revision:0,issues:[]}});assert.equal(inArrivalRange(b,'2026-09-01','2026-09-30',true),true);assert.equal(inArrivalRange(b,'2026-09-01','2026-09-30',false),false);});
test('range is inclusive on actual delivery date',()=>{const b=batch('a');assert.equal(inArrivalRange(b,'2026-09-12','2026-09-12',false),true);assert.equal(inArrivalRange(b,'2026-09-13','',true),false);});
test('ascending dates and natural row order keep undated records last',()=>{const rows=[line('10'),line('2'),line('0',{arrivedOn:null}),line('a',{arrivedOn:'2026-09-11'})];assert.deepEqual(sortLines(rows).map(l=>l.id),['a','2','10','0']);});
test('descending dates also keep undated rows last',()=>assert.deepEqual(sortLines([line('1'),line('2',{arrivedOn:null}),line('3',{arrivedOn:'2026-09-14'})],true).map(l=>l.id),['3','1','2']));
test('sorting does not mutate input',()=>{const rows=[line('2'),line('1')];sortLines(rows);assert.equal(rows[0].id,'2');});
test('header is not counted as a line',()=>assert.equal(documentLines(doc(),'大永食材').length,1));
test('not-yet-recognized receipts produce no invented lines',()=>assert.equal(documentLines(doc({run:{id:'run-a',status:'RUNNING'}}),'大永食材').length,0));
test('original values are preserved after administrative edits',()=>{const d=doc({admin:{rows:[{row_key:'1',revision:1,values:{quantity:3},source_token:'current',reviewed:true}],tokens:{'1':'current'}}});const row=documentLines(d,'大永食材')[0];assert.equal(row.values.quantity,3);assert.equal(row.original.quantity,2);assert.equal(d.fields[2].raw_value,2);assert.equal(row.reviewed,true);});
test('changed source invalidates reviewed status, not the saved correction',()=>{const row=documentLines(doc({admin:{rows:[{row_key:'1',revision:2,values:{quantity:3},source_token:'old',reviewed:true}],tokens:{'1':'new'}}}),'大永食材')[0];assert.equal(row.stale,true);assert.equal(row.reviewed,false);assert.equal(row.values.quantity,3);});
test('missing money stays unknown, zero is a real value',()=>{assert.equal(finiteNumber(''),null);assert.equal(finiteNumber(null),null);assert.equal(finiteNumber(false),null);assert.equal(finiteNumber(0),0);assert.equal(money(null),'未填');assert.equal(money(0),'0');});
test('subtotals preserve explicit zero and invoice discounts',()=>{assert.equal(lineSubtotal({quantity:2,unit_price_ex_tax:18,subtotal_ex_tax:30}),30);assert.equal(lineSubtotal({quantity:2,unit_price_ex_tax:18,subtotal_ex_tax:0}),0);});
test('quantity times price computes cents without 0.30000000004',()=>assert.equal(calculatedSubtotal(3,0.1),0.3));
test('missing price cannot be silently replaced by zero',()=>assert.equal(calculatedSubtotal(3,null),null));
test('summary identifies missing money separately',()=>{assert.deepEqual(totals([line('1'),line('2',{values:{quantity:3}}),line('3',{values:{subtotal_ex_tax:0}})]),{sum:36,missing:1});});
test('turning codes off omits field rather than clearing stored codes',()=>{const values=cleanValues({product:'細鹽',product_code:'004-0008'},false);assert.equal('product_code' in values,false);assert.equal(({product_code:'004-0008',...values}).product_code,'004-0008');});
test('enabled codes preserve leading zeros and do not generate a code',()=>{assert.equal(cleanValues({product_code:'004-0008'},true).product_code,'004-0008');assert.equal(cleanValues({},true).product_code,'');});
test('numeric validation rejects negative, infinite and malformed input',()=>{for(const n of [-1,Infinity,'abc',1e13])assert.throws(()=>cleanValues({quantity:n},false));});
test('blank numeric cells remain null on save',()=>assert.equal(cleanValues({quantity:'',unit_price_ex_tax:''},false).quantity,null));
test('export includes all filtered records, not a 20-row page',()=>{const rows=Array.from({length:47},(_,i)=>line(`${i}`));assert.equal(exportMatrix(rows,false).length,48);});
test('export excludes codes by default and preserves text when enabled',()=>{const rows=[line('1',{values:{product_code:'0008',product:'=1+1',quantity:0}})];assert.equal(exportMatrix(rows,false)[0].includes('品項編碼'),false);const matrix=exportMatrix(rows,true);assert.equal(matrix[1][3],'0008');assert.equal(matrix[1][5],'=1+1');});
test('search and reviewed filter are both applied',()=>{const rows=[line('1',{values:{product:'細鹽'},reviewed:true}),line('2',{values:{product:'細鹽'},reviewed:false})];assert.equal(filterLines(rows,'細鹽','pending')[0].id,'2');});
test('missing migration is reported, not shown as a successful empty table',()=>assert.match(adminError({code:'PGRST202',message:'Could not find the function'}),/尚未安裝/));
test('new administrative code does not invoke store confirmation',()=>{const ui=readFileSync(new URL('../app/pilot/admin-receipt-workspace.tsx',import.meta.url),'utf8');assert.doesNotMatch(ui,/save_pilot_receipt_review|complete_pilot_receipt_erp|確認收貨|申請修改/);assert.match(ui,/delete cell\.f/);assert.match(ui,/exportMatrix\(filtered,showCodes\)/);});
test('migration grants only guarded RPCs; no direct table or stock writes',()=>{const sql=readFileSync(new URL('../supabase/migrations/20260916040000_admin_receipt_reconciliation.sql',import.meta.url),'utf8');assert.doesNotMatch(sql,/(?:insert into|update|delete from)\s+public\.(?:goods_receipts|receipt_lines|inventory_lots|receipt_ocr_fields|receipt_upload_batches)\b/i);assert.doesNotMatch(sql,/grant\s+(?:all|select|insert|update|delete)\b/i);assert.match(sql,/private\.app_role\(p_store\) is distinct from 'LOGISTICS'/);assert.match(sql,/SOURCE_CHANGED/);assert.match(sql,/request\.user_id<>auth\.uid\(\)/);});
