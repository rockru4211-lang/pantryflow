import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import React from 'react';
import ts from 'typescript';
import {usageNamesError} from '../lib/ingredient-usage-names.ts';
const source=readFileSync(new URL('../app/pilot/ingredient-name-editor.tsx',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default function','function');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
const find=(n,p)=>!n?[]:Array.isArray(n)?n.flatMap(x=>find(x,p)):typeof n!=='object'?[]:[...(p(n)?[n]:[]),...find(n.props?.children,p)];
const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):String(n??'');
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const initial={id:'ingredient',code:'F000001',formal_name:'鐵塔鮮奶油 1L',count_name:'鐵塔鮮奶油',recipe_aliases:['鮮奶油'],revision:2,products:[{id:'p',name:'原盤點名稱',code:'P001'}],bindings:[],suppliers:[{id:'supplier',name:'A供應商',stopped:true,supply_revision:4}]};
function harness(){
 const hooks=[],effects=[],calls=[];let i=0,saved=0,fail=false,ids=0;
 const scope={React,usageNamesError,AbortSignal,AbortController,crypto:{randomUUID:()=>`request-${++ids}`},
  useState:v=>{const k=i++;if(!(k in hooks))hooks[k]=v;return [hooks[k],v=>{hooks[k]=typeof v==='function'?v(hooks[k]):v;}];},
  useRef:v=>{const k=i++;return hooks[k]||(hooks[k]={current:v});},useEffect:fn=>{i++;effects.push(fn);},
  supabase:{rpc:(_name,args)=>{calls.push(args);const p=Promise.resolve(args.p_data?(fail?{error:{message:'REVISION_CONFLICT'}}:{data:initial}):{data:structuredClone(initial)});p.abortSignal=()=>p;return p;}}};
 runInNewContext(code,scope);
 const render=()=>{i=0;return scope.IngredientNameEditor({storeId:'store',ingredientId:'ingredient',onClose(){},onSaved(){saved++;}});};
 render();const cleanup=effects[0]();
 return {render,cleanup,calls,fail:v=>fail=v,get saved(){return saved;}};
}
test('editor loads classified names, keeps the fixed code read-only and carries supplier status revisions',async()=>{
 const h=harness();await flush();let tree=h.render();
 assert(text(tree).includes('F000001'));assert(text(tree).includes('已對應盤點：原盤點名稱'));
 assert.equal(find(tree,n=>n.type==='input'&&n.props.value==='F000001').length,0);
 find(tree,n=>n.type==='button'&&text(n)==='＋ 新增對應')[0].props.onClick();tree=h.render();
 find(tree,n=>n.type==='select'&&n.props['aria-label']==='第 1 筆供應商')[0].props.onChange({target:{value:'supplier'}});tree=h.render();
 find(tree,n=>n.type==='input'&&n.props['aria-label']==='第 1 筆貨單名稱')[0].props.onChange({target:{value:'A進貨名稱'}});tree=h.render();
 find(tree,n=>n.type==='button'&&text(n)==='儲存')[0].props.onClick();await flush();
 const b=h.calls.at(-1).p_data.bindings[0];assert.equal(b.supplier_id,'supplier');assert.equal(b.stopped,true);assert.equal(b.supply_revision,4);assert.equal(h.saved,1);h.cleanup();
});
test('failed save retains typed aliases and reuses the request identity until input changes',async()=>{
 const h=harness();await flush();let tree=h.render();
 find(tree,n=>n.type==='input'&&n.props['aria-label']==='新增食譜別名')[0].props.onChange({target:{value:'打發奶油'}});
 h.fail(true);tree=h.render();find(tree,n=>n.type==='button'&&text(n)==='儲存')[0].props.onClick();await flush();
 tree=h.render();assert.equal(h.saved,0);assert.equal(find(tree,n=>n.type==='input'&&n.props['aria-label']==='新增食譜別名')[0].props.value,'打發奶油');
 assert(text(tree).includes('輸入仍保留'));const first=h.calls.at(-1);assert(first.p_data.recipe_aliases.includes('打發奶油'));
 h.fail(false);find(tree,n=>n.type==='button'&&text(n)==='儲存')[0].props.onClick();await flush();
 assert.equal(h.calls.at(-1).p_request_id,first.p_request_id);assert.equal(h.saved,1);h.cleanup();
});
