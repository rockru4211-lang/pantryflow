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
 const exports={};new Function('exports','require',compiled)(exports,name=>name in mocks?mocks[name]:require(name));return exports;
}
const {FormalAppShell}=load('../app/pilot/app-shell.tsx',{'@/lib/supabase-browser':{},'./inventory-catalog':{displayTime:String},'./daisy-logo':{default:()=>null},'@/lib/app-workspace':{roleLabel:()=> '行政'}});
const PersonSettings=load('../app/pilot/person-function-settings.tsx',{'@/lib/supabase-browser':{},'@/lib/app-workspace':{},'@/lib/operation-deadline':{},'@/lib/people-settings':{functionLabels:{FIELD:'現場作業',OFFICE:'行政作業',MANAGE:'系統管理'},workFunctions:p=>p.work_functions},'./person-removal':{default:()=>null},'./staff-invitation-card':{default:()=>null}}).default;
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
 assert.doesNotMatch(checkboxes.at(-3),/disabled/);assert.doesNotMatch(checkboxes.at(-2),/disabled/);assert.match(checkboxes.at(-1),/disabled/);
 assert.match(html,/移除人員/);assert.match(html,/沿用原帳號與 PIN/);
 const manager=renderToStaticMarkup(React.createElement(PersonSettings,{...props,managementStoreIds:['a','b']}));
 assert.doesNotMatch([...manager.matchAll(/<input type="checkbox"[^>]*>/g)].at(-1)[0],/disabled/);
});
