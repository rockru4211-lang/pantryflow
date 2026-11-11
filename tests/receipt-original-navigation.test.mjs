import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
function prop(file,component,name,scope){
 const source=readFileSync(new URL('../app/pilot/'+file,import.meta.url),'utf8');
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let value;
 function visit(n){if((ts.isJsxSelfClosingElement(n)||ts.isJsxOpeningElement(n))&&n.tagName.getText(ast)===component){const attr=n.attributes.properties.find(a=>ts.isJsxAttribute(a)&&a.name.text===name);if(attr)value=attr.initializer.expression;}ts.forEachChild(n,visit);}visit(ast);
 assert.ok(value,component+'.'+name);return runInNewContext(ts.transpileModule('('+value.getText(ast)+')',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope);
}
test('desktop receipt links open the exact batch even for matching suppliers and dates',()=>{
 let opened=null;
 const file='unified-operations-workspace.tsx';
 const scope={kind:'receipt',setReceiptTarget:target=>opened=target};
 const open=prop(file,'OperationsSheet','onSource',scope);
 const values={supplier:'同一供應商',date:'2026-11-08'};
 open({id:'receipt-a:line-1',values,meta:{batch:'receipt-a',key:'line-1'}});
 assert.equal(prop(file,'ReceiptReviewWorkbench','batchId',{receiptTarget:opened}),'receipt-a');
 open({id:'receipt-b:line-2',values,meta:{batch:'receipt-b',key:'line-2'}});
 assert.equal(prop(file,'ReceiptReviewWorkbench','batchId',{receiptTarget:opened}),'receipt-b');
 assert.equal(prop(file,'ReceiptReviewWorkbench','initialRowKey',{receiptTarget:opened}),'line-2');
 prop(file,'ReceiptReviewWorkbench','onClose',scope)();
 assert.equal(opened,null);
});
test('archive original view opens the photo and entry opens the shared workbench',()=>{
 const calls=[];const scope={setDownloadOriginal:value=>calls.push(['download',value]),setOriginalId:id=>calls.push(['original',id]),openEntry:(id,queue)=>calls.push(['entry',id,queue])};
 prop('receiving-workspace.tsx','ReceiptSupplierInbox','onOpen',scope)({batch_id:'a'});
 prop('receiving-workspace.tsx','ReceiptSupplierInbox','onDetails',scope)({batch_id:'a'},['a','b']);
 assert.deepEqual(calls,[['download',false],['original','a'],['entry','a',['a','b']]]);
});
