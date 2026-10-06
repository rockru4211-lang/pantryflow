import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as costing from '../lib/recipe-cost.ts';
const scope={exports:{},require:()=>costing};
runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/recipe-price-draft.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,scope);
const {normalizeRecipeDraft,normalizeRecipeLineDraft,recipePriceDraft,changeRecipePriceUnit}=scope.exports;
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
test('explicit unit changes preserve entered numbers and become manual edits',()=>{
 const d={...base,unit:'g',amount:'.4',rawAmount:'.3'};
 const kg=changeRecipePriceUnit(d,'公斤');assert.equal(kg.amount,d.amount);assert.equal(kg.rawAmount,null);
 assert.equal(changeRecipePriceUnit({...d,amount:'700',rawAmount:null},'台斤').amount,'700');
 assert.equal(changeRecipePriceUnit({...d,amount:'700',amountEdited:true},'台斤').amount,'700');
 const piece=changeRecipePriceUnit(d,'顆');assert.equal(piece.amount,d.amount);assert.equal(piece.rawAmount,null);
 const egg=recipePriceDraft({name:'蛋黃',unit:'顆'},{products:[],prices:[{key:'n:蛋黃',unit:'g',price:.42,source:'報價',effective_date:'2026-09-29'}]});assert.equal(egg.amount,'');assert.equal(egg.unit,'顆');
});

test('price entry and unit changes never overwrite recipe quantity, notes save prices per piece',()=>{
 const line={id:'e',name:'蛋黃',quantity:'120',unit:'g',note:'120g 使用 6顆'};
 const before=JSON.stringify(line);const draft=recipePriceDraft(line,{products:[],prices:[]});assert.equal(draft.unit,'顆');
 const n=normalizeRecipeLineDraft(line,{...draft,amount:'8.4'});assert.equal(n.price,8.4);assert.equal(n.unit,'顆');assert.equal(n.purchase.content_quantity,undefined);assert.equal(JSON.stringify(line),before);
 assert.equal(normalizeRecipeLineDraft({...line,note:'取皮切絲'},{...draft,amount:'8.4'}).unit,'顆');
});


test('historical provenance and unknown dates survive editing without inventing a purchase date',()=>{
 const line={id:'b',name:'牛絞肉',quantity:'500',unit:'g'};
 const history={key:'n:牛絞肉',name:'牛絞肉',unit:'g',price:.85714,source:'歷史食譜',source_kind:'history',reference_id:'ref-1',effective_date:null,purchase:{amount:857.14,quantity:1,unit:'公斤'}};
 const d=recipePriceDraft(line,{products:[],prices:[history]});
 assert.equal(d.referenceId,'ref-1');assert.equal(d.date,'');assert.equal(d.amount,'857.14');assert.equal(d.unit,'公斤');
 assert.equal(normalizeRecipeDraft(d,'g').price,.85714);
 assert.throws(()=>normalizeRecipeDraft({...d,referenceId:undefined},'g'));
});
test('pending candidates never silently enter the price draft or the cost',()=>{
 const line={id:'p',name:'豬絞肉',quantity:'500',unit:'g'};
 const candidate={key:'n:豬絞肉',unit:'g',price:.25,source:'請購表',effective_date:'2026-09-11',reference_id:'pending'};
 const workspace={products:[],prices:[],price_candidates:[candidate]};
 assert.equal(recipePriceDraft(line,workspace).amount,'');
 assert.equal(costing.recipeCost({lines:[line],notes:''},workspace).total,null);
});

