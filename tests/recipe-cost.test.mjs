import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recipeCost,emptyRecipe,parseRecipeText,normalizeRecipePurchase,recipeUnit,recipeCountHint,recipePurchaseUnitAmount,recipeNoteBasis,recipeNoteText,linkRecipePreps,recipePrepOptions,recipeYieldHint} from '../lib/recipe-cost.ts';
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

test('per-unit input preserves old total quotes and conservative cost stays separate',()=>{
 const old={key:'n:羅曼',price:50,unit:'顆',purchase:{amount:1500,quantity:5,unit:'盒',content_quantity:6,content_unit:'顆'}};
 assert.equal(recipePurchaseUnitAmount(old),300);
 const n=normalizeRecipePurchase({...old.purchase,cost_unit_price:360},'顆');
 assert.equal(n.price,50);assert.equal(n.costPrice,60);
 assert.throws(()=>normalizeRecipePurchase({...old.purchase,cost_unit_price:299},'顆'));
 assert.equal(normalizeRecipePurchase(old.purchase,'顆').costPrice,null);
 const d={...doc,lines:[{id:'egg',name:'蛋黃',quantity:'6',unit:'顆'}]};
 const eggPrice={key:'n:蛋黃',unit:'顆',price:8.4,cost_price:9};
 assert.equal(recipeCost(d,{...ws,prices:[eggPrice]}).total,54);
 assert.equal(recipeCost(d,{...ws,prices:[{...eggPrice,cost_price:null}]}).total.toFixed(2),'50.40');
 assert.equal(normalizeRecipePurchase({amount:700,quantity:1,unit:'公斤'},'g').price*40,28);
});
test('name count hint is explicit and leaves ambiguous units unresolved',()=>{
 assert.deepEqual(recipeCountHint('蛋黃（6顆）'),{name:'蛋黃',quantity:'6',unit:'顆'});
 assert.deepEqual(recipeCountHint('餅皮 (2片)'),{name:'餅皮',quantity:'2',unit:'片'});
 assert.equal(recipeCountHint('蛋黃（少許）'),null);
 assert.equal(recipeCountHint('蛋黃'),null);
});

