import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import React from 'react';
import ts from 'typescript';
import {coalescedRead} from '../lib/coalesced-read.ts';
import {operationDeadline} from '../lib/operation-deadline.ts';
const source=readFileSync(new URL('../app/pilot/ingredient-prices-workspace.tsx',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default function','function');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
const flush=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
const find=(n,p)=>!n?[]:Array.isArray(n)?n.flatMap(x=>find(x,p)):typeof n!=='object'?[]:[...(p(n)?[n]:[]),...find(n.props?.children,p)];
const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):String(n??'');
test('a committed save remains successful when refresh fails, and the previous catalog stays visible',async()=>{
 const hooks=[],effects=[],calls=[];let i=0,readCount=0;
 const catalog={ingredients:[{id:'saved'}],can_price:true};
 const useMemo=(fn,deps)=>{const k=i++,old=hooks[k];if(!old||deps.some((d,j)=>d!==old.deps[j]))hooks[k]={value:fn(),deps};return hooks[k].value;};
 const scope={React,coalescedRead,operationDeadline,emptyPriceSheet:{ingredients:[]},IngredientPriceSheet:'Sheet',ArrowLeft:'Arrow',canExportData:()=>true,appError:e=>String(e),document:{visibilityState:'visible'},window:{addEventListener(){},removeEventListener(){}},setInterval:()=>1,clearInterval(){},
 useState:v=>{const k=i++;if(!(k in hooks))hooks[k]=v;return [hooks[k],v=>{hooks[k]=v;}];},useRef:v=>{const k=i++;return hooks[k]||(hooks[k]={current:v});},useMemo,useCallback:(fn,deps)=>useMemo(()=>fn,deps),useEffect:fn=>{i++;effects.push(fn);},
 supabase:{auth:{getUser:async()=>({data:{user:{id:'u'}}})},rpc:(_name,args)=>{calls.push(args.p_action);const p=Promise.resolve(args.p_action==='read'?(++readCount===1?{data:catalog}:{error:Error('57014 timeout')}):{data:{ok:true}});p.abortSignal=()=>p;return p;}}};
 runInNewContext(code,scope);
 const render=()=>{i=0;return scope.IngredientSession({store:{id:'s',role:'OWNER',name:'店'},onBack(){}});};
 render();const cleanup=effects[0]();await flush();
 const sheet=find(render(),n=>n.type==='Sheet')[0];assert.equal(sheet.props.data,catalog);
 await sheet.props.save('save',{id:'saved'},'request');await flush();
 const tree=render();assert(text(tree).includes('修改已儲存'));assert.equal(find(tree,n=>n.type==='Sheet')[0].props.data,catalog);assert.equal(calls.filter(x=>x==='save').length,1);cleanup();
});
