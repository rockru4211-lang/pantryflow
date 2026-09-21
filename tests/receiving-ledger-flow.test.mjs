import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import {matchesReceiptLedgerStatus,selectedReceiptLedgerRows,receiptSubtotal,receiptDetailPage,receiptBatchesWithoutLedger} from '../lib/receipt-ledger.ts';

const source=readFileSync(new URL('../app/pilot/receiving-workspace.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('receiving.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const workspace=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='ReceivingWorkspace');
const compile=code=>ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React},fileName:'receiving.tsx'}).outputText;
function handler(name,scope){const node=workspace.body.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(node,`Missing real handler ${name}`);runInNewContext(compile(node.getText(ast)),scope);return scope[name];}
function nodes(predicate){const result=[];function visit(node){if(predicate(node))result.push(node);ts.forEachChild(node,visit);}visit(ast);return result;}
const row=(batch_id,row_key='1')=>({batch_id,row_key,run_id:`run-${batch_id}`,status:'PENDING',review_allowed:true});

function confirmHarness(selected){
 const sent=[];const messages=[];const current=[row('chosen'),row('chosen','2'),row('unrelated')];
 const scope={pendingLedger:current,selectedLedgerRows:current.filter(r=>selected.includes(r.batch_id)),ledger:current,selectedLedgerBatchIds:selected,storeId:'store',setSelectedLedgerBatchIds:()=>{},setMessage:text=>messages.push(text),act:fn=>fn(),refresh:async()=>{},supabase:{rpc:async(name,args)=>{sent.push({name,args});return {data:{confirmed:args.p_rows.length,failed_count:0},error:null};}}};
 return {sent,messages,run:()=>handler('confirmLedger',scope)()};
}
test('bulk confirmation sends only the explicitly selected whole receipt, including its other lines',async()=>{
 const h=confirmHarness(['chosen']);await h.run();assert.equal(h.sent.length,1);assert.deepEqual(Array.from(h.sent[0].args.p_rows,r=>`${r.batch_id}:${r.row_key}`),['chosen:1','chosen:2']);
});
test('bulk confirmation cannot confirm anything without an explicit selection',async()=>{
 const h=confirmHarness([]);await h.run();assert.equal(h.sent.length,0);assert.match(h.messages[0],/選取/);
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
 const expression=nodes(n=>ts.isArrowFunction(n)&&n.body.getText(ast).startsWith('{const subtotal=receiptSubtotal'))[0];
 assert.ok(expression,'The rendered review subtotal must use the same missing-value rule');
 assert.equal(runInNewContext(compile(`(${expression.getText(ast)})();`),{receiptSubtotal,row:'1',value:name=>name==='quantity'?2:null}),'未提供');
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
 const scope={visibleLedger:[{...row('chosen'),product_name:'=1+1',supplier_name:'供應商甲',quantity:2,unit_price:null,subtotal:null}],receiptDate:()=> '2026/09/21',setMessage:()=>{},exportRowsFile:async(...args)=>exported.push(args)};
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