test('cost notes keep 120g unchanged while costing six eggs',()=>{
 const egg={id:'egg',name:'蛋黃',quantity:'120',unit:'g',note:'120g 使用 6顆蛋'};
 const before=JSON.stringify(egg);
 const doc={...emptyRecipe(),notes:'',lines:[egg]};
 const workspace={...ws,prices:[{key:'n:蛋黃',unit:'顆',price:8.4}]};
 assert.deepEqual(recipeNoteBasis(egg),{quantity:120,unit:'g',count:6,countUnit:'顆'});
 assert.equal(recipeCost(doc,workspace).total.toFixed(2),'50.40');
 assert.equal(JSON.stringify(egg),before);
 assert.equal(recipeCost({...doc,lines:[{...egg,quantity:'60'}]},workspace).total.toFixed(2),'25.20');
 assert.equal(recipeCost({...doc,lines:[{...egg,note:'120g 使用 8顆'}]},workspace).total.toFixed(2),'67.20');
 assert.equal(recipeCost({...doc,lines:[{...egg,note:''}]},workspace).total,null);
});
test('original source notes provide a cost basis without editing ingredient names or units',()=>{
 const egg={id:'egg',name:'蛋黃（6顆）',quantity:'120',unit:'g'};
 const source='【大蒜美乃滋】製成 1150g\n 蛋黃   120g(6 顆 )\n 芥花油 700g';
 assert.equal(recipeNoteText(egg,source),'120 g 使用 6 顆');
 assert.equal(recipeNoteBasis({...egg,quantity:'240'},source).quantity,120);
 assert.equal(recipeNoteBasis(egg,'蒜仁 120g(6 顆)'),null);
 assert.equal(recipeNoteBasis(egg,'蛋黃 120g(6 顆)\n蛋黃 120g(8 顆)'),null);
 assert.equal(recipeNoteBasis({...egg,note:'取皮切絲，汁40g'},source),null);
 assert.equal(recipeNoteBasis({...egg,note:'120g 使用 6顆或8顆'},source),null);
});
test('legacy normalized count quotes use each recipe note instead of overwriting another recipe basis',()=>{
 const egg={id:'e',name:'蛋黃',quantity:'120',unit:'g',note:'120g 使用 6顆'};
 const workspace={...ws,prices:[{key:'n:蛋黃',unit:'g',price:.56,cost_price:.6,purchase:{amount:8.4,quantity:1,unit:'顆',content_quantity:15,content_unit:'g',cost_unit_price:9}}]};
 assert.equal(recipeCost({...emptyRecipe(),lines:[egg]},workspace).total,54);
 assert.equal(recipeCost({...emptyRecipe(),lines:[{...egg,note:'120g 使用 8顆'}]},workspace).total,72);
 assert.equal(recipeCost({...emptyRecipe(),lines:[{...egg,note:''}]},workspace).total,null);
});
test('existing prep links by exact name and compatible output unit without copying rounded prices',()=>{
 const child={id:'mayo',document:{...doc,name:'大蒜美乃滋',yield:'1150',lines:[{id:'cost',name:'原料',quantity:'1',unit:'g'}]}};
 const workspace={...ws,recipes:[child,{...child,id:'other',document:{...child.document,yield:'1',unit:'份'}}],prices:[{key:'n:原料',unit:'g',price:196.22}]};
 const parent={...emptyRecipe(),name:'凱薩醬',lines:[{id:'m',name:'大蒜美乃滋',quantity:'400',unit:'g',note:'保留做法'}]};
 const linked=linkRecipePreps(parent,workspace,['caesar']);
 assert.deepEqual(linked.lines[0],{...parent.lines[0],recipe_id:'mayo'});assert.equal(parent.lines[0].recipe_id,undefined);
 assert.equal(recipeCost(linked,workspace).total.toFixed(2),'68.25');
 workspace.prices[0].price=230;assert.equal(recipeCost(linked,workspace).total,80);
 assert.strictEqual(linkRecipePreps(linked,workspace),linked);
 assert.equal(linkRecipePreps({...parent,lines:[{...parent.lines[0],quantity:'0.4',unit:'公斤'}]},workspace).lines[0].recipe_id,'mayo');
});
test('ambiguous names and existing quotes are never overwritten; unresolved prep yields stay pending',()=>{
 const child={id:'prep',document:doc};const parent={...emptyRecipe(),lines:[{id:'use',name:'炒洋蔥',quantity:'30',unit:'g'}]};
 const workspace={...ws,recipes:[child]};
 assert.strictEqual(linkRecipePreps(parent,{...workspace,recipes:[child,{...child,id:'duplicate'}]}),parent);
 const incompatible=linkRecipePreps({...parent,lines:[{...parent.lines[0],unit:'ml'}]},workspace);
 assert.equal(incompatible.lines[0].recipe_id,'prep');assert.equal(recipeCost(incompatible,workspace).total,null);assert.equal(recipeCost(incompatible,workspace).lines[0].reason,'待確認單位換算');
 const missingYield={...workspace,recipes:[{...child,document:{...doc,yield:''}}]};
 assert.equal(recipeCost(linkRecipePreps(parent,missingYield),missingYield).lines[0].reason,'待填製成量');
 assert.strictEqual(linkRecipePreps(parent,{...workspace,prices:[{key:'n:炒洋蔥',unit:'g',price:0}]}),parent);
 const mapped={...parent,lines:[{...parent.lines[0],product_id:'bought'}]};assert.strictEqual(linkRecipePreps(mapped,workspace),mapped);
 assert.strictEqual(linkRecipePreps(parent,workspace,[],['use']),parent);
 assert.strictEqual(linkRecipePreps(parent,{...workspace,recipes:[{...child,document:{...doc,name:'炒洋蔥新版'}}]}),parent);
});
test('prep choices reject self, ancestor and cyclic references',()=>{
 const line={id:'use',name:'炒洋蔥',quantity:'30',unit:'g'};
 const workspace={...ws,recipes:[{id:'parent',document:doc},{id:'child',document:{...doc,lines:[{...line,recipe_id:'parent'}]}}]};
 assert.deepEqual(recipePrepOptions(line,workspace,['parent']),[]);
 const cycle={...workspace,recipes:[{id:'a',document:{...doc,lines:[{...line,recipe_id:'b'}]}},{id:'b',document:{...doc,lines:[{...line,recipe_id:'a'}]}}]};
 assert.deepEqual(recipePrepOptions(line,cycle),[]);
});
test('bacon stored per portion links to gram usage and becomes calculable only after confirming output weight',()=>{
 const bacon={id:'bacon',document:{...emptyRecipe(),kind:'prep',name:'烤培根',yield:'1',unit:'份',notes:'【烤培根】\n壽福培根 100g\n(200 度 8 分鐘)\n製成培根碎 40g 培根油 27g',lines:[{id:'raw',name:'壽福培根',quantity:'100',unit:'g'}]}};
 const workspace={...ws,recipes:[bacon],prices:[{key:'n:壽福培根',price:.8,unit:'g'}]};
 const parent={...emptyRecipe(),lines:[{id:'b',name:'烤培根',quantity:'6',unit:'g'}]};
 const linked=linkRecipePreps(parent,workspace,['salad']);assert.equal(linked.lines[0].recipe_id,'bacon');
 assert.equal(recipeCost(linked,workspace).total,null);assert.equal(bacon.document.yield,'1');
 const hint=recipeYieldHint(bacon.document);assert.deepEqual(hint,{name:'培根碎',quantity:'40',unit:'g'});
 const confirmed={...workspace,recipes:[{...bacon,document:{...bacon.document,yield:hint.quantity,unit:hint.unit}}]};
 assert.equal(recipeCost(linked,confirmed).total,12);assert.equal(linked.lines[0].quantity,'6');assert.equal(bacon.document.lines[0].quantity,'100');
 assert.equal(recipeYieldHint({...bacon.document,notes:'製成培根碎40g\n製成培根油27g'}),null);
 assert.equal(recipeYieldHint({...bacon.document,notes:'壽福培根100g'}),null);
});
