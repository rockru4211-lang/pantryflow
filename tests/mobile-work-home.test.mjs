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
 for(const state of [{rows:undefined},{error:'offline'}]){const h=harness(state);for(const [label,target] of [['進貨上傳','receiving'],['調撥','transfers'],['廢棄','waste']]){h.button(label).props.onClick();assert.equal(h.actions.at(-1),target);}assert.doesNotMatch(h.text(),/冷藏區|已完成/);}
});
test('task count excludes finished, bulletin and stale supervisor spot work; click retains exact record',()=>{
 const row={key:'count:1',id:'1',category:'count',title:'盤點',copy:'進行中',pending:true,target:'count',at:'2026-10-13T00:00:00Z'};
 const h=harness({rows:[row,{...row,key:'receipt',category:'receipt',target:'receiving',title:'貨單待核對'},{...row,key:'loan',category:'loan',target:'transfers',title:'借貸待歸還'},{...row,key:'2',pending:false},{...row,key:'3',category:'bulletin'},{...row,key:'4',category:'spot',target:'spot-check',title:'抽盤'}]});assert.match(h.text(),/今日待辦1/);assert.doesNotMatch(h.text(),/抽盤|货單待核對|貨單待核對|借貸待歸還/);h.nodes().find(n=>n.props?.className==='bm-row bm-task').props.onClick();assert.equal(h.opened[0],row);
});
test('staff and cross-store visibility is preserved, recipe query is forwarded',()=>{
 const staff=harness({store:{role:'STAFF',business_type:'CHAIN_RESTAURANT',cross:false}});assert.doesNotMatch(staff.text(),/食譜與成本|供應商訂貨|調撥/);
 const h=harness();h.nodes().find(n=>n.type==='input').props.onChange({target:{value:'  火腿  '}});h.nodes().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.deepEqual(h.searches,['火腿']);
});
