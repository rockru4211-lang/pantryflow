import * as dataAccess from '../lib/data-access.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
function load(path,mocks={}){
 const source=readFileSync(new URL(path,import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};new Function('exports','require',compiled)(exports,name=>name.endsWith('.css')?{}:name in mocks?mocks[name]:require(name));return exports;
}
const {FormalAppShell}=load('../app/pilot/app-shell.tsx',{'@/lib/supabase-browser':{},'./inventory-catalog':{displayTime:String},'./daisy-logo':{default:()=>null},'@/lib/app-workspace':{roleLabel:()=> '行政'}});
const PersonSettings=load('../app/pilot/person-function-settings.tsx',{'@/lib/supabase-browser':{},'@/lib/app-workspace':{},'@/lib/operation-deadline':{},'@/lib/data-access':dataAccess,'@/lib/people-settings':{functionLabels:{FIELD:'現場作業',OFFICE:'行政作業',MANAGE:'系統管理'},workFunctions:p=>p.work_functions},'./person-removal':{default:()=>null},'./person-pin-settings':{default:()=>React.createElement('p',null,'PIN 已設定；調整權限不影響原 PIN')},'./staff-invitation-card':{default:()=>null}}).default;
const stores=[{id:'a',name:'BeApe'},{id:'b',name:'Gras'}];
test('administrative sidebar exposes people without changing the active role',()=>{
 const props={role:'LOGISTICS',businessType:'SINGLE_RESTAURANT',storeName:'BeApe',stores,storeId:'a',view:'home',onNavigate(){},onStoreChange(){}};
 const enabled=renderToStaticMarkup(React.createElement(FormalAppShell,{...props,peopleManagementEnabled:true}));
 const disabled=renderToStaticMarkup(React.createElement(FormalAppShell,{...props,peopleManagementEnabled:false}));
 assert.match(enabled,/>人員管理</);assert.doesNotMatch(disabled,/>人員管理</);assert.match(enabled,/admin-web-shell/);
});
test('office editor enables work permissions and removal but locks system grants',()=>{
 const person={user_id:'target',display_name:'小明',work_functions:['FIELD'],stores:[{id:'a',name:'BeApe',uses_pin:true}],can_edit_functions:true,can_remove:true};
 const props={person,stores,storeId:'a',managementStoreIds:[],onClose(){},onSaved:async()=>{}};
 const html=renderToStaticMarkup(React.createElement(PersonSettings,props));
 const checkboxes=[...html.matchAll(/<input type="checkbox"[^>]*>/g)].map(x=>x[0]);
 assert.equal(checkboxes.length,10);assert.doesNotMatch(html,/aria-label="設備維修(?:查看|編輯)"/);assert.match(html,/設備維修已包含在現場基本作業/);assert.doesNotMatch(checkboxes[2],/disabled/);assert.doesNotMatch(checkboxes[3],/disabled/);assert.match(html,/加選功能權限/);assert.doesNotMatch(html,/更多權限/);
 assert.match(html,/停用人員/);assert.match(html,/調整權限不影響原 PIN/);
 const manager=renderToStaticMarkup(React.createElement(PersonSettings,{...props,managementStoreIds:['a','b']}));
 assert.doesNotMatch([...manager.matchAll(/<input type="checkbox"[^>]*>/g)].at(-1)[0],/disabled/);
});

test('new personnel uses one inline form with direct PIN and automatic default store',()=>{
 const html=renderToStaticMarkup(React.createElement(PersonSettings,{stores,storeId:'a',managementStoreIds:[],onClose(){},onSaved:async()=>{}}));
 assert.match(html,/people-inline-form/);assert.match(html,/PIN 碼/);assert.match(html,/type="password"/);assert.match(html,/套用後勤/);assert.doesNotMatch(html,/<dialog|邀請連結|預設門市|更多權限/);
});


test('unified mobile navigation is identical for staff, supervisor, office and owner',()=>{
 for(const role of ['STAFF','SUPERVISOR','LOGISTICS','OWNER']){
  const html=renderToStaticMarkup(React.createElement(FormalAppShell,{role,businessType:'SINGLE_RESTAURANT',storeName:'BeApe',stores,storeId:'a',view:'home',mobileWorkflow:true,peopleManagementEnabled:true,onNavigate(){},onStoreChange(){}}));
  assert.match(html,/beape-field-shell/);
  assert.doesNotMatch(html,/admin-web-shell|admin-desktop-nav|role-ribbon|aria-label="設定"/);
  const nav=html.match(/<nav class="shell-bottom-nav"[\s\S]*?<\/nav>/)[0];
  assert.deepEqual([...nav.matchAll(/<span>([^<]+)<\/span>/g)].map(m=>m[1]),['首頁','紀錄','通知','設定']);
  assert.match(html,/aria-label="目前門市"/);
 }
});
