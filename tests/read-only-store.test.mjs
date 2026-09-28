import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {readOnlyMonthRange,readOnlyStorePolicy,visibleReviewedRows} from '../lib/read-only-store.ts';

test('staff remains blind even with separately granted report and export permissions',()=>{
  const policy=readOnlyStorePolicy({role:'STAFF',permissions:{reports_view:true,data_export:true}});
  assert.equal(policy.blind,true);
  assert.equal(policy.reports,true);
  assert.equal(readOnlyStorePolicy({role:'SUPERVISOR',permissions:{reports_view:false,data_export:false}}).reports,false);
});

test('finance filters require explicit confirmation and never treat missing status as confirmed',()=>{
  const rows=[{id:'pending',review_status:'PENDING'},{id:'legacy'},{id:'confirmed',review_status:'CONFIRMED'}];
  assert.deepEqual(visibleReviewedRows(rows,true).map(row=>row.id),['confirmed']);
  assert.deepEqual(visibleReviewedRows(rows,false),rows);
  assert.equal(readOnlyStorePolicy({role:'LOGISTICS',company_title:'財務'}).confirmedOnly,true);
  assert.equal(readOnlyStorePolicy({role:'LOGISTICS',company_title:'行政'}).confirmedOnly,false);
});

test('monthly reads follow Taiwan month boundaries including the December rollover',()=>{
  assert.deepEqual(readOnlyMonthRange('2026-12'),{from:'2026-12-01T00:00:00+08:00',to:'2027-01-01T00:00:00+08:00'});
  const range=readOnlyMonthRange('2026-09');
  assert.equal(new Date(range.from).toISOString(),'2026-08-31T16:00:00.000Z');
});

const source=readFileSync(new URL('../app/pilot/read-only-store-workspace.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function render({section='counts',role='SUPERVISOR',company_title,reportPermission=true,exportPermission=false,workspaceData={},queryData={}}={}) {
  let stateIndex=0;
  const reads=[];
  const compiledModule={exports:{}};
  const icon=()=>null;
  runInNewContext(compiled,{exports:compiledModule.exports,require:name=>{
    if(name==='react')return {...React,useState:initial=>{
      let value=typeof initial==='function'?initial():initial;
      if(stateIndex===0)value=section;
      else if(stateIndex===1)value='2026-09';
      else if(value&&typeof value==='object'&&'key' in value&&'loading' in value)value={...value,loading:false,data:queryData};
      stateIndex++;return [value,()=>{}];
    },useEffect(){},useCallback:callback=>callback,useRef:initial=>({current:initial})};
    if(name==='react/jsx-runtime')return jsx;
    if(name==='lucide-react')return {Eye:icon,RefreshCw:icon};
    if(name==='@/lib/read-only-store')return {readOnlyMonthRange,readOnlyStorePolicy,visibleReviewedRows};
    if(name==='@/lib/app-workspace')return {appError:String,canExportData:store=>store.permissions.data_export};
    if(name==='@/lib/inventory-monthly')return {inventoryMoney:value=>value==null?'—':`NT$ ${value}`,inventoryNumber:value=>value==null?'—':String(value),taipeiMonth:()=> '2026-09'};
    if(name==='@/lib/expiry-waste')return {monthRange:()=>['2026-09-01','2026-09-30']};
    if(name==='@/lib/stock-rules.mjs')return {stockStateLabels:{READY:'可用'}};
    if(name==='./inventory-catalog')return {displayTime:value=>value};
    if(name==='./operation-hooks')return {useWorkspace:(storeId,scope)=>{reads.push(scope);return {data:workspaceData,loading:false,error:'',refresh:async()=>{}};}};
    if(name==='./expiry-waste-cards')return {WasteHistoryRows:({rows})=>jsx.jsx('div',{children:rows.map(row=>jsx.jsx('p',{children:row.name},row.id))}),WasteDetail:()=>null};
    if(name==='./reports-workspace')return {exportRows:async()=>{}};
    if(name==='./spot-check-workspace')return {default:({store,userId})=>jsx.jsx('div',{'data-spot-store':store.id,'data-spot-viewer':userId})};
    if(name==='@/lib/supabase-browser')return {supabase:{rpc(){throw Error('Unexpected RPC during rendering');}}};
    throw Error(`Unexpected import ${name}`);
  }});
  const element=compiledModule.exports.default({store:{id:'one',name:'一店',role,company_title,business_type:'SINGLE_RESTAURANT',permissions:{reports_view:reportPermission,data_export:exportPermission}},userId:'viewer'});
  return {html:renderToStaticMarkup(element),reads};
}

test('a staff member cannot render or load stock, including a stale stock tab after a role change',()=>{
  const {html,reads}=render({section:'stock',role:'STAFF'});
  assert.doesNotMatch(html,/庫存資料|總庫存|可用/);
  assert.deepEqual(reads,[]);
});

test('staff only sees count progress, never a control that reveals submitted quantities',()=>{
  const {html}=render({role:'STAFF',queryData:{sessions:[{id:'session',status:'CLOSED',started_at:'2026-09-01'}],zones:[{id:'fridge',name:'冷藏庫'}],progress:{session:[{zone_id:'fridge',status:'COMPLETED'}]}}});
  assert.match(html,/冷藏庫：已完成/);
  assert.doesNotMatch(html,/查看已送出明細|搜尋品項／儲物區|匯出 Excel/);
});

test('finance read view excludes pending transfers and cannot expose change actions',()=>{
  const base={from_name:'一店',to_name:'二店',quantity:2,unit:'瓶',status:'COMPLETE',created_at:'2026-09-10',events:[]};
  const {html}=render({section:'transfers',role:'LOGISTICS',company_title:'財務',workspaceData:{records:[{...base,id:'a',name:'待確認鮮奶',review_status:'PENDING'},{...base,id:'b',name:'已確認鮮奶',review_status:'CONFIRMED'}]}});
  assert.match(html,/已確認鮮奶/);
  assert.doesNotMatch(html,/待確認鮮奶|完成歸還|完成換貨|確認調撥|新增調撥|匯出 Excel/);
});

test('read-only stock escapes user-provided item names and does not offer stock modification',()=>{
  const {html,reads}=render({section:'stock',workspaceData:{products:[{id:'p',name:'<script>alert(1)</script>',unit:'瓶',stock:{total:0,available:0}}],positions:[]}});
  assert.deepEqual(reads,['stock']);
  assert.match(html,/&lt;script&gt;/);
  assert.match(html,/總庫存 0 瓶/);
  assert.doesNotMatch(html,/<script>|儲存|移動／確認/);
});

test('finance can open the scoped spot-check view while a stale staff tab cannot render it',()=>{
  assert.match(render({section:'spot',role:'LOGISTICS',company_title:'財務'}).html,/data-spot-store="one" data-spot-viewer="viewer"/);
  assert.doesNotMatch(render({section:'spot',role:'STAFF'}).html,/data-spot-store/);
});
