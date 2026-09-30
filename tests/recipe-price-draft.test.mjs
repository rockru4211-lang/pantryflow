import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as costing from '../lib/recipe-cost.ts';
const scope={exports:{},require:()=>costing};
runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/recipe-price-draft.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,scope);
const {normalizeRecipeDraft,recipePriceDraft,changeRecipePriceUnit}=scope.exports;
const base={amount:'300',rawAmount:null,unit:'包',content:'750',contentUnit:'g',source:'手動補價',date:'2026-09-30'};
test('package contents preserve their entered units and compute actual cost without rounding',()=>{
 const flour=normalizeRecipeDraft(base,'g');assert.equal(flour.price,.4);assert.equal(flour.price*20,8);
 const oil=normalizeRecipeDraft({...base,amount:'600',unit:'桶',content:'5',contentUnit:'L'},'ml');assert.equal(oil.price,.12);assert.equal(oil.price*100,12);assert.equal(oil.purchase.content_quantity,5);assert.equal(oil.purchase.content_unit,'L');
 const jin=normalizeRecipeDraft({...base,amount:'700',unit:'台斤',content:''},'g');assert.equal((jin.price*40).toFixed(2),'46.67');
 const egg=normalizeRecipeDraft({...base,amount:'8.4',unit:'顆',content:''},'顆');assert.equal((egg.price*6).toFixed(2),'50.40');
});
test('invalid packaging, cross dimension and missing values remain unresolved',()=>{
 for(const patch of [{content:''},{content:'0'},{content:'-1'},{contentUnit:'L'},{amount:''},{amount:'-1'}])assert.throws(()=>normalizeRecipeDraft({...base,...patch},'g'));
 assert.equal(normalizeRecipeDraft({...base,amount:'0'},'g').price,0);
});
test('conservative costs preserve raw purchase, prevent lower estimates and can be cleared',()=>{
 const n=normalizeRecipeDraft({...base,amount:'330',rawAmount:'300'},'g');assert.equal(n.price,.4);assert.equal(n.costPrice,.44);assert.equal(n.purchase.amount,300);assert.equal(n.purchase.cost_unit_price,330);
 assert.throws(()=>normalizeRecipeDraft({...base,amount:'299',rawAmount:'300'},'g'));
 assert.equal(normalizeRecipeDraft({...base,rawAmount:'300'},'g').costPrice,null);
});
test('saved 5 L bucket and legacy multi-package quotes reload without changing their meaning',()=>{
 const line={id:'a',name:'油',quantity:'100',unit:'ml'};
 const price={key:'n:油',unit:'ml',price:.12,cost_price:.13,source:'報價',effective_date:'2026-09-29',purchase:{amount:1200,quantity:2,unit:'桶',content_quantity:5,content_unit:'L',cost_unit_price:650}};
 const draft=recipePriceDraft(line,{products:[],prices:[price]});assert.equal(draft.amount,'650');assert.equal(draft.rawAmount,'600');assert.equal(draft.content,'5');assert.equal(draft.contentUnit,'L');
 const n=normalizeRecipeDraft(draft,'ml');assert.equal(n.price,.12);assert.equal(n.costPrice,.13);
});
test('unit changes preserve physical weight prices but never relabel a gram price as per piece',()=>{
 const d={...base,unit:'g',amount:'.4',rawAmount:'.3'};
 const kg=changeRecipePriceUnit(d,'公斤');assert.equal(kg.amount,'400');assert.equal(kg.rawAmount,'300');
 assert.equal(changeRecipePriceUnit({...d,amount:'700',rawAmount:null},'台斤').amount,'700');
 assert.equal(changeRecipePriceUnit({...d,amount:'700',amountEdited:true},'台斤').amount,'700');
 const piece=changeRecipePriceUnit(d,'顆');assert.equal(piece.amount,'');assert.equal(piece.rawAmount,null);
 const egg=recipePriceDraft({name:'蛋黃',unit:'顆'},{products:[],prices:[{key:'n:蛋黃',unit:'g',price:.42,source:'報價',effective_date:'2026-09-29'}]});assert.equal(egg.amount,'');assert.equal(egg.unit,'顆');
});
