import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {recoveryJournal,recoveryKey,recoveryError,definitiveOperationFailure} from '../lib/operation-recovery.ts';
import {validWasteRecovery,confirmedWasteReceipt} from '../lib/waste-recovery.ts';
import {validSpotRecovery} from '../lib/spot-recovery.ts';
const storage=()=>{const map=new Map();return {map,getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
const key=recoveryKey('staff','beape','waste');
const receipt={id:'waste-1',type:'WASTE'};
const draft={page:'waste-new',fields:{name:'奶油',quantity:'0.125',unit:'公斤',reason:'品質異常',note:'早班'},item:null,risk:null,riskWaste:false,openedAt:1};
const pending={id:'request-1',action:'WASTE',payload:{name:'奶油',quantity:'0.125',unit:'公斤'},origin:'waste'};
const snapshot={draft,pending,completed:null};
const compile=code=>ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
const ast=ts.createSourceFile('waste.tsx',readFileSync(new URL('../app/pilot/expiry-waste-workspace.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const component=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ExpiryWasteWorkspace');
function handler(name,scope){const node=component.body.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(node);runInNewContext(compile(node.getText(ast)),scope);return scope[name];}
function wasteHarness({store=storage(),sender=async()=>({data:receipt,error:null}),restored=false}={}){
 const journal=recoveryJournal(store,key,validWasteRecovery),calls=[],accepted=[],errors=[];
 const scope={Error,crypto:{randomUUID:()=> 'request-new'},lock:{current:false},request:{current:restored?journal.value?.pending:null},journal:{current:journal},draftRef:{current:journal.value?.draft||draft},page:'waste-new',storeId:'beape',setBusy:()=>{},setMessage:v=>errors.push(v),setUncertain:()=>{},setStorageProblem:()=>{},setRestoredFields:()=>{},setResult:v=>accepted.push(v),operationDeadline:run=>run(new AbortController().signal),confirmedWasteReceipt,definitiveOperationFailure,recoveryError,expiryError:()=> '請重試',window:{dispatchEvent:()=>{}},Event,changed:'changed',refresh:()=>{},supabase:{rpc:(name,args)=>({abortSignal:async()=>{calls.push(JSON.parse(JSON.stringify(args)));return sender(args);}})}};
 const save=handler('save',scope);return {scope,store,calls,accepted,errors,save};
}
test('recovery keys isolate user, store and workflow; corrupt storage is never silently reset',()=>{
 assert.notEqual(key,recoveryKey('other','beape','waste'));assert.notEqual(key,recoveryKey('staff','gras','waste'));assert.notEqual(key,recoveryKey('staff','beape','spot'));
 const s=storage();s.setItem(key,'broken');assert.throws(()=>recoveryJournal(s,key,validWasteRecovery));assert.equal(s.getItem(key),'broken');
});
test('journal survives reload, detects competing tabs and verifies writes actually persisted',()=>{
 const s=storage(),one=recoveryJournal(s,key,validWasteRecovery),two=recoveryJournal(s,key,validWasteRecovery);one.write(snapshot);
 assert.deepEqual(recoveryJournal(s,key,validWasteRecovery).value,snapshot);assert.throws(()=>two.write(null),/RECOVERY_CHANGED/);
 const broken={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};assert.throws(()=>recoveryJournal(broken,key,validWasteRecovery).write(snapshot),/RECOVERY_UNAVAILABLE/);
});
test('waste timeout and reopening retry the same immutable request, never edited input',async()=>{
 const first=wasteHarness({sender:async()=>{throw Error('network lost');}});await first.save('WASTE',pending.payload,()=>assert.fail());
 const saved=recoveryJournal(first.store,key,validWasteRecovery).value;assert.ok(saved.pending);assert.equal(first.accepted.length,0);
 const reopened=wasteHarness({store:first.store,restored:true});let done=0;await reopened.save('WASTE',{name:'不可替換',quantity:99},()=>done++);
 assert.deepEqual(reopened.calls[0],first.calls[0]);assert.equal(done,1);assert.equal(reopened.scope.request.current,null);
 assert.deepEqual(recoveryJournal(first.store,key,validWasteRecovery).value.completed.receipt,receipt);
});
test('waste double click sends only one request and null/truncated replies are never acknowledged',async()=>{
 let complete;const h=wasteHarness({sender:()=>new Promise(resolve=>complete=resolve)});const first=h.save('WASTE',pending.payload,()=>{});await h.save('WASTE',pending.payload,()=>assert.fail());assert.equal(h.calls.length,1);complete({data:null,error:null});await first;assert.equal(h.accepted.length,0);assert.ok(h.scope.request.current);
});
test('pre-send storage failure sends nothing; failed receipt persistence retains original request for retry',async()=>{
 const pre=wasteHarness();pre.scope.journal.current.write=()=>{throw Error('RECOVERY_UNAVAILABLE');};await pre.save('WASTE',pending.payload,()=>assert.fail());assert.equal(pre.calls.length,0);
 const s=storage();let writes=0;const original=s.setItem;s.setItem=(k,v)=>{if(++writes===2)throw Error('full');original(k,v);};
 const post=wasteHarness({store:s});await post.save('WASTE',pending.payload,()=>assert.fail());assert.equal(post.calls.length,1);assert.equal(post.accepted.length,0);assert.ok(recoveryJournal(s,key,validWasteRecovery).value.pending);
});
test('server validation permits corrections, but request reuse conflicts retain the exact request',async()=>{
 for(const [error,retained] of [[{code:'22023',message:'INVALID_QUANTITY'},false],[{code:'P0001',message:'REQUEST_REUSED'},true]]){
  const h=wasteHarness({sender:async()=>({error,data:null})});await h.save('WASTE',pending.payload,()=>assert.fail());assert.equal(!!h.scope.request.current,retained);assert.equal(!!recoveryJournal(h.store,key,validWasteRecovery).value.pending,retained);
 }
});
test('waste recovery restores input and pending request without sending, and receipts reopen as completed',async()=>{
 const effect=component.body.statements.find(n=>ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(ast)==='useEffect'&&n.getText(ast).includes('validWasteRecovery'));
 const callback=effect.expression.arguments[0].getText(ast);
 for(const saved of [snapshot,{draft:null,pending:null,completed:{receipt,origin:'waste'}}]){
  const s=storage();recoveryJournal(s,key,validWasteRecovery).write(saved);const values={};
  const scope={queueMicrotask,workspaceStorage:()=>s,recoveryJournal,recoveryKey,validWasteRecovery,recoveryError,userId:'staff',storeId:'beape',initialRecordId:null,initialPage:'waste',journal:{current:null},draftRef:{current:null},request:{current:null}};
  for(const name of ['RestoredFields','Name','Unit','Item','Risk','RiskWaste','FormOpenedAt','Page','Message','Uncertain','Result','CompletionOrigin','StorageProblem'])scope['set'+name]=v=>values[name]=v;
  runInNewContext(compile(`const restore=${callback};restore();`),scope);await Promise.resolve();
  if(saved.pending){assert.equal(values.Page,'waste-new');assert.equal(values.Name,'奶油');assert.equal(values.RestoredFields.quantity,'0.125');assert.deepEqual(scope.request.current,pending);assert.equal(values.Uncertain,true);}
  else{assert.equal(values.Page,'complete');assert.deepEqual(values.Result,receipt);}
 }
});
test('spot draft preserves zero, blanks and notes; invalid snapshots cannot become confirmed receipts',()=>{
 const v={draft:{id:'check',revision:2,values:{one:'0',two:''},notes:{one:'盤空',two:'尚未盤'}},pending:{action:'save_entries',data:{id:'check',request_id:'retry-1',revision:2,entries:[]}}};
 const s=storage(),k=recoveryKey('staff','beape','spot');recoveryJournal(s,k,validSpotRecovery).write(v);assert.deepEqual(recoveryJournal(s,k,validSpotRecovery).value,v);
 assert.equal(validSpotRecovery({...v,pending:{action:'unknown',data:{}}}),false);assert.equal(confirmedWasteReceipt({}),false);assert.equal(confirmedWasteReceipt(null),false);
});

test('spot reopening restores local quantities and notes, but blocks autosave over a newer shared revision',async()=>{
 const file=ts.createSourceFile('spot.tsx',readFileSync(new URL('../app/pilot/spot-check-workspace.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const fn=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='SpotCheckWorkspace');
 const effect=fn.body.statements.find(n=>ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(file)==='useEffect'&&n.getText(file).includes('validSpotRecovery'));
 for(const newer of [false,true]){
  const s=storage(),k=recoveryKey('staff','beape','spot');const saved={draft:{id:'check',revision:2,values:{one:'0',two:''},notes:{one:'盤空',two:'尚未盤'}},pending:null};recoveryJournal(s,k,validSpotRecovery).write(saved);
  const values={},scope={queueMicrotask,recoveryJournal,recoveryKey,validSpotRecovery,recoveryError,workspaceStorage:()=>s,userId:'staff',store:{id:'beape'},initialId:null,journal:{current:null},detailSequence:{current:0},pending:{current:null},valuesRef:{current:{}},notesRef:{current:{}},dirtyRef:{current:false},recoveryConflict:{current:false},spotError:()=> '錯誤',accept:()=>{},rpc:async()=>({id:'check',store_id:'beape',revision:newer?3:2,items:[]})};
  for(const name of ['Uncertain','Notice','Values','Notes','Dirty','Error','Loading'])scope['set'+name]=v=>values[name]=v;
  runInNewContext(compile(`const restore=${effect.expression.arguments[0].getText(file)};restore();`),scope);for(let i=0;i<5;i++)await Promise.resolve();
  assert.deepEqual(values.Values,saved.draft.values);assert.deepEqual(values.Notes,saved.draft.notes);assert.equal(scope.dirtyRef.current,true);assert.equal(scope.recoveryConflict.current,newer);assert.equal(values.Loading,false);assert.deepEqual(recoveryJournal(s,k,validSpotRecovery).value,saved);
 }
});
