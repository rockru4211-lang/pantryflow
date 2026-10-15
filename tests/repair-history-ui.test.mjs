import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import React from 'react';
import ts from 'typescript';
import * as directory from '../lib/administrative-directory.ts';
import * as selection from '../lib/equipment-selection.ts';
import {historicalRepair} from '../lib/repair-history.ts';
import * as completion from '../lib/mobile-repair.ts';
import * as lifecycle from '../lib/directory-lifecycle.ts';

const source=readFileSync(new URL('../app/pilot/administrative-directory.tsx',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default function','function');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
const find=(n,p)=>!n?[]:Array.isArray(n)?n.flatMap(x=>find(x,p)):typeof n!=='object'?[]:[...(p(n)?[n]:[]),...find(n.props?.children,p)];
const label=n=>Array.isArray(n)?n.map(label).join(''):n&&typeof n==='object'?label(n.props?.children):String(n??'');
const year=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}).slice(0,4);
const row=(id,date,extra={})=>({id,name:id,category:'維修紀錄',repair_date:date,summary:'',link:'',note:'',archived:false,revision:1,...extra});
function harness(initial){
 const hooks=[],effects=[],calls=[],focus=[];let cursor=0,tree,sequence=0,failSave=false;
 const memo=(fn,deps)=>{const k=cursor++,old=hooks[k];if(!old||deps.some((d,j)=>d!==old.deps[j]))hooks[k]={value:fn(),deps};return hooks[k].value;};
 const scope={React,Fragment:React.Fragment,historicalRepair,DirectoryAttachments:"Attachments",useAttachmentCounts:()=>({}),...directory,...lifecycle,...selection,...completion,DirectoryLifecycleMenu:'Lifecycle',Download:'Icon',Plus:'Icon',Search:'Icon',Upload:'Icon',crypto:{randomUUID:()=>`new-${++sequence}`},queueMicrotask,
  canData:()=>true,officeAccess:()=>true,canExportData:()=>true,appError:e=>e.message,operationDeadline:fn=>fn(undefined),window:{confirm:()=>true,addEventListener(){},removeEventListener(){}},
  useState:v=>{const k=cursor++;if(!(k in hooks))hooks[k]=typeof v==='function'?v():v;return [hooks[k],next=>{hooks[k]=typeof next==='function'?next(hooks[k]):next;}];},
  useRef:v=>{const k=cursor++;return hooks[k]||(hooks[k]={current:v});},useCallback:(fn,deps)=>memo(()=>fn,deps),
  useEffect:(fn,deps)=>{const k=cursor++,old=hooks[k];if(!old||deps.some((d,j)=>d!==old[j])){hooks[k]=deps;effects.push(fn);}},
  supabase:{rpc:(name,args)=>{calls.push({name,args});const result=name==='app_workspace'?{data:{rows:initial}}:failSave?{error:Error('讀取逾時')}:{data:{rows:args.p_data.rows.map(r=>({...r,revision:1}))}};return {abortSignal:async()=>result};}},
 };
 runInNewContext(code,scope);
 const render=()=>{cursor=0;tree=scope.AdministrativeDirectory({section:'equipment',store:{id:'store-a',name:'店'},onSuppliers(){}});tree.props.ref.current={querySelector:selector=>({querySelector:()=>({focus:()=>focus.push(selector)}),scrollIntoView:()=>{}})};while(effects.length)effects.shift()();return tree;};
 const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();render();};
 const invoke=async(fn,...args)=>{await fn(...args);render();await settle();};
 const button=name=>find(tree,n=>n.type==='button'&&label(n)===name)[0];
 const changeYear=value=>invoke(find(tree,n=>n.type==='select'&&n.props['aria-label']==='維修年份')[0].props.onChange,{target:{value}});
 render();
 return {settle,invoke,button,changeYear,calls,focus,get tree(){return tree;},failSave:()=>{failSave=true;}};
}
const ids=h=>find(h.tree,n=>n.type==='tr'&&n.props['data-administrative-id']).map(n=>n.props['data-administrative-id']);

