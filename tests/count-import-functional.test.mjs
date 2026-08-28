import assert from'node:assert/strict';
import test from'node:test';
import{parseCountImportFile}from'../pilot-v1/services/count-import.js';
import{readFile}from'node:fs/promises';

const dataSource=await readFile(new URL('../pilot-v1/services/data.js',import.meta.url),'utf8');
const migration=await readFile(new URL('../supabase/migrations/20260827123000_pilot_test_functional_repairs.sql',import.meta.url),'utf8');

test('CSV count import preserves source row, zone and quantity column',async()=>{
  const csv='備註,盤點區域,商品編碼,商品名稱,盤點單位,本次數量\n常用,冷藏庫,MILK-1,鮮奶,瓶,\n,乾貨區,RICE-1,米,公斤,\n';
  const file={name:'盤點表.csv',size:Buffer.byteLength(csv),type:'text/csv',text:async()=>csv};
  const result=await parseCountImportFile(file,['MILK-1']);
  assert.equal(result.canPublish,true);
  assert.deepEqual(result.counts,{matched:1,unmatched:1,duplicates:0,missingUnit:0,generatedCodes:0,defaultZones:0,invalid:0});
  assert.equal(result.rows[0].sourceRow,2);
  assert.equal(result.rows[0].quantityColumn,6);
  assert.equal(result.rows[1].zoneName,'乾貨區');
});

test('count import repairs duplicate codes and infers missing units before publication',async()=>{
  const csv='區域,商品編碼,商品名稱,單位\n冷藏,MILK,鮮奶,\n冷藏,MILK,鮮奶,瓶\n';
  const file={name:'invalid.csv',size:Buffer.byteLength(csv),type:'text/csv',text:async()=>csv};
  const result=await parseCountImportFile(file,[]);
  assert.equal(result.canPublish,true);
  assert.equal(result.counts.duplicates,1);
  assert.equal(result.counts.missingUnit,1);
  assert.equal(result.rows[0].unit,'個');
  assert.equal(result.rows[1].productCode,'MILK-R3');
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
