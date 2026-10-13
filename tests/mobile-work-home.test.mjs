import {usesUnifiedMobile} from '../lib/mobile-workflow.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {canData,viewAccess} from '../lib/data-access.ts';
import {visibleWork} from '../lib/workflow-rules.ts';
const src=readFileSync(new URL('../app/pilot/mobile-work-home.tsx',import.meta.url),'utf8');
const code=ts.transpileModule(src.slice(src.indexOf('export default function')).replace('export default ',''),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText;
const nodes=n=>Array.isArray(n)?n.flatMap(nodes):!n||typeof n!=='object'?[]:[n,...nodes(n.props?.children)];
const text=n=>typeof n==='string'?n:typeof n==='number'?String(n):Array.isArray(n)?n.map(text).join(''):n?.props?text(n.props.children):'';
function harness(overrides={}){
 let query='';const actions=[],searches=[],opened=[];
 const props={store:{id:'s',role:'SUPERVISOR',business_type:'SINGLE_RESTAURANT',cross:true,data_access:{RECIPE:{view:true,edit:false},SUPPLIERS:{view:true,edit:false}}},rows:[],error:'',refresh(){},onNavigate:v=>actions.push(v),onRecipeSearch:q=>searches.push(q),onOpenWork:r=>opened.push(r),...overrides};
 const scope={React,visibleWork,canData,viewAccess,hasCrossStore:s=>s.cross,useState:()=>[query,v=>{query=v;}],...Object.fromEntries(['Truck','ArrowLeftRight','Trash2','ClipboardList','Search','ChevronRight','Clock3','Wrench','ClipboardCheck'].map(k=>[k,()=>null]))};
 runInNewContext(code,scope);const render=()=>scope.MobileWorkHome(props);render();
 return {props,actions,searches,opened,render,text:()=>text(render()),button:label=>nodes(render()).find(n=>n.type==='button'&&text(n)===label),nodes:()=>nodes(render())};
}
test('work entries remain usable while pending feed is loading or unavailable',()=>{
 for(const state of [{rows:undefined},{error:'offline'}]){const h=harness(state);for(const [label,target] of [['貨單上傳','receiving'],['調撥','transfers'],['廢棄','waste']]){h.button(label).props.onClick();assert.equal(h.actions.at(-1),target);}assert.doesNotMatch(h.text(),/冷藏區|已完成/);}
});
test('task count excludes finished, bulletin and stale supervisor spot work; click retains exact record',()=>{
 const row={key:'count:1',id:'1',category:'count',title:'盤點',copy:'進行中',pending:true,target:'count',at:'2026-10-13T00:00:00Z'};
 const h=harness({rows:[row,{...row,key:'receipt',category:'receipt',target:'receiving',title:'貨單待核對'},{...row,key:'loan',category:'loan',target:'transfers',title:'借貸待歸還'},{...row,key:'2',pending:false},{...row,key:'3',category:'bulletin'},{...row,key:'4',category:'spot',target:'spot-check',title:'抽盤'}]});assert.match(h.text(),/今日待辦1/);assert.doesNotMatch(h.text(),/抽盤|货單待核對|貨單待核對|借貸待歸還/);h.nodes().find(n=>n.props?.className==='bm-row bm-task').props.onClick();assert.equal(h.opened[0],row);
});
test('staff and cross-store visibility is preserved, recipe query is forwarded',()=>{
 const staff=harness({store:{role:'STAFF',business_type:'CHAIN_RESTAURANT',cross:false}});assert.doesNotMatch(staff.text(),/食譜與成本|供應商訂貨|調撥/);
 const h=harness();h.nodes().find(n=>n.type==='input').props.onChange({target:{value:'  火腿  '}});h.nodes().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.deepEqual(h.searches,['火腿']);
});


test('mobile presentation excludes system administrator and leaves desktop roles unchanged',()=>{
 for(const role of ['STAFF','SUPERVISOR','LOGISTICS','OWNER',null]){
  assert.equal(usesUnifiedMobile(false,role),true);
  assert.equal(usesUnifiedMobile(true,role),false);
 }
 assert.equal(usesUnifiedMobile(false,'STAFF','CHAIN_RESTAURANT'),false);
 assert.equal(usesUnifiedMobile(false,'ADMIN'),false);
 assert.equal(usesUnifiedMobile(true,'ADMIN'),false);
});
test('office spot entry and pending task follow explicit feature permission',()=>{
 const store={role:'LOGISTICS',business_type:'SINGLE_RESTAURANT',cross:true,work_functions:['OFFICE'],data_access:{SPOT:{view:true,edit:true}}};
 const spot={key:'spot:a',id:'a',category:'spot',title:'10月抽盤',copy:'待抽查',pending:true,target:'spot-check',at:'2026-10-13T00:00:00Z'};
 const allowed=harness({store,rows:[spot]});
 allowed.button('抽盤查看與執行抽盤').props.onClick();assert.deepEqual(allowed.actions,['spot-check']);
 allowed.nodes().find(n=>n.props?.className==='bm-row bm-task').props.onClick();assert.equal(allowed.opened[0],spot);
 assert.match(allowed.text(),/設備維修/);assert.doesNotMatch(allowed.text(),/今天的行政重點|人員管理/);
 const denied=harness({store:{...store,data_access:{}},rows:[spot]});assert.doesNotMatch(denied.text(),/抽盤/);
 assert.equal(canData({...store,access_mode:'VIEW'},'SPOT',true),false);
});


test('mobile receipt entry uses photo upload for every ordinary role without altering desktop admin entry',()=>{
 const source=readFileSync(new URL('../app/pilot/receiving-workspace.tsx',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source.slice(source.indexOf('export default function ReceivingEntry')).replace('export default ',''),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText;
 const ReceiptPhotoWorkspace=()=>null,ReceivingWorkspace=()=>null;
 const scope={React,ReceiptPhotoWorkspace,ReceivingWorkspace};runInNewContext(compiled,scope);
 for(const role of ['STAFF','SUPERVISOR','LOGISTICS','OWNER']){
  const entry=scope.ReceivingEntry({role,fieldMode:true,businessType:'SINGLE_RESTAURANT',storeId:'a'});
  assert.equal(entry.type,ReceiptPhotoWorkspace);assert.equal(entry.props.storeId,'a');
 }
 assert.equal(scope.ReceivingEntry({role:'LOGISTICS',fieldMode:false,businessType:'SINGLE_RESTAURANT'}).type,ReceivingWorkspace);
});