test('repair history filters years and undated records, sorts newest first and preserves inactive history',async()=>{
 const h=harness([row('old','2021-05-01'),row('early',`${year}-01-01`),row('latest',`${year}-10-01`),row('undated',null),row('inactive',`${year}-06-01`,{archived:true}),row('removed','2020-01-01',{is_removed:true})]);
 await h.settle();await h.invoke(h.button('維修紀錄').props.onClick);
 assert.deepEqual(ids(h),['latest','early']);
 await h.changeYear('2021');assert.deepEqual(ids(h),['old']);
 await h.changeYear('undated');assert.deepEqual(ids(h),['undated']);
 await h.changeYear('all');assert.deepEqual(ids(h),['latest','early','old','undated']);
 await h.invoke(h.button('已停用').props.onClick);assert.deepEqual(ids(h),['inactive']);
 await h.invoke(h.button('已移除').props.onClick);assert.deepEqual(ids(h),['removed']);
 assert.equal(h.calls.length,1,'year changes only filter the existing records');
});

test('new repair opens first and focuses even with an older year selected; saving retains the record',async()=>{
 const h=harness(Array.from({length:300},(_,i)=>row(`history-${i}`,'2021-05-01')));
 await h.settle();await h.invoke(h.button('維修紀錄').props.onClick);await h.changeYear('2021');
 await h.invoke(h.button('新增紀錄').props.onClick);
 assert.equal(ids(h)[0],'new-1');assert.equal(ids(h).length,301);assert.ok(h.focus.some(s=>s.includes('new-1')));
 const name=find(h.tree,n=>n.type==='input'&&n.props['aria-label']==='設備名稱')[0];
 await h.invoke(name.props.onChange,{target:{value:'冰箱'}});
 await h.invoke(h.button('儲存').props.onClick);
 const save=h.calls.find(c=>c.name==='app_operation');assert.equal(save.args.p_store_id,'store-a');assert.equal(save.args.p_data.rows[0].name,'冰箱');assert.equal(save.args.p_data.rows[0].category,'維修紀錄');
 await h.changeYear(year);assert.deepEqual(ids(h),['new-1']);
});

test('failed saves keep the new form visible and cancel removes only the unsaved draft',async()=>{
 const h=harness([row('original',`${year}-01-01`)]);await h.settle();await h.invoke(h.button('維修紀錄').props.onClick);await h.invoke(h.button('新增紀錄').props.onClick);
 await h.invoke(find(h.tree,n=>n.type==='input'&&n.props['aria-label']==='設備名稱')[0].props.onChange,{target:{value:'冷氣'}});
 h.failSave();await h.invoke(h.button('儲存').props.onClick);
 assert.equal(ids(h)[0],'new-1');assert.ok(label(h.tree).includes('讀取逾時'));assert.ok(find(h.tree,n=>n.type==='input'&&n.props.value==='冷氣').length);
 await h.invoke(h.button('取消').props.onClick);assert.deepEqual(ids(h),['original']);
});

test('equipment quick choice and vendor prefill survive saving a new repair',async()=>{
 const h=harness([row('original',`${year}-01-01`,{name:'冰箱',summary:'維修廠商：甲廠商'})]);
 await h.settle();await h.invoke(h.button('維修紀錄').props.onClick);await h.invoke(h.button('新增紀錄').props.onClick);
 const input=()=>find(h.tree,n=>n.type==='input'&&n.props['aria-label']==='設備名稱')[0];
 assert.equal(input().props.list,'equipment-name-options');
 await h.invoke(input().props.onChange,{target:{value:'冰箱'}});await h.invoke(input().props.onBlur);
 const vendor=find(h.tree,n=>n.type==='input'&&n.props['aria-label']==='維修廠商')[0];assert.equal(vendor.props.value,'甲廠商');
 await h.invoke(vendor.props.onChange,{target:{value:'新廠商'}});await h.invoke(h.button('儲存').props.onClick);
 assert.equal(selection.repairVendor(h.calls.find(c=>c.name==='app_operation').args.p_data.rows[0].summary),'新廠商');
});
test('completion button opens missing result in-place then saves completed state with date',async()=>{
 const h=harness([row('washer',`${year}-10-14`,{name:'洗碗機',repair_result:''})]);await h.settle();await h.invoke(h.button('維修紀錄').props.onClick);
 await h.invoke(h.button('完成維修').props.onClick);assert.ok(label(h.tree).includes('請填寫處理結果'));
 const result=find(h.tree,n=>n.type==='textarea'&&n.props['aria-label']==='洗碗機 處理結果')[0];await h.invoke(result.props.onChange,{target:{value:'補膠完成'}});
 await h.invoke(h.button('完成維修').props.onClick);const saved=h.calls.find(c=>c.name==='app_operation').args.p_data.rows[0];assert.equal(saved.id,'washer');assert.equal(saved.repair_result,'已完成維修\n補膠完成');assert.match(saved.summary,/完成日期：\d{4}-\d{2}-\d{2}/);assert.equal(h.button('完成維修'),undefined);
});
