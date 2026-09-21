import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as workflow from '../lib/receipt-workflow.ts';
import * as ledger from '../lib/receipt-ledger.ts';

const compile=source=>ts.transpileModule(source,{fileName:'component.tsx',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
function load(path,modules,globals={}){
 const scope={React,exports:{},structuredClone,console,queueMicrotask,require:name=>{assert.ok(Object.hasOwn(modules,name),`Explicitly mock dependency ${name}`);return modules[name];},...globals};
 runInNewContext(compile(readFileSync(new URL(path,import.meta.url),'utf8')),scope,{timeout:1000});
 return scope.exports;
}
const draftModel=load('../lib/receipt-review-draft.ts',{'./receipt-workflow':workflow});
const field=(row,name,value)=>({id:`${row}-${name}`,row_key:row,field_name:name,value,raw_value:value,review_status:'PENDING',confidence:1,corrected:false,source_region:null});
function fixture(){
 const fields=[field('document','supplier_name','蔬果行'),field('document','receipt_date','115/09/21'),field('document','document_number','INV-001'),field('document','total_inc_tax',150)];
 for(const [row,name,qty,price] of [['row-0','高麗菜',2,30],['row-1','牛奶',3,30]])for(const [key,value] of Object.entries({product:name,specification:'標準',unit:'包',quantity:qty,unit_price_ex_tax:price,subtotal_ex_tax:qty*price,tax:0,total_inc_tax:qty*price}))fields.push(field(row,key,value));
 const mappings=[{row_key:'row-0',product_id:'p0',name:'高麗菜',unit:'包',specification:'標準'},{row_key:'row-1',product_id:'p1',name:'牛奶',unit:'包',specification:'標準'}];
 return {fields,mappings};
}
function elements(tree,predicate){const result=[];function visit(node){if(Array.isArray(node)){node.forEach(visit);return;}if(!React.isValidElement(node))return;if(predicate(node))result.push(node);if(typeof node.type==='function')visit(node.type(node.props));else visit(node.props.children);}visit(tree);return result;}
function textOf(node){if(node===null||node===undefined||typeof node==='boolean')return '';if(Array.isArray(node))return node.map(textOf).join('');return React.isValidElement(node)?textOf(node.props.children):String(node);}

// This hook host executes the real component, its effects and its real event
// handlers. Only I/O is replaced; drafts use the real reconciliation model.
function harness(options={}){
 const snapshot=fixture(),hooks=[],calls=[],events=[],storage=options.storage||new Map(),listeners=new Map();let cursor=0,tree,dirty=false;
 const props={storeId:'store',userId:'reviewer',batchId:'receipt',runId:'ocr-1',fields:structuredClone(snapshot.fields),mappings:structuredClone(snapshot.mappings),chain:false,canReview:true,busy:false,pictures:React.createElement('span',null,'原始貨單'),...options.props};
 const store={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
 const operation={busy:false,error:'',run:async(action,payload)=>{
  calls.push({action,payload:structuredClone(payload)});events.push(`save:${payload.row_key}`);
  const result=options.save?await options.save(action,payload):{saved:true,id:props.batchId,row_key:payload.row_key};
  if(result){for(const change of payload.fields){const f=snapshot.fields.find(field=>field.id===change.id);if(f)f.value=structuredClone(change.value);}if(payload.mapping_mode==='NONE')snapshot.mappings=snapshot.mappings.filter(m=>m.row_key!==payload.row_key);}
  return result;
 },setError:message=>{operation.error=message;dirty=true;}};
 props.onRefresh=async()=>{events.push('refresh');if(options.refresh)return options.refresh();props.fields=structuredClone(snapshot.fields);props.mappings=structuredClone(snapshot.mappings);dirty=true;return {fields:props.fields,mappings:props.mappings};};
 props.onComplete=async()=>{events.push('complete');if(options.complete)return options.complete();};
 const changed=(previous,next)=>!previous||!next||previous.length!==next.length||previous.some((value,index)=>!Object.is(value,next[index]));
 const react={...React,
  useState(initial){const index=cursor++;if(!hooks[index]){hooks[index]={value:typeof initial==='function'?initial():initial};hooks[index].set=next=>{const previous=hooks[index].value;hooks[index].value=typeof next==='function'?next(previous):next;if(!Object.is(previous,hooks[index].value))dirty=true;};}return [hooks[index].value,hooks[index].set];},
  useRef(initial){const index=cursor++;if(!hooks[index])hooks[index]={value:{current:initial}};return hooks[index].value;},
  useEffect(effect,deps){const index=cursor++;const hook=hooks[index]||{};if(changed(hook.deps,deps)){hook.pending=effect;hook.deps=deps;}hooks[index]=hook;},
  useMemo(factory,deps){const index=cursor++;const hook=hooks[index]||{};if(changed(hook.deps,deps)){hook.value=factory();hook.deps=deps;}hooks[index]=hook;return hook.value;},
  useCallback(fn,deps){return react.useMemo(()=>fn,deps);},
 };
 const window={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);},confirm:()=>true};
 const component=load('../app/pilot/receipt-desktop-review.tsx',{
  react,'@/lib/receipt-workflow':workflow,'@/lib/receipt-ledger':ledger,'@/lib/receipt-review-draft':draftModel,
  '@/lib/workspace-storage':{workspaceStorage:()=>store},'./operation-hooks':{useOperation:()=>operation},
  '@/lib/supabase-browser':{supabase:{rpc:async()=>({data:{products:[{id:'p0',name:'高麗菜',base_unit:'包',specification:'標準'}]},error:null})}},
 },{window}).default;
 const render=()=>{let turns=0;do{assert.ok(++turns<40,'Effects must settle without a render loop');dirty=false;cursor=0;tree=component(props);for(const hook of hooks){if(hook.pending){const effect=hook.pending;hook.pending=undefined;hook.cleanup?.();hook.cleanup=effect();}}}while(dirty);return tree;};
 const settle=async()=>{for(let i=0;i<35;i++){await Promise.resolve();if(dirty)render();}render();};
 const invoke=async(fn,...args)=>{await fn(...args);await settle();};
 const findButton=label=>{const found=elements(tree,node=>node.type==='button'&&textOf(node).includes(label));assert.equal(found.length,1,`One button containing ${label}`);return found[0];};
 render();
 return {props,snapshot,calls,events,storage,operation,listeners,render,settle,invoke,findButton,
  get tree(){return tree;},get html(){return renderToStaticMarkup(tree);},
  inputs:()=>elements(tree,node=>node.type==='input'),
  input:label=>{const result=elements(tree,node=>node.type==='input'&&node.props['aria-label']===label);assert.equal(result.length,1,`One input ${label}`);return result[0];},
  click:label=>invoke(findButton(label).props.onClick),
 };
}

test('polling updates clean rows while preserving dirty input and the exact CAS baseline',async()=>{
 const h=harness();await h.settle();
 await h.invoke(h.input('第 1 項 數量').props.onChange,{target:{value:'7'}});
 h.props.fields=h.props.fields.map(f=>({...f,value:f.id==='row-0-quantity'?8:f.id==='row-1-quantity'?9:f.value}));
 h.snapshot.fields=structuredClone(h.props.fields);h.render();await h.settle();
 assert.equal(h.input('第 1 項 數量').props.value,'7');assert.equal(h.input('第 2 項 數量').props.value,'9');
 assert.match(h.html,/原資料已更新/);
 await h.click('儲存修改');
 assert.equal(h.calls.length,1);const payload=h.calls[0].payload;
 assert.equal(payload.fields.find(f=>f.id==='row-0-quantity').old,2);assert.equal(payload.fields.find(f=>f.id==='row-0-quantity').value,7);
 assert.equal(payload.fields.length,8,'The real RPC receives every original row field');assert.equal(payload.previous_product_id,'p0');
});

test('unknown save responses keep dirty rows, stop other saves, and cannot complete the receipt',async()=>{
 const h=harness({save:async()=>undefined});await h.settle();
 await h.invoke(h.input('第 1 項 數量').props.onChange,{target:{value:'7'}});
 await h.invoke(h.input('第 2 項 數量').props.onChange,{target:{value:'9'}});
 await h.click('儲存修改');
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].payload.row_key,'row-0');
 assert.equal(h.input('第 1 項 數量').props.value,'7');assert.equal(h.input('第 2 項 數量').props.value,'9');
 assert.equal(h.findButton('完成資料核對').props.disabled,true);await h.click('完成資料核對');assert.ok(!h.events.includes('complete'));
 const drafts=draftModel.parseReceiptReviewDrafts([...h.storage.values()][0]);
 assert.equal(draftModel.isReceiptReviewDirty(drafts['row-0']),true);assert.equal(drafts['row-0'].acknowledged,false);assert.equal(draftModel.isReceiptReviewDirty(drafts['row-1']),true);
});

