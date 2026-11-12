import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recipeCostComparison,recipeComponentSources,recipeTrialPriceDetails,signedCost} from '../lib/recipe-cost-comparison.ts';
const cost=(total)=>({total,subtotal:total??5,missing:total===null?1:0,lines:[]});
const doc=(lines=[])=>({name:'配方',kind:'dish',yield:'1',unit:'份',notes:'',lines});
const card={id:'r',document:doc(),cost:cost(100),latest_cost:cost(110)};
test('baseline and complete current trial remain distinct, percentage uses whole recipe',()=>{
 const snapshot=JSON.stringify(card),c=recipeCostComparison(card);
 assert.equal(c.delta,10);assert.equal(c.percent,10);assert.equal(JSON.stringify(card),snapshot);
 assert.equal(recipeCostComparison({...card,approved_cost:{cost:cost(80)}}).before,80);
});
test('partial or absent latest never becomes a total or falls back to historical quotes',()=>{
 assert.equal(recipeCostComparison({...card,latest_cost:cost(null)}).after,null);
 assert.equal(recipeCostComparison({...card,latest_cost:cost(null)}).delta,null);
 assert.equal(recipeCostComparison({...card,latest_cost:undefined},{pricing_loaded:true,prices:[],recipes:[]}).latest,null);
 assert.equal(recipeCostComparison({...card,cost:cost(null)}).percent,null);
 assert.equal(recipeCostComparison({...card,cost:cost(0)}).percent,null);
 assert.equal(signedCost(null),'—');assert.equal(signedCost(-2),'-2.00');
});
test('nested component source amounts honor yield, component loss inclusion and leaf losses without duplicating totals',()=>{
 const root={...card,document:doc([{id:'p',name:'配件',recipe_id:'p',quantity:'2',unit:'份',edible_rate:'0.5',quantity_basis:'net'}])};
 const prep={id:'p',document:{...doc([{id:'q',name:'內層',recipe_id:'q',quantity:'1',unit:'份'}]),yield:'2'}};
 const nested={id:'q',document:doc([{id:'a',name:'奶油',quantity:'10',unit:'g',edible_rate:'0.5',quantity_basis:'net',transfer_prices:[{key:'n:奶油',unit:'g',price:999}],transfer_price_at:'2099-01-01'}])};
 const ws={recipes:[root,prep,nested],prices:[{key:'n:奶油',unit:'g',price:100}],current_prices:[{key:'n:奶油',unit:'g',price:3}],products:[],can_price:true};
 const rows=recipeComponentSources(root,'p',ws);assert.equal(rows.length,1);assert.equal(rows[0].amount,60);
 assert.equal(recipeComponentSources(root,'p',{...ws,current_prices:[]})[0].amount,null);
 assert.equal(recipeComponentSources(root,'p',{...ws,current_prices:[{key:'n:奶油',unit:'g',price:null,cost_price:null}]})[0].amount,null);
 nested.document.lines=[{id:'cycle',name:'循環',recipe_id:'r',quantity:'1',unit:'份'}];
 assert.equal(recipeComponentSources(root,'p',ws)[0].amount,null);
});
test('receipt price and pack specification stay original while per-gram trial remains separate',()=>{
 const price={unit:'g',price:0.3,cost_price:0.3,purchase:{amount:0.3,quantity:1,unit:'g'},source_ref:{receipt_purchase:{amount:300,quantity:1,unit:'包',content_quantity:1000,content_unit:'g'}}};
 assert.deepEqual(recipeTrialPriceDetails(price),{original:'原始進價 NT$ 300／1 包',specification:'每 包 1000 g',converted:'食譜換算成本 NT$ 0.3／g'});
 assert.equal(recipeTrialPriceDetails({...price,source_ref:{}}).original,'原始進價／購買單位未提供');
 assert.equal(recipeTrialPriceDetails({...price,source_ref:{receipt_purchase:{amount:300,quantity:1,unit:'顆'}}}).specification,'原始規格未提供');
});
