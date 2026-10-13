import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import React from 'react';
import ts from 'typescript';
import * as files from '../lib/directory-attachments.ts';
test('attachment type and size validation preserves file identity',async()=>{
 assert.equal(files.attachmentMime({name:'報價.XLSX',size:12}),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 assert.throws(()=>files.attachmentMime({name:'bad.html',size:12}));assert.throws(()=>files.attachmentMime({name:'large.pdf',size:20971521}));
 assert.equal((await files.attachmentHash(new Blob(['a']))).length,64);
});
const raw=readFileSync(new URL('../app/pilot/directory-attachments.tsx',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replaceAll('export function','function');
const code=ts.transpileModule(raw,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
const find=(n,p)=>!n?[]:Array.isArray(n)?n.flatMap(x=>find(x,p)):typeof n!=='object'?[]:[...(p(n)?[n]:[]),...find(n.props?.children,p)];
const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):String(n??'');
function harness(){
 const hooks=[],effects=[],calls=[],stored=new Set(),records=new Map();let cursor=0,tree,fail=true;
 const scope={React,...files,crypto,Event,queueMicrotask,window:{addEventListener(){},removeEventListener(){},dispatchEvent(){},confirm:()=>true},appError:e=>e.message,operationDeadline:fn=>fn(),
 useState:v=>{const k=cursor++;if(!(k in hooks))hooks[k]=v;return [hooks[k],v=>hooks[k]=typeof v==='function'?v(hooks[k]):v];},useRef:v=>{const k=cursor++;return hooks[k]||(hooks[k]={current:v});},
 useCallback:(fn,deps)=>{const k=cursor++;if(!hooks[k]||deps.some((d,i)=>d!==hooks[k].deps[i]))hooks[k]={fn,deps};return hooks[k].fn;},
 useEffect:(fn,deps)=>{const k=cursor++;if(!hooks[k]||deps.some((d,i)=>d!==hooks[k][i])){hooks[k]=deps;effects.push(fn);}},
 supabase:{rpc:(_name,args)=>({abortSignal:async()=>{const d=args.p_data;calls.push(d);if(d.operation==='list')return {data:[...records.values()].filter(r=>r.ready_at&&!r.removed_at)};
 if(d.operation==='prepare'){const id=args.p_request_id;if(!records.has(id))records.set(id,{id,filename:d.name,mime:d.mime,byte_size:d.size,storage_path:id,ready_at:null});return {data:{...records.get(id),stored:stored.has(id)}};}
 if(d.operation==='complete'){const r=records.get(d.id);if(r.filename==='second.pdf'&&fail){fail=false;return {error:Error('暫時中斷')};}r.ready_at='now';return {data:r};}
 if(d.operation==='remove'){records.get(d.id).removed_at='now';return {data:{}};}
 } }),storage:{from:()=>({upload:async(path)=>{calls.push({operation:'upload',path});stored.add(path);return {};},createSignedUrls:async(paths)=>({data:paths.map(path=>({path,signedUrl:'https://example.invalid/'+path}))})})}}
 };
 runInNewContext(code,scope);const render=()=>{cursor=0;tree=scope.DirectoryAttachments({storeId:'store',kind:'document',targetId:'doc',editable:true,expanded:true});while(effects.length)effects.shift()();};
 const settle=async()=>{for(let i=0;i<25;i++){await new Promise(r=>setImmediate(r));render();}};render();return {settle,calls,records,get tree(){return tree;}};
}
test('partial upload retry does not upload a second copy and removal preserves other attachments',async()=>{
 const h=harness();await h.settle();const picker=find(h.tree,n=>n.type==='input'&&n.props.multiple)[0];
 picker.props.onChange({target:{files:[new File(['one'],'first.pdf'),new File(['two'],'second.pdf')],value:'selected'}});await h.settle();
 assert.equal(h.calls.filter(c=>c.operation==='upload').length,2);assert.equal([...h.records.values()].filter(r=>r.ready_at).length,1);
 const retry=find(h.tree,n=>n.type==='button'&&text(n).startsWith('重試未完成'))[0];assert.ok(retry);retry.props.onClick();await h.settle();
 assert.equal(h.calls.filter(c=>c.operation==='upload').length,2);assert.equal(h.records.size,2);assert.equal([...h.records.values()].filter(r=>r.ready_at).length,2);
 find(h.tree,n=>n.type==='button'&&text(n)==='移除')[0].props.onClick();await h.settle();assert.equal([...h.records.values()].filter(r=>!r.removed_at).length,1);
 assert.ok(h.calls.filter(c=>c.kind).every(c=>c.target==='doc'&&c.kind==='document'));
});
