import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recipeCost,emptyRecipe,parseRecipeText} from '../lib/recipe-cost.ts';
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
