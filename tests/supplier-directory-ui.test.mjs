import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import React from 'react';
import ts from 'typescript';
import * as directory from '../lib/supplier-directory.ts';
import * as lifecycle from '../lib/directory-lifecycle.ts';
import * as categories from '../lib/supplier-categories.ts';
import {safeSupplierLink} from '../lib/supplier-prices.ts';

const source=readFileSync(new URL('../app/pilot/supplier-workspace.tsx',import.meta.url),'utf8');
const code=ts.transpileModule(source.slice(source.indexOf('export default function')).replace('export default ',''),{
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}
}).outputText;
const nodes=node=>Array.isArray(node)?node.flatMap(nodes):node&&typeof node==='object'?[node,...nodes(node.props?.children)]:[];
const text=node=>Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):typeof node==='string'||typeof node==='number'?String(node):'';

const row=(id,name,supplier_category,is_active=true,can_delete=false)=>({id,name,supplier_category,is_active,can_delete,updated_at:'2026-11-12'});
const food=row('food','食材商','食材');
const drink={...row('drink','酒商','酒水'),aliases:['酒水別名']};
const typo=row('typo','誤建供應商','',false,true);
const linked=row('linked','舊合作供應商','耗材',false);

function harness({name='BeApe',editable=true}={}){
 const hooks=[],effects=[],calls=[],reads=[];
 let cursor=0,tree,error='',fail=false;
 let rows=[food,drink,typo,linked];
 const scope={
  React,AbortController,safeSupplierLink,ChevronDown:'i',ChevronRight:'i',Plus:'i',Search:'i',
  ...directory,...categories,...lifecycle,
  officeAccess:()=>true,canData:()=>editable,useAttachmentCounts:()=>({}),
  WorkspaceEditDialog:'WorkspaceEditDialog',DirectoryAttachments:'aside',SupplierIngredientHistory:'aside',
  DirectoryLifecycleMenu:'menu',MobileSupplierDirectory:'mobile',
  receiptRead:(fn,signal)=>fn(signal),
  supabase:{rpc:(_name,args)=>({abortSignal:async()=>{reads.push(args);return {data:{suppliers:rows,editable}};}})},
  useOperation:()=>({error,setError:value=>{error=value;},run:async(action,payload)=>{
   calls.push({action,payload});
   if(fail){error='這筆資料已有關聯或歷史紀錄，無法永久刪除。';return;}
   if(payload.operation==='delete')rows=rows.filter(s=>s.id!==payload.id);
   return {deleted:true};
  }}),
  useState:value=>{
   const i=cursor++;
   if(!(i in hooks))hooks[i]=typeof value==='function'?value():value;
   return [hooks[i],next=>{hooks[i]=typeof next==='function'?next(hooks[i]):next;}];
  },
  useRef:value=>{const i=cursor++;return hooks[i]||(hooks[i]={current:value});},
  useCallback:fn=>fn,
  useEffect:fn=>effects.push(fn),
  window:{confirm:()=>true,addEventListener(){},removeEventListener(){}},
  setInterval:()=>1,clearInterval(){}
 };
 runInNewContext(code,scope);
 const render=()=>{cursor=0;tree=scope.SupplierWorkspace({store:{id:'store',name,role:'OWNER'},userId:'actor',onBack(){}});};
 const settle=async()=>{for(let i=0;i<15;i++)await Promise.resolve();render();};
 render();for(const effect of effects.splice(0))effect();
 return {reads,calls,settle,render,fail:value=>{fail=value;},get tree(){return tree;},
  field:label=>nodes(tree).find(n=>n.props?.['aria-label']===label),
  button:label=>nodes(tree).find(n=>n.type==='button'&&text(n).trim()===label)
 };
}

test('active store appears first and a supplier alias search spans active categories',async()=>{
 for(const [name,label] of [['BeApe','BeApeXGras'],['Gras','GrasXBeApe']]){
  const h=harness({name});await h.settle();
  assert.equal(text(nodes(h.tree).find(n=>n.props?.className==='sd-store-label')),label);
  assert.ok(h.field('查看 食材商'));assert.equal(h.field('查看 酒商'),undefined);
  assert.equal(h.reads[0].p_filter.include_delete_eligibility,true);
  h.field('搜尋供應商、別名或品項').props.onChange({target:{value:'酒水別名'}});h.render();
  assert.ok(h.field('查看 酒商'));assert.equal(h.field('查看 食材商'),undefined);
 }
});

test('disabled list shows every category and the delete confirmation protects linked and read-only rows',async()=>{
 const h=harness();await h.settle();h.button('已停用 2').props.onClick();h.render();
 assert.equal(h.field('供應商分類'),undefined);
 assert.deepEqual(nodes(h.tree).filter(n=>n.type==='th').map(text),['供應商','操作']);
 assert.ok(h.field('查看 舊合作供應商'));assert.equal(h.field('刪除 舊合作供應商'),undefined);
 h.field('刪除 誤建供應商').props.onClick();h.render();
 assert.equal(h.calls.length,0);
 h.button('取消').props.onClick();h.render();assert.equal(h.button('永久刪除'),undefined);
 h.field('刪除 誤建供應商').props.onClick();h.render();
 h.fail(true);h.button('永久刪除').props.onClick();await h.settle();
 assert.match(text(h.tree),/已有關聯或歷史紀錄/);assert.ok(h.button('永久刪除'));
 h.fail(false);h.button('永久刪除').props.onClick();await h.settle();
 assert.equal(h.calls[1].action,'directory.lifecycle');
 assert.equal(h.calls[1].payload.id,'typo');assert.equal(h.calls[1].payload.operation,'delete');
 assert.equal(h.field('刪除 誤建供應商'),undefined);assert.ok(h.field('查看 舊合作供應商'));
 const readOnly=harness({editable:false});await readOnly.settle();
 readOnly.button('已停用 2').props.onClick();readOnly.render();
 assert.equal(readOnly.field('刪除 誤建供應商'),undefined);
 assert.equal(readOnly.field('恢復使用 誤建供應商'),undefined);
});
