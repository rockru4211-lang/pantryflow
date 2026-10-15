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
test('desktop original link opens split review in place and closing retains the list',()=>{
 let original=null;const scope={kind:'receipt',setOriginalId:id=>original=id};
 const open=prop('unified-operations-workspace.tsx','OperationsSheet','onSource',scope);
 open({meta:{batch:'receipt-a'}});assert.equal(original,'receipt-a');
 prop('unified-operations-workspace.tsx','ReceiptReviewWorkbench','onClose',scope)();assert.equal(original,null);
});
test('archive view and entry action share the split workbench',()=>{
 const calls=[];const scope={setOriginalId:id=>calls.push(['original',id]),openEntry:(id,queue)=>calls.push(['entry',id,queue])};
 prop('receiving-workspace.tsx','ReceiptSupplierInbox','onOpen',scope)({batch_id:'a'});
 prop('receiving-workspace.tsx','ReceiptSupplierInbox','onDetails',scope)({batch_id:'a'},['a','b']);
 assert.deepEqual(calls,[['entry','a',undefined],['entry','a',['a','b']]]);
});
