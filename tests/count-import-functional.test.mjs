import assert from'node:assert/strict';
import test from'node:test';
import{parseCountImportFile}from'../pilot-v1/services/count-import.js';
import{readFile}from'node:fs/promises';

globalThis.window={PANTRYFLOW_CONFIG:{supabaseUrl:'http://127.0.0.1',supabaseAnonKey:'test'},supabase:{createClient:()=>({})}};
const{createThrottledDraftSaver}=await import('../pilot-v1/services/data.js');

const dataSource=await readFile(new URL('../pilot-v1/services/data.js',import.meta.url),'utf8');
const migration=await readFile(new URL('../supabase/migrations/20260827123000_pilot_test_functional_repairs.sql',import.meta.url),'utf8');

test('CSV count import preserves source row, zone and quantity column',async()=>{
  const csv='備註,盤點區域,商品編碼,商品名稱,盤點單位,本次數量\n常用,冷藏庫,MILK-1,鮮奶,瓶,\n,乾貨區,RICE-1,米,公斤,\n';
  const file={name:'盤點表.csv',size:Buffer.byteLength(csv),type:'text/csv',text:async()=>csv};
  const result=await parseCountImportFile(file,['MILK-1']);
  assert.equal(result.canPublish,true);
  assert.deepEqual(result.counts,{matched:1,unmatched:1,duplicates:0,missingUnit:0,invalid:0});
  assert.equal(result.rows[0].sourceRow,2);
  assert.equal(result.rows[0].quantityColumn,6);
  assert.equal(result.rows[1].zoneName,'乾貨區');
});

test('count import rejects duplicate and missing-unit rows before publication',async()=>{
  const csv='區域,商品編碼,商品名稱,單位\n冷藏,MILK,鮮奶,\n冷藏,MILK,鮮奶,瓶\n';
  const file={name:'invalid.csv',size:Buffer.byteLength(csv),type:'text/csv',text:async()=>csv};
  const result=await parseCountImportFile(file,[]);
  assert.equal(result.canPublish,false);
  assert.equal(result.counts.duplicates,1);
  assert.equal(result.counts.missingUnit,1);
});

test('formal count import uploads original, calls one transaction RPC and preserves immutable history',()=>{
  assert.match(dataSource,/storage\.from\('count-imports'\)\.upload/);
  assert.match(dataSource,/publish_pilot_count_import/);
  assert.match(migration,/COUNT_IMPORT_ROWS_ARE_IMMUTABLE/);
  assert.match(migration,/source_row integer not null/);
  assert.match(migration,/source_quantity_column/);
});

test('zone repair is store-scoped and exposes rename, ordering, deactivation and unassignment RPCs',()=>{
  assert.match(migration,/count_zones_store_name_uidx/);
  for(const name of['rename_pilot_zone','set_pilot_zone_active','reorder_pilot_zones','unassign_pilot_product_from_zone'])assert.match(migration,new RegExp(name));
});

test('draft autosave is throttled and flushes the latest value before navigation',async()=>{
  const writes=[],states=[];
  const saver=createThrottledDraftSaver(async(...args)=>writes.push(args),{wait:50,onState:(key,state)=>states.push([key,state])});
  saver.schedule('product-1','profile','session','zone','product-1','1','kg');
  saver.schedule('product-1','profile','session','zone','product-1','2','kg');
  assert.equal(writes.length,0);
  await saver.flush();
  assert.equal(writes.length,1);
  assert.equal(writes[0][4],'2');
  assert.deepEqual(states.at(-1),['product-1','saved']);
});

test('production provenance migrations are present and count completion remains append-only',async()=>{
  const provenance=await readFile(new URL('../supabase/migrations/20260828082409_system_first_count_import.sql',import.meta.url),'utf8');
  const storage=await readFile(new URL('../supabase/migrations/20260828084853_fix_count_import_storage_policy.sql',import.meta.url),'utf8');
  assert.match(provenance,/OPENING_BALANCES_AUTO_INITIALIZED/);
  assert.match(storage,/count_import_storage_insert/);
  const countFlow=await readFile(new URL('../supabase/baseline/production-applied/20260823133159_single_store_operational_slice.sql',import.meta.url),'utf8');
  assert.match(countFlow,/insert into public\.count_entries/);
  assert.match(countFlow,/inventory_count_resolution_events/);
  assert.doesNotMatch(countFlow,/update public\.count_entries set quantity/i);
});
