import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {matchesReceiptLedgerStatus,selectedReceiptLedgerRows,receiptSubtotal,receiptDetailPage,receiptBatchesWithoutLedger} from '../lib/receipt-ledger.ts';
import {numericFields} from '../lib/receipt-workflow.ts';

const source=readFileSync(new URL('../app/pilot/receiving-workspace.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('receiving.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const workspace=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='ReceivingWorkspace');
const compile=code=>ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React},fileName:'receiving.tsx'}).outputText;
const draftScope={exports:{},structuredClone,require:name=>{assert.equal(name,'./receipt-workflow');return {numericFields};}};
runInNewContext(compile(readFileSync(new URL('../lib/receipt-review-draft.ts',import.meta.url),'utf8')),draftScope);
const draftModel=draftScope.exports;
function handler(name,scope){const node=workspace.body.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(node,`Missing real handler ${name}`);runInNewContext(compile(node.getText(ast)),scope);return scope[name];}
function nodes(predicate){const result=[];function visit(node){if(predicate(node))result.push(node);ts.forEachChild(node,visit);}visit(ast);return result;}
function initializer(name){for(const statement of workspace.body.statements){if(!ts.isVariableStatement(statement))continue;const declaration=statement.declarationList.declarations.find(node=>node.name.getText(ast)===name);if(declaration?.initializer)return declaration.initializer;}throw Error(`Missing initializer ${name}`);}
const row=(batch_id,row_key='1')=>({batch_id,row_key,run_id:`run-${batch_id}`,status:'PENDING',review_allowed:true});