test('an unconfirmed save cannot be edited back to its old value and erase the durable retry draft',async()=>{
 const h=harness({save:async()=>undefined});await h.settle();
 await h.invoke(h.input('第 1 項 數量').props.onChange,{target:{value:'7'}});await h.click('儲存修改');
 assert.equal(h.input('第 1 項 數量').props.disabled,true,'Retry or refresh the unresolved write before changing its payload');
 await h.invoke(h.input('第 1 項 數量').props.onChange,{target:{value:'2'}});
 assert.equal(h.input('第 1 項 數量').props.value,'7');
 const mapping=elements(h.tree,node=>node.type==='select'&&node.props['aria-label']==='第 1 項 對應商品')[0];
 assert.equal(mapping.props.disabled,true);await h.invoke(mapping.props.onChange,{target:{value:''}});
 const saved=draftModel.parseReceiptReviewDrafts([...h.storage.values()][0]);assert.equal(saved['row-0'].values['row-0-quantity'],'7');assert.equal(saved['row-0'].mappingMode,'KEEP');
});

test('known save success still blocks completion until a canonical refresh confirms the payload',async()=>{
 const h=harness({refresh:async()=>undefined});await h.settle();
 await h.invoke(h.input('第 1 項 數量').props.onChange,{target:{value:'7'}});await h.click('儲存修改');
 assert.equal(h.calls.length,1);assert.equal(h.input('第 1 項 數量').props.disabled,true);
 assert.equal(h.findButton('完成資料核對').props.disabled,true);await h.click('完成資料核對');assert.ok(!h.events.includes('complete'));
 const drafts=draftModel.parseReceiptReviewDrafts([...h.storage.values()][0]);assert.equal(drafts['row-0'].acknowledged,true);
});