test('editor calculates kilogram, Taiwanese jin and gram prices despite restored missing snapshots',()=>{
 const lines=[{id:'kg',name:'公斤食材',quantity:'500',unit:'g'},{id:'jin',name:'台斤食材',quantity:'500',unit:'g'},{id:'g',name:'克食材',quantity:'5',unit:'g'}];
 const document={...costing.emptyRecipe(),name:'試算配方',lines};
 const saved={total:null,subtotal:0,missing:3,lines:lines.map(line=>({id:line.id,amount:null,reason:'待補價格或換算',price:null}))};
 const workspace={products:[],prices:[{key:'n:公斤食材',name:'公斤食材',unit:'g',price:.85714}],can_price:true,recipes:[{id:'r',document,approved_cost:{id:'saved',document,cost:saved}}]};
 const draft=(amount,unit)=>({...base,amount,unit,content:'',rawAmount:null});
 const before=JSON.stringify(workspace);
 const preview=scope.exports.recipeEditorPreview(document,workspace,{jin:draft('150','台斤'),g:draft('0.09647577092511013','g')});
 const result=costing.recipeCost(document,preview,['r']);
 assert.equal(result.lines[0].amount,428.57);
 assert.equal(result.lines[1].amount,125);
 assert.equal(result.lines[2].amount,5*.09647577092511013);
 assert.equal(result.missing,0);
 assert.equal(JSON.stringify(workspace),before);
 assert.equal(costing.recipeCost(document,workspace,['r']).total,null);
});
test('editing an existing cost previews new input without approving it; invalid input stays pending',()=>{
 const line={id:'x',name:'豬皮',quantity:'2',unit:'卷'},document={...costing.emptyRecipe(),name:'配方',lines:[line]};
 const saved={total:60,subtotal:60,missing:0,lines:[{id:'x',amount:60,reason:null,price:null}]};
 const workspace={products:[],prices:[{key:'n:豬皮',name:'豬皮',unit:'卷',price:30}],can_price:true,recipes:[{id:'r',document,approved_cost:{id:'v',document,cost:saved}}]};
 const draft={...base,amount:'40',unit:'卷',content:''};
 assert.equal(costing.recipeCost(document,scope.exports.recipeEditorPreview(document,workspace,{x:draft}),['r']).total,80);
 assert.equal(costing.recipeCost(document,scope.exports.recipeEditorPreview(document,workspace,{x:{...draft,amount:''}}),['r']).total,null);
 assert.equal(costing.recipeCost(document,workspace,['r']).total,60);
 const afterSave={...workspace,prices:[{...workspace.prices[0],price:40}]};
 assert.equal(costing.recipeCost(document,scope.exports.recipeEditorPreview(document,afterSave,{}),['r']).total,80);
 assert.equal(costing.recipeCost(document,afterSave,['r']).total,60);
});

test('candidate shortlist favors comparable dated quotes and deduplicates without mutating sources',()=>{
 const line={name:'麵粉',product_id:'p',unit:'g'},quote={key:'p:p',name:'麵粉',unit:'g',price:1,source:'進貨',effective_date:'2026-10-01'};
 const candidates=[{...quote,reference_id:'unknown',effective_date:null},{...quote,reference_id:'mismatch',unit:'包',effective_date:'2026-10-05',conversion_pending:true},{...quote,reference_id:'old',effective_date:'2026-09-01'},{...quote,reference_id:'new'},{...quote,reference_id:'supplier',supplier_name:'另一供應商'}];const before=JSON.stringify(candidates);
 const result=scope.exports.recipePriceCandidates(line,{price_candidates:candidates});assert.equal(result[0].reference_id,'new');assert.equal(result.length,3);assert.ok(result.some(p=>p.reference_id==='supplier'));assert.equal(result.at(-1).reference_id,'mismatch');assert.equal(JSON.stringify(candidates),before);
});

test('usable exact historical prices fill automatically while conflicts and unknown conversions stay pending',()=>{
 const line={id:'a',name:'桃紅鹽',product_id:'p',unit:'g'},quote={key:'p:p',name:'桃紅鹽',unit:'g',price:1,source:'歷史價格',reference_id:'h',effective_date:null};const ws={prices:[],products:[],recipes:[],price_candidates:[quote]};
 assert.equal(scope.exports.recipeUsablePriceDraft(line,ws).amount,'1');assert.equal(scope.exports.recipeUsablePriceDraft(line,{...ws,price_candidates:[quote,{...quote,reference_id:'h2',price:2}]}),undefined);
 for(const patch of [{conversion_pending:true},{source_ref:{missing_price:true}},{key:'p:other'},{unit:'包'}])assert.equal(scope.exports.recipeUsablePriceDraft(line,{...ws,price_candidates:[{...quote,...patch}]}),undefined);
 const dated={...quote,effective_date:'2026-10-01',price:3};assert.equal(scope.exports.recipeUsablePriceDraft(line,{...ws,price_candidates:[quote,dated]}).amount,'3');
 const manual={...base,amount:'27'};assert.equal(scope.exports.recipeInitialPriceDrafts({lines:[line],notes:''},ws,{a:manual}).a.amount,'27');
 assert.equal(scope.exports.recipeUsablePriceDraft(line,{...ws,prices:[{...quote,price:5}]}),undefined);
});

test('saved costs remain visible while pricing is loading or unavailable',()=>{
 const document={...costing.emptyRecipe(),name:'已存配方',lines:[{id:'x',name:'食材',unit:'g',quantity:'2'}]};
 const saved={total:60,subtotal:60,missing:0,lines:[{id:'x',amount:60,reason:null,price:null}]};
 const ws={pricing_loaded:false,recipes:[{id:'r',document,cost:saved,updated_at:''}],prices:[],products:[],can_price:true};
 const preview=scope.exports.recipeEditorPreview(document,ws,{});
 assert.equal(costing.recipeCost(document,preview,['r']).total,60);
 assert.equal(costing.recipeCost({...document,lines:[{...document.lines[0],quantity:'1'}]},preview,['r']).total,30);
 assert.deepEqual(ws.recipes[0].cost,saved);
});

