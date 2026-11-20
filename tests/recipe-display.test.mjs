import test from 'node:test';
import assert from 'node:assert/strict';
import {recipeCostSummary,recipeSavedLineCost,recipeUsageSummary,recipeKitchenLineName,recipeDirectoryCost} from '../lib/recipe-display.ts';
const document={yield:'100',unit:'g'};
const cost={total:80.8,subtotal:80.8,missing:0,lines:[{id:'a',amount:80.8}]};
test('directory retains original reference costs without treating incomplete lines as complete',()=>{
 const card={document:{...document,source_cost_per_portion:123.04,lines:[]},cost:{...cost,total:null,missing:1}};
 const before=JSON.stringify(card);
 assert.deepEqual(recipeDirectoryCost(card),{amount:123.04,label:'原食譜每份成本',locked:false});
 assert.equal(JSON.stringify(card),before);
 assert.deepEqual(recipeDirectoryCost({...card,cost}),{amount:80.8,label:'整份配方',locked:true});
 assert.equal(recipeDirectoryCost({...card,document:{...card.document,source_cost_per_portion:0}}).amount,0);
});
test('a matched purchase price keeps its unit and never becomes a whole-dish total',()=>{
 const card={document:{...document,lines:[{id:'a',ingredient_id:'oyster'}]},cost:{total:null,subtotal:0,missing:1,lines:[{id:'a',amount:null,price:{price:145,unit:'顆'}}]}};
 assert.deepEqual(recipeDirectoryCost(card),{amount:145,label:'進貨單價／顆',locked:false});
 assert.equal(card.cost.total,null);
 assert.deepEqual(recipeDirectoryCost({...card,cost:{...card.cost,lines:[{id:'a',amount:null,price:null}]}}),{amount:null,label:'待補成本',locked:false});
});
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

test('kitchen alias never changes custom names or infers identity from a name alone',()=>{
 const workspace={ingredients:[{id:'i',name:'原品名',recipe_aliases:['廚房名']}]};
 assert.equal(recipeKitchenLineName({name:'原品名',ingredient_id:'i'},workspace),'廚房名');
 assert.equal(recipeKitchenLineName({name:'自訂用名',ingredient_id:'i'},workspace),'自訂用名');
 assert.equal(recipeKitchenLineName({name:'原品名'},workspace),'原品名');
 assert.equal(recipeKitchenLineName({name:'原品名',ingredient_id:'missing'},workspace),'原品名');
});
