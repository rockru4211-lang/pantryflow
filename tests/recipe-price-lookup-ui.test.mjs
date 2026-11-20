import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{runInNewContext}from'node:vm';import ts from'typescript';
import * as model from'../lib/recipe-cost.ts';import * as lookup from'../lib/recipe-price-lookup.ts';
function harness(apply=true){
 const slots=[],effects=[],timers=[],requests=[],applied=[];let cursor=0,closed=0;
 const react={useState(value){const i=cursor++;if(!(i in slots))slots[i]=typeof value==='function'?value():value;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useEffect(fn,deps){const i=cursor++;if(!slots[i]||deps.some((v,n)=>!Object.is(v,slots[i].deps[n]))){const old=slots[i];effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});}}};
 const quote={key:'n:餐用油',name:'餐用油',product_id:null,unit:'g',price:.1,purchase:{amount:300,quantity:1,unit:'桶',content_quantity:3000,content_unit:'g'},source:'請購表',supplier_name:'A廠商',source_kind:'purchase',effective_date:'2026-11-19'};
 const props={storeId:'s',line:{id:'a',name:'餐用油',unit:'g',quantity:'15'},sourceText:'',workspace:{recipes:[],products:[],prices:[quote],can_price:true},onApply:d=>{applied.push(d);return apply;},onClose:()=>closed++};
 const runtime={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
 const scope={exports:{},Intl,AbortSignal,AbortController,setTimeout(fn){const timer={fn,active:true};timers.push(timer);return timer;},clearTimeout(timer){timer.active=false;},require(name){
  if(name==='react')return react;if(name==='react/jsx-runtime')return runtime;if(name==='@/lib/recipe-cost')return model;if(name==='@/lib/recipe-price-lookup')return lookup;
  if(name==='@/lib/operation-deadline')return {operationDeadline:fn=>fn(new AbortController().signal)};
  if(name==='@/lib/supabase-browser')return {supabase:{rpc:(_name,args)=>({abortSignal:signal=>new Promise(resolve=>requests.push({args,signal,resolve}))})}};
  if(name==='./recipe-modal')return {default:'dialog'};if(name.endsWith('.css'))return {};throw Error(name);
 }};
 runInNewContext(ts.transpileModule(readFileSync(new URL('../app/pilot/recipe-price-lookup.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,scope);
 return {props,requests,applied,get closed(){return closed;},render(){cursor=0;const tree=scope.exports.default(props);effects.splice(0).forEach(fn=>fn());return tree;},fire(){timers.splice(0).filter(t=>t.active).forEach(t=>t.fn());}};
}
const nodes=n=>Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...nodes(n.props?.children)]:[];
const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):String(n??'');
const button=(tree,label)=>nodes(tree).find(n=>n.type==='button'&&text(n)===label);
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('lookup starts no writes, stages the chosen source on explicit apply, and handles storage failure',async()=>{
 for(const success of [true,false]){
  const h=harness(success);let tree=h.render();assert.equal(h.applied.length,0);
  const radio=nodes(tree).find(n=>n.props?.role==='radio');radio.props.onClick();tree=h.render();assert.match(text(tree),/成本 \$1.5/);
  assert.equal(button(tree,'帶入這筆價格').props.disabled,false);button(tree,'帶入這筆價格').props.onClick();tree=h.render();
  assert.equal(h.applied.length,1);assert.equal(h.applied[0].purchase,undefined);assert.equal(h.applied[0].amount,'300');assert.equal(h.applied[0].supplierName,'A廠商');
  assert.equal(h.closed,success?1:0);if(!success)assert.match(text(tree),/草稿未能保留/);
 }
 const h=harness();const tree=h.render();button(tree,'取消').props.onClick();assert.equal(h.closed,1);assert.equal(h.applied.length,0);
});
test('query changes abort stale reads and late results cannot replace the new query',async()=>{
 const h=harness();let tree=h.render();h.fire();assert.equal(h.requests[0].args.p_query,'餐用油');
 nodes(tree).find(n=>n.props?.['aria-label']==='搜尋食譜價格').props.onChange({target:{value:'新食材'}});tree=h.render();h.fire();assert.equal(h.requests[0].signal.aborted,true);
 h.requests[1].resolve({data:[],error:null});await settle();tree=h.render();assert.match(text(tree),/沒有符合的價格/);
 h.requests[0].resolve({data:[{name:'餐用油',quote:{reference_id:'old',source:'進貨',basis:'receipt',purchase:{amount:99,quantity:1,unit:'g'}}}],error:null});await settle();tree=h.render();assert.doesNotMatch(text(tree),/\$99/);
});
test('supplier/source filters invalidate hidden selections and pending references never become zero-price choices',()=>{
 const h=harness();h.props.workspace.price_references=[{key:'n:餐用油',name:'餐用油',unit:'g',price:0,source:'歷史食譜',source_kind:'history',review_status:'pending',reference_id:'pending'}];
 let tree=h.render();assert.equal(nodes(tree).filter(n=>n.props?.role==='radio'&&n.props.disabled).length,1);
 nodes(tree).find(n=>n.props?.role==='radio'&&!n.props.disabled).props.onClick();tree=h.render();
 nodes(tree).find(n=>n.props?.['aria-label']==='價格來源').props.onChange({target:{value:'history'}});tree=h.render();assert.equal(button(tree,'帶入這筆價格').props.disabled,true);
});
