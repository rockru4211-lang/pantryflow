import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { validCountQuantity, paperOrder, countExportRows, countHasNote, countMatchesQuery } from '../lib/count-flow.ts';
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
test('count exports preserve a zero count and its note without implying removal or changing valuation',()=>{
 const note='本期用完，下期可移除。\n請行政確認。';
 const row={id:'counted-zero',name:'伊比利火腿',zone:'冷藏區',unit:'包',quantity:0,note,unit_price:380,amount:0,opening_quantity:2,entered_at:'2026-09-21'};
 for(const management of [false,true]){
  const output=countExportRows([row],management)[0];
  assert.equal(output['本次數量'],0);assert.equal(output['備註'],note);
  if(management){assert.equal(output['單價'],380);assert.equal(output['金額'],0);assert.equal(output['期初'],2);}
 }
 assert.equal(row.quantity,0);assert.equal(row.note,note);assert.equal(row.amount,0);
 assert.ok(!Object.hasOwn(row,'is_active'));
 for(const absent of [null,undefined])assert.equal(countExportRows([{...row,note:absent}],true)[0]['備註'],'');
});
test('notes can be reviewed across zones and searched without matching an absent note',()=>{
 const rows=[
  {id:'fridge',name:'伊比利火腿',zone:'冷藏區',supplier:'甲廠商',quantity:0,note:'本期用完，下期可移除。'},
  {id:'frozen',name:'雞胸肉',zone:'冷凍區',supplier:'乙廠商',quantity:3,note:'請行政確認規格'},
  {id:'plain',name:'鮮奶',zone:'冷藏區',supplier:'甲廠商',quantity:2,note:null},
  {id:'empty',name:'麵粉',zone:'常溫區',quantity:1,note:'  \n '},
 ];
 assert.deepEqual(rows.filter(countHasNote).map(r=>r.id),['fridge','frozen']);
 assert.deepEqual(rows.filter(r=>countMatchesQuery(r,'下期可移除')).map(r=>r.id),['fridge']);
 assert.deepEqual(rows.filter(r=>countMatchesQuery(r,'  甲廠商  ')).map(r=>r.id),['fridge','plain']);
 assert.equal(rows.filter(r=>countMatchesQuery(r,'')).length,4);
 assert.equal(rows.filter(r=>countMatchesQuery(r,'null')).length,0);
});
test('Excel and CSV detail sheets preserve multiline notes alongside explicit zero quantities',()=>{
 const rows=[{name:'伊比利火腿',zone:'冷藏區',unit:'包',quantity:0,note:'本期用完，下期可移除。\n請行政確認。',entered_at:'2026-09-21'},{name:'鮮奶',zone:'冷藏區',unit:'瓶',quantity:3,note:null,entered_at:'2026-09-21'}];
 for(const management of [false,true]){
  const values=countExportRows(rows,management);const sheet=XLSX.utils.json_to_sheet(values);
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'盤點明細');
  const xlsx=XLSX.read(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
  const csv=XLSX.read(XLSX.utils.sheet_to_csv(sheet),{type:'string'});
  for(const output of [xlsx,csv]){
   const restored=XLSX.utils.sheet_to_json(output.Sheets[output.SheetNames[0]],{defval:''});
   assert.equal(restored[0]['本次數量'],0);assert.equal(restored[0]['備註'],rows[0].note);
   assert.equal(restored[1]['備註'],'');
  }
 }
});
