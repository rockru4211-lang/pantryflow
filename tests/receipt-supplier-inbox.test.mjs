import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as inbox from '../lib/receipt-supplier-inbox.ts';
const row=(id,name='大永行銷有限公司',supplierId='dayong')=>({batch_id:id,batch_number:`RC-${id}`,supplier_name:name,raw_supplier_name:name,supplier_id:supplierId,receipt_date:'2026-09-09',uploaded_at:'2026-09-09T03:00:00Z',work_date:'2026-09-09',state:'NEEDS_REVIEW',run_status:'SUCCEEDED',page_count:2,stored_page_count:2});
test('canonical identity combines confirmed OCR aliases and counts distinct receipts, not pages or lines',()=>{
 const rows=[row('1'),{...row('2'),raw_supplier_name:'太永行銷有限公司'},row('1')];
 const groups=inbox.groupSupplierInbox(rows,'2026-09');assert.equal(groups.length,1);assert.equal(groups[0].rows.length,2);assert.equal(groups[0].name,'大永行銷有限公司');
 assert.equal(inbox.groupSupplierInbox(rows,'2026-09','太永')[0].rows.length,2);
});
test('similar but unconfirmed suppliers stay separate, repeated unknown names are one exception',()=>{
 const rows=[row('1'),row('2','新廠商',null),row('3',' 新 廠商 ',null),row('4','太永行銷有限公司',null)];
 assert.equal(inbox.groupSupplierInbox(rows,'2026-09').length,3);
 const names=inbox.unresolvedSupplierNames([...rows,row('2','新廠商',null)]);assert.equal(names.length,2);assert.equal(names[0].count,2);
 const known=[{name:'大永行銷有限公司'},{name:'大永企業有限公司'}];assert.deepEqual(inbox.suggestInboxSuppliers('太永行銷有限公司',known),[known[0]]);
 assert.equal(rows[3].supplier_id,null);
});
test('month filtering handles ROC dates and Taipei upload date fallback without cross-month counts',()=>{
 const rows=[row('1'),{...row('2'),receipt_date:'115/08/31'},{...row('3'),receipt_date:'',uploaded_at:'2026-08-31T16:01:00Z'},{...row('4'),receipt_date:'2026-02-30',uploaded_at:'2026-08-30T00:00:00Z'}];
 assert.equal(inbox.groupSupplierInbox(rows,'2026-09')[0].rows.length,2);
 assert.equal(inbox.groupSupplierInbox(rows,'2026-08')[0].rows.length,2);
 assert.equal(inbox.inboxMonth({...row('5'),receipt_date:'',uploaded_at:'invalid'}),'');
});
test('pending OCR is not a supplier task and OCR completion never means financial review is complete',()=>{
 const waiting={...row('1','',null),run_status:null,state:'PROCESSING'};assert.equal(inbox.unresolvedSupplierNames([waiting]).length,0);
 assert.equal(inbox.inboxRecognitionLabel(waiting),'辨識中');assert.equal(inbox.inboxRecognitionLabel(row('2')),'辨識完成');
 assert.equal(inbox.inboxRecognitionLabel({...row('3'),state:'OCR_FAILED'}),'辨識失敗');
});
const source=readFileSync(new URL('../app/pilot/receipt-supplier-inbox.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('inbox.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const component=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ReceiptSupplierInbox');
const scope={React,exports:{},...React,...inbox,taipeiMonth:()=> '2026-09',Search:()=>null,Plus:()=>null,RefreshCw:()=>null,useOperation:()=>({busy:false,error:'',setError(){},run(){}})};
runInNewContext(ts.transpileModule(component.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText,scope);
const render=(props={})=>renderToStaticMarkup(React.createElement(scope.exports.default,{storeId:'store',userId:'user',rows:[row('1'),{...row('2'),raw_supplier_name:'太永行銷有限公司'},row('3','元寶','yuanbao')],loading:false,error:'',busy:false,onRefresh(){},onOpen(){},onUpload(){},onRetry(){},...props}));
test('inbox landing displays one row per supplier and no thumbnails or per-invoice confirmations',()=>{
 const html=render();assert.equal((html.match(/大永行銷有限公司/g)||[]).length,1);assert.match(html,/2 張/);assert.match(html,/共 3 張貨單/);
 for(const unwanted of ['RC-1','太永行銷有限公司','<img','<input type="checkbox"','供應商待確認','儲存名稱對應'])assert.ok(!html.includes(unwanted),unwanted);
});
test('only uncertain names produce one compact exception prompt; read failure never exposes stale rows',()=>{
 const html=render({rows:[row('1','太永行銷有限公司',null),row('2','太永行銷有限公司',null)]});assert.match(html,/有 1 個供應商名稱需要釐清/);assert.match(html,/處理名稱/);
 const failure=render({error:'無法讀取'});assert.match(failure,/無法讀取/);assert.doesNotMatch(failure,/大永行銷有限公司|尚無貨單/);
});
