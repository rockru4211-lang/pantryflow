import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import React from 'react';
import ts from 'typescript';
import * as admin from '../lib/administrative-directory.ts';
import * as lifecycle from '../lib/directory-lifecycle.ts';
import * as equipment from '../lib/equipment-selection.ts';
const raw=readFileSync(new URL('../app/pilot/administrative-directory.tsx',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default function','function');
const code=ts.transpileModule(raw,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
const find=(n,p)=>!n?[]:Array.isArray(n)?n.flatMap(x=>find(x,p)):typeof n!=='object'?[]:[...(p(n)?[n]:[]),...find(n.props?.children,p)];
const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):String(n??'');
const initial={id:'lease',name:'店面租賃合約',category:'合約文件',summary:'原始內容\n不可遺失',link:'https://example.com/lease',note:'原備註',contract_end:'2020-01-31',notified_at:'2019-10-31T08:00:00Z',archived:false,revision:1};
function harness(){
 let cursor=0,tree;const hooks=[],effects=[],calls=[];let rows=[initial,{...initial,id:'equipment',name:'設備',category:'設備資料'},{...initial,id:'purchase',name:'待購',category:'待購事項'},{...initial,id:'unknown',name:'待確認行政資料',category:'公司與門市'}];
 const scope={React,Fragment:React.Fragment,...admin,...lifecycle,...equipment,crypto,queueMicrotask,Search:'i',ChevronDown:'i',ChevronRight:'i',Download:'i',Upload:'i',Plus:'i',WorkspaceEditDialog:'WorkspaceEditDialog',DirectoryAttachments:'aside',DirectoryLifecycleMenu:'menu',useAttachmentCounts:()=>({}),officeAccess:()=>true,canData:()=>true,canExportData:()=>true,historicalRepair:()=>false,appError:e=>e.message,operationDeadline:fn=>fn(),window:{confirm:()=>true,addEventListener(){},removeEventListener(){}},
 useState:v=>{const k=cursor++;if(!(k in hooks))hooks[k]=typeof v==='function'?v():v;return [hooks[k],v=>hooks[k]=typeof v==='function'?v(hooks[k]):v];},useRef:v=>{const k=cursor++;return hooks[k]||(hooks[k]={current:v});},
 useEffect:(fn,deps)=>{const k=cursor++;if(!hooks[k]||deps.some((d,i)=>d!==hooks[k][i])){hooks[k]=deps;effects.push(fn);}},useCallback:(fn,deps)=>{const k=cursor++;if(!hooks[k]||deps.some((d,i)=>d!==hooks[k].deps[i]))hooks[k]={fn,deps};return hooks[k].fn;},
 supabase:{rpc:(name,args)=>({abortSignal:async()=>{if(name==='app_workspace')return {data:{rows}};calls.push(args);if(args.p_action==='directory.lifecycle'){
 const outcome={contract_nonrenewed_at:'2026-11-11T09:00:00Z',contract_nonrenewal_reason:args.p_data.reason};
 rows=rows.map(r=>r.id===args.p_data.id?{...r,...outcome,archived:true,revision:r.revision+1}:r);
 return {data:outcome};
 }const saved=args.p_data.rows.map(r=>({...r,revision:r.revision+1}));rows=[...rows.filter(r=>!saved.some(s=>s.id===r.id)),...saved];return {data:{rows:saved}};}})}
 };runInNewContext(code,scope);
 function render(){cursor=0;tree=scope.AdministrativeDirectory({store:{id:'store',name:'BeApe'},section:'contracts'});while(effects.length)effects.shift()();return tree;}
 async function settle(){await new Promise(r=>setTimeout(r,0));render();await new Promise(r=>setTimeout(r,0));render();}
 render();return {render,settle,calls,get tree(){return tree;},button:label=>find(tree,n=>n.type==='button'&&text(n)===label)[0],field:label=>find(tree,n=>n.props?.['aria-label']===label)[0]};
}
test('contract details open in the shared side panel and editing preserves legacy content',async()=>{
 const h=harness();await h.settle();
 assert.deepEqual(find(h.tree,n=>n.type==='th').map(text),['合約名稱','分類','到期日','狀態','操作']);
 h.field('查看 店面租賃合約').props.onClick();h.render();
 const panel=find(h.tree,n=>n.type==='WorkspaceEditDialog')[0];
 assert.equal(panel.props.side,true);assert.equal(panel.props.title,initial.name);
 assert.ok(text(panel).includes(initial.summary));assert.ok(!text(panel).includes('費用與付款'));
 h.button('編輯合約').props.onClick();h.render();
 assert.equal(find(h.tree,n=>n.type==='WorkspaceEditDialog')[0].props.title,'編輯合約');
 assert.equal(find(h.tree,n=>n.type==='tr'&&n.props.className==='is-editing').length,0);
 h.field('店面租賃合約 分類').props.onChange({target:{value:'__new__'}});h.render();
 h.field('店面租賃合約 新分類名稱').props.onChange({target:{value:'維修紀錄'}});h.render();
 h.button('加入').props.onClick();h.render();
 h.field('店面租賃合約 備註').props.onChange({target:{value:'每月付款'}});h.render();
 h.button('儲存').props.onClick();await h.settle();
 const saved=h.calls[0].p_data.rows[0];
 assert.equal(saved.directory_section,'contracts');assert.equal(saved.category,'維修紀錄');
 assert.equal(saved.summary,initial.summary);assert.equal(saved.link,initial.link);assert.equal(saved.note,'每月付款');
 assert.ok(h.field('查看 店面租賃合約'));assert.equal(find(h.tree,n=>n.type==='WorkspaceEditDialog').length,0);
 assert.equal(h.button('完成維修'),undefined);
 h.button('待分類').props.onClick();h.render();
 assert.ok(text(h.tree).includes('待確認行政資料'));assert.ok(!text(h.tree).includes('待購'));
});

test('confirming nonrenewal moves the same contract to completed and keeps dates and reminder history',async()=>{
 const h=harness();await h.settle();
 assert.ok(h.button('即將到期 1'));assert.ok(h.button('已結束'));
 h.field('查看 店面租賃合約').props.onClick();h.render();
 h.button('標記不續約').props.onClick();h.render();
 assert.ok(text(h.tree).includes(initial.contract_end));
 h.field('不續約原因').props.onChange({target:{value:'停止使用'}});h.render();
 find(h.tree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});
 await h.settle();
 const call=h.calls[0];
 assert.equal(call.p_action,'directory.lifecycle');
 assert.equal(call.p_data.operation,'nonrenew');assert.equal(call.p_data.id,initial.id);
 assert.equal(call.p_data.revision,initial.revision);assert.equal(call.p_data.reason,'停止使用');
 assert.equal(h.button('已結束').props['aria-pressed'],true);assert.ok(h.button('即將到期 0'));
 const panel=find(h.tree,n=>n.type==='WorkspaceEditDialog')[0];
 assert.ok(text(panel).includes('不續約紀錄'));assert.ok(text(panel).includes('停止使用'));
 assert.ok(text(panel).includes('已通知'));assert.ok(text(panel).includes(initial.contract_end));
 assert.ok(text(panel).includes(initial.note));assert.equal(h.button('標記不續約'),undefined);
});

test('custom contract ownership and extra fields survive export-shaped import',()=>{
 const imported=admin.prepareAdministrativeImport([{'資料名稱':'保養契約','資料歸屬':'contracts','分類':'設備保養方案','內容摘要':'完整原文','費用與付款':'年繳','聯絡資訊':'窗口'}],[],()=> 'contract').rows[0];
 assert.equal(admin.documentSection(imported),'contracts');assert.equal(imported.contract_payment,'年繳');assert.equal(imported.contract_contact,'窗口');assert.equal(admin.contractDue({...imported,contract_end:'2026-12-31'},'2026-10-15'),true);
});

test('exported completed statuses stay archived when imported as new contracts',()=>{
 const rows=admin.prepareAdministrativeImport([
  {'資料名稱':'已結束合約','資料歸屬':'contracts','分類':'合約文件','狀態':'已結束'},
  {'資料名稱':'不續約合約','資料歸屬':'contracts','分類':'合約文件','狀態':'不續約'},
 ],[],()=>crypto.randomUUID()).rows;
 assert.equal(rows.length,2);
 assert.ok(rows.every(row=>row.archived));
});

test('compact notes preserve legacy payment content, deduplicate identical blocks and handle empty fields',()=>{
 const row={summary:'原合約內容',note:'原合約內容',contract_payment:'每月付款'};assert.equal(admin.contractNotes(row),'原合約內容\n\n每月付款');assert.equal(row.note,'原合約內容');assert.equal(admin.contractNotes({summary:'',note:'',contract_payment:''}),'');
});

test('contract ordering puts due items first and missing dates last',()=>{
 const today='2026-11-11';
 const candidates=[{...initial,contract_end:null},{...initial,contract_end:'2027-08-01'},
  {...initial,contract_end:'2026-12-27'},{...initial,contract_end:'2026-10-31'}];
 assert.deepEqual(candidates.sort((a,b)=>admin.compareContracts(a,b,today)).map(r=>r.contract_end),
  ['2026-10-31','2026-12-27','2027-08-01',null]);
});
