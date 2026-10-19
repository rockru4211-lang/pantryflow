import test from 'node:test';
import assert from 'node:assert/strict';
import {recipeCostSummary,recipeSavedLineCost,recipeUsageSummary} from '../lib/recipe-display.ts';
const document={yield:'100',unit:'g'};
const cost={total:80.8,subtotal:80.8,missing:0,lines:[{id:'a',amount:80.8}]};
test('saved prep cost remains visible without a parent usage or finished yield',()=>{
 assert.equal(recipeCostSummary(document,cost).amount,80.8);
 assert.equal(recipeCostSummary({...document,yield:''},cost).unitAmount,null);
 assert.equal(recipeCostSummary({...document,yield:''},cost).amount,80.8);
 assert.equal(recipeUsageSummary({document:{lines:[]},cost},'prep').amount,null);
});
test('zero, missing and partial costs remain distinct',()=>{
 assert.equal(recipeCostSummary(document,{...cost,total:0,subtotal:0,lines:[{id:'a',amount:0}]}).unitAmount,0);
 assert.deepEqual(recipeCostSummary(document,{total:null,subtotal:0,missing:1,lines:[{id:'a',amount:null}]}),{amount:null,partial:false,hasYield:true,unitAmount:null});
 assert.deepEqual(recipeCostSummary(document,{...cost,total:null,missing:1}),{amount:80.8,partial:true,hasYield:true,unitAmount:80.8/100});
});
test('viewed usage matches saved line IDs, sums repeated uses and never changes locked costs',()=>{
 const parent={document:{lines:[{id:'second',recipe_id:'prep'},{id:'first',recipe_id:'prep'}]},cost:{...cost,lines:[{id:'first',amount:10},{id:'second',amount:20}]}};
 const before=JSON.stringify(parent);
 assert.equal(recipeSavedLineCost(parent,parent.document.lines[0]),20);
 assert.equal(recipeUsageSummary(parent,'prep').amount,30);
 assert.equal(recipeSavedLineCost(parent,{id:'absent'}),null);
 assert.equal(JSON.stringify(parent),before);
 parent.cost.lines[0].amount=null;
 assert.equal(recipeUsageSummary(parent,'prep').amount,null);
});
