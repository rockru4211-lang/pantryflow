import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {appendInventoryWorkbook,groupedInventoryImport} from '../lib/inventory-workbook.ts';

const makeLine=(id,overrides={})=>({
 row_key:id,product_id:id,name:id,supplier:'同一食品',category:'食材',
 unit:'公斤',current_quantity:2,unit_price:125,amount:250,review_note:'',...overrides,
});
const directory=[
 {id:'a',name:'同一食品',aliases:['同一'],supplier_category:'食材'},
 {id:'b',name:'第二供應商',supplier_category:'食材'},
 {id:'c',name:'酒商',supplier_category:'酒水'},
];

test('inventory groups canonical supplier names, retains distinct prices, and reports only valued amounts',()=>{
 const book=XLSX.utils.book_new();
 const first=makeLine('1',{name:'白蝦',supplier:' 同一 ',price_purchase:{amount:1500,quantity:3,unit:'箱',content_quantity:4,content_unit:'公斤'}});
 const lines=[first,first,makeLine('2',{category:'調料',unit_price:null,amount:null,current_quantity:0}),
  makeLine('3',{name:'白蝦',supplier:'第二供應商',unit_price:150,amount:300}),
  makeLine('4',{supplier:'酒商',category:'酒水'}),makeLine('5',{supplier:'酒商',category:'食材',amount:null})];
 const identities=[{product_id:'1',code:'F002262'},{product_id:'3',code:'F002262'}];
 appendInventoryWorkbook(XLSX,book,lines,identities,directory);
 const file=XLSX.read(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{cellStyles:true});
 assert.deepEqual(file.SheetNames,['食材','酒水']);
 const food=file.Sheets['食材'];
 assert.equal(food['!merges'].length,3);
 assert.equal(food['!cols'][8].hidden,true);
 const rows=XLSX.utils.sheet_to_json(food,{defval:null});
 assert.equal(rows.filter(r=>r.食材編碼==='同一食品').length,1);
 assert.equal(rows.some(r=>r.食材編碼==='同一'),false);
 const firstExport=rows.find(r=>r.資料編號==='1');
 assert.equal(firstExport['進價（元）'],500);
 assert.equal(firstExport.計價單位,'箱');
 assert.equal(firstExport['庫存金額（元）'],250);
 assert.equal(rows.find(r=>r.資料編號==='3')['進價（元）'],150);
 const pending=rows.find(r=>r.資料編號==='2');
 assert.equal(pending.實盤數量,0);
 assert.equal(pending.核對狀態,'待對碼、待補價');
 assert.equal(pending['庫存金額（元）'],null);
 assert.equal(rows.find(r=>r.食材編碼==='已計價小計')['庫存金額（元）'],550);
 assert.equal('儲物區' in firstExport,false);

 const imported=groupedInventoryImport(XLSX,file);
 assert.equal(imported.length,5);
 assert.equal('進價' in imported.find(r=>r.資料編號==='1'),false);
 const index=rows.findIndex(r=>r.資料編號==='1')+2;
 food[`E${index}`].v=550;
 const edited=groupedInventoryImport(XLSX,file).find(r=>r.資料編號==='1');
 assert.equal(edited.進價,550);
 assert.equal(edited.計價規格,'箱');
 assert.equal(edited.包裝規格,'4公斤');
});
