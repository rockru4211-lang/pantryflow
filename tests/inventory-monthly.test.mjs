import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as inventory from '../lib/inventory-monthly.ts';
const zone={id:'e1',zone_id:'cold',zone:'冷藏',quantity:4,note:null,entered_by:'主管',entered_at:'2026-09-01T00:00:00Z'};
const row={row_key:'wine:瓶',product_id:'wine',name:'酒',unit:'瓶',supplier:'酒商',category:'酒類',zones:[zone,{...zone,id:'e2',zone_id:'bar',zone:'吧台',quantity:6}],current_quantity:10,previous_quantity:8,difference:2,comparison:'MATCHED',unit_price:120,amount:1200,previous_amount:800,original_quantity:10,corrected:false,correction_conflict:false,missing_price:false,needs_review:true,acknowledged:false,review_note:''};
test('monthly filters retain aggregate value for multi-zone product; category amount counts product once',()=>{
 const filtered=inventory.filterInventory([row],{search:'酒商',zone:'bar',pending:true});assert.equal(filtered.length,1);assert.equal(filtered[0].amount,1200);assert.equal(filtered[0].current_quantity,10);
 assert.deepEqual(inventory.inventoryCategories(filtered),[{name:'酒類',items:1,amount:1200,missing:0}]);
});
test('absent counts and unknown prices do not become zero; genuine zero remains numeric in Excel',()=>{
 const entries=inventory.inventoryExportRows([{...row,current_quantity:0,unit_price:null,amount:null,missing_price:true},{...row,current_quantity:null,difference:null,comparison:'MISSING',amount:null}]);
 assert.equal(entries[0]['本月數量'],0);assert.equal(entries[0]['單價'],'未提供');assert.equal(entries[0]['本月金額'],'未計入');assert.equal(entries[1]['本月數量'],'未盤');assert.equal(entries[1]['數量增減'],'本月未盤');
 const groups=inventory.inventoryCategories([{...row,amount:null,missing_price:true},{...row,current_quantity:null}]);assert.equal(groups[0].items,1);assert.equal(groups[0].missing,1);
});
test('new items, missing month and changed units are labels, never fabricated numerical differences',()=>{
 for(const [comparison,label] of [['NEW','本月新增'],['NO_BASELINE','無上月資料'],['UNIT_CHANGED','單位變更']])assert.equal(inventory.comparisonLabel({...row,comparison,difference:null}),label);
 assert.equal(inventory.inventoryNumber(null),'—');assert.equal(inventory.inventoryNumber(0),'0');assert.equal(inventory.taipeiMonth(new Date('2026-08-31T16:00:00Z')),'2026-09');
});
const source=readFileSync(new URL('../app/pilot/inventory-monthly-workspace.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('inventory.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const functions=['InventoryTableRows','ZoneDetails'];
const code=functions.map(name=>ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast)).join('\n');
const scope={React,...inventory,exports:{},ChevronDown:()=>null,dateLabel:value=>value};
runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText,scope);
test('rendered table shows accurate multi-zone breakdown and distinct missing-price status',()=>{
 const html=renderToStaticMarkup(React.createElement('table',null,React.createElement('tbody',null,React.createElement(scope.InventoryTableRows,{row:{...row,unit_price:null,amount:null,missing_price:true},expanded:true,onExpand(){},onEdit(){},disabled:false,closed:false}))));
 assert.match(html,/2 個儲物區/);assert.match(html,/待補單價/);assert.match(html,/儲物區原始明細/);assert.match(html,/吧台/);assert.match(html,/未計入/);assert.doesNotMatch(html,/NaN/);
});
test('confirmed aggregate correction is distinguishable from preserved source quantities',()=>{
 const html=renderToStaticMarkup(React.createElement(scope.ZoneDetails,{row:{...row,corrected:true,original_quantity:12}}));
 assert.match(html,/原始合計 12/);assert.match(html,/主管確認合計 10/);
});

test('all unpriced inventory is unavailable rather than zero, partial totals cannot produce total delta',()=>{
 const missing={...row,amount:null,unit_price:null,missing_price:true};
 assert.equal(inventory.inventoryCategorySummary([missing],true).subtotal,null);
 assert.equal(inventory.inventoryCategories([missing])[0].amount,null);
 assert.equal(inventory.inventoryCategorySummary([row,missing],true).amount_difference,null);
 const zero={...row,current_quantity:0,amount:0,previous_quantity:0,previous_amount:0};
 assert.equal(inventory.inventoryCategorySummary([zero],true).subtotal,0);
 assert.equal(inventory.inventoryExportRows([zero])[0]['期初'],0);
 assert.equal(inventory.comparisonLabel({...row,comparison:'PENDING_BASELINE'}),'期初待確認');
});

test('field notes are visible on the collapsed admin row',()=>{const html=renderToStaticMarkup(React.createElement('table',null,React.createElement('tbody',null,React.createElement(scope.InventoryTableRows,{row:{...row,zones:[{...zone,note:'目前沒在使用'}]},expanded:false,onExpand(){},onEdit(){},disabled:false,closed:false}))));assert.match(html,/im-field-notes/);assert.match(html,/目前沒在使用/);assert.match(html,/修改/);});


test('admin table retains quantity and note while displaying current removal actor and time',()=>{
 const html=renderToStaticMarkup(React.createElement('table',null,React.createElement('tbody',null,React.createElement(scope.InventoryTableRows,{row:{...row,current_quantity:0,zones:[{...zone,quantity:0,note:'目前沒在使用'}]},removed:{product_id:'wine',name:'酒',removed_by:'現場主管',removed_at:'2026-09-29T13:00:00Z'},expanded:false,onExpand(){},onEdit(){},disabled:false,closed:false}))));
 assert.match(html,/目前已移出/);assert.match(html,/現場主管/);assert.match(html,/目前沒在使用/);assert.match(html,/<strong>0<\/strong>/);
});
test('table shows saved spot counts with baseline, reason, status and read failures',()=>{
 const props={row:{...row,spots:[{zone_id:'cold',zone:'冷藏',quantity:0.8,baseline:1,difference:-0.2,note:'已使用',status:'OPEN',created_at:'2026-10-01'}]},expanded:false,onExpand(){},onEdit(){},disabled:false,closed:false};
 const render=p=>renderToStaticMarkup(React.createElement('table',null,React.createElement('tbody',null,React.createElement(scope.InventoryTableRows,p))));
 const html=render(props);assert.match(html,/0.8/);assert.match(html,/-0.2/);assert.match(html,/原數量 1/);assert.match(html,/已使用/);assert.match(html,/抽盤中/);
 const failure=render({...props,spotError:true});assert.match(failure,/讀取失敗/);assert.doesNotMatch(failure,/未抽盤|已使用/);
});
