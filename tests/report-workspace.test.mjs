import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import * as model from '../lib/report-workspace-model.ts';
import {receiptPriceSummary} from '../lib/receipt-price-summary.ts';

const source=readFileSync(new URL('../app/pilot/reports-workspace.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function workspace({section='reports',page='home',month='2026-08',initialPage,manage=false,data={counts:[],receipts:[],lines:[]},error='',onWasteHistory,exportOpen=false}={}){
 const effects=[],navigation=[],countNavigation=[],downloaded=[];let draft={month,page,search:''},stateIndex=0;
 const setDraft=updater=>{draft=typeof updater==='function'?updater(draft):updater;};
 const exports={};
 runInNewContext(compiled,{exports,require:name=>{
  if(name==='react')return {...React,useEffect:effect=>effects.push(effect),useState:value=>[stateIndex++===0?exportOpen:value,()=>{}]};
  if(name==='react/jsx-runtime')return jsx;
  if(name==='@/lib/report-workspace-model')return model;
  if(name==='@/lib/receipt-price-summary')return {receiptPriceSummary};
  if(name==='@/lib/app-workspace')return {canManageBusiness:()=>manage,canExportData:()=>true,localMonth:()=>month,monthRange:value=>({month:value})};
  if(name==='./operation-hooks')return {useOperationDraft:()=>[draft,setDraft],useWorkspace:()=>({data,error,loading:false,refresh(){}})};
  if(name==='./inventory-catalog')return {displayTime:value=>value};
  if(name==='@/lib/supabase-browser')return {supabase:{rpc:async()=>({error:null})}};
  if(name==='xlsx')return {utils:{json_to_sheet:rows=>rows,book_new:()=>({}),book_append_sheet:(book,sheet)=>{book.rows=sheet;}},writeFile:book=>downloaded.push(book.rows)};
  throw new Error(`Unexpected import ${name}`);
 }});
 const tree=exports.default({store:{id:'store',name:'測試店'},userId:'user',section,initialPage,onBack(){},onCount:id=>countNavigation.push(id),onReceipt(){},onNavigate:view=>navigation.push(view),onWasteHistory});
 function findButton(label,node=tree){
  if(!node||typeof node!=='object')return;
  if(Array.isArray(node)){for(const child of node){const match=findButton(label,child);if(match)return match;}return;}
  if(node.type==='button'&&renderToStaticMarkup(node).includes(label))return node;
  return node.props?.children===undefined?undefined:findButton(label,node.props.children);
 }
 return {tree,html:renderToStaticMarkup(tree),effects,navigation,countNavigation,downloaded,findButton,get draft(){return draft;}};
}

test('ordinary logistics never receive the forbidden complete-audit export entry',()=>{
 assert.doesNotMatch(workspace({section:'exports'}).html,/完整稽核明細/);
 const admin=workspace({section:'exports',manage:true});
 admin.findButton('完整稽核明細').props.onClick();assert.deepEqual(admin.navigation,['audit']);
});

test('waste reports open existing history with the selected month and never field registration',()=>{
 const months=[],report=workspace({section:'costs',month:'2026-07',onWasteHistory:month=>months.push(month)});
 assert.match(report.html,/value="2026-07"/);assert.match(report.html,/進貨金額/);assert.doesNotMatch(report.html,/食材成本|廢棄影響/);
 report.findButton('廢棄紀錄').props.onClick();assert.deepEqual(months,['2026-07']);assert.deepEqual(report.navigation,[]);
 assert.doesNotMatch(workspace({section:'costs'}).html,/查看所選月份的廢棄明細/);
});

const events=[
 {id:'c',action:'COUNT_DRAFT_SAVED',entity_type:'count_draft',entity_id:'session',actor_name:'員工',created_at:'2026-08-01',old_value:{quantity:null},new_value:{quantity:0}},
 {id:'r',action:'RECEIPT_CONFIRMED',entity_type:'goods_receipt',entity_id:'receipt',actor_name:'主管',created_at:'2026-08-02',old_value:null,new_value:{batch_id:'batch'}},
 {id:'m',action:'member.assign',entity_type:'store_membership',entity_id:'member',actor_name:'老闆',created_at:'2026-08-03',old_value:null,new_value:{role:'LOGISTICS'}},
 {id:'u',action:'settings.save',entity_type:'settings',entity_id:'store',actor_name:'老闆',created_at:'2026-08-04',old_value:{},new_value:{}}
];
test('audit categories show existing historical events and keep unrelated changes in all operations',()=>{
 for(const [page,id] of [['counts','c'],['receipts','r'],['events','m']])assert.deepEqual(model.reportAuditEvents(events,page).map(event=>event.id),[id]);
 assert.equal(model.reportAuditEvents(events,'all').length,4);
 const report=workspace({section:'audit',page:'counts',manage:true,data:{events}});
 assert.match(report.html,/儲存盤點數量／備註/);assert.doesNotMatch(report.html,/確認進貨|選擇一筆盤點/);assert.match(report.html,/quantity/);
 const home=workspace({section:'audit',manage:true,data:{events}});
 home.findButton('盤點事件').props.onClick();assert.equal(home.draft.page,'counts');assert.deepEqual(home.navigation,[]);
 home.findButton('進貨事件').props.onClick();assert.equal(home.draft.page,'receipts');assert.deepEqual(home.navigation,[]);
});

test('prices export uses the displayed per-item, per-unit latest and weighted summary',async()=>{
 const line={id:'a',receipt_id:'receipt',product_id:'milk',name:'鮮奶',unit:'瓶',quantity:2,unit_price:40,amount:80,receipt_date:'2026-08-01',supplier_name:'甲',source_batch_id:'a',inventory_status:'POSTED'};
 const lines=[line,{...line,id:'b',quantity:1,unit_price:70,amount:70,receipt_date:'2026-08-02',source_batch_id:'b'},{...line,id:'c',unit:'箱',unit_price:400},{...line,id:'d',product_id:'unknown',name:'待確認',unit_price:null}];
 const report=workspace({section:'costs',page:'prices',exportOpen:true,data:{counts:[],receipts:[],lines}});
 assert.match(report.html,/本期加權均價 NT\$ 50/);
 report.findButton('Excel').props.onClick();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(report.downloaded.length,1);const rows=report.downloaded[0];assert.equal(rows.length,3);
 assert.equal(rows[0].最近單價,70);assert.equal(rows[0].本期加權均價,50);assert.equal(rows[0].單位,'瓶');assert.equal(rows[1].單位,'箱');assert.equal(rows[2].最近單價,'未提供');assert.equal(Object.hasOwn(rows[0],'數量'),false);
});

test('missing totals remain unknown, known zero is retained, and read failure cannot render zero counts',()=>{
 assert.equal(model.confirmedReceiptTotal(undefined),null);assert.equal(model.confirmedReceiptTotal([]),null);assert.equal(model.confirmedReceiptTotal([{total_inc_tax:0}]),0);assert.equal(model.confirmedReceiptTotal([{total_inc_tax:10},{total_inc_tax:null}]),null);
 const missing=workspace({page:'summary',data:{}});assert.match(missing.html,/未提供/);assert.doesNotMatch(missing.html,/>0 次|>0 張|NT\$ 0/);
 const failed=workspace({page:'summary',data:undefined,error:'讀取失敗'});assert.match(failed.html,/讀取失敗/);assert.doesNotMatch(failed.html,/>0 次|>0 張|營運摘要<\/h2>.*NT\$ 0/);
});

test('explicit home or count-record entry overrides only page; ordinary detail return preserves report context',()=>{
 for(const initialPage of ['home','counts']){
  const report=workspace({page:'prices',month:'2026-07',initialPage});report.effects.forEach(effect=>effect());
  assert.equal(report.draft.page,initialPage);assert.equal(report.draft.month,'2026-07');
 }
 const returned=workspace({page:'counts',month:'2026-07'});returned.effects.forEach(effect=>effect());assert.equal(returned.draft.page,'counts');assert.equal(returned.draft.month,'2026-07');
});
