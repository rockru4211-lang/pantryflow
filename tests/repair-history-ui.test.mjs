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
 const scope={React,Fragment:React.Fragment,historicalRepair,WorkspaceEditDialog:"WorkspaceEditDialog",DirectoryAttachments:"Attachments",useAttachmentCounts:()=>({}),...directory,...lifecycle,...selection,...completion,DirectoryLifecycleMenu:'Lifecycle',Download:'Icon',Plus:'Icon',Search:'Icon',Upload:'Icon',crypto:{randomUUID:()=>`new-${++sequence}`},queueMicrotask,
  canData:()=>true,officeAccess:()=>true,canExportData:()=>true,appError:e=>e.message,operationDeadline:fn=>fn(undefined),window:{confirm:()=>true,addEventListener(){},removeEventListener(){}},
  useState:v=>{const k=cursor++;if(!(k in hooks))hooks[k]=typeof v==='function'?v():v;return [hooks[k],next=>{hooks[k]=typeof next==='function'?next(hooks[k]):next;}];},
  useRef:v=>{const k=cursor++;return hooks[k]||(hooks[k]={current:v});},useCallback:(fn,deps)=>memo(()=>fn,deps),
  useEffect:(fn,deps)=>{const k=cursor++,old=hooks[k];if(!old||deps.some((d,j)=>d!==old[j])){hooks[k]=deps;effects.push(fn);}},
  supabase:{rpc:(name,args)=>{calls.push({name,args});const result=name==='app_workspace'?{data:{rows:initial}}:failSave?{error:Error('讀取逾時')}:{data:{rows:args.p_data.rows.map(r=>({...r,revision:1}))}};return {abortSignal:async()=>result};}},
 };
 runInNewContext(code,scope);
 const render=()=>{cursor=0;tree=scope.AdministrativeDirectory({section:'equipment',store:{id:'store-a',name:'店'},onSuppliers(){}});find(tree,n=>n.type==='section'&&n.props.ref)[0].props.ref.current={querySelector:selector=>({querySelector:()=>({focus:()=>focus.push(selector)}),scrollIntoView:()=>{}})};while(effects.length)effects.shift()();return tree;};
 const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();render();};
 const invoke=async(fn,...args)=>{await fn(...args);render();await settle();};
 const button=name=>find(tree,n=>n.type==='button'&&label(n)===name)[0];
 const changeYear=value=>invoke(find(tree,n=>n.type==='select'&&n.props['aria-label']==='維修年份')[0].props.onChange,{target:{value}});
 render();
 return {settle,invoke,button,changeYear,calls,focus,get tree(){return tree;},failSave:()=>{failSave=true;}};
}
const ids=h=>find(h.tree,n=>n.type==='tr'&&n.props['data-administrative-id']).map(n=>n.props['data-administrative-id']);

test('vendor directory groups shared sheets and preserves search, order and legacy data when editing',async()=>{
 const source='https://docs.google.com/spreadsheets/d/vendor-sheet/edit#gid=12';
 const link='https://example.com/vendor-file';
 const vendor=(id,name,extra)=>row(id,null,{name,category:'設備資料',...extra});
 const h=harness([
  vendor('ac','泰通空調',{summary:'舊的補充說明\n服務事項：冷氣保養\n電話：0937-089114\n聯絡方式：官方 LINE',note:'有群組',link:source}),
  vendor('other-ac','冷氣行',{summary:'服務事項：冷氣維修',link:source}),
  vendor('water','佳浩',{summary:'服務事項：熱水飲水機',note:'租賃',link}),
 ]);
 await h.settle();
 const columns=find(h.tree,n=>n.type==='th').map(label);
 assert.deepEqual(columns,['廠商','維修／服務事項','聯絡人','電話','LINE／其他','備註','操作']);
 assert.equal(find(h.tree,n=>n.type==='a'&&n.props.href===source).length,1);
 assert.equal(find(h.tree,n=>n.type==='a'&&n.props.href===link).length,1);
 assert.equal(find(h.tree,n=>n.type==='Attachments').length,0);
 const search=()=>find(h.tree,n=>n.type==='input'&&n.props.type==='search')[0];
 const query=value=>h.invoke(search().props.onChange,{target:{value}});
 await query('LINE ０９３７ ０８９１１４');assert.deepEqual(ids(h),['ac']);
 await query('租賃');assert.deepEqual(ids(h),['water']);
 await query('開水機');assert.deepEqual(ids(h),['water']);
 await query('冷氣不冷');assert.deepEqual(ids(h),['ac','other-ac']);
 await h.invoke(h.button('編輯').props.onClick);
 const dialog=()=>find(h.tree,n=>n.type==='WorkspaceEditDialog')[0];
 assert.equal(dialog().props.title,'編輯廠商');
 assert.deepEqual(ids(h),['ac','other-ac']);
 assert.equal(find(h.tree,n=>n.type==='tr'&&n.props.className==='is-editing').length,0);
 assert.equal(h.focus.length,0,'opening a dialog does not scroll the edited row into view');
 const notes=find(h.tree,n=>n.type==='textarea'&&n.props['aria-label']==='泰通空調 備註')[0];
 await h.invoke(notes.props.onChange,{target:{value:'已有群組，先用 LINE 聯絡'}});
 const editor=find(h.tree,n=>n.type==='details'&&label(n.props.children).includes('分類、連結與附件'))[0];
 assert.ok(editor);
 assert.equal(find(h.tree,n=>n.type==='Attachments').length,0,'attachments open only on demand');
 await h.invoke(editor.props.onToggle,{currentTarget:{open:true}});
 assert.equal(find(h.tree,n=>n.type==='Attachments').length,1);
 await h.invoke(h.button('儲存').props.onClick);
 const saved=h.calls.find(c=>c.name==='app_operation').args.p_data.rows[0];
 assert.equal(saved.link,source);assert.equal(saved.note,'已有群組，先用 LINE 聯絡');
 assert.equal(directory.equipmentContact(saved.summary).details,'舊的補充說明');
 assert.equal(search().props.value,'冷氣不冷');assert.deepEqual(ids(h),['ac','other-ac']);
 assert.equal(dialog(),undefined);
});

test('new vendor uses the dialog, keeps failed input visible and discards it when cancelled',async()=>{
 const h=harness([row('ac',null,{name:'泰通空調',category:'設備資料'})]);
 await h.settle();
 await h.invoke(h.button('新增').props.onClick);
 const dialog=()=>find(h.tree,n=>n.type==='WorkspaceEditDialog')[0];
 assert.equal(dialog().props.title,'新增廠商');
 assert.deepEqual(ids(h),['ac']);
 const name=()=>find(dialog(),n=>n.type==='input'&&n.props['aria-label']==='廠商／設備名稱')[0];
 await h.invoke(name().props.onChange,{target:{value:'新廠商'}});
 h.failSave();await h.invoke(h.button('儲存').props.onClick);
 assert.equal(name().props.value,'新廠商');
 assert.equal(label(find(dialog(),n=>n.props.role==='alert')),'讀取逾時');
 await h.invoke(dialog().props.onClose);
 assert.equal(dialog(),undefined);
 assert.deepEqual(ids(h),['ac']);
});

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
