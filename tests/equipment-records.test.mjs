import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import React from 'react';
import ts from 'typescript';
import * as records from '../lib/equipment-records.ts';
import * as selection from '../lib/equipment-selection.ts';
import {repairLocalTime} from '../lib/equipment-workflow.ts';
import {validateAdministrativeRows} from '../lib/administrative-directory.ts';
const year=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}).slice(0,4);
const doc=(id,extra={})=>({id,name:'洗碗機',category:'維修紀錄',repair_date:`${year}-01-01`,repair_reason:'脫膠',repair_result:'',summary:'維修廠商：承泰',link:'https://example.com/source',note:'保留備註',archived:false,revision:3,...extra});
test('combined records retain unknown historical state, remove mirrors and inactive docs, and preserve notes on completion',()=>{
 const legacy=doc('old');const job={id:'job',name:'冷藏冰箱',created_at:`${year}-02-01T23:00:00Z`,vendor:'廠商',problem:'不冷',last_report:'',status:'QUOTE',events:[]};
 const list=records.equipmentRecords([job],[legacy,doc('job'),doc('removed',{is_removed:true}),doc('inactive',{archived:true}),doc('mirror',{category:'報修項目'})]);
 assert.deepEqual(list.map(r=>r.id),['job','old']);assert.equal(list[0].date,`${year}-02-02`);assert.equal(list[1].status,'HISTORY');
 const saved=records.saveLegacyRepair(legacy,{name:'洗碗機',vendor:'承泰',problem:'脫膠',result:'補膠試機正常',status:'DONE',date:legacy.repair_date,completed:`${year}-10-13`});
 assert.equal(saved.id,legacy.id);assert.equal(saved.revision,3);assert.equal(saved.link,legacy.link);assert.equal(saved.note,legacy.note);assert.equal(saved.repair_date,legacy.repair_date);assert.equal(records.equipmentRecords([],[saved])[0].status,'DONE');assert.equal(records.equipmentRecords([],[saved])[0].completed,`${year}-10-13`);
});
const source=readFileSync(new URL('../app/pilot/equipment-records.tsx',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default function','function');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
const find=(n,p)=>!n?[]:Array.isArray(n)?n.flatMap(x=>find(x,p)):typeof n!=='object'?[]:[...(p(n)?[n]:[]),...find(n.props?.children,p)];
const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):String(n??'');
function harness({initialDocs=[],initialJobs=[],failReport=false,office=true,mobileMode=false}={}){
 const hooks=[],effects=[],calls=[];let cursor=0,tree,seq=0,docs=initialDocs,jobs=initialJobs;
 const scope={React,Fragment:React.Fragment,...records,...selection,repairLocalTime,validateAdministrativeRows,DirectoryAttachments:'Attachments',AdministrativeDirectory:'Directory',useAttachmentCounts:()=>({}),Plus:'Icon',Search:'Icon',canData:()=>true,officeAccess:()=>office,appError:e=>e.message,operationDeadline:fn=>fn(undefined),crypto:{randomUUID:()=>`id-${++seq}`},queueMicrotask,setInterval:()=>1,clearInterval(){},window:{confirm:()=>true,addEventListener(){},removeEventListener(){}},
 useState:v=>{const i=cursor++;if(!(i in hooks))hooks[i]=typeof v==='function'?v():v;return [hooks[i],next=>hooks[i]=typeof next==='function'?next(hooks[i]):next];},useRef:v=>{const i=cursor++;return hooks[i]||(hooks[i]={current:v});},
 useCallback:(fn,deps)=>{const i=cursor++;if(!hooks[i]||deps.some((d,j)=>d!==hooks[i].deps[j]))hooks[i]={fn,deps};return hooks[i].fn;},useEffect:(fn,deps)=>{const i=cursor++;if(!hooks[i]||deps.some((d,j)=>d!==hooks[i][j])){hooks[i]=deps;effects.push(fn);}},
 supabase:{rpc:(name,args)=>({abortSignal:async()=>{calls.push({name,args});if(name==='app_workspace')return {data:{rows:docs}};if(name==='app_operation'){const saved=args.p_data.rows.map(r=>({...r,revision:r.revision+1}));docs=[...docs.filter(r=>!saved.some(s=>s.id===r.id)),...saved];return {data:{rows:saved}};}
 const d=args.p_data,a=args.p_action;if(a==='list')return {data:{jobs}};
 if(a==='report'&&failReport){failReport=false;return {error:Error('暫時中斷')};}
 let job=jobs.find(j=>j.id===d.id);if(a==='create')job={...d,status:'PENDING',created_at:`${year}-10-14T00:00:00Z`,last_report:'',revision:1,events:[]};else if(a==='report')job={...job,status:d.status,last_report:d.body,report_date:d.report_date,revision:job.revision+1};else if(a==='plan')job={...job,vendor:d.vendor,scheduled_at:d.scheduled_at,status:'PENDING',revision:job.revision+1};
 jobs=[job,...jobs.filter(j=>j.id!==job.id)];return {data:{job}};
 }})}};
 runInNewContext(code,scope);const render=()=>{cursor=0;tree=scope.EquipmentRecords({mobileMode,store:{id:'store',name:'二店'},onSuppliers(){}});while(effects.length)effects.shift()();};const settle=async()=>{for(let i=0;i<25;i++)await Promise.resolve();render();};const invoke=async(fn,...args)=>{await fn(...args);render();await settle();};
 render();return {settle,invoke,calls,get tree(){return tree;},button:t=>find(tree,n=>n.type==='button'&&text(n)===t)[0],input:t=>find(tree,n=>['input','select','textarea'].includes(n.type)&&n.props?.['aria-label']===t)[0],submit:()=>invoke(find(tree,n=>n.type==='form')[0].props.onSubmit,{preventDefault(){}})};
}
test('one entry lists history, prefills vendor, retries quote without duplicate create, and completes same job',async()=>{
 const h=harness({initialDocs:[doc('history'),doc('supplier',{name:'承泰',category:'設備資料',summary:'服務事項：洗碗機/洗杯機'})],failReport:true});await h.settle();
 assert.ok(text(h.tree).includes('歷史紀錄'));assert.deepEqual(find(h.tree,n=>n.type==='nav'&&n.props['aria-label']==='設備管理分頁').flatMap(n=>find(n,c=>c.type==='button')).map(text),['維修紀錄','廠商','已停用','已移除']);
 await h.invoke(h.button('新增維修').props.onClick);await h.invoke(h.input('設備名稱').props.onChange,{target:{value:'洗碗機'}});assert.equal(h.input('維修廠商').props.value,'承泰');await h.invoke(h.input('維修狀態').props.onChange,{target:{value:'QUOTE'}});await h.submit();assert.ok(text(h.tree).includes('暫時中斷'));assert.ok(h.button('儲存紀錄'));await h.submit();
 const writes=h.calls.filter(c=>c.name==='equipment_workflow'&&c.args.p_action!=='list');assert.equal(writes.filter(c=>c.args.p_action==='create').length,1);const reports=writes.filter(c=>c.args.p_action==='report');assert.equal(reports.length,2);assert.equal(reports[0].args.p_request_id,reports[1].args.p_request_id);
 const id=writes[0].args.p_data.id;const tr=find(h.tree,n=>n.type==='tr'&&n.props['data-repair-id']===id)[0];await h.invoke(find(tr,n=>n.type==='button'&&text(n)==='完成維修')[0].props.onClick);await h.invoke(h.input('處理結果').props.onChange,{target:{value:'更換膠條，試機正常'}});await h.invoke(h.input('完成日期').props.onChange,{target:{value:`${year}-10-12`}});await h.submit();const completed=h.calls.filter(c=>c.args.p_action==='report').at(-1).args.p_data;assert.equal(completed.id,id);assert.equal(completed.status,'DONE');assert.equal(completed.report_date,`${year}-10-12`);assert.ok(text(h.tree).includes('更換膠條，試機正常'));
 await h.invoke(h.button('廠商').props.onClick);const directory=find(h.tree,n=>n.type==='Directory')[0];assert.equal(directory.props.initialCategory,'全部');assert.equal(directory.props.embeddedDirectory,true);
});
test('completing a legacy record preserves identity, original date and source instead of creating a workflow duplicate',async()=>{
 const h=harness({initialDocs:[doc('old',{repair_date:`${year}-10-14`})]});await h.settle();await h.invoke(h.button('完成維修').props.onClick);await h.invoke(h.input('處理結果').props.onChange,{target:{value:'維修完成'}});await h.submit();const saved=h.calls.find(c=>c.name==='app_operation').args.p_data.rows[0];assert.equal(saved.id,'old');assert.equal(saved.repair_date,`${year}-10-14`);assert.equal(saved.link,'https://example.com/source');assert.equal(h.calls.filter(c=>c.args.p_action==='create').length,0);
});
test('field desktop access can report but cannot create office repair jobs',async()=>{const h=harness({office:false});await h.settle();assert.equal(h.button('新增維修'),undefined);});

test('mobile combines both record sources by year without a separate history entrance and reports on the original record',async()=>{
 const h=harness({mobileMode:true,initialDocs:[doc('old'),doc('prior',{repair_date:'2020-01-01'})],initialJobs:[{id:'job',name:'冰箱',created_at:`${year}-02-01T00:00:00Z`,status:'QUOTE',events:[]}]});await h.settle();
 assert.deepEqual(find(h.tree,n=>n.type==='article').map(n=>n.props['data-repair-id']),['job','old']);assert.equal(h.button('舊維修紀錄'),undefined);assert.equal(h.button('新增維修'),undefined);assert.equal(h.button('廠商'),undefined);assert.equal(find(h.tree,n=>n.type==='table').length,0);
 await h.invoke(h.input('維修年份').props.onChange,{target:{value:'2020'}});assert.deepEqual(find(h.tree,n=>n.type==='article').map(n=>n.props['data-repair-id']),['prior']);
 assert.equal(h.button('回報進度'),undefined);assert.ok(text(h.tree).includes('歷史紀錄'));assert.equal(h.calls.filter(c=>c.name==='app_operation').length,0);
});

test('old records show history without completion or pending filters, retaining edit and attachments',async()=>{
 const h=harness({initialDocs:[doc('old',{summary:'維修廠商：承泰\n維修狀態：PENDING',repair_date:'2026-10-13'})]});await h.settle();
 assert.equal(h.button('完成維修'),undefined);assert.ok(h.button('編輯'));assert.ok(text(h.tree).includes('歷史紀錄'));
 await h.invoke(h.button('待處理').props.onClick);assert.equal(find(h.tree,n=>n.type==='tr'&&n.props['data-repair-id']==='old').length,0);
});
test('history cutoff is fixed and respects Taipei midnight without claiming completion',()=>{
 assert.equal(records.recordOnlyRepair({date:'2026-10-13'}),true);
 assert.equal(records.recordOnlyRepair({date:'2026-10-14'}),false);
 assert.equal(records.recordOnlyRepair({date:'2026-10-15'}),false);
 assert.equal(records.recordOnlyRepair({date:''}),false);
 const r=records.equipmentRecords([{id:'j',created_at:'2026-10-13T16:00:00Z',status:'PENDING'}],[])[0];
 assert.equal(records.recordOnlyRepair(r),false);assert.equal(r.status,'PENDING');assert.equal(r.completed,'');
});
test('desktop editing stays beneath its own row and survives filtering without discarding input',async()=>{
 const h=harness({initialDocs:[doc('inline',{repair_date:'2026-10-11'})]});await h.settle();await h.invoke(h.button('編輯').props.onClick);
 const editorRows=find(h.tree,n=>n.type==='tr'&&n.props.className==='repair-inline-editor');
 assert.equal(editorRows.length,1);assert.equal(find(editorRows[0],n=>n.type==='form').length,1);
 await h.invoke(h.input('設備名稱').props.onChange,{target:{value:'編輯中的設備'}});
 await h.invoke(h.input('維修年份').props.onChange,{target:{value:'2020'}});
 assert.equal(h.input('設備名稱').props.value,'編輯中的設備');
 assert.equal(find(h.tree,n=>n.type==='form').length,1);
 await h.submit();assert.equal(h.calls.find(c=>c.name==='app_operation').args.p_data.rows[0].name,'編輯中的設備');
});
