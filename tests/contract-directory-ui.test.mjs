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
const initial={id:'lease',name:'店面租賃合約',category:'合約文件',summary:'原始內容\n不可遺失',link:'https://example.com/lease',note:'原備註',archived:false,revision:1};
function harness(){
 let cursor=0,tree;const hooks=[],effects=[],calls=[];let rows=[initial,{...initial,id:'equipment',name:'設備',category:'設備資料'},{...initial,id:'purchase',name:'待購',category:'待購事項'},{...initial,id:'unknown',name:'待確認行政資料',category:'公司與門市'}];
 const scope={React,Fragment:React.Fragment,...admin,...lifecycle,...equipment,crypto,queueMicrotask,Search:'i',Download:'i',Upload:'i',Plus:'i',DirectoryAttachments:'aside',DirectoryLifecycleMenu:'menu',useAttachmentCounts:()=>({}),officeAccess:()=>true,canData:()=>true,canExportData:()=>true,historicalRepair:()=>false,appError:e=>e.message,operationDeadline:fn=>fn(),window:{confirm:()=>true,addEventListener(){},removeEventListener(){}},
 useState:v=>{const k=cursor++;if(!(k in hooks))hooks[k]=typeof v==='function'?v():v;return [hooks[k],v=>hooks[k]=typeof v==='function'?v(hooks[k]):v];},useRef:v=>{const k=cursor++;return hooks[k]||(hooks[k]={current:v});},
 useEffect:(fn,deps)=>{const k=cursor++;if(!hooks[k]||deps.some((d,i)=>d!==hooks[k][i])){hooks[k]=deps;effects.push(fn);}},useCallback:(fn,deps)=>{const k=cursor++;if(!hooks[k]||deps.some((d,i)=>d!==hooks[k].deps[i]))hooks[k]={fn,deps};return hooks[k].fn;},
 supabase:{rpc:(name,args)=>({abortSignal:async()=>{if(name==='app_workspace')return {data:{rows}};calls.push(args);const saved=args.p_data.rows.map(r=>({...r,revision:r.revision+1}));rows=[...rows.filter(r=>!saved.some(s=>s.id===r.id)),...saved];return {data:{rows:saved}};}})}
 };runInNewContext(code,scope);
 function render(){cursor=0;tree=scope.AdministrativeDirectory({store:{id:'store',name:'BeApe'},section:'contracts'});while(effects.length)effects.shift()();return tree;}
 async function settle(){await new Promise(r=>setTimeout(r,0));render();await new Promise(r=>setTimeout(r,0));render();}
 render();return {render,settle,calls,get tree(){return tree;},button:label=>find(tree,n=>n.type==='button'&&text(n)===label)[0],field:label=>find(tree,n=>n.props?.['aria-label']===label)[0]};
}
test('contract details expand inline, custom category saves ownership and preserves legacy content',async()=>{
 const h=harness();await h.settle();assert.equal(find(h.tree,n=>n.props?.className==='contract-detail-row').length,0);
 const toggle=find(h.tree,n=>n.props?.className==='contract-name-toggle')[0];toggle.props.onClick();h.render();assert.equal(find(h.tree,n=>n.props?.className==='contract-detail-row').length,1);assert.ok(text(h.tree).includes(initial.summary));
 h.button('編輯細項').props.onClick();h.render();h.field('店面租賃合約 分類').props.onChange({target:{value:'__new__'}});h.render();h.field('店面租賃合約 新分類名稱').props.onChange({target:{value:'設備保養方案'}});h.render();h.button('加入').props.onClick();h.render();h.field('店面租賃合約 費用與付款').props.onChange({target:{value:'每月付款'}});h.render();h.button('儲存').props.onClick();await h.settle();
 const saved=h.calls[0].p_data.rows[0];assert.equal(saved.directory_section,'contracts');assert.equal(saved.category,'設備保養方案');assert.equal(saved.summary,initial.summary);assert.equal(saved.link,initial.link);assert.equal(saved.note,initial.note);assert.equal(saved.contract_payment,'每月付款');assert.equal(find(h.tree,n=>n.props?.className==='contract-name-toggle').length,1);
 h.button('收合細項').props.onClick();h.render();assert.equal(find(h.tree,n=>n.props?.className==='contract-detail-row').length,0);
 h.button('待分類').props.onClick();h.render();assert.ok(text(h.tree).includes('待確認行政資料'));assert.ok(!text(h.tree).includes('▸待購'));
});
test('custom contract ownership and extra fields survive export-shaped import',()=>{
 const imported=admin.prepareAdministrativeImport([{'資料名稱':'保養契約','資料歸屬':'contracts','分類':'設備保養方案','內容摘要':'完整原文','費用與付款':'年繳','聯絡資訊':'窗口'}],[],()=> 'contract').rows[0];
 assert.equal(admin.documentSection(imported),'contracts');assert.equal(imported.contract_payment,'年繳');assert.equal(imported.contract_contact,'窗口');assert.equal(admin.contractDue({...imported,contract_end:'2026-12-31'},'2026-10-15'),true);
});
