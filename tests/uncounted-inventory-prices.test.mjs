import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import React from 'react';
import ts from 'typescript';
import {loadUncountedInventoryPrices,applyCostQuotes} from '../lib/cost-price.ts';
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
async function login({closed=false,historical=false}={}){
 const hooks=[],timers=[],calls=[];let cursor=0,effect=true;
 const scope={React,OperationsSheet:()=>null,loadUncountedInventoryPrices,applyCostQuotes,inventoryMonthEnd,inventoryPriceSource,monthNow:()=> '2026-10',day:v=>v.slice(0,10),text:v=>v==null?'':String(v),friendly:e=>String(e),monthRange:()=>({from:'2026-10-01',to:'2026-11-01'}),monthlyDisplayRows:r=>r,inventoryPurchases:r=>r,inventoryAccountLines:()=>[],inventoryFieldNotes:()=>'',PRODUCT_CATEGORIES:[],wasteReasons:[],canExportData:()=>true,AbortController,
 readScopedReceiptAccounts:async()=>[],setTimeout:fn=>{timers.push(fn);return 1;},clearTimeout(){},
 rpc:async(name,args)=>{calls.push({name,args});if(name==='baihuayuan_inventory_month')return {month:'2026-10-01',rows:[],closed,historical};if(name==='get_pilot_inventory_catalog')return [{product_id:'p1',name:'冷凍起酥片300g/36pcs',unit:'箱',unit_price:null,zone:'乾貨'},{product_id:'p2',name:'人工價格',unit:'包',unit_price:19,zone:'乾貨'}];if(name==='baihuayuan_cost_quotes')return [{price:5550,source:'請購表'}];throw Error('Unexpected write/read '+name);},
 useState:initial=>{const i=cursor++;if(!(i in hooks))hooks[i]=typeof initial==='function'?initial():initial;return [hooks[i],v=>{hooks[i]=typeof v==='function'?v(hooks[i]):v;}];},useRef:v=>{const i=cursor++;return hooks[i]||(hooks[i]={current:v});},useCallback:fn=>fn,useEffect:fn=>{if(effect)fn();}};
 runInNewContext(compiled,scope);const props={userId:'u',kind:'inventory',store:{id:'s',name:'BeApe'},onSpecial(){}};
 scope.UnifiedOperationsWorkspace(props);effect=false;timers.forEach(fn=>fn());for(let i=0;i<80;i++)await Promise.resolve();cursor=0;
 return {calls,props:scope.UnifiedOperationsWorkspace(props).props};
}
test('actual inventory entry loads October catalog prices on every login before any button click',async()=>{
 for(let attempt=0;attempt<2;attempt++){
  const loaded=await login();assert.equal(loaded.props.error,'');assert.equal(loaded.props.loading,false);assert.equal(loaded.props.rows[0].values.price,'5550');assert.equal(loaded.props.rows[0].values.quantity,'');assert.equal(loaded.props.rows[0].values.amount,'');assert.equal(loaded.props.rows[1].values.price,'19');
  const request=loaded.calls.find(c=>c.name==='baihuayuan_cost_quotes');assert.equal(request.args.p_items[0].date,'2026-10-31');assert.equal(request.args.p_items[0].product_id,'p1');assert.equal(request.args.p_items.length,1);
  assert.equal(loaded.props.rows[0].meta.originalValues.price,'5550');
 }
});
test('closed and historical month reads never hydrate catalog references',async()=>{
 for(const options of [{closed:true},{historical:true}]){const loaded=await login(options);assert.equal(loaded.props.rows.length,0);assert.equal(loaded.calls.some(c=>c.name==='baihuayuan_cost_quotes'),false);}
});
