import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {formatPurchaseSpecification} from '../lib/purchase-specification.ts';
import {reviewDraft,changeReviewLine,reviewPayload} from '../lib/receipt-review.ts';
const source=readFileSync(new URL('../app/pilot/receipt-package-input.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('package.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n));
const code=ts.transpileModule(fn.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
const nodes=n=>Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...nodes(n.props?.children)]:[];
function harness(initial=''){
 let value=initial,emptyUnit='克';const scope={React,exports:{},formatPurchaseSpecification,useState:()=>[emptyUnit,v=>emptyUnit=v]};runInNewContext(code,scope);
 const render=()=>scope.exports.default({value,unit:'包',label:'包裝內容',onChange:v=>value=v});
 return {get value(){return value;},field:label=>nodes(render()).find(n=>n.props?.['aria-label']===label)};
}
test('package quantity and unit are optional, keep decimal typing, and can select a unit first',()=>{
 const h=harness();h.field('包裝內容 單位').props.onChange({target:{value:'公升'}});assert.equal(h.value,'');
 h.field('包裝內容 數量').props.onChange({target:{value:'1.'}});assert.equal(h.value,'1.公升');assert.equal(h.field('包裝內容 數量').props.value,'1.');
 h.field('包裝內容 數量').props.onChange({target:{value:'1.5'}});assert.equal(h.value,'1.5公升');
 h.field('包裝內容 數量').props.onChange({target:{value:''}});assert.equal(h.value,'');
});
test('complex OCR package text is retained verbatim instead of guessing inner or outer packaging',()=>{
 const h=harness('454g*12包');assert.equal(h.field('包裝內容').props.value,'454g*12包');
 h.field('包裝內容').props.onChange({target:{value:'454克'}});assert.equal(h.field('包裝內容 數量').props.value,'454');
});
test('saved package content roundtrips using existing specification and never changes invoice amount',()=>{
 const row={lines:[{row_key:'a',product_name:'牛菌菇',unit:'包',quantity:2,unit_price:1700,subtotal:3400,specification:'',category:'食材',note:''}],supplier_name:'甲',receipt_date:'2026-10-16',document_number:'',note:'',tax:null,total:3400,source_fingerprint:'v1',revision:1};
 const draft=changeReviewLine(reviewDraft(row),0,'specification','454克');const data=reviewPayload(row,draft,false);
 assert.equal(data.lines[0].specification,'454克');assert.equal(data.lines[0].subtotal,3400);assert.equal(data.lines[0].quantity,2);
 assert.equal(reviewDraft({...row,lines:data.lines}).lines[0].specification,'454克');
});
