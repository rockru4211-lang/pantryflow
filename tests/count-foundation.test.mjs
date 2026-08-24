import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';
import test from'node:test';
import{validateCatalogRows}from'../pilot-v1/services/catalog-import.js';
import{countPage}from'../pilot-v1/pages/count.js';

const base={product_code:'HAM-001',name:'火腿',count_unit:'包',purchase_unit:'箱',opening_quantity:'10'};

test('Excel import accepts a valid row and preserves zero opening quantity',()=>{
  const [valid,zero]=validateCatalogRows([base,{...base,product_code:'OIL-001',opening_quantity:'0'}]);
  assert.deepEqual(valid.errors,[]);assert.deepEqual(zero.errors,[]);assert.equal(zero.row.opening_quantity,0);
});
test('Excel import reports exact row, field and reason',()=>{
  const result=validateCatalogRows([{...base,name:''}])[0];
  assert.deepEqual(result.errors,[{row:2,field:'name',message:'必填欄位不可空白'}]);
});
test('Excel import rejects a duplicate code inside the file',()=>{
  const result=validateCatalogRows([base,{...base,name:'另一商品'}]);
  assert.deepEqual(result[1].errors,[{row:3,field:'product_code',message:'檔案內商品編碼重複'}]);
});
test('database import updates an existing product instead of creating a duplicate',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/20260824043544_employee_manager_count_foundation.sql',import.meta.url),'utf8');
  assert.match(sql,/status','UPDATED'/);assert.match(sql,/on conflict\(store_id,product_id\) do update/);
});
test('manager creation locks one of three opening sources',()=>{
  const html=countPage({sessions:[],zones:[{id:'z',name:'冷藏庫'}],products:[{id:'p',name:'火腿'}],assignments:[{zone_id:'z',product_id:'p'}]},{canManage:true});
  for(const value of['LAST_APPROVED_COUNT','OPENING_INVENTORY_EXCEL','MANAGER_MANUAL_OPENING'])assert.match(html,new RegExp(value));
});
test('employee blind count contains no opening, previous quantity, difference or Excel controls',()=>{
  const html=countPage({sessions:[{id:'s',status:'IN_PROGRESS'}],zones:[{id:'z',name:'冷藏庫'}],products:[{id:'p',name:'火腿',product_code:'HAM',count_unit:'包'}],assignments:[{zone_id:'z',product_id:'p'}],progress:[{session_id:'s',zone_id:'z',status:'NOT_STARTED'}],drafts:[]},{canManage:false,context:{sessionId:'s',zoneId:'z'}});
  assert.match(html,/目前數量與儲存狀態/);assert.match(html,/step="0\.001"/);assert.match(html,/← 返回區域/);
  assert.doesNotMatch(html,/期初 \d|上次數量|差異 \d|Excel|建立商品/);
});
test('employee task card does not expose the locked opening source',()=>{
  const html=countPage({sessions:[{id:'s',status:'IN_PROGRESS',opening_source:'LAST_APPROVED_COUNT'}],zones:[{id:'z',name:'冷藏庫'}],products:[{id:'p',name:'火腿'}],assignments:[{zone_id:'z',product_id:'p'}],progress:[]},{canManage:false});
  assert.match(html,/選擇盤點任務/);assert.doesNotMatch(html,/期初來源|LAST_APPROVED_COUNT/);
});
test('manager discrepancy only permits reason and explicit recount, never quantity overwrite',()=>{
  const html=countPage({sessions:[{id:'s',status:'REVIEWING'}],zones:[],products:[{id:'p',name:'火腿'}],assignments:[],discrepancies:[{id:'d',product_id:'p',previous_quantity:10,estimated_quantity:9,difference:-1}]},{canManage:true});
  assert.match(html,/差異總覽/);assert.match(html,/開啟員工重盤/);assert.doesNotMatch(html,/name="quantity"|直接改|修正數量/);
});
test('every count flow non-home view renders a working back control',()=>{
  const data={sessions:[{id:'s',status:'IN_PROGRESS'}],zones:[{id:'z',name:'冷藏庫'}],products:[{id:'p',name:'火腿',product_code:'HAM',count_unit:'包'}],assignments:[{zone_id:'z',product_id:'p'}],progress:[{session_id:'s',zone_id:'z',status:'NOT_STARTED'}],drafts:[]};
  for(const context of[{}, {sessionId:'s'}, {sessionId:'s',zoneId:'z'}])assert.match(countPage(data,{canManage:false,context}),/data-back/);
});
test('future migration is explicit and production remains untouched',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/20260824043544_employee_manager_count_foundation.sql',import.meta.url),'utf8');
  assert.match(sql,/FUTURE-APPLY ONLY/);assert.match(sql,/inventory_count_task_assignments/);assert.match(sql,/inventory_count_recount_events/);assert.match(sql,/create_count_session_with_source/);assert.match(sql,/import_count_catalog/);assert.match(sql,/COUNT_TASK_ASSIGNMENT_REQUIRED/);assert.match(sql,/COUNT_RECOUNT_COMPLETED/);
});