test('saving all dirty rows is sequential, refreshes each baseline, and then enables completion',async()=>{
 const h=harness();await h.settle();
 await h.invoke(h.input('第 1 項 數量').props.onChange,{target:{value:'7'}});
 await h.invoke(h.input('第 2 項 數量').props.onChange,{target:{value:'9'}});
 await h.click('完成資料核對');assert.equal(h.calls.length,0);assert.ok(!h.events.includes('complete'));
 await h.click('儲存修改');
 assert.deepEqual(h.events,['save:row-0','refresh','save:row-1','refresh']);
 assert.equal(h.storage.size,0);assert.equal(h.findButton('完成資料核對').props.disabled,false);
 await h.click('完成資料核對');assert.equal(h.events.at(-1),'complete');
});

test('read-only receipt fields and completion are guarded even if stale event handlers are invoked',async()=>{
 const h=harness({props:{canReview:false}});await h.settle();
 assert.ok(h.inputs().every(input=>input.props.disabled));
 await h.invoke(h.input('第 1 項 數量').props.onChange,{target:{value:'7'}});
 assert.equal(h.input('第 1 項 數量').props.value,'2');
 await h.click('儲存修改');await h.click('完成資料核對');assert.equal(h.calls.length,0);assert.ok(!h.events.includes('complete'));
});

test('invalid numeric input remains editable and cannot trigger saving or completion',async()=>{
 const h=harness();await h.settle();
 await h.invoke(h.input('第 1 項 數量').props.onChange,{target:{value:'not a number'}});
 assert.equal(h.input('第 1 項 數量').props.value,'not a number');assert.equal(h.input('第 1 項 數量').props.disabled,false);
 assert.equal(h.findButton('完成資料核對').props.disabled,true);
 await h.click('儲存修改');await h.click('完成資料核對');assert.equal(h.calls.length,0);assert.ok(!h.events.includes('complete'));
 assert.equal(h.input('第 1 項 數量').props.value,'not a number');
});