test('editor preserves saved values across price reloads and incomplete conversion drafts',async()=>{
 const {recipeEditorDisplayCost}=await import('../lib/recipe-price-draft.ts');
 const line={id:'a',name:'鮮奶油',quantity:'100',unit:'g'},document={name:'配方',kind:'dish',yield:'1',unit:'份',lines:[line],notes:''};
 const oldPrice={key:'n:鮮奶油',unit:'g',price:.2,source:'舊價',effective_date:null},cost={total:20,subtotal:20,missing:0,lines:[{id:'a',amount:20,reason:null,price:oldPrice}]};
 const workspace={recipes:[{id:'r',document,cost,revision:1}],products:[],prices:[{...oldPrice,price:.3}],can_price:true};
 assert.equal(recipeEditorDisplayCost(document,workspace,{},'r').total,20);
 const draft={amount:'180',rawAmount:null,unit:'瓶',content:'',contentUnit:'g',source:'手動補價',date:'2026-10-06'};
 assert.equal(normalizeRecipeLineDraft(line,draft).unit,'瓶');
 assert.equal(recipeEditorDisplayCost(document,workspace,{a:draft},'r').total,20);
 assert.equal(recipeEditorDisplayCost(document,workspace,{a:{...draft,content:'600'}},'r').total,30);
 assert.equal(recipeEditorDisplayCost({...document,lines:[{...line,name:'另一食材'}]},workspace,{},'r').total,null);
 assert.equal(workspace.recipes[0].cost.total,20);
});

test('list and component display fill saved missing costs with the same device price',()=>{
 const doc={...costing.emptyRecipe(),kind:'prep',name:'麵粉配件',yield:'1',unit:'份',lines:[{id:'flour',name:'麵粉',quantity:'400',unit:'g'}]};
 const missing={total:null,subtotal:0,missing:1,lines:[{id:'flour',amount:null,reason:'待補價格',price:null}]};
 const ws={recipes:[{id:'child',document:doc,cost:missing,updated_at:'',revision:1},{id:'parent',document:{...costing.emptyRecipe(),lines:[{id:'use',name:'麵粉配件',recipe_id:'child',quantity:'1',unit:'份'}]},cost:{...missing,lines:[{id:'use',amount:null,reason:'備料成本未完整',price:null}]},revision:1,updated_at:''}],prices:[],products:[],can_price:true};
 const before=JSON.stringify(ws),draft={...base,amount:'32',content:'1000'};
 const shown=scope.exports.recipeDisplayWorkspace(ws,{child:{flour:draft}});
 assert.equal(shown.recipes[0].cost.total,12.8);assert.equal(shown.recipes[1].cost.total,12.8);
 assert.equal(scope.exports.recipeEditorDisplayCost(doc,shown,{},'child').total,12.8);
 assert.equal(JSON.stringify(ws),before);
 const saved={...ws,recipes:[{...ws.recipes[0],cost:{total:10,subtotal:10,missing:0,lines:[{id:'flour',amount:10,reason:null,price:null}]}}]};
 assert.equal(scope.exports.recipeDisplayWorkspace(saved,{child:{flour:{...draft,content:''}}}).recipes[0].cost.total,10);
});

test('each recipe displays its own saved quote after the shared price changes',()=>{
 const doc={...costing.emptyRecipe(),lines:[{id:'x',name:'麵粉',quantity:'400',unit:'g'}]};
 const quote={key:'n:麵粉',name:'麵粉',unit:'g',price:.032,source:'手動補價',purchase:{amount:32,quantity:1,unit:'包',content_quantity:1000,content_unit:'g'}};
 const card={id:'a',document:doc,cost:{total:12.8,subtotal:12.8,missing:0,lines:[{id:'x',amount:12.8,price:quote,reason:null}]}};
 const ws={recipes:[card],products:[],prices:[{...quote,price:.04,purchase:{...quote.purchase,amount:40}}],can_price:true};
 const own=scope.exports.recipeLockedPriceWorkspace(doc,ws,'a');
 assert.equal(scope.exports.recipePriceDraft(doc.lines[0],own).amount,'32');
 assert.equal(scope.exports.recipeCostChange(card,ws).count,1);
 assert.ok(Math.abs(scope.exports.recipeCostChange(card,ws).percent-25)<1e-8);
 assert.equal(ws.prices[0].purchase.amount,40);assert.equal(card.cost.total,12.8);
 const edited=scope.exports.changeRecipePriceUnit({...base,amount:'2200',content:'5000',unit:'罐'},'桶');
 assert.equal(edited.amount,'2200');assert.equal(edited.content,'5000');assert.equal(edited.unit,'桶');assert.equal(edited.referenceId,undefined);
});

test('whole package usage also retains the package content for other recipes',()=>{
 const n=normalizeRecipeDraft({...base,amount:'32',content:'1000'},'包');
 assert.equal(n.price,32);assert.equal(n.purchase.content_quantity,1000);assert.equal(n.purchase.content_unit,'g');
});
