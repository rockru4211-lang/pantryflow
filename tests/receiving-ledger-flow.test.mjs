import test from 'node:test';
import {receiptRead,receiptReadRows,receiptReadError} from '../lib/receipt-read.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {receiptLedgerSummary,matchesReceiptLedgerStatus,selectedReceiptLedgerRows,receiptSubtotal,receiptDetailPage,receiptBatchesWithoutLedger,groupReceiptLedger,receiptReviewTotals} from '../lib/receipt-ledger.ts';
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
test('current ledger status filter selects actionable or complete records',()=>{
 const select=nodes(n=>ts.isJsxElement(n)&&n.openingElement.tagName.getText(ast)==='select'&&n.openingElement.attributes.properties.some(a=>a.name?.getText(ast)==='aria-label'&&a.initializer?.text==='資料狀態'))[0];
 const change=select.openingElement.attributes.properties.find(a=>a.name?.getText(ast)==='onChange').initializer.expression;
 let scope;runInNewContext(compile(`(${change.getText(ast)})({target:{value:'ACTION'}});`),{setLedgerScope:v=>scope=v});assert.equal(scope,'ACTION');
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

function refreshHarness({batchId='',fieldRole=false,page='list',timeout=12000}={}){
 const calls=[];const state={batches:[],ledger:[row('stale')],selected:['stale'],detail:null,ledgerError:'',message:'保留原操作訊息',loading:true,refreshing:false};
 const batch={id:'chosen',store_id:'store',status:'REVIEWING'};
 const detail={batch,review_allowed:true,run:{status:'SUCCEEDED'},review:{complete:false}};
 const responses={get_pilot_receipts:()=>({data:[batch],error:null}),get_pilot_receipt_ledger:()=>({data:null,error:Error('LEDGER_UNAVAILABLE')}),get_pilot_receipt:()=>({data:detail,error:null}),get_baihuayuan_record_flags:()=>({data:[],error:null}),get_baihuayuan_receipt_inbox:()=>({data:[],error:null})};
 const scope={storeId:'store',batchId,fieldRole,page,document:{visibilityState:'visible'},AbortController,receiptRead:(run,signal)=>receiptRead(run,signal,timeout),receiptReadRows,receiptReadError,readFlight:{current:null},busyRead:{current:false},readSequence:{current:0},setBatches:value=>state.batches=value,setLedger:value=>state.ledger=value,setLedgerError:value=>state.ledgerError=value,setSelectedLedgerBatchIds:value=>state.selected=value,setDetail:value=>state.detail=value,setLoading:value=>state.loading=value,setMessage:value=>state.message=value,setInbox:value=>state.inbox=value,setInboxError:value=>state.inboxError=value,setRecordFlags:value=>state.flags=value,setRefreshing:value=>state.refreshing=value,setLastRead:value=>state.lastRead=value,setReadError:value=>state.readError=value,supabase:{rpc:(name,args)=>({abortSignal:signal=>{calls.push({name,args,signal});return responses[name]();}})}};
 const callback=initializer('refresh').arguments[0];
 runInNewContext(compile(`globalThis.refresh=${callback.getText(ast)};`),scope);
 return {calls,state,scope,responses,detail,run:(background=false)=>scope.refresh(background)};
}
test('ledger read failure clears stale rows but leaves authorized batches and detail available',async()=>{
 const h=refreshHarness({batchId:'chosen'});await h.run();
 assert.equal(h.state.batches[0].id,'chosen');assert.equal(h.state.detail,h.detail);
 assert.equal(h.state.ledger.length,0);assert.equal(h.state.selected.length,0);assert.match(h.state.ledgerError,/未能讀取/);
 assert.equal(h.state.loading,false);assert.equal(h.state.message,'保留原操作訊息');
 assert.deepEqual(h.calls.map(c=>c.name),['get_pilot_receipt_ledger','get_baihuayuan_record_flags','get_pilot_receipts','get_pilot_receipt']);
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
 for(let turn=0;turn<20&&!finishOld;turn++)await Promise.resolve();
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
 const totals=nodes(n=>ts.isJsxElement(n)&&n.openingElement.attributes.properties.some(a=>a.name?.getText(ast)==='className'&&a.initializer?.text==='receipt-ledger-metrics'))[0];
 for(const condition of [{ledgerError:'讀取失敗',loading:false},{ledgerError:'',loading:true}]){
  const view=runInNewContext(compile(`(${totals.getText(ast)});`),{React,...condition,ledgerSummaryUnavailable:true,ledgerPeriodLabel:'本月',ledgerSummary:receiptLedgerSummary([]),ledgerActionCount:0,activeRecordView:'LIVE'});
  const html=renderToStaticMarkup(view);assert.match(html,/尚未/);assert.doesNotMatch(html,/共 0 張貨單/);
 }
 const exports=nodes(n=>ts.isJsxOpeningElement(n)&&n.tagName.getText(ast)==='button'&&n.attributes.properties.some(a=>a.name?.getText(ast)==='onClick'&&a.initializer?.getText(ast).includes('exportLedger(')));
 assert.ok(exports.length>=1);
 for(const button of exports){const disabled=button.attributes.properties.find(a=>a.name?.getText(ast)==='disabled').initializer.expression;assert.equal(runInNewContext(compile(`(${disabled.getText(ast)});`),{busy:false,loading:false,refreshing:false,ledgerError:'failed'}),true);}
 const h=confirmHarness(['chosen']);h.scope.ledgerError='進貨明細彙總未能讀取';await h.run();assert.equal(h.sent.length,0);
 let exported=false;
 await handler('exportLedger',{ledgerError:'進貨明細彙總未能讀取',loading:false,setMessage:()=>{},visibleLedger:[row('stale')],exportRowsFile:async()=>{exported=true;}})('csv');assert.equal(exported,false);
 const fallback=runInNewContext(compile(`(${initializer('unlistedBatches').getText(ast)});`),{ledgerError:'failed',batches:[{id:'complete',status:'COMPLETED'}],ledger:[],receiptBatchesWithoutLedger,groupReceiptLedger,receiptReviewTotals});
 assert.equal(fallback[0].id,'complete','Even completed authorized batches remain reachable while the ledger is unavailable');
});


test('supplier grouping keeps interleaved receipts separate and preserves each invoice row order',()=>{
 const rows=[{...row('a','2'),supplier_name:'甲廠商'}, {...row('b'),supplier_name:'乙廠商'}, {...row('c'),supplier_name:'甲廠商'}, {...row('a','3'),supplier_name:'甲廠商'}];
 const groups=groupReceiptLedger(rows);
 assert.deepEqual(groups.map(group=>group.supplier),['甲廠商','乙廠商']);
 assert.deepEqual(groups[0].receipts.map(receipt=>receipt.batchId),['a','c']);
 assert.deepEqual(groups[0].receipts[0].items.map(item=>item.row_key),['2','3']);
 assert.equal(groups[0].receipts[0].items[0],rows[0]);
 assert.deepEqual(selectedReceiptLedgerRows(rows,rows,['a']).map(item=>item.row_key),['2','3']);
});

test('totals never assume five percent, never treat missing line input as zero, and accept an explicit zero tax',()=>{
 assert.deepEqual(receiptReviewTotals([{quantity:2,price:30}],null),{subtotal:60,tax:null,total:null});
 assert.deepEqual(receiptReviewTotals([{quantity:2,price:30}],0),{subtotal:60,tax:0,total:60});
 assert.deepEqual(receiptReviewTotals([{quantity:2,price:30}],7),{subtotal:60,tax:7,total:67});
 assert.deepEqual(receiptReviewTotals([{quantity:'',price:30}],3),{subtotal:null,tax:3,total:null});
 assert.deepEqual(receiptReviewTotals([],0),{subtotal:null,tax:0,total:null});
 assert.equal(receiptReviewTotals([{quantity:0.2,price:0.1},{quantity:1,price:0.1}],0.01).total,0.13);
});


test('switching receipt in a review preserves the original list or ERP return destination',()=>{
 for(const page of ['review','status','published','list','company-tasks']){
  let source='company-tasks',batchId,detail='old';const initialRoute={current:''};
  handler('openBatch',{page,onOpenReceipt:undefined,setBatchSource:value=>source=value,setLoading:()=>{},setMessage:()=>{},setDetail:value=>detail=value,setBatchId:value=>batchId=value,setPage:()=>{},initialRoute})({id:'next'});
  assert.equal(source,['review','status','published'].includes(page)?'company-tasks':page);
  assert.equal(batchId,'next');assert.equal(detail,null);assert.equal(initialRoute.current,'next');
 }
});


test('polls do not discard a slow first response or multiply requests',async()=>{
 const h=refreshHarness();let finish;h.responses.get_pilot_receipt_ledger=()=>new Promise(resolve=>finish=resolve);
 const first=h.run();for(let n=0;n<20&&!finish;n++)await Promise.resolve();
 const sequence=h.scope.readSequence.current;for(let tick=0;tick<5;tick++)await h.run(true);
 assert.equal(h.scope.readSequence.current,sequence);assert.equal(h.calls.filter(c=>c.name==='get_pilot_receipt_ledger').length,1);
 finish({data:[row('fresh')],error:null});await first;assert.equal(h.state.ledger[0].batch_id,'fresh');assert.equal(h.state.loading,false);
});
test('ledger displays without waiting for stalled ancillary batch information',async()=>{
 const h=refreshHarness();let finish;h.responses.get_pilot_receipts=()=>new Promise(resolve=>finish=resolve);h.responses.get_pilot_receipt_ledger=()=>({data:[row('fresh')],error:null});
 const pending=h.run();for(let n=0;n<40&&h.state.loading;n++)await Promise.resolve();
 assert.equal(h.state.ledger[0].batch_id,'fresh');assert.equal(h.state.loading,false);assert.equal(h.calls.some(c=>c.name==='get_baihuayuan_receipt_inbox'),false);
 finish({data:[],error:null});await pending;
});
test('visibility lookup failure cannot expose test or removed receipts as live',async()=>{
 const h=refreshHarness();h.responses.get_pilot_receipt_ledger=()=>({data:[row('hidden')],error:null});h.responses.get_baihuayuan_record_flags=()=>({data:null,error:Error('NETWORK')});
 await h.run();assert.equal(h.state.ledger.length,0);assert.match(h.state.ledgerError,/未能讀取/);
});
test('a stuck request exits loading on deadline and a retry recovers',async()=>{
 const h=refreshHarness({timeout:15});h.responses.get_pilot_receipt_ledger=()=>new Promise(()=>{});
 await h.run();assert.equal(h.state.loading,false);assert.equal(h.state.refreshing,false);assert.match(h.state.ledgerError,/逾時/);
 h.responses.get_pilot_receipt_ledger=()=>({data:[row('recovered')],error:null});await h.run();assert.equal(h.state.ledger[0].batch_id,'recovered');assert.equal(h.state.ledgerError,'');
});
test('background reads pause during input, hidden tabs and writes',async()=>{
 for(const page of ['direct','review','upload']){const h=refreshHarness({page});await h.run(true);assert.equal(h.calls.length,0);}
 const h=refreshHarness();h.scope.busyRead.current=true;await h.run(true);assert.equal(h.calls.length,0);h.scope.busyRead.current=false;h.scope.document.visibilityState='hidden';await h.run(true);assert.equal(h.calls.length,0);
});
test('null and invalid read payloads never count as successful zero-row ledgers',()=>{
 for(const data of [null,undefined,{},'[]'])assert.throws(()=>receiptReadRows({data,error:null}),/INVALID/);
 assert.deepEqual(receiptReadRows({data:[],error:null}),[]);
});


test('ledger summary counts unique receipts and uses saved untaxed amounts without recomputing or inventing tax',()=>{
 const rows=[{batch_id:'a',quantity:2,unit_price:30,subtotal:59.9},{batch_id:'a',quantity:1,unit_price:20,subtotal:20.2},{batch_id:'b',quantity:0,unit_price:9,subtotal:0}];
 assert.deepEqual(receiptLedgerSummary(rows),{receipts:2,items:3,excluded:0,amount:80.1});
 assert.deepEqual(receiptLedgerSummary(rows.slice(1)),{receipts:2,items:2,excluded:0,amount:20.2});
});
test('summary distinguishes missing prices, missing quantities, explicit zero and genuinely empty results',()=>{
 const base={batch_id:'a',quantity:2,unit_price:30,subtotal:60};
 for(const field of ['quantity','unit_price','subtotal'])for(const missing of [null,undefined,'',NaN,Infinity]){
  const row={...base,[field]:missing};
  assert.equal(receiptLedgerSummary([row]).amount,null);
  assert.deepEqual(receiptLedgerSummary([base,row]),{receipts:1,items:2,excluded:1,amount:60});
 }
 assert.deepEqual(receiptLedgerSummary([]),{receipts:0,items:0,excluded:0,amount:0});
 assert.equal(receiptLedgerSummary([{...base,unit_price:0,subtotal:0}]).amount,0);
});
