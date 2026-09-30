import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recipeCost,emptyRecipe,parseRecipeText,normalizeRecipePurchase,recipeUnit} from '../lib/recipe-cost.ts';
const doc={...emptyRecipe(),name:'炒洋蔥',kind:'prep',yield:'675',unit:'g',lines:[{id:'a',name:'洋蔥',quantity:'1000',unit:'g',product_id:'p'}]};
const ws={recipes:[],products:[],can_price:false,prices:[{key:'p:p',name:'洋蔥',unit:'g',price:.07}]};
test('finished yield, nested prep and dimensional conversions',()=>{
 assert.equal(recipeCost(doc,ws).total,70);
 const nested={...emptyRecipe(),lines:[{id:'b',name:'炒洋蔥',quantity:'30',unit:'g',recipe_id:'prep'}]};
 assert.equal(recipeCost(nested,{...ws,recipes:[{id:'prep',document:doc}]}).total,70/675*30);
 assert.equal(recipeCost({...doc,lines:[{...doc.lines[0],quantity:'1',unit:'kg'}]},ws).total,70);
});
test('missing costs and unknown conversions never become zero',()=>{
 assert.equal(recipeCost(doc,{...ws,prices:[]}).total,null);
 assert.equal(recipeCost({...doc,lines:[{...doc.lines[0],unit:'ml'}]},ws).total,null);
 assert.equal(recipeCost({...doc,lines:[{...doc.lines[0],quantity:''}]},ws).total,null);
 assert.equal(recipeCost({...doc,lines:[]},ws).total,null);
 assert.equal(recipeCost(doc,{...ws,prices:[{...ws.prices[0],price:0}]}).total,0);
});
test('cycles and missing yields do not produce plausible costs',()=>{
 const self={...doc,lines:[{id:'self',name:'self',recipe_id:'x',quantity:'1',unit:'g'}]};
 assert.equal(recipeCost(self,{...ws,recipes:[{id:'x',document:self}]},['x']).total,null);
 const use={...self,lines:[{...self.lines[0],recipe_id:'x'}]};
 assert.equal(recipeCost(use,{...ws,recipes:[{id:'x',document:{...doc,yield:''}}]}).total,null);
});
test('import splits subrecipes, preserves source, and leaves unspecified yield empty',()=>{
 const text='【炒洋蔥】製成675g 一份30g\n洋蔥 1kg\n芥花油 50g\n細海鹽 7g\n【成品】\n炒洋蔥30g\n軟法1顆';
 const parsed=parseRecipeText(text,'主廚.docx');assert.equal(parsed.length,2);assert.equal(parsed[0].yield,'675');assert.equal(parsed[0].lines.length,3);assert.equal(parsed[1].yield,'');assert.match(parsed[1].notes,/軟法1顆/);
});

test('purchase quote keeps precision from Taiwanese jin to recipe grams',()=>{
 const normalized=normalizeRecipePurchase({amount:700,quantity:1,unit:'台斤'},'g');
 assert.equal(normalized.unit,'g');assert.equal(normalized.baseQuantity,600);
 assert.equal(normalized.price,700/600);
 const cost=recipeCost({...doc,lines:[{...doc.lines[0],quantity:'40'}]}, {...ws,prices:[{...ws.prices[0],price:normalized.price}]});
 assert.equal(cost.total,700/600*40);assert.equal(cost.total.toFixed(2),'46.67');
 assert.equal(normalizeRecipePurchase({amount:700,quantity:1,unit:'臺斤'},'公斤').price,normalized.price);
});
test('per-package content bridges count and weight without guessed weights',()=>{
 const p=normalizeRecipePurchase({amount:300,quantity:1,unit:'盒',content_quantity:6,content_unit:'顆'},'顆');
 assert.equal(p.price,50);assert.equal(p.baseQuantity,6);
 assert.equal(normalizeRecipePurchase({amount:1500,quantity:5,unit:'盒',content_quantity:6,content_unit:'顆'},'pcs').price,50);
 assert.equal(normalizeRecipePurchase({amount:120,quantity:2,unit:'包',content_quantity:.5,content_unit:'公斤'},'g').price,.12);
 assert.equal(normalizeRecipePurchase({amount:10,quantity:1,unit:'顆'},'個').price*6,60);
 assert.equal(recipeUnit('pc'),'顆');
});
test('missing or impossible conversions stay unresolved while explicit free price is valid',()=>{
 for(const quote of [{amount:300,quantity:1,unit:'盒'},{amount:300,quantity:0,unit:'g'},{amount:-3,quantity:1,unit:'g'},{amount:NaN,quantity:1,unit:'g'},{amount:3,quantity:1,unit:'盒',content_quantity:0,content_unit:'g'},{amount:3,quantity:1,unit:'盒',content_quantity:5,content_unit:'ml'}])assert.throws(()=>normalizeRecipePurchase(quote,'g'));
 assert.equal(normalizeRecipePurchase({amount:0,quantity:1,unit:'g'},'g').price,0);
});