function confirmHarness(selected){
 const sent=[];const messages=[];const current=[row('chosen'),row('chosen','2'),row('unrelated')];
 const storage={getItem:()=>null};
 const scope={ledgerError:'',loading:false,pendingLedger:current,selectedLedgerRows:current.filter(r=>selected.includes(r.batch_id)),ledger:current,selectedLedgerBatchIds:selected,userId:'reviewer',storeId:'store',workspaceStorage:()=>storage,hasStoredReceiptDraft:draftModel.hasStoredReceiptDraft,setSelectedLedgerBatchIds:()=>{},setMessage:text=>messages.push(text),act:fn=>fn(),refresh:async()=>{},supabase:{rpc:async(name,args)=>{sent.push({name,args});return {data:{confirmed:args.p_rows.length,failed_count:0},error:null};}}};
 return {sent,messages,scope,run:()=>handler('confirmLedger',scope)()};
}
test('bulk confirmation sends only the explicitly selected whole receipt, including its other lines',async()=>{
 const h=confirmHarness(['chosen']);await h.run();assert.equal(h.sent.length,1);assert.deepEqual(Array.from(h.sent[0].args.p_rows,r=>`${r.batch_id}:${r.row_key}`),['chosen:1','chosen:2']);
});
test('bulk confirmation cannot confirm anything without an explicit selection',async()=>{
 const h=confirmHarness([]);await h.run();assert.equal(h.sent.length,0);assert.match(h.messages[0],/選取/);
});
test('bulk confirmation refuses selected receipts with a local unsaved draft before making any write',async()=>{
 const h=confirmHarness(['chosen']);const checked=[];
 const initial=draftModel.createReceiptReviewDraft({batchId:'chosen',runId:'run-chosen',row:'1',fields:[{id:'quantity',row_key:'1',field_name:'quantity',value:2}]});
 const draft=draftModel.updateReceiptReviewField(initial,'quantity','3');
 const key=draftModel.receiptReviewDraftStorageKey('reviewer','store','chosen','run-chosen');
 const storage={getItem:name=>name===key?draftModel.serializeReceiptReviewDrafts({'1':draft}):null};h.scope.workspaceStorage=user=>{assert.equal(user,'reviewer');return storage;};
 h.scope.hasStoredReceiptDraft=(...args)=>{checked.push(args);return draftModel.hasStoredReceiptDraft(...args);};
 await h.run();
 assert.equal(h.sent.length,0);assert.match(h.messages[0],/未儲存/);
 assert.deepEqual(checked,[[storage,'reviewer','store','chosen','run-chosen']]);
});
test('bulk confirmation fails closed if the local draft state cannot be read',async()=>{
 const h=confirmHarness(['chosen']);h.scope.workspaceStorage=()=>{throw Error('STORAGE_UNAVAILABLE');};
 await h.run();assert.equal(h.sent.length,0);assert.match(h.messages[0],/無法確認本機草稿/);
});
test('the missing-data metric selects the missing-data filter rather than all statuses',()=>{
 const button=nodes(n=>ts.isJsxElement(n)&&n.openingElement.tagName.getText(ast)==='button'&&n.children.some(c=>c.getText(ast).includes('<small>待補資料</small>')))[0];
 const click=button.openingElement.attributes.properties.find(a=>a.name?.getText(ast)==='onClick').initializer.expression;
 let filter;runInNewContext(compile(`(${click.getText(ast)})();`),{setLedgerFilter:value=>filter=value,changeLedgerFilter:value=>filter=value});assert.equal(filter,'NEEDS_MAPPING');
});
test('changing the status filter clears the previous whole-receipt selection',()=>{
 let selection=['chosen'],filter='PENDING';
 handler('changeLedgerFilter',{setSelectedLedgerBatchIds:value=>selection=value,setLedgerFilter:value=>filter=value})('NEEDS_MAPPING');
 assert.equal(selection.length,0);assert.equal(filter,'NEEDS_MAPPING');
});
test('whole-receipt selection explicitly includes sibling lines, never another or invisible receipt',()=>{
 const chosen=row('chosen'),sibling=row('chosen','2'),unrelated=row('unrelated');
 const ledger=[chosen,sibling,unrelated];
 assert.deepEqual(selectedReceiptLedgerRows(ledger,[chosen],['chosen','unrelated']),[chosen,sibling]);
 assert.deepEqual(selectedReceiptLedgerRows(ledger,[unrelated],['chosen']),[]);
 assert.deepEqual(selectedReceiptLedgerRows([{...chosen,status:'COMPLETE'},{...sibling,review_allowed:false},{...unrelated,run_id:null}],ledger,['chosen','unrelated']),[]);
});
test('missing-data filter excludes already completed and ordinary pending rows',()=>{
 const states=['PENDING','NEEDS_MAPPING','COMPLETE'];
 assert.deepEqual(states.filter(s=>matchesReceiptLedgerStatus(s,'NEEDS_MAPPING')),['NEEDS_MAPPING']);
 assert.deepEqual(states.filter(s=>matchesReceiptLedgerStatus(s,'PENDING')),['PENDING','NEEDS_MAPPING']);
});
test('subtotal distinguishes an unknown quantity or price from a genuine zero',()=>{
 for(const missing of [null,undefined,'','  ',NaN,Infinity,{},false]){
  assert.equal(receiptSubtotal(2,missing),null);assert.equal(receiptSubtotal(missing,30),null);
 }
 assert.equal(receiptSubtotal(0,30),0);assert.equal(receiptSubtotal(2,0),0);assert.equal(receiptSubtotal('2.5','30'),75);
 const desktopSource=readFileSync(new URL('../app/pilot/receipt-desktop-review.tsx',import.meta.url),'utf8');
 const desktopAst=ts.createSourceFile('receipt-desktop-review.tsx',desktopSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let lineRenderer;
 function visit(node){if(ts.isArrowFunction(node)&&ts.isBlock(node.body)&&node.body.statements.some(statement=>ts.isVariableStatement(statement)&&statement.declarationList.declarations.some(declaration=>declaration.name.getText(desktopAst)==='subtotal')))lineRenderer=node;ts.forEachChild(node,visit);}
 visit(desktopAst);assert.ok(lineRenderer,'Exercise the current desktop row renderer, not the removed modal table');
 for(const [quantity,price,expected] of [['2','','未提供'],['','30','未提供'],['0','30','NT$ 0'],['2.5','30','NT$ 75']]){
  const snapshot=[{id:'q',field_name:'quantity'},{id:'p',field_name:'unit_price_ex_tax'}];
  const scope={React,receiptSubtotal,drafts:{'1':{snapshot,values:{q:quantity,p:price}}},columns:['quantity','unit_price_ex_tax'],input:()=>null,rowStatus:()=>null,mapping:()=>null,ReceiptDesktopRow:({fields,details})=>React.createElement(React.Fragment,null,fields,details)};
  const view=runInNewContext(compile(`(${lineRenderer.getText(desktopAst)})('1',0);`),scope);
  assert.ok(renderToStaticMarkup(view).includes(`<td>${expected}</td>`),`Rendered subtotal for ${quantity || 'blank'} × ${price || 'blank'}`);
 }
});
test('opening a stale completed ledger row waits for authoritative detail before any completion screen',()=>{
 const pages=[];const initialRoute={current:''};
 const scope={setBatchSource:()=>{},setLoading:()=>{},setMessage:()=>{},setDetail:()=>{},setBatchId:()=>{},setPage:p=>pages.push(p),initialRoute};
 handler('openLedger',scope)({...row('chosen'),status:'COMPLETE'});
 assert.deepEqual(pages,['status']);assert.equal(initialRoute.current,'chosen');
 const partial={batch:{status:'REVIEWING'},review_allowed:true,run:{status:'SUCCEEDED'},receipt:null,review:{saved_rows:['1'],complete:false}};
 assert.equal(receiptDetailPage(partial),'review');
 assert.equal(receiptDetailPage({...partial,review:{complete:true}}),'published');
 assert.equal(receiptDetailPage({...partial,run:{status:'RUNNING'}}),'status');
 assert.equal(receiptDetailPage({...partial,review_allowed:false}),'status');
});
test('pending batches without OCR lines stay reachable while completed or already listed batches are omitted',()=>{
 const batches=[{id:'queued',status:'UPLOADED'},{id:'failed',status:'OCR_FAILED'},{id:'listed',status:'REVIEWING'},{id:'done',status:'COMPLETED'},{id:'saved',status:'REVIEWING',review_saved:true}];
 assert.deepEqual(receiptBatchesWithoutLedger(batches,[{batch_id:'listed'}]).map(b=>b.id),['queued','failed']);
});
test('an OCR status page exposes a working review action after recognition succeeds',()=>{
 const expression=nodes(n=>ts.isJsxExpression(n)&&n.expression?.getText(ast).startsWith('canReview&&action(')&&n.expression.getText(ast).includes('開始核對'))[0].expression;
 const pages=[];const scope={canReview:true,fieldRole:false,action:(label,onClick)=>({label,onClick}),setPage:p=>pages.push(p)};
 const button=runInNewContext(compile(`(${expression.getText(ast)});`),scope);
 assert.equal(button.label,'開始核對');button.onClick();assert.deepEqual(pages,['review']);
 assert.equal(runInNewContext(compile(`(${expression.getText(ast)});`),{...scope,canReview:false}),false);
});
test('CSV export uses the shared safe writer and only the visible ledger scope',async()=>{
 const exported=[];
 const scope={ledgerError:'',loading:false,visibleLedger:[{...row('chosen'),product_name:'=1+1',supplier_name:'供應商甲',quantity:2,unit_price:null,subtotal:null}],receiptDate:()=> '2026/09/21',setMessage:()=>{},exportRowsFile:async(...args)=>exported.push(args)};
 await handler('exportLedger',scope)('csv');
 assert.equal(exported.length,1);assert.equal(exported[0][0].length,1);assert.equal(exported[0][0][0]['品名'],'=1+1');assert.equal(exported[0][1],'csv');
 const reportSource=readFileSync(new URL('../app/pilot/reports-workspace.tsx',import.meta.url),'utf8');
 const reportAst=ts.createSourceFile('reports.tsx',reportSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const writer=reportAst.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='exportRows');
 let blob;
 const writerScope={exports:{},require:createRequire(import.meta.url),Blob,URL:{createObjectURL:value=>{blob=value;return 'blob:csv';},revokeObjectURL:()=>{}},document:{createElement:()=>({click:()=>{},remove:()=>{}}),body:{appendChild:()=>{}}},setTimeout:()=>{}};
 runInNewContext(compile(writer.getText(reportAst)),writerScope);
 await writerScope.exportRows(exported[0][0],'csv','test');
 const bytes=new Uint8Array(await blob.arrayBuffer());assert.deepEqual([...bytes.slice(0,3)],[239,187,191]);
 const csv=await blob.text();assert.match(csv,/供應商甲/);assert.match(csv,/'=1\+1/);assert.ok(!csv.startsWith('\\ufeff'));
});

function refreshHarness({batchId='',fieldRole=false}={}){
 const calls=[];const state={batches:[],ledger:[row('stale')],selected:['stale'],detail:null,ledgerError:'',message:'保留原操作訊息',loading:true};
 const batch={id:'chosen',store_id:'store',status:'REVIEWING'};
 const detail={batch,review_allowed:true,run:{status:'SUCCEEDED'},review:{complete:false}};
 const responses={get_pilot_receipts:()=>({data:[batch],error:null}),get_pilot_receipt_ledger:()=>({data:null,error:Error('LEDGER_UNAVAILABLE')}),get_pilot_receipt:()=>({data:detail,error:null})};
 const scope={storeId:'store',batchId,fieldRole,readSequence:{current:0},setBatches:value=>state.batches=value,setLedger:value=>state.ledger=value,setLedgerError:value=>state.ledgerError=value,setSelectedLedgerBatchIds:value=>state.selected=value,setDetail:value=>state.detail=value,setLoading:value=>state.loading=value,setMessage:value=>state.message=value,supabase:{rpc:async(name,args)=>{calls.push({name,args});return await responses[name]();}}};
 const callback=initializer('refresh').arguments[0];
 runInNewContext(compile(`globalThis.refresh=${callback.getText(ast)};`),scope);
 return {calls,state,scope,responses,detail,run:()=>scope.refresh()};
}
test('ledger read failure clears stale rows but leaves authorized batches and detail available',async()=>{
 const h=refreshHarness({batchId:'chosen'});await h.run();
 assert.equal(h.state.batches[0].id,'chosen');assert.equal(h.state.detail,h.detail);
 assert.equal(h.state.ledger.length,0);assert.equal(h.state.selected.length,0);assert.match(h.state.ledgerError,/未能讀取/);
 assert.equal(h.state.loading,false);assert.equal(h.state.message,'保留原操作訊息');
 assert.deepEqual(h.calls.map(c=>c.name),['get_pilot_receipts','get_pilot_receipt_ledger','get_pilot_receipt']);
});
test('a rejected ledger request also falls back and a later success restores only the ledger error state',async()=>{
 const h=refreshHarness();h.responses.get_pilot_receipt_ledger=()=>Promise.reject(Error('NETWORK'));
 await h.run();assert.equal(h.state.batches.length,1);assert.match(h.state.ledgerError,/未能讀取/);
 h.responses.get_pilot_receipt_ledger=()=>({data:[row('chosen')],error:null});
 await h.run();assert.equal(h.state.ledger[0].batch_id,'chosen');assert.equal(h.state.ledgerError,'');assert.equal(h.state.message,'保留原操作訊息');
});
test('a late failed ledger read cannot overwrite a newer successful refresh',async()=>{
 const h=refreshHarness();let finishOld;
 h.responses.get_pilot_receipt_ledger=()=>new Promise(resolve=>{finishOld=resolve;});
 const old=h.run();
 h.responses.get_pilot_receipt_ledger=()=>({data:[row('newest')],error:null});
 await h.run();
 finishOld({data:null,error:Error('OLD_FAILURE')});await old;
 assert.equal(h.state.ledger[0].batch_id,'newest');assert.equal(h.state.ledgerError,'');
});
test('ledger failure does not weaken receipt detail store validation',async()=>{
 const h=refreshHarness({batchId:'chosen'});
 h.responses.get_pilot_receipt=()=>({data:{...h.detail,batch:{...h.detail.batch,store_id:'another-store'}},error:null});
 await assert.rejects(h.run(),/STORE_SCOPE_MISMATCH/);
 assert.equal(h.state.detail,null);assert.equal(h.state.ledger.length,0);assert.equal(h.state.selected.length,0);
});
test('a late detail response cannot replace a newer detail after a ledger recovery',async()=>{
 const h=refreshHarness({batchId:'chosen'});let finishOld;
 h.responses.get_pilot_receipt=()=>new Promise(resolve=>{finishOld=resolve;});
 const old=h.run();
 // Wait only for the real handler to reach its detail read, not a wall-clock timer.
 for(let turn=0;turn<20&&!finishOld;turn++)await Promise.resolve();
 assert.equal(typeof finishOld,'function','The batch detail must be requested despite the ledger error');
 const newest={...h.detail,review:{complete:true}};
 h.responses.get_pilot_receipt_ledger=()=>({data:[row('chosen')],error:null});
 h.responses.get_pilot_receipt=()=>({data:newest,error:null});
 await h.run();finishOld({data:h.detail,error:null});await old;
 assert.equal(h.state.detail,newest);assert.equal(h.state.ledgerError,'');
});
test('staff refresh retains its existing batch flow without calling the admin ledger',async()=>{
 const h=refreshHarness({batchId:'chosen',fieldRole:true});await h.run();
 assert.deepEqual(h.calls.map(c=>c.name),['get_pilot_receipts','get_pilot_receipt']);assert.equal(h.state.detail,h.detail);
});
test('failed ledger summaries report unavailable and controls cannot confirm or export stale data',async()=>{
 const metric=nodes(n=>ts.isJsxElement(n)&&n.openingElement.attributes.properties.some(a=>a.name?.getText(ast)==='className'&&a.initializer?.text==='receipt-ledger-metrics'))[0];
 const view=runInNewContext(compile(`(${metric.getText(ast)});`),{React,ledgerError:'進貨明細彙總未能讀取',loading:false,ledgerFilter:'PENDING',pendingLedger:[],completedLedger:[],needsMappingLedger:[],changeLedgerFilter:()=>{}});
 const html=renderToStaticMarkup(view);assert.equal((html.match(/未能讀取/g)||[]).length,3);assert.ok(!html.includes('<strong>0</strong>'));
 const exports=nodes(n=>ts.isJsxOpeningElement(n)&&n.tagName.getText(ast)==='button'&&n.attributes.properties.some(a=>a.name?.getText(ast)==='onClick'&&a.initializer?.getText(ast).includes('exportLedger(')));
 assert.equal(exports.length,2);
 for(const button of exports){const disabled=button.attributes.properties.find(a=>a.name?.getText(ast)==='disabled').initializer.expression;assert.equal(runInNewContext(compile(`(${disabled.getText(ast)});`),{busy:false,loading:false,ledgerError:'failed'}),true);}
 const h=confirmHarness(['chosen']);h.scope.ledgerError='進貨明細彙總未能讀取';await h.run();assert.equal(h.sent.length,0);
 let exported=false;
 await handler('exportLedger',{ledgerError:'進貨明細彙總未能讀取',loading:false,setMessage:()=>{},visibleLedger:[row('stale')],exportRowsFile:async()=>{exported=true;}})('csv');assert.equal(exported,false);
 const fallback=runInNewContext(compile(`(${initializer('unlistedBatches').getText(ast)});`),{ledgerError:'failed',batches:[{id:'complete',status:'COMPLETED'}],ledger:[],receiptBatchesWithoutLedger});
 assert.equal(fallback[0].id,'complete','Even completed authorized batches remain reachable while the ledger is unavailable');
});