test('chain mapping cannot create products and identity edits remove the original mapping',async()=>{
 for(const chain of [false,true]){
  const h=harness({props:{chain}});await h.settle();
  const select=()=>elements(h.tree,node=>node.type==='select'&&node.props['aria-label']==='第 1 項 對應商品')[0];
  assert.equal(elements(select(),node=>node.type==='option'&&node.props.value==='__new').length,chain?0:1);
  if(chain){await h.invoke(select().props.onChange,{target:{value:'__new'}});assert.equal(select().props.value,'p0');}
  await h.invoke(h.input('第 1 項 品名').props.onChange,{target:{value:'更正品名'}});assert.equal(select().props.value,'');
  await h.click('儲存修改');assert.equal(h.calls[0].payload.mapping_mode,'NONE');assert.equal(h.calls[0].payload.previous_product_id,'p0');
 }
});

test('editing another document field preserves raw ROC dates and explicit zero remains distinct from blank',async()=>{
 const h=harness();await h.settle();
 assert.equal(h.input('貨單 日期').props.value,'115/09/21');assert.equal(h.input('貨單 日期').props.type,'text');
 await h.invoke(h.input('貨單 貨單號碼').props.onChange,{target:{value:'INV-002'}});
 await h.invoke(h.input('第 1 項 數量').props.onChange,{target:{value:'0'}});
 await h.invoke(h.input('第 1 項 單價').props.onChange,{target:{value:''}});
 await h.click('儲存修改');
 const document=h.calls.find(call=>call.payload.row_key==='document').payload;
 const date=document.fields.find(f=>f.id==='document-receipt_date');assert.equal(date.old,'115/09/21');assert.equal(date.value,'115/09/21');
 const item=h.calls.find(call=>call.payload.row_key==='row-0').payload;
 assert.equal(item.fields.find(f=>f.id==='row-0-quantity').value,0);assert.equal(item.fields.find(f=>f.id==='row-0-unit_price_ex_tax').value,null);
});

test('calculated subtotal follows current quantity without changing the separately editable original subtotal',async()=>{
 const h=harness();await h.settle();
 assert.equal(h.input('第 1 項 貨單未稅小計').props.value,'60');
 await h.invoke(h.input('第 1 項 數量').props.onChange,{target:{value:'7'}});
 assert.ok(h.html.includes('<td>NT$ 210</td>'));assert.equal(h.input('第 1 項 貨單未稅小計').props.value,'60');
 await h.invoke(h.input('第 1 項 單價').props.onChange,{target:{value:''}});
 assert.ok(h.html.includes('<td>未提供</td>'));assert.equal(h.input('第 1 項 貨單未稅小計').props.value,'60');
});

test('persisted input survives reopening the same receipt without leaking to a different store',async()=>{
 const h=harness();await h.settle();
 await h.invoke(h.input('第 1 項 數量').props.onChange,{target:{value:'7'}});
 const reopened=harness({storage:h.storage});await reopened.settle();
 assert.equal(reopened.input('第 1 項 數量').props.value,'7');assert.match(reopened.html,/已恢復/);
 assert.equal(reopened.findButton('完成資料核對').props.disabled,true);
 const other=harness({storage:h.storage,props:{storeId:'other-store'}});await other.settle();assert.equal(other.input('第 1 項 數量').props.value,'2');
});

test('a row missing from a fresh server snapshot blocks completion while its displayed draft is unresolved',async()=>{
 const h=harness();await h.settle();
 h.props.fields=h.props.fields.filter(field=>field.row_key!=='row-1');h.props.mappings=h.props.mappings.filter(mapping=>mapping.row_key!=='row-1');h.render();await h.settle();
 assert.match(h.html,/辨識資料已更新/);
 assert.equal(h.findButton('完成資料核對').props.disabled,true);
 await h.click('完成資料核對');assert.ok(!h.events.includes('complete'));
});
