import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as reminders from '../lib/custody-reminders.ts';
function mount(state,request=async()=>state){
 const hooks=[];let cursor=0,tree;const calls=[];
 const react={...React,useState(initial){const i=cursor++;if(!(i in hooks))hooks[i]=i===0?state:typeof initial==='function'?initial():initial;return[hooks[i],v=>{hooks[i]=typeof v==='function'?v(hooks[i]):v;}];},useRef(value){const i=cursor++;hooks[i]??={current:value};return hooks[i];},useEffect(){cursor++;},useCallback(fn){cursor++;return fn;}};
 const scope={React,exports:{},crypto:{randomUUID},require(name){if(name==='react')return react;if(name==='lucide-react')return Object.fromEntries(['Plus','Search','RefreshCw','X','Download','ChevronDown','ChevronRight','Pencil'].map(n=>[n,()=>null]));if(name==='@/lib/custody-reminders')return reminders;if(name==='./custody-reminder-api')return{reminderRequest:async(...args)=>{calls.push(args);return request(...args);}};return{};}};
 runInNewContext(ts.transpileModule(readFileSync(new URL('../app/pilot/custody-reminder-workspace.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText,scope);
 const render=()=>{cursor=0;tree=scope.exports.default({storeId:'store',kind:'supplier',registerGuard(){}});};
 const nodes=predicate=>{const found=[];const walk=n=>{if(Array.isArray(n)){n.forEach(walk);return;}if(!React.isValidElement(n))return;if(predicate(n))found.push(n);walk(n.props.children);};walk(tree);return found;};
 render();return{render,nodes,calls,html:()=>renderToStaticMarkup(tree)};
}
test('unified custody list includes legacy balances and edits their original record while new records use supplier',async()=>{
 const state={rows:[{id:'s',product_id:'p',kind:'supplier',name:'火腿',supplier:'甲',unit:'包',remaining:100,note:'',revision:2},{id:'r',product_id:'q',kind:'reserved',name:'鵝肝',supplier:'乙',unit:'包',remaining:98,note:'歷史備註',revision:4}],products:[]};
 const {render,nodes,calls,html:markup}=mount(state);
 const html=markup();assert.match(html,/火腿/);assert.match(html,/鵝肝/);assert.doesNotMatch(html,/保留貨/);
 nodes(n=>n.type==='button'&&n.props.children==='編輯')[1].props.onClick();render();
 await nodes(n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});await new Promise(r=>setImmediate(r));
 assert.equal(calls[0][2].id,'r');assert.equal(calls[0][2].kind,'reserved');assert.equal(calls[0][2].revision,4);assert.equal(calls[0][2].remaining,'98');
 render();nodes(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children.includes('新增寄庫'))[0].props.onClick();render();
 nodes(n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});await new Promise(r=>setImmediate(r));assert.equal(calls[1][2].kind,'supplier');assert.equal(calls[1][2].id,'');
});

const safetyFixture=()=>({can_edit:true,rows:[{id:'duck',product_id:'p',kind:'reserved',name:'鴨肝',supplier:'甲',unit:'包',remaining:53,note:'原備註',revision:7,safety_stock:null,responsible_user_id:''}],products:[],recipients:[]});
test('safety-stock cell opens an editable form and saves or clears the threshold on the original balance',async()=>{
 let saved=safetyFixture();
 const {nodes,render,calls,html}=mount(saved,async(_store,action,data)=>{
  assert.equal(action,'save');saved={...saved,rows:saved.rows.map(r=>({...r,safety_stock:data.safety_stock===''?null:Number(data.safety_stock),revision:r.revision+1}))};return saved;
 });
 const button=name=>nodes(n=>n.type==='button'&&n.props['aria-label']===name)[0];
 const field=()=>nodes(n=>n.type==='input'&&n.props['aria-label']==='安全水位')[0];
 button('鴨肝：設定安全水位').props.onClick();render();
 assert.equal(field().props.value,'');assert.equal(field().props.autoFocus,true);
 field().props.onChange({target:{value:'60'}});render();
 await nodes(n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});await new Promise(r=>setImmediate(r));render();
 assert.equal(nodes(n=>n.type==='form').length,0);assert.match(html(),/60 包/);
 const payload=calls[0][2];assert.equal(payload.safety_stock,'60');assert.equal(payload.remaining,'53');assert.equal(payload.kind,'reserved');assert.equal(payload.note,'原備註');assert.equal(payload.id,'duck');assert.equal(payload.revision,7);
 button('鴨肝：編輯安全水位').props.onClick();render();assert.equal(field().props.value,'60');
 field().props.onChange({target:{value:''}});render();await nodes(n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});await new Promise(r=>setImmediate(r));render();
 assert.equal(calls[1][2].safety_stock,'');assert.equal(calls[1][2].revision,8);assert.ok(button('鴨肝：設定安全水位'));
});
test('failed safety-stock save keeps the draft editable; cancelling keeps the saved value',async()=>{
 const {nodes,render,calls,html}=mount(safetyFixture(),async()=>{throw new Error('REMINDER_CHANGED');});
 nodes(n=>n.type==='button'&&n.props['aria-label']==='鴨肝：設定安全水位')[0].props.onClick();render();
 nodes(n=>n.type==='input'&&n.props['aria-label']==='安全水位')[0].props.onChange({target:{value:'20'}});render();
 await nodes(n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});await new Promise(r=>setImmediate(r));render();
 assert.equal(nodes(n=>n.type==='input'&&n.props['aria-label']==='安全水位')[0].props.value,'20');assert.equal(nodes(n=>n.type==='fieldset')[0].props.disabled,false);assert.equal(nodes(n=>n.props.role==='alert').length,1);
 nodes(n=>n.type==='button'&&n.props.children==='取消')[0].props.onClick();render();assert.equal(nodes(n=>n.type==='form').length,0);assert.match(html(),/設定水位/);assert.equal(calls.length,1);
});
test('read-only custody does not expose safety-stock editing',()=>{
 const {nodes,html}=mount({...safetyFixture(),can_edit:false});
 assert.equal(nodes(n=>n.type==='button'&&n.props['aria-label']?.includes('安全水位')).length,0);assert.equal(nodes(n=>n.type==='button'&&n.props.children==='編輯').length,0);assert.match(html(),/未設定/);
});
