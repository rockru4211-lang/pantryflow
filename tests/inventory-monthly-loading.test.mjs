import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {receiptRead} from '../lib/receipt-read.ts';
import {inventoryError} from '../lib/inventory-monthly.ts';

const source=readFileSync(new URL('../app/pilot/inventory-monthly-workspace.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('inventory.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function nodes(predicate){const found=[];function visit(node){if(predicate(node))found.push(node);ts.forEachChild(node,visit);}visit(ast);return found;}
function harness(timeout=12000){
 const state={data:null,error:'',loading:true},calls=[];
 let response=()=>Promise.resolve({data:{month:'2026-09-01'},error:null});
 const scope={state,store:{id:'beape'},month:'2026-09',source:'',custody:false,working:{current:false},editorRef:{current:null},readFlight:{current:null},request:{current:0},document:{visibilityState:'visible'},AbortController,inventoryError,dateLabel:value=>value,
  receiptRead:(run,signal)=>receiptRead(run,signal,timeout),
  setData:value=>state.data=value,setError:value=>state.error=value,setLoading:value=>state.loading=value,setLastRead:()=>{},
  supabase:{rpc:(_name,args)=>{calls.push(args);return {abortSignal:signal=>response(signal),then:(resolve,reject)=>response().then(resolve,reject)};}}
 };
 for(const name of ['fetchMonth','read']){
  const declaration=nodes(n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)[0];
  const callback=declaration.initializer.arguments[0].getText(ast);
  runInNewContext(ts.transpileModule(`globalThis.${name}=${callback};`,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,scope);
 }
 return {state,calls,scope,respond:fn=>{response=fn;},read:(quiet=false)=>scope.read(quiet)};
}
const flush=async()=>{for(let n=0;n<12;n++)await Promise.resolve();};

test('slow inventory read survives two polling ticks without overlap or starvation',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const h=harness();let finish;
 h.respond(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=h.read();await flush();
 t.mock.timers.tick(5000);await h.read(true);
 t.mock.timers.tick(5000);await h.read(true);
 assert.equal(h.calls.length,1);
 finish({data:{month:'2026-09-01',rows:['期初']},error:null});await pending;
 assert.deepEqual(h.state.data.rows,['期初']);assert.equal(h.state.loading,false);
});

test('unresponsive read times out, retains previous data and allows retry',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const h=harness();h.state.data={rows:['retained']};let signal;
 h.respond(s=>{signal=s;return new Promise(()=>{});});
 const pending=h.read();await flush();t.mock.timers.tick(12000);await pending;
 assert.equal(signal.aborted,true);assert.equal(h.state.loading,false);
 assert.match(h.state.error,/讀取逾時/);assert.deepEqual(h.state.data.rows,['retained']);
 h.respond(()=>Promise.resolve({data:{rows:['fresh']},error:null}));await h.read();
 assert.equal(h.state.error,'');assert.deepEqual(h.state.data.rows,['fresh']);
});

test('manual retry cancels old read; its cleanup cannot release the newer request',async()=>{
 const h=harness();let finishOld,finishNew,oldSignal;
 h.respond(signal=>{oldSignal=signal;return new Promise(resolve=>{finishOld=resolve;});});
 const old=h.read();await flush();
 h.respond(()=>new Promise(resolve=>{finishNew=resolve;}));
 const newer=h.read();await flush();await old;
 assert.equal(oldSignal.aborted,true);assert.ok(h.scope.readFlight.current);
 await h.read(true);assert.equal(h.calls.length,2);
 finishNew({data:{rows:['new']},error:null});await newer;
 finishOld({data:{rows:['old']},error:null});await flush();
 assert.deepEqual(h.state.data.rows,['new']);assert.equal(h.state.error,'');
});

test('month cleanup prevents obsolete results and editing suppresses background reads',async()=>{
 const h=harness();let finish;
 h.respond(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=h.read();await flush();
 const effect=nodes(n=>ts.isCallExpression(n)&&n.expression.getText(ast)==='useEffect'&&n.arguments[1]?.getText(ast)==='[read]')[0];
 const listeners={addEventListener(){},removeEventListener(){}};
 Object.assign(h.scope,{setTimeout:()=>1,setInterval:()=>2,clearTimeout(){},clearInterval(){},window:listeners});
 Object.assign(h.scope.document,listeners);
 const cleanup=runInNewContext(ts.transpileModule(`(${effect.arguments[0].getText(ast)})();`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,h.scope);
 cleanup();await pending;finish({data:{rows:['old store']},error:null});await flush();
 assert.equal(h.state.data,null);assert.equal(h.state.error,'');
 h.scope.editorRef.current={dirty:true,price:'123'};await h.read(true);
 assert.equal(h.calls.length,1);assert.equal(h.scope.editorRef.current.price,'123');
});

test('review writes are not aborted or timed out by the read helper',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const h=harness();let finish,finished=false;
 h.respond(()=>new Promise(resolve=>{finish=resolve;}));
 const mutation=h.scope.fetchMonth('review',{unit_price:123}).then(()=>{finished=true;});await flush();
 t.mock.timers.tick(20000);await flush();assert.equal(finished,false);assert.equal(h.calls.length,1);
 finish({data:{revision:2},error:null});await mutation;assert.equal(finished,true);
});
