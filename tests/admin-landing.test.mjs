import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

const path='../app/pilot/authenticated-workspace.tsx';
const source=ts.createSourceFile(path,readFileSync(new URL(path,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const component=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='WorkspaceContent');
const names=['receivingHome','landingOnReceiving','view'];
const declarations=component.body.statements.filter(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>names.includes(d.name.getText(source))));
const setter=component.body.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='setView');
const compile=code=>ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const store={role:'LOGISTICS',business_type:'SINGLE_RESTAURANT',access_mode:'EDIT',is_active:true};
function route({desktop=true,selectedStore=store,storedView='home'}={}) {
 const context={desktop,selectedStore,storedView,isStoreReadOnly:s=>s.access_mode==='VIEW'};
 runInNewContext(compile(declarations.map(n=>n.getText(source)).join('\n')+'\nglobalThis.result={view,receivingHome,landingOnReceiving};'),context);
 return context.result;
}
test('desktop admin opens receiving from saved home and preserves a saved working page',()=>{
 assert.equal(route().view,'receiving');
 assert.equal(route({storedView:'administrative'}).view,'administrative');
 assert.equal(route({storedView:'finance-accounts'}).view,'finance-accounts');
});
test('other roles, mobile and archived or read-only stores keep their home',()=>{
 for(const options of [{desktop:false},{selectedStore:null},...['OWNER','STAFF','SUPERVISOR'].map(role=>({selectedStore:{...store,role}})),{selectedStore:{...store,business_type:'CHAIN_RESTAURANT'}},{selectedStore:{...store,access_mode:'VIEW'}},{selectedStore:{...store,is_active:false}}]) {
  assert.equal(route(options).view,'home');
 }
});
test('returning home clears stale receipt detail and filters; other navigation preserves them',()=>{
 const writes=[];
 const context={receivingHome:true,setReceiptBatchId:v=>writes.push(['batch',v]),setReceiptStartPage:v=>writes.push(['page',v]),setReceiptSupplierNames:v=>writes.push(['suppliers',v.length]),setFieldReceipt:v=>writes.push(['field',v]),setEntryRevision:fn=>writes.push(['revision',fn(4)]),setStoredView:v=>writes.push(['view',v])};
 runInNewContext(compile(setter.getText(source)),context);
 context.setView('home');
 assert.deepEqual(writes,[['batch',undefined],['page','list'],['suppliers',0],['field',false],['revision',5],['view','home']]);
 writes.length=0;context.setView('suppliers');assert.deepEqual(writes,[['view','suppliers']]);
 writes.length=0;context.receivingHome=false;context.setView('home');assert.deepEqual(writes,[['view','home']]);
});
