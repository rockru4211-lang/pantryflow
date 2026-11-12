import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import React from 'react';
import ts from 'typescript';
import {automaticCostGuard,loadUncountedInventoryPrices,applyCostQuotes,restoreCostBasis} from '../lib/cost-price.ts';
import {operationRecordStatus} from '../lib/operation-integrity.ts';
import {inventoryStorageZones,inventoryEditExpected} from '../lib/inventory-monthly.ts';
import {costBasisNote} from '../lib/cost-price.ts';
import {sheetNumber,transferDirectionValues} from '../lib/operations-sheet.ts';
import {validatePurchaseSpecification} from '../lib/purchase-specification.ts';
import {inventoryMonthEnd,inventoryPriceSource} from '../lib/inventory-cost.ts';
const catalogRow=(id,price='')=>({id:`catalog:${id}`,state:'LIVE',values:{name:id,unit:'箱',quantity:'',price,amount:''},meta:{catalog:{product_id:id}}});
test('uncounted catalog reads prices in bounded batches without counts, writes, or replacing saved prices',async()=>{
 const rows=Array.from({length:205},(_,i)=>catalogRow(String(i)));
 rows.push(catalogRow('saved','19'),{...catalogRow('removed'),state:'REMOVED'},{...catalogRow('locked'),locked:true},{...catalogRow('counted'),id:'counted',values:{price:'',quantity:'2'}});
 const calls=[];const result=await loadUncountedInventoryPrices(rows,async items=>{calls.push(items);return items.map(i=>i.product_id==='4'?{price:null,reason:'名稱尚未完成對應'}:{price:5550,source:'請購表',date:'2026-09-01'});});
 assert.deepEqual(calls.map(c=>c.length),[100,100,5]);assert.equal(result[0].values.price,'5550');assert.equal(result[0].values.quantity,'');assert.equal(result[0].values.amount,'');
 assert.equal(result[0].requestId,undefined);assert.equal(result[0].meta.costQuote,undefined);assert.match(result[0].values.price_source,/請購表/);assert.equal(result[4].values.price,'');assert.match(result[4].values.price_source,/對應/);
 assert.equal(result[205],rows[205]);assert.equal(result[206],rows[206]);assert.equal(result[207],rows[207]);assert.equal(result[208],rows[208]);assert.equal(rows[0].values.price,'');
 await assert.rejects(loadUncountedInventoryPrices([catalogRow('a')],async()=>[]),/回應不完整/);
});
const source=readFileSync(new URL('../app/pilot/unified-operations-workspace.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source.slice(source.indexOf('export default function')).replace('export default ',''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
async function login({closed=false,historical=false,rows=[],kind='inventory',records=[],quoteLookup}={}){
 const hooks=[],timers=[],calls=[];let cursor=0,effect=true;
 const scope={operationRecordStatus,useCustodyReminders:()=>({rows:[],tags:[],error:''}),ProductReminderBadge:()=>null,React,automaticCostGuard,inventoryStorageZones,inventoryEditExpected,costBasisNote,sheetNumber,transferDirectionValues,validatePurchaseSpecification,crypto,restoreCostBasis,costingUnits:[],useMemo:fn=>fn(),OperationsSheet:()=>null,loadUncountedInventoryPrices,applyCostQuotes,inventoryMonthEnd,inventoryPriceSource,monthNow:()=> '2026-10',day:v=>v.slice(0,10),text:v=>v==null?'':String(v),friendly:e=>String(e),monthRange:()=>({from:'2026-10-01',to:'2026-11-01'}),monthlyDisplayRows:r=>r,inventoryPurchases:r=>r,inventoryAccountLines:()=>[],inventoryFieldNotes:()=>'',PRODUCT_CATEGORIES:[],wasteReasons:[],canExportData:()=>true,AbortController,
 readScopedReceiptAccounts:async()=>[],setTimeout:fn=>{timers.push(fn);return 1;},clearTimeout(){},
 rpc:async(name,args)=>{calls.push({name,args});if(name==='get_baihuayuan_record_flags')return [];if(name==='app_workspace')return {records,products:[]};if(name==='baihuayuan_inventory_month')return {month:'2026-10-01',rows,source_id:'session',count_date:'2026-09-30',closed,historical};if(name==='get_pilot_inventory_catalog')return [{product_id:'p1',name:'冷凍起酥片300g/36pcs',unit:'箱',unit_price:null,zone:'乾貨'},{product_id:'p2',name:'人工價格',unit:'包',unit_price:19,zone:'乾貨'}];if(name==='save_baihuayuan_inventory_inline_v3'||name==='save_baihuayuan_sheet_row')return {saved:true};if(name==='baihuayuan_cost_quotes'&&quoteLookup)return quoteLookup(args.p_items);if(name==='baihuayuan_cost_quotes')return args.p_items.map(i=>({price:i.product_id==='p1'?5550:23,source:'已確認建檔進貨'}));throw Error('Unexpected write/read '+name);},
 useState:initial=>{const i=cursor++;if(!(i in hooks))hooks[i]=typeof initial==='function'?initial():initial;return [hooks[i],v=>{hooks[i]=typeof v==='function'?v(hooks[i]):v;}];},useRef:v=>{const i=cursor++;return hooks[i]||(hooks[i]={current:v});},useCallback:fn=>fn,useEffect:fn=>{if(effect)fn();}};
 runInNewContext(compiled,scope);const props={userId:'u',kind,store:{id:'s',name:'BeApe'},onSpecial(){}};
 scope.UnifiedOperationsWorkspace(props);effect=false;timers.forEach(fn=>fn());for(let i=0;i<80;i++)await Promise.resolve();cursor=0;
 const tree=scope.UnifiedOperationsWorkspace(props);const sheet=React.Children.toArray(tree.props.children).find(node=>node.type===scope.OperationsSheet);
 return {calls,props:sheet.props};
}
test('actual inventory entry loads October catalog prices on every login before any button click',async()=>{
 for(let attempt=0;attempt<2;attempt++){
  const loaded=await login();assert.equal(loaded.props.error,'');assert.equal(loaded.props.loading,false);assert.equal(loaded.props.rows[0].values.price,'5550');assert.equal(loaded.props.rows[0].values.quantity,'');assert.equal(loaded.props.rows[0].values.amount,'');assert.equal(loaded.props.rows[1].values.price,'23');
  const request=loaded.calls.find(c=>c.name==='baihuayuan_cost_quotes');assert.equal(request.args.p_items[0].date,'2026-10-31');assert.equal(request.args.p_items[0].product_id,'p1');assert.equal(request.args.p_items.length,2);
  assert.equal(loaded.props.rows[0].meta.originalValues.price,'5550');
 }
});
test('closed and historical month reads never hydrate catalog references',async()=>{
 for(const options of [{closed:true},{historical:true}]){const loaded=await login(options);assert.equal(loaded.props.rows.length,0);assert.equal(loaded.calls.some(c=>c.name==='baihuayuan_cost_quotes'),false);}
});
test('inventory sheet separates uncounted, missing price and explicit zero with quantity before pricing',async()=>{
 const {props}=await login();
 assert.equal(props.title,'庫存明細');
 assert.deepEqual(Array.from(props.columns.slice(0,9),c=>c.label),['品名','供應商','儲物區','實盤數量','單位','進價','計價規格','庫存金額','現場備註']);
 const col=key=>props.columns.find(c=>c.key===key);
 assert.equal(col('quantity').placeholder,'未盤點');
 const r={values:{quantity:'',purchase_price:'904',price_unit:'公斤',amount:''}};
 assert.equal(col('quantity').display(r),'');assert.equal(col('amount').display(r),'');
 assert.equal(col('amount').display({values:{...r.values,quantity:'200'}}),'');
 assert.equal(col('amount').display({values:{...r.values,quantity:'0',amount:'0'}}),'0.00');
 assert.equal(col('amount').display({values:{...r.values,quantity:'2890',amount:'2612.56'}}),'2,612.56');
 assert.equal(col('price_unit').display({values:{price_unit:'瓶',purchase_specification:'1公升'}}),'瓶（1公升）');
 assert.equal(col('purchase_price').readonly,undefined);assert.equal(col('price_unit').readonly,undefined);assert.equal(col('price_unit').pricingBasis,true);
});

test('counted inventory uses mobile classifications, editable unit and price, and guarded persistent save',async()=>{
 const original={row_key:'p1:公斤',source_signature:'sig',product_id:'p1',name:'麵粉',unit:'公斤',supplier:'供應商',category:'食材',current_quantity:2,source_quantity:2,unit_price:100,amount:200,review_note:'',zones:[{zone:'未分類',note:null}],previous_quantity:null};
 const {props,calls}=await login({rows:[original]});const row=props.rows[0];
 assert.equal(props.error,'');assert.equal(row.values.zone,'乾貨');assert.equal(props.reportDate,'2026-09-30');assert.equal(props.autoRefresh,true);
 assert.equal(props.columns.find(c=>c.key==='unit').editable(row),true);
 await props.onSave({...row,requestId:'save',values:{...row.values,unit:'包',price:'120',purchase_price:'120',price_unit:'包',quantity:'3'}});
 const saved=calls.find(c=>c.name==='save_baihuayuan_inventory_inline_v3');assert.equal(saved.args.p_unit,'包');assert.equal(saved.args.p_quantity,3);assert.equal(saved.args.p_unit_price,120);assert.deepEqual(JSON.parse(JSON.stringify(saved.args.p_expected)),inventoryEditExpected(original));
 for(const options of [{closed:true},{historical:true}]){const frozen=await login({...options,rows:[original]});assert.equal(frozen.props.rows[0].locked,true);assert.equal(frozen.props.rows[0].values.zone,'未分類');}
});
test('multiple mobile zones are kept without duplicates and missing catalog retains count evidence',()=>{
 const row={product_id:'a',zones:[{zone:'舊區'}]};
 assert.equal(inventoryStorageZones(row,[{product_id:'a',zone:'食材'},{product_id:'a',zone:'乾貨'},{product_id:'a',zone:'乾貨'},{product_id:'b',zone:'酒類'}]),'食材、乾貨');
 assert.equal(inventoryStorageZones(row,[{product_id:'a',zone:'未配置'}]),'舊區');
 assert.equal(inventoryStorageZones(row,[{product_id:'a',zone:'食材'}],true),'舊區');
});

test('new inventory save transmits automatic expected quote while manual input has no guard',async()=>{
 const {props,calls}=await login();
 const quote={price:120,source:'已確認建檔進貨',reference_id:'receipt:line'};
 const row={id:'new',fresh:true,requestId:'auto',values:{name:'麵粉',unit:'公斤',quantity:'',price:'120',purchase_price:'120',price_unit:'公斤'},meta:{costQuote:quote}};
 await props.onSave(row);
 const saved=calls.find(c=>c.name==='save_baihuayuan_sheet_row');
 assert.equal(saved.args.p_value.price_mode,'automatic');assert.deepEqual(saved.args.p_value.expected_cost_quote,quote);
 await props.onSave({...row,requestId:'manual',meta:{}});
 const manual=calls.filter(c=>c.name==='save_baihuayuan_sheet_row')[1];
 assert.equal(manual.args.p_value.price_mode,undefined);assert.equal(manual.args.p_value.expected_cost_quote,undefined);
});

test('pending transfer load retains full automatic evidence through quantity edits and save; confirmed snapshots stay manual',async()=>{
 const quote={price:120,unit:'公斤',source:'已確認建檔進貨',date:'2026-10-01',reference_id:'receipt:line',batch_id:'batch',basis:'receipt',purchase:{amount:120,quantity:1,unit:'公斤'}};
 const record={id:'pending',kind:'TRANSFER',review_status:'PENDING',revision:1,created_at:'2026-10-02',from_name:'BeApe',to_name:'Gras',name:'麵粉',quantity:2,unit:'公斤',reference_price:120,transfer_amount:240,note:'',cost_quote:quote};
 const {props,calls}=await login({kind:'transfer',records:[record,{...record,id:'confirmed',review_status:'CONFIRMED'}]});
 assert.equal(props.error,'');assert.equal(props.rows.length,2);
 const pending=props.rows[0],confirmed=props.rows[1];
 assert.equal(pending.meta.costQuote,quote);assert.equal(confirmed.meta.costQuote,undefined);
 assert.equal(confirmed.values.price,'120');assert.equal(confirmed.values.amount,'240');
 await props.onSave({...pending,requestId:'pending-edit',values:{...pending.values,quantity:'3',amount:'360',note:'補充備註'}});
 const saved=calls.find(c=>c.name==='save_baihuayuan_sheet_row');
 assert.equal(saved.args.p_value.price_mode,'automatic');assert.equal(saved.args.p_value.expected_cost_quote,quote);
 await props.onSave({...confirmed,requestId:'history-note',values:{...confirmed.values,note:'歷史備註'}});
 const historical=calls.filter(c=>c.name==='save_baihuayuan_sheet_row')[1];
 assert.equal(historical.args.p_value.price_mode,undefined);assert.equal(historical.args.p_value.expected_cost_quote,undefined);
 assert.equal(calls.some(c=>c.name==='baihuayuan_cost_quotes'),false);
});

test('inventory automatic unit quote save retains original CAS plus full automatic evidence; manual and legacy saves do not',async()=>{
 const original={row_key:'p1:公斤',source_signature:'sig',product_id:'p1',name:'麵粉',unit:'公斤',current_quantity:2,unit_price:480,amount:960,review_note:'',zones:[]};
 const quote={price:.48,unit:'g',source:'已確認建檔進貨',date:'2026-09-29',reference_id:'receipt:line',batch_id:'batch',basis:'receipt',purchase:{amount:480,quantity:1,unit:'公斤'}};
 const {props,calls}=await login({rows:[original],quoteLookup:items=>items.map(item=>item.product_id==='p1'?quote:{price:null})});
 const loaded=props.rows[0];
 const [priced]=await props.onPrice([{...loaded,requestId:'unit-auto',values:{...loaded.values,unit:'g',quantity:'2000',price:'',purchase_price:'',amount:''}}]);
 assert.equal(priced.values.price,'0.48');assert.equal(priced.values.amount,'960');
 const request=calls.filter(c=>c.name==='baihuayuan_cost_quotes').at(-1);
 assert.equal(request.args.p_items[0].unit,'g');assert.equal(request.args.p_items[0].product_id,'p1');
 await props.onSave(priced);
 const automatic=calls.find(c=>c.name==='save_baihuayuan_inventory_inline_v3');
 assert.equal(automatic.args.p_unit,'g');assert.equal(automatic.args.p_unit_price,.48);
 assert.equal(automatic.args.p_expected.price_mode,'automatic');assert.equal(automatic.args.p_expected.expected_cost_quote,quote);
 assert.deepEqual(automatic.args.p_expected.values,inventoryEditExpected(original).values);
 assert.equal(automatic.args.p_expected.source_signature,'sig');
 await props.onSave({...priced,requestId:'manual',meta:{...priced.meta,costQuote:undefined},values:{...priced.values,price:'.6',purchase_price:'600'}});
 await props.onSave({...loaded,requestId:'legacy-note',values:{...loaded.values,note:'補充'}});
 for(const saved of calls.filter(c=>c.name==='save_baihuayuan_inventory_inline_v3').slice(1)){
  assert.equal(saved.args.p_expected.price_mode,undefined);assert.equal(saved.args.p_expected.expected_cost_quote,undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(saved.args.p_expected)),inventoryEditExpected(original));
 }
});
