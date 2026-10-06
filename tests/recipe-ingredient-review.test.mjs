import test from 'node:test';
import assert from 'node:assert/strict';
import {recipeIngredientMovements} from '../lib/recipe-ingredient-review.ts';
import {recipeCost} from '../lib/recipe-cost.ts';
const price=(key,value)=>({key,name:'洋蔥',unit:'g',price:value,source:'請購表',source_ref:{ingredient_id:'onion'},purchase:{amount:value*1000,quantity:1,unit:'公斤'}});
const document=(name,lines,kind='dish')=>({name,kind,yield:'1000',unit:'g',notes:'',lines});
test('one ingredient alert groups confirmed aliases and includes indirect recipes',()=>{
 const a={id:'prep',document:document('醬汁',[{id:'onion',name:'洋蔥',quantity:'100',unit:'g'}],'prep'),revision:1,updated_at:''};
 const b={id:'dish',document:document('主菜',[{id:'prep-use',name:'醬汁',recipe_id:'prep',quantity:'100',unit:'g'}]),revision:1,updated_at:''};
 const c={id:'other',document:document('別名菜',[{id:'alias',name:'黃洋蔥',quantity:'100',unit:'g'}]),revision:1,updated_at:''};
 const old={recipes:[a,b,c],prices:[price('n:洋蔥',.05),price('n:黃洋蔥',.05)],products:[],can_price:true};
 for(const card of old.recipes)card.cost=recipeCost(card.document,old,[card.id]);
 const ws={...old,prices:[price('n:洋蔥',.055),price('n:黃洋蔥',.055)]};
 const groups=recipeIngredientMovements(ws);assert.equal(groups.length,1);assert.equal(groups[0].key,'i:onion');assert.deepEqual(new Set(groups[0].recipeIds),new Set(['prep','dish','other']));assert.ok(Math.abs(groups[0].percent-10)<1e-9);
 assert.deepEqual(recipeIngredientMovements({...ws,pricing_loaded:false}),[]);
 assert.deepEqual(recipeIngredientMovements(old),[]);
});
test('a parent still alerts from its locked prep breakdown after the prep was independently updated',()=>{
 const doc=document('配件',[{id:'onion',name:'洋蔥',quantity:'100',unit:'g'}],'prep');
 const base={recipes:[],prices:[price('n:洋蔥',.05)],products:[],can_price:true};
 const old=recipeCost(doc,base,['prep']),newer={...base,prices:[price('n:洋蔥',.055)]};
 const prep={id:'prep',document:doc,cost:recipeCost(doc,newer,['prep']),revision:1,updated_at:''};
 const parent={id:'parent',document:document('主菜',[{id:'use',name:'配件',recipe_id:'prep',quantity:'100',unit:'g'}]),cost:{total:.5,subtotal:.5,missing:0,lines:[{id:'use',amount:.5,price:null,reason:null,child_snapshot:{document:doc,cost:old}}]},revision:1,updated_at:''};
 const groups=recipeIngredientMovements({...newer,recipes:[prep,parent]});assert.equal(groups.length,1);assert.ok(groups[0].recipeIds.includes('parent'));
});
test('explicitly returning a prep recalculates only the active parent preview',()=>{
 const prepDoc=document('配件',[{id:'onion',name:'洋蔥',quantity:'100',unit:'g'}],'prep');
 const parentDoc=document('主菜',[{id:'use',name:'配件',recipe_id:'prep',quantity:'100',unit:'g'}]);
 const old={lines:[{id:'use',amount:.5,reason:null,price:null}],total:.5,subtotal:.5,missing:0};
 const ws={products:[],prices:[price('n:洋蔥',.055)],can_price:true,recipes:[{id:'prep',document:prepDoc},{id:'parent',document:parentDoc,approved_cost:{document:parentDoc,cost:old}}]};
 assert.equal(recipeCost(parentDoc,ws,['parent']).total,.5);
 assert.equal(recipeCost({...parentDoc,lines:parentDoc.lines.map(line=>({...line,cost_revision:'explicit-save'}))},ws,['parent']).total,.55);
 assert.equal(recipeCost(parentDoc,ws,['parent']).total,.5);
});
