import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {createServer} from 'vite';
import * as XLSX from 'xlsx';
const vite=await createServer({configFile:false,appType:'custom',cacheDir:'node_modules/.vite/backfill-tests',server:{middlewareMode:true}});after(()=>vite.close());
const {fillCountWorkbook,addUnmatchedSheet}=await vite.ssrLoadModule('/lib/count-backfill.ts');
test('backfill preserves source order, blank opening, merged cells and unrelated rows',()=>{
 const book=XLSX.utils.book_new();const first=XLSX.utils.aoa_to_sheet([['原始盤點表'],['品名','單位','期初數量','實盤數量'],['麵粉','公斤',''],['簽名']]);first['!merges']=[{s:{r:0,c:0},e:{r:0,c:3}}];
 XLSX.utils.book_append_sheet(book,first,'乾貨原表');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['品名','單位','期初數量'],['牛奶','瓶',0]]),'冷藏原表');
 const rows=[{id:'b',product_id:'p1',sheet_name:'乾貨原表',source_row:3,quantity:1.5,unit:'公斤'},{id:'a',product_id:'p1',sheet_name:'乾貨原表',source_row:3,quantity:2,unit:'公斤'},{id:'c',product_id:'p2',sheet_name:'冷藏原表',source_row:2,quantity:4,unit:'瓶'}];
 const before=JSON.stringify(book);const {book:result,unmatched}=fillCountWorkbook(book,rows);
 assert.equal(JSON.stringify(book),before);assert.deepEqual(result.SheetNames,['乾貨原表','冷藏原表']);assert.equal(result.Sheets['乾貨原表'].D3.v,3.5);assert.equal(result.Sheets['乾貨原表'].C3.v,'');assert.equal(result.Sheets['冷藏原表'].C2.v,0);assert.equal(result.Sheets['冷藏原表'].D2.v,4);assert.deepEqual(result.Sheets['乾貨原表']['!merges'],first['!merges']);assert.equal(result.Sheets['乾貨原表'].A4.v,'簽名');assert.equal(unmatched.length,0);
});
test('different units and new items stay separate instead of an invented total',()=>{
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['品名','單位'],['麵粉','公斤']]),'原表');
 const base={name:'麵粉',product_id:'p',sheet_name:'原表',source_row:2,entered_at:'2026-09-10',zone:'乾貨'};
 const {book:result,unmatched}=fillCountWorkbook(book,[{...base,id:'a',quantity:2,unit:'公斤'},{...base,id:'b',quantity:3,unit:'包'},{...base,id:'c',sheet_name:undefined,source_row:undefined,quantity:4,unit:'公斤'}]);
 assert.equal(result.Sheets['原表'].C2,undefined);assert.equal(unmatched.length,3);addUnmatchedSheet(result,unmatched,true);assert.equal(result.SheetNames[1],'新增或未對應');assert.equal(XLSX.utils.sheet_to_json(result.Sheets['新增或未對應']).length,3);
});
