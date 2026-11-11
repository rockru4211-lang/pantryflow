import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import * as overview from '../lib/operations-overview.ts';
import {canData,officeAccess,viewAccess} from '../lib/data-access.ts';
import {formatPurchaseSpecification} from '../lib/purchase-specification.ts';
import {canApproveRecipe} from '../lib/recipe-organization.ts';
const source=readFileSync('app/pilot/operations-overview.tsx','utf8');
const compiled=ts.transpileModule(source.replace(/^import .*;\n/gm,'').replace('export default function','function'),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const nodes=n=>Array.isArray(n)?n.flatMap(nodes):!n||typeof n!=='object'?[]:[n,...nodes(n.props?.children)];
function render(filter='all',permission=true,allStores=false,extraStore=false,{role='LOGISTICS',active='equipment',respond,accessMode,snapshot}={}){
 const store={id:'a',name:'BeApe',organization_id:'o',role,access_mode:accessMode,business_type:'SINGLE_RESTAURANT',data_access:{EQUIPMENT:{view:permission,edit:permission}},work_functions:permission?['OFFICE']:[],is_active:true};
 const second={...store,id:'b',name:'Gras'},stores=extraStore?[store,second]:[store];
 const scope=JSON.stringify((allStores?stores:[store]).map(s=>[s.id,s.role,s.access_mode,s.work_functions,s.data_access]));
 const rows=Array.from({length:8},(_,i)=>({id:String(i),name:'項目'+i,storeId:'a',storeName:'BeApe',detail:'日期未定',status:'待處理',view:i%2?'purchase-notes':'equipment',taskKind:i%2?'purchase':'repair'}));
 let i=0;const values=[allStores,active,0,'',filter,snapshot??{scope,results:[{storeId:'a',category:'equipment',rows},...(extraStore?[{storeId:'b',category:'equipment',rows:[{...rows[0],id:'gras',name:'Gras 專屬事項',storeId:'b',storeName:'Gras'}]}]:[])]}],opened=[],effects=[],calls=[];
 const updates=[];
 const request=(name,args)=>{
  calls.push({name,args});
  return {abortSignal:()=>respond?Promise.resolve(respond(name,args)):new Promise(()=>{})};
 };
 const countQuery={
  select(){return this;},eq(_column,storeId){return {...this,storeId};},in(){return this;},order(){return this;},
  limit(){return request('inventory_count_sessions',{p_store_id:this.storeId});},
 };
 const context={React,...overview,formatPurchaseSpecification,canApproveRecipe,canData,officeAccess,viewAccess,AbortController,crypto,appError:()=>'',operationDeadline:run=>run(new AbortController().signal),supabase:{rpc:request,from:()=>countQuery},window:{addEventListener(){},removeEventListener(){}},setInterval:()=>1,clearInterval(){},useEffect(fn){effects.push(fn);},useState(v){return [values[i++]??v,next=>updates.push(next)];}};

 runInNewContext(compiled,context);
 return {tree:context.OperationsOverview({store,stores,onOpen:(...args)=>opened.push(args)}),opened,effects,calls,updates};
}
test('task UI limits combined preview, filters by type, and opens the original workspace',()=>{
 const all=render();const rows=nodes(all.tree).filter(n=>n.type==='tbody')[0].props.children;
 assert.equal(rows.length,5);assert.equal(nodes(all.tree).find(n=>n.props?.className==='ops-more').props.children,'⋯ 還有 3 筆・查看全部');
 const purchases=render('purchase');const selected=nodes(purchases.tree).filter(n=>n.props?.className==='ops-open');assert.equal(selected.length,4);
 selected[0].props.onClick();assert.deepEqual(purchases.opened[0],['a','purchase-notes']);
});

test('overview does not show merged tasks to a store without office access',()=>{
 assert.equal(nodes(render('all',false).tree).some(n=>n.props?.className==='ops-task-filters'),false);
});

const label=n=>Array.isArray(n)?n.map(label).join(''):n&&typeof n==='object'?label(n.props?.children):n==null||typeof n==='boolean'?'':String(n);
test('overview follows current store and reads only its records until all-store viewing is explicit',()=>{
 const current=render('all',true,false,true);const text=label(current.tree);
 assert.match(text,/查看全部門市/);assert.doesNotMatch(text,/Gras 專屬事項/);
 current.effects.forEach(fn=>fn());assert.ok(current.calls.length);assert.ok(current.calls.every(c=>c.args.p_store_id==='a'));
 const combined=render('all',true,true,true);assert.match(label(combined.tree),/全部門市總覽/);assert.match(label(combined.tree),/返回 BeApe/);
 combined.effects.forEach(fn=>fn());assert.deepEqual([...new Set(combined.calls.map(c=>c.args.p_store_id))],['a','b']);
});

test('overview defaults to price increases and skips custody and receipt reads across stores',()=>{
 const overview=render('all',true,true,true,{role:'OWNER',active:null});
 const tabs=nodes(overview.tree).find(n=>n.props?.['aria-label']==='營運總覽分類').props.children;
 assert.deepEqual(Array.from(tabs,tab=>label(tab.props.children[0])),['價格上漲','待辦事項','合約到期','盤點待追蹤']);
 assert.equal(tabs[0].props['aria-pressed'],true);
 overview.effects.forEach(fn=>fn());
 assert.equal(overview.calls.filter(call=>call.name==='baihuayuan_ingredient_prices').length,2);
 assert.equal(overview.calls.some(call=>['baihuayuan_custody_reminders','get_baihuayuan_receipt_inbox','get_baihuayuan_record_flags'].includes(call.name)),false);
});

test('overview defaults to tasks when the store lacks ingredient price access',()=>{
 const {tree}=render('all',true,false,false,{active:null});
 const tabs=nodes(tree).find(n=>n.props?.['aria-label']==='營運總覽分類').props.children;
 assert.deepEqual(Array.from(tabs,tab=>label(tab.props.children[0])),['待辦事項','合約到期','盤點待追蹤']);
 assert.equal(tabs[0].props['aria-pressed'],true);
});

test('follow-up reads only authorized sources and publishes saved recipe and count results',async()=>{
 const noApproval=render('all',true,false,false,{role:'LOGISTICS'});
 noApproval.effects.forEach(fn=>fn());
 assert.equal(noApproval.calls.some(call=>call.args.p_section==='recipes.saved'||call.name==='baihuayuan_spot_check'),false);
 assert.equal(nodes(noApproval.tree).some(node=>node.type==='button'&&label(node.props.children).startsWith('食譜確認')),false);
 const readOnly=render('all',true,false,false,{role:'OWNER',accessMode:'VIEW'});
 readOnly.effects.forEach(fn=>fn());
 assert.equal(readOnly.calls.some(call=>['inventory_count_sessions','baihuayuan_spot_check'].includes(call.name)||call.args.p_section==='recipes.saved'),false);
 const fixture=render('all',true,false,false,{role:'OWNER',respond:(name,args)=>{
  const store_id=args.p_store_id;
  if(name==='inventory_count_sessions')return {data:[{id:'count',status:'IN_PROGRESS',started_at:'2026-11-10T16:10:00Z'}]};
  if(name==='baihuayuan_spot_check')return {data:args.p_action==='list'?{checks:[{id:'spot',store_id,status:'OPEN'}]}:{
   id:'spot',store_id,status:'OPEN',created_at:'2026-11-10',items:[{entry_id:'item',name:'火腿',unit:'公斤',quantity:1,original_quantity:2}],
  }};
  if(args.p_section==='recipes.saved')return {data:{recipes:[{id:'recipe',document:{name:'番茄起司',kind:'dish',lifecycle:'unset'}}]}};
  if(args.p_section==='incidents')return {data:{records:[]}};
  if(name==='equipment_workflow')return {data:{jobs:[]}};
  if(name==='app_operation'||args.p_section==='administrative')return {data:{rows:[]}};
  return {data:{ingredients:[],supply_states:[]}};
 }});
 fixture.effects.forEach(fn=>fn());
 await new Promise(resolve=>setImmediate(resolve));
 const snapshot=fixture.updates.reduce((previous,update)=>update(previous),undefined);
 assert.equal(snapshot.results.find(result=>result.category==='equipment').rows[0].recordId,'recipe');
 const countRows=snapshot.results.find(result=>result.category==='counts').rows;
 assert.equal(countRows.find(row=>row.view==='count').detail,'2026-11-11');
 assert.equal(countRows.find(row=>row.view==='spot-check').recordId,'spot');
});

test('price overview renders original 台斤 amounts and same-spec purchase increase',async()=>{
 const options={role:'OWNER',active:'prices'};
 const fixture=render('all',true,false,false,{...options,respond:(name)=>{
  if(name!=='baihuayuan_ingredient_prices')return {data:null};
  return {data:{supply_states:[],ingredients:[{
   id:'lemon',name:'檸檬(無籽)',unit:'g',cost_price:0.16,selected_reference:'old',
   purchase:{amount:96,quantity:1,unit:'斤'},
   sources:[{id:'new',price:0.283333,unit:'g',source_kind:'purchase',review_status:'confirmed',
    receipt_purchase:{amount:170,quantity:1,unit:'台斤'}}],
  }]}};
 }});
 fixture.effects.forEach(fn=>fn());
 await new Promise(resolve=>setImmediate(resolve));
 const snapshot=fixture.updates.reduce((previous,update)=>update(previous),undefined);
 const {tree}=render('all',true,false,false,{...options,snapshot});
 const text=label(tree);
 assert.match(text,/原進價 → 新進價/);
 assert.match(text,/\$96／斤 → \$170／台斤/);
 assert.match(text,/\+77\.1%/);
 assert.doesNotMatch(text,/0\.2833/);
});
