import test from 'node:test';
import assert from 'node:assert/strict';
import {utils} from 'xlsx';
import {parseInventoryWorkbook} from '../lib/inventory-import.ts';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const reviewSource=readFileSync(new URL('../lib/inventory-review.ts',import.meta.url),'utf8').replace("'./inventory-import'",JSON.stringify(new URL('../lib/inventory-import.ts',import.meta.url).href));
const {reviewPayload,workbookReview}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(reviewSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
import {countExportRows,countValuation,countNeedsReview} from '../lib/count-flow.ts';

test('imports a unit price while preserving missing and zero prices',()=>{
 const book=utils.book_new();
 utils.book_append_sheet(book,utils.aoa_to_sheet([['品名','單位','單價','期初數量','金額'],['鮮奶','瓶',12,3,36],['雞蛋','顆','',2,50],['贈品','份',0,1,0]]),'原表');
 const rows=workbookReview(parseInventoryWorkbook(book)).filter(r=>r.status!=="SKIPPED").map(reviewPayload);
 assert.deepEqual(rows.map(r=>r.unit_price),[12,null,0]);
 assert.deepEqual(rows.map(r=>r.opening_quantity),[3,2,1]);
 assert.equal(rows[1].raw_values['E:金額'],'50');
});
test('count values distinguish unknown prices, zero values and unresolved changes',()=>{
 const base={id:'1',product_id:'p',zone_id:'z',zone:'冷藏',name:'奶',unit:'瓶',quantity:5,entered_at:'2026-09-20',entered_by:'主管'};
 const priced={...base,unit_price:12,amount:60,difference:2};
 const free={...base,id:'2',unit_price:0,amount:0};
 const unknown={...base,id:'3',unit_price:null,amount:null};
 assert.deepEqual(countValuation([priced,free,unknown]),{subtotal:60,missing:1});
 assert.equal(countNeedsReview(priced),true);
 assert.equal(countNeedsReview({...priced,confirmed_at:'2026-09-20'}),false);
 assert.equal(countNeedsReview(free),false);
 assert.equal(countNeedsReview(unknown),true);
 const exported=countExportRows([priced,free,unknown],true);
 assert.deepEqual(exported.map(r=>r['金額']),[60,0,'待補單價']);
 assert(!('金額' in countExportRows([priced],false)[0]));
 assert(!('單價' in countExportRows([priced],false)[0]));
});
