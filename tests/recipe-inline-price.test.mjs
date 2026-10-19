import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as costing from '../lib/recipe-cost.ts';
import * as pricing from '../lib/recipe-price-draft.ts';
const scope={React,exports:{},require:name=>name.endsWith('recipe-cost')?costing:pricing,Intl};
runInNewContext(ts.transpileModule(readFileSync(new URL('../app/pilot/recipe-inline-price.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText,scope);
function field(amount,amountEdited=false){
 const writes=[],draft={amount,amountEdited,rawAmount:amount,unit:'g',content:'',contentUnit:'g',source:'食譜紀錄',date:'2026-10-19'};
 const props={line:{id:'a',name:'洋蔥',quantity:'100',unit:'g'},draft,workspace:{prices:[],products:[],recipes:[]},onChange:value=>writes.push(value)};
 const tree=scope.exports.default(props);let input;
 const visit=node=>{if(Array.isArray(node))return node.forEach(visit);if(!React.isValidElement(node))return;if(node.props['aria-label']==='洋蔥成本單價')input=node;visit(node.props.children);};visit(tree);
 return {input,draft,writes};
}
test('saved price is concise without changing its stored precision or creating a price edit',()=>{
 const h=field('0.13166999999999998');assert.equal(h.input.props.value,'0.13167');assert.equal(h.draft.amount,'0.13166999999999998');assert.equal(h.draft.rawAmount,h.draft.amount);assert.equal(h.writes.length,0);
 h.input.props.onChange({target:{value:'0.123456789'}});assert.equal(h.writes[0].amount,'0.123456789');assert.equal(h.writes[0].rawAmount,null);assert.equal(h.writes[0].amountEdited,true);assert.equal(field('0.123456789',true).input.props.value,'0.123456789');
});
test('empty, zero, tiny and large prices stay distinct in the input',()=>{
 assert.equal(field('').input.props.value,'');assert.equal(field('0').input.props.value,'0');assert.ok(Number(field('0.00000000123').input.props.value)>0);assert.equal(field('1234567.25').input.props.value,'1234567.25');
});
