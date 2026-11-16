import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {runInNewContext} from 'node:vm';import React from 'react';import ts from 'typescript';
import {inventoryCostRatio} from '../lib/inventory-cost.ts';
import {matchText} from '../lib/receipt-ingredient-matching.ts';
const source=fs.readFileSync(new URL('../app/pilot/receipt-count-candidates.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('x.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),fn=ast.statements.find(n=>ts.isFunctionDeclaration(n));
const code=ts.transpileModule(fn.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];const text=t=>typeof t==='string'?t:Array.isArray(t)?t.map(text).join(''):t?.props?text(t.props.children):'';
function harness({drawer=false}={}){const states=[],refs=[],calls=[];let si=0,ri=0,fail=false,added=0;const data={rows:[{id:'p',name:'牛奶',unit:'瓶',supplier:'甲商',receipt_date:'2026-10-14',revision:'source-revision'}],zones:[{id:'z',name:'冷藏'}],editable:true};const targets=[
 {id:'matched-kg',name:'牛奶',units:['公斤'],supplier:'乙商',code:'F000001',specification:'',can_remember:true,revision:'target-kg'},
 {id:'matched-bottle',name:'鮮牛奶',units:['瓶'],supplier:'甲商',code:'F000002',specification:'',can_remember:true,revision:'target-bottle'},
 ];const scope={exports:{},React,AbortController,matchText,inventoryCostRatio,WorkspaceEditDialog:'WorkspaceEditDialog',crypto:{randomUUID:()=>`req-${calls.length}`},useState:x=>{const i=si++;if(!(i in states))states[i]=x;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useRef:x=>{const i=ri++;return refs[i]||(refs[i]={current:x});},useCallback:f=>f,useEffect(){},receiptCandidateError:()=> '輸入仍保留',receiptCountCandidates:async(store,action,payload,id)=>{if(action==='list')return {...data,rows:[]};if(action==='match-options')return {items:targets};calls.push({store,action,payload,id});if(fail)throw Error('NETWORK');return {saved:true};}};runInNewContext(code,scope);const render=()=>{si=0;ri=0;return scope.ReceiptCountCandidatesNotice({storeId:'s',drawer,onAdded:()=>added++});};render();states[0]=data;states[1]=!drawer;const find=f=>nodes(render()).find(f),button=label=>find(n=>n.type==='button'&&text(n)===label);return {states,calls,render,find,button,fail:v=>fail=v,added:()=>added};}
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
test('candidate selection requires a zone, preserves choices on failure, and retries the same add',async()=>{const x=harness();x.find(n=>n.props?.['aria-label']==='選取 牛奶').props.onChange({target:{checked:true}});assert.equal(x.button('加入盤點').props.disabled,true);x.find(n=>n.type==='select').props.onChange({target:{value:'z'}});x.fail(true);x.button('加入盤點').props.onClick();await settle();assert.deepEqual(Array.from(x.states[2]),['p']);assert.equal(x.added(),0);x.fail(false);x.button('加入盤點').props.onClick();await settle();assert.equal(x.calls[0].id,x.calls[1].id);assert.equal(x.calls[1].payload.zone_id,'z');assert.equal(x.added(),1);assert.equal(x.states[0].rows.length,0);});
test('not needed records a decision without assigning a zone or refreshing count drafts',async()=>{const x=harness();x.find(n=>n.props?.['aria-label']==='選取 牛奶').props.onChange({target:{checked:true}});x.button('不需盤點').props.onClick();await settle();assert.equal(x.calls[0].action,'dismiss');assert.equal(x.calls[0].payload.zone_id,undefined);assert.equal(x.added(),0);assert.equal(x.states[0].rows.length,0);});
test('read-only candidate lists do not expose write actions',()=>{const x=harness();x.states[0]={...x.states[0],editable:false};assert.equal(x.button('加入盤點'),undefined);assert.equal(x.find(n=>n.type==='input'&&n.props.type==='checkbox').props.disabled,true);});

test('desktop drawer has a single trigger and requires a deliberate match selection',async()=>{
 const x=harness({drawer:true});
 const trigger=()=>x.find(n=>n.props?.className==='receipt-count-trigger');
 for(let i=0;i<12;i++)assert.equal(nodes(x.render()).filter(n=>n.props?.className==='receipt-count-trigger').length,1);
 assert.equal(x.find(n=>n.type==='WorkspaceEditDialog'),undefined);
 trigger().props.onClick();
 assert.equal(x.find(n=>n.type==='WorkspaceEditDialog').props.side,true);
 x.find(n=>n.props?.['aria-label']==='配對既有品項 牛奶').props.onClick();
 await settle();
 assert.equal(x.find(n=>n.type==='WorkspaceEditDialog').props.title,'配對既有品項');
 assert.equal(x.button('確認配對').props.disabled,true);
 assert.match(text(x.render()),/同供應商、同單位/);
 x.find(n=>n.type==='input'&&n.props['aria-label']==='牛奶').props.onChange();
 assert.match(text(x.render()),/瓶 → 公斤，換算待核/);
 assert.equal(x.calls.length,0);
 x.fail(true);
 x.button('確認配對').props.onClick();
 await settle();
 assert.equal(x.find(n=>n.type==='input'&&n.props['aria-label']==='牛奶').props.checked,true);
 x.fail(false);
 x.button('確認配對').props.onClick();
 await settle();
 assert.deepEqual(JSON.parse(JSON.stringify(x.calls[1].payload)),{
  source_id:'p',source_revision:'source-revision',target_id:'matched-kg',target_revision:'target-kg',remember:true,
 });
 assert.equal(x.calls[0].id,x.calls[1].id);
 assert.equal(x.added(),1);
 assert.match(text(x.render()),/已配對至「牛奶」。換算待核。/);
 assert.equal(x.find(n=>n.type==='WorkspaceEditDialog').props.title,'待選儲物區');
});

test('desktop pairing can skip remembering the supplier alias',async()=>{
 const x=harness({drawer:true});
 x.find(n=>n.props?.className==='receipt-count-trigger').props.onClick();
 x.find(n=>n.props?.['aria-label']==='配對既有品項 牛奶').props.onClick();
 await settle();
 x.find(n=>n.props?.['aria-label']==='鮮牛奶').props.onChange();
 const control=x.find(n=>n.props?.className==='receipt-count-remember');
 nodes(control).find(n=>n.type==='input').props.onChange({target:{checked:false}});
 x.button('確認配對').props.onClick();
 await settle();
 assert.equal(x.calls[0].payload.remember,false);
 assert.equal(x.calls[0].payload.zone_id,undefined);
 assert.doesNotMatch(text(x.render()),/換算待核/);
});
