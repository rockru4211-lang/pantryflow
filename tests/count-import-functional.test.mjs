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
  assert.equal(result.counts.matched,1);
  assert.equal(result.counts.unmatched,1);
  assert.equal(result.counts.duplicates,0);
  assert.equal(result.counts.missingUnit,0);
  assert.equal(result.counts.invalid,0);
  assert.equal(result.rows[0].sourceRow,2);
  assert.equal(result.rows[0].quantityColumn,6);
  assert.equal(result.rows[1].zoneName,'乾貨區');
});

test('count import merges exact duplicate details instead of inventing another product',async()=>{
  const csv='區域,商品編碼,商品名稱,單位\n冷藏,MILK,鮮奶,瓶\n冷藏,MILK,鮮奶,瓶\n';
  const file={name:'invalid.csv',size:Buffer.byteLength(csv),type:'text/csv',text:async()=>csv};
  const result=await parseCountImportFile(file,[]);
  assert.equal(result.canPublish,true);
  assert.equal(result.rows.length,1);
  assert.equal(result.counts.duplicates,1);
  assert.equal(result.counts.conflicts,0);
});

test('BeApe style sheet treats 編號 as source order and creates stable product identity from 品名',async()=>{
  const csv='編號,廠商名稱,品名,單位,進貨,期初數量,期末數量,抽盤數量,備註\n1,大永,酸豆(中顆) 450g,罐,,,12,,\n2,大永,海鹽(細) 義大利 1kg,盒,,,3,,\n';
  const file={name:'BeApe_吧台盤點表_20260831.csv',size:Buffer.byteLength(csv),type:'text/csv',text:async()=>csv};
  const first=await parseCountImportFile(file,[]),second=await parseCountImportFile(file,[]);
  assert.equal(first.canPublish,true);
  assert.equal(first.rows[0].zoneName,'吧台');
  assert.match(first.rows[0].productCode,/^AUTO-[0-9A-F]{8}$/);
  assert.notEqual(first.rows[0].productCode,'1');
  assert.equal(first.rows[0].quantityColumn,7);
  assert.equal(first.rows[0].productCode,second.rows[0].productCode);
});

test('missing source code reuses a known product matched by normalized name',async()=>{
  const csv='品名,單位,期末數量\n酸豆(中顆) 450g,罐,\n';
  const file={name:'Gras_酒類盤點表.csv',size:Buffer.byteLength(csv),type:'text/csv',text:async()=>csv};
  const result=await parseCountImportFile(file,[{product_code:'09-0047',name:'酸豆(中顆) 450g',count_unit:'罐'}]);
  assert.equal(result.rows[0].productCode,'09-0047');
  assert.equal(result.counts.matched,1);
  assert.equal(result.counts.unmatched,0);
});

test('missing unit is visible in preview and receives a confirmable safe default',async()=>{
  const csv='品名,期末數量\n新商品,\n';
  const file={name:'冷藏盤點.csv',size:Buffer.byteLength(csv),type:'text/csv',text:async()=>csv};
  const result=await parseCountImportFile(file,[]);
  assert.equal(result.canPublish,true);
  assert.equal(result.rows[0].unit,'個');
  assert.equal(result.rows[0].unitInferred,true);
  assert.equal(result.counts.missingUnit,1);
});

test('conflicting names for one product code block publication',async()=>{
  const csv='區域,商品編碼,商品名稱,單位\n冷藏,MILK,鮮奶,瓶\n吧台,MILK,燕麥奶,瓶\n';
  const file={name:'conflict.csv',size:Buffer.byteLength(csv),type:'text/csv',text:async()=>csv};
  const result=await parseCountImportFile(file,[]);
  assert.equal(result.canPublish,false);
  assert.equal(result.counts.conflicts,1);
});

test('Excel import combines every recognizable worksheet and skips instruction sheets',async()=>{
  const sheet=(name,values)=>({name,actualRowCount:values.length,actualColumnCount:Math.max(...values.map(row=>row.length)),eachRow(_options,callback){values.forEach(values=>callback({cellCount:values.length,getCell(index){return{value:values[index-1]}}}))}});
  class Workbook{
    constructor(){
      this.worksheets=[];
      this.xlsx={load:async()=>{
        this.worksheets=[
          sheet('2026/08食材',[['品名','單位','期末數量'],['海鹽','包','']]),
          sheet('2026/08酒水',[['品名','單位','期末數量'],['氣泡水','瓶','']]),
          sheet('說明',[['使用方式'],['不要刪除欄位']])
        ];
      }};
    }
  }
  globalThis.window={ExcelJS:{Workbook}};
  const file={name:'Gras_盤點表.xlsx',size:100,type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',arrayBuffer:async()=>new ArrayBuffer(1)};
  try{
    const result=await parseCountImportFile(file,[]);
    assert.deepEqual(result.sheetNames,['2026/08食材','2026/08酒水']);
    assert.equal(result.rows.length,2);
    assert.deepEqual(result.rows.map(row=>row.zoneName),['食材','酒水']);
    assert.equal(result.counts.skippedSheets,1);
  }finally{delete globalThis.window}
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
