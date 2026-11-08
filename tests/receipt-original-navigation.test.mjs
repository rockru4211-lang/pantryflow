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
test('desktop view expands the selected receipt and closing either dialog retains the list context',()=>{
 let expanded=null,original='receipt-a',photo='receipt-a';
 const account={batch_id:'receipt-a'};
 const scope={kind:'receipt',accounts:{current:new Map([['receipt-a',account]])},
  setExpandedSource:update=>{expanded=update(expanded);},setOriginalId:id=>original=id,setPhotoId:id=>photo=id};
 const open=prop('unified-operations-workspace.tsx','OperationsSheet','onSource',scope);
 const row={id:'receipt-a:line-1',meta:{batch:'receipt-a'}};
 open(row);assert.equal(expanded.rowId,row.id);assert.equal(expanded.account,account);
 prop('unified-operations-workspace.tsx','ReceiptReviewWorkbench','onClose',scope)();assert.equal(original,null);
 prop('unified-operations-workspace.tsx','ReceiptOriginalDialog','onClose',scope)();assert.equal(photo,null);
 assert.equal(expanded.rowId,row.id);
 open(row);assert.equal(expanded,null);
});
test('archive original view opens the photo and entry opens the shared workbench',()=>{
 const calls=[];const scope={setDownloadOriginal:value=>calls.push(['download',value]),setOriginalId:id=>calls.push(['original',id]),openEntry:(id,queue)=>calls.push(['entry',id,queue])};
 prop('receiving-workspace.tsx','ReceiptSupplierInbox','onOpen',scope)({batch_id:'a'});
 prop('receiving-workspace.tsx','ReceiptSupplierInbox','onDetails',scope)({batch_id:'a'},['a','b']);
 assert.deepEqual(calls,[['download',false],['original','a'],['entry','a',['a','b']]]);
});
