import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import * as overview from '../lib/operations-overview.ts';
import {officeAccess,viewAccess} from '../lib/data-access.ts';
const source=readFileSync('app/pilot/operations-overview.tsx','utf8');
const compiled=ts.transpileModule(source.replace(/^import .*;\n/gm,'').replace('export default function','function'),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const nodes=n=>Array.isArray(n)?n.flatMap(nodes):!n||typeof n!=='object'?[]:[n,...nodes(n.props?.children)];
function render(filter='all',permission=true,allStores=false,extraStore=false,{role='LOGISTICS',active='equipment'}={}){
 const store={id:'a',name:'BeApe',organization_id:'o',role,business_type:'SINGLE_RESTAURANT',data_access:{EQUIPMENT:{view:permission,edit:permission}},work_functions:permission?['OFFICE']:[],is_active:true};
 const second={...store,id:'b',name:'Gras'},stores=extraStore?[store,second]:[store];
 const scope=JSON.stringify((allStores?stores:[store]).map(s=>[s.id,s.role,s.access_mode,s.work_functions,s.data_access]));
 const rows=Array.from({length:8},(_,i)=>({id:String(i),name:'項目'+i,storeId:'a',storeName:'BeApe',detail:'日期未定',status:'待處理',view:i%2?'purchase-notes':'equipment',taskKind:i%2?'purchase':'repair'}));
 let i=0;const values=[allStores,active,0,'',filter,{scope,results:[{storeId:'a',category:'equipment',rows},...(extraStore?[{storeId:'b',category:'equipment',rows:[{...rows[0],id:'gras',name:'Gras 專屬事項',storeId:'b',storeName:'Gras'}]}]:[])]}],opened=[],effects=[],calls=[];
 const context={React,...overview,officeAccess,viewAccess,AbortController,crypto,appError:()=>'',operationDeadline:run=>run(new AbortController().signal),supabase:{rpc:(name,args)=>{calls.push({name,args});return {abortSignal:()=>new Promise(()=>{})};}},window:{addEventListener(){},removeEventListener(){}},setInterval:()=>1,clearInterval(){},useEffect(fn){effects.push(fn);},useState(v){return [values[i++]??v,()=>{}];}};
 runInNewContext(compiled,context);
 return {tree:context.OperationsOverview({store,stores,onOpen:(...args)=>opened.push(args)}),opened,effects,calls};
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

test('overview defaults to custody and skips receipt reads even for owners viewing both stores',()=>{
 const overview=render('all',true,true,true,{role:'OWNER',active:null});
 const tabs=nodes(overview.tree).find(n=>n.props?.['aria-label']==='營運總覽分類').props.children;
 assert.deepEqual(Array.from(tabs,tab=>label(tab.props.children[0])),['寄庫補貨','價格上漲','待辦事項','合約到期']);
 assert.equal(tabs[0].props['aria-pressed'],true);
 overview.effects.forEach(fn=>fn());
 assert.equal(overview.calls.filter(call=>call.name==='baihuayuan_custody_reminders').length,2);
 assert.equal(overview.calls.some(call=>['get_baihuayuan_receipt_inbox','get_baihuayuan_record_flags'].includes(call.name)),false);
});
