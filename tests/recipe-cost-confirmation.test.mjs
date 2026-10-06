import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recipeCost,emptyRecipe} from '../lib/recipe-cost.ts';
const document={...emptyRecipe(),name:'測試',lines:[{id:'a',name:'食材',quantity:'2',unit:'盒'}]};
const original={lines:[{id:'a',amount:60,price:{key:'n:食材',name:'食材',unit:'盒',price:30},reason:null}],total:60,subtotal:60,missing:0};
const workspace={recipes:[{id:'r',document,approved_cost:{id:'v',document,cost:original,at:'2026-10-01'}}],prices:[{key:'n:食材',unit:'盒',price:50}],products:[],can_price:true};
test('saved costs survive new prices; latest proposal is separate',()=>{
 assert.equal(recipeCost(document,workspace,['r']).total,60);
 assert.equal(recipeCost(document,{...workspace,cost_mode:'latest'},['r']).total,100);
 assert.equal(recipeCost({...document,lines:[{...document.lines[0],quantity:'1'}]},workspace,['r']).total,30);
 assert.equal(recipeCost({...document,lines:[{...document.lines[0],quantity:'3'}]},workspace,['r']).total,90);
});
test('same line ID cannot apply an old cost to a different ingredient',()=>{
 const changed={...document,lines:[{...document.lines[0],name:'別的食材'}]};
 assert.equal(recipeCost(changed,workspace,['r']).total,null);
});
test('partial snapshots fill missing costs from a usable price without overwriting saved amounts',()=>{
 const cost={lines:[{id:'a',amount:null,price:null,reason:'待補價格'}],total:null,subtotal:0,missing:1};
 const partial={...workspace,recipes:[{...workspace.recipes[0],approved_cost:{...workspace.recipes[0].approved_cost,cost}}]};
 assert.equal(recipeCost(document,partial,['r']).total,100);
 assert.equal(cost.lines[0].amount,null);
 assert.equal(recipeCost(document,{...partial,cost_mode:'latest'},['r']).total,100);
});
test('a parent keeps its saved preparation cost even when preparation prices change',()=>{
 const parent={...document,lines:[{id:'a',name:'備料',quantity:'2',unit:'份',recipe_id:'child'}]};
 const child={...document,yield:'1',unit:'份'};
 const nested={...workspace,recipes:[{id:'r',document:parent,approved_cost:{id:'v',document:parent,cost:original}}, {id:'child',document:child}]};
 assert.equal(recipeCost(parent,nested,['r']).total,60);
 assert.equal(recipeCost(parent,{...nested,cost_mode:'latest'},['r']).total,200);
});

test('compatible usage unit edits use the saved rate, never the new catalog price',()=>{
 const doc={...document,lines:[{id:'a',name:'食材',quantity:'1000',unit:'g'}]};
 const saved={total:32,subtotal:32,missing:0,lines:[{id:'a',amount:32,reason:null,price:{key:'n:食材',unit:'g',price:.032}}]};
 const ws={...workspace,prices:[{key:'n:食材',unit:'g',price:1}],recipes:[{id:'r',document:doc,approved_cost:{document:doc,cost:saved}}]};
 assert.equal(recipeCost({...doc,lines:[{...doc.lines[0],quantity:'1',unit:'公斤'}]},ws,['r']).total,32);
 assert.equal(recipeCost({...doc,lines:[{...doc.lines[0],quantity:'2',unit:'公斤'}]},ws,['r']).total,64);
});
