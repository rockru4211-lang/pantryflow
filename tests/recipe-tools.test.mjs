import {RecipeDraftBook} from '../lib/recipe-drafts-core.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recipeCost,emptyRecipe,normalizeRecipePurchase} from '../lib/recipe-cost.ts';
import {recipeFillBlankPrices,changeRecipePriceUnit,normalizeRecipeLineDraft,recipeEditorDisplayCost,recipeCommitPrices} from '../lib/recipe-price-draft.ts';
import {recipeExportEntries,recipePrintHtml,exportSummary} from '../lib/recipe-export.ts';
import {removeMovedRecipeDrafts} from '../lib/recipe-tools-state.ts';
const ws={recipes:[],products:[],prices:[],can_price:true};
const line=(unit='卷',quantity='2')=>({id:'pork',name:'豬皮',quantity,unit,note:'規格參考：600g'});
const quote=(price=30)=>({key:'n:豬皮',name:'豬皮',product_id:null,unit:'卷',price,source:'手動',effective_date:'2026-10-02'});
test('two rolls have explicit each-price semantics, independent of reference weight',()=>{const doc={...emptyRecipe(),lines:[line()]};assert.equal(recipeCost(doc,{...ws,prices:[quote()]}).total,60);assert.equal(recipeCost(doc,{...ws,prices:[quote(60)]}).total,120);assert.equal(recipeCost(doc,{...ws,prices:[quote(0)]}).total,0);assert.equal(recipeCost(doc,ws).total,null);});
test('whole packages reuse confirmed original quote rather than forcing gram conversions',()=>{const purchase={amount:80,quantity:1,unit:'盒',content_quantity:500,content_unit:'g'};const n=normalizeRecipePurchase(purchase,'g');const workspace={...ws,prices:[{...quote(),unit:n.unit,price:n.price,purchase}]};assert.equal(recipeCost({...emptyRecipe(),lines:[line('盒','1')]},workspace).total,80);assert.equal(recipeCost({...emptyRecipe(),lines:[line('盒','0.5')]},workspace).total,40);assert.equal(recipeCost({...emptyRecipe(),lines:[line('g','100')]},workspace).total,16);});
test('explicit unit edits preserve numbers for the user to save',()=>{const draft={amount:'60',rawAmount:'50',unit:'片',content:'',contentUnit:'g',source:'手動',date:'2026-10-02',amountEdited:true};const next=changeRecipePriceUnit(draft,'卷');assert.equal(next.amount,'60');assert.equal(next.rawAmount,null);assert.equal(changeRecipePriceUnit({...draft,unit:'公斤',amountEdited:false},'g').amount,'60');assert.equal(changeRecipePriceUnit({...draft,unit:'g',amount:'700'},'台斤').amount,'700');});
test('new explicit package conversions do not require prose notes',()=>{const draft={amount:'60',rawAmount:null,unit:'片',content:'300',contentUnit:'g',source:'手動',date:'2026-10-02'};const n=normalizeRecipeLineDraft(line('g','100'),draft);assert.equal(n.purchase.conversion_basis,'package');assert.equal(n.price,0.2);assert.equal(recipeCost({...emptyRecipe(),lines:[line('g','100')]},{...ws,prices:[{...quote(),unit:'g',price:n.price,purchase:n.purchase}]}).total,20);});
test('transfer snapshots preserve cost without replacing target-store common prices',()=>{const saved={...line(),transfer_prices:[quote()],transfer_price_at:'2026-10-02T01:00:00Z'};const prior={...quote(99),recorded_at:'2026-10-01T01:00:00Z'};assert.equal(recipeCost({...emptyRecipe(),lines:[saved]},{...ws,prices:[prior]}).total,60);assert.equal(prior.price,99);assert.equal(recipeCost({...emptyRecipe(),lines:[saved]},{...ws,prices:[{...prior,recorded_at:'2026-10-02T02:00:00Z'}]}).total,198);});
test('export includes a shared component once and never sums it again into parent cost',()=>{const prep={id:'prep',revision:1,updated_at:'',document:{...emptyRecipe(),name:'皮',kind:'prep',yield:'2',unit:'卷',lines:[line()]}};const dish={id:'dish',revision:1,updated_at:'',document:{...emptyRecipe(),name:'菜',lines:[{...line(),'recipe_id':'prep'}]}};const workspace={...ws,recipes:[dish,{...dish,id:'dish2'},prep],prices:[quote()]};const entries=recipeExportEntries(workspace,['dish','dish2']);assert.equal(entries.length,3);assert.equal(entries.filter(e=>e.card.id==='prep').length,1);assert.equal(entries.find(e=>e.card.id==='prep').parents.length,1);assert.equal(exportSummary(entries[0]).total,60);});
test('print escapes content and hides all financial fields for kitchen copies',()=>{const doc={...emptyRecipe(),name:'<script>alert(1)</script>',notes:'<img src=x onerror=alert(1)>',lines:[line()]};const card={id:'r',revision:1,updated_at:'',document:doc};const workspace={...ws,recipes:[card],prices:[quote()]};const text=recipePrintHtml('BeApe',workspace,['r'],false);assert.ok(text.includes('&lt;script&gt;'));assert.ok(!text.includes('<script>'));assert.ok(!text.includes('NT$'));assert.ok(text.includes('規格參考：600g'));assert.ok(recipePrintHtml('BeApe',workspace,['r'],true).includes('60.00'));});
test('unknown prices stay pending in exported summaries',()=>{const card={id:'r',revision:1,updated_at:'',document:{...emptyRecipe(),lines:[line()]}};assert.equal(exportSummary(recipeExportEntries({...ws,recipes:[card]},['r'])[0]).total,null);});
test('confirmed moves clear only saved local tabs; dirty drafts are never deleted',()=>{const document={...emptyRecipe(),name:'菜'};const raw=JSON.stringify({version:2,drafts:[{id:'a',document,saved:JSON.stringify(document)}],tabs:['a'],active:'a',imports:[{state:'ready',recipeIds:['a']}]});assert.deepEqual(JSON.parse(removeMovedRecipeDrafts(raw,['a'])).drafts,[]);assert.throws(()=>removeMovedRecipeDrafts(raw.replace('"saved":','"pending":{},"saved":'),['a']));});

test('manual quotes preview and commit without loading current prices',()=>{
 const doc={...emptyRecipe(),name:'保存測試',lines:[line()]};
 const draft={amount:'30',rawAmount:null,unit:'卷',content:'',contentUnit:'g',source:'手動補價',date:'2026-10-06'};
 const saved={id:'saved',revision:1,document:doc,updated_at:'',cost:recipeCost(doc,{...ws,prices:[quote(20)]})};
 const workspace={...ws,pricing_loaded:false,recipes:[saved]};
 assert.equal(recipeEditorDisplayCost(doc,workspace,{'pork':draft},'saved').total,60);
 assert.equal(recipeEditorDisplayCost(doc,workspace,{},'saved').total,40);
 assert.equal(recipeCommitPrices(doc,workspace,{'pork':draft})[0].price,30);
});
test('commit captures new displayed quotes without refreshing locked ingredients',()=>{
 const doc={...emptyRecipe(),name:'保存測試',lines:[line()]};
 const saved={id:'saved',revision:1,document:doc,updated_at:'',cost:recipeCost(doc,{...ws,prices:[quote(20)]})};
 assert.deepEqual(recipeCommitPrices(doc,{...ws,recipes:[saved],prices:[quote(99)]},{}),[]);
 const quotes=recipeCommitPrices(doc,{...ws,prices:[quote(30)]},{});
 assert.equal(quotes.length,1);assert.equal(quotes[0].price,30);
});

test('two rows of the same ingredient keep independent edited prices',()=>{
 const doc={...emptyRecipe(),lines:[{...line(),id:'a'},{...line(),id:'b'}]};
 const draft=amount=>({amount:String(amount),rawAmount:null,unit:'卷',content:'',contentUnit:'卷',source:'手動',date:'2026-10-06'});
 const cost=recipeEditorDisplayCost(doc,{...ws,pricing_loaded:false},{a:draft(30),b:draft(50)},'r');
 assert.deepEqual(cost.lines.map(row=>row.amount),[60,100]);assert.equal(cost.total,160);
});
test('saving a main recipe leaves untouched components locked and saves explicit component edits first',async()=>{
 const values=new Map(),writes=[];
 const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const book=new RecipeDraftBook('test',storage,async pending=>{writes.push(pending.id);return {revision:pending.revision+1};},()=>{},String);
 const prep={...emptyRecipe(),name:'醬',kind:'prep'};
 const dish={...emptyRecipe(),name:'菜',lines:[{...line(),recipe_id:'prep'}]};
 book.add(prep,{id:'prep',revision:1},false);book.add(dish,{id:'dish',revision:1});
 assert.equal(await book.saveTree('dish'),true);assert.deepEqual(writes,['dish']);
 writes.length=0;assert.equal(await book.saveTree('dish',id=>id==='prep'),true);assert.deepEqual(writes,['prep','dish']);
});
test('failed component identifies its own error and retains its retry token',async()=>{
 const storage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
 const book=new RecipeDraftBook('test',storage,async()=>{throw Error('network');},()=>{},String);
 book.add({...emptyRecipe(),name:'白醬'}, {id:'prep',revision:1},false);
 book.add({...emptyRecipe(),name:'主表',lines:[{...line(),recipe_id:'prep'}]},{id:'dish',revision:1});
 assert.equal(await book.saveTree('dish',()=>true),false);
 assert.match(book.saveError,/白醬/);assert.ok(book.drafts.get('prep').pending);
});

test('server-confirmed moves remove dirty local drafts from the old store and retain a recovery copy',async()=>{
 const {RecipeDraftBook:Book}=await import('../lib/recipe-drafts.ts');
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const book=new Book('store:workspace-v2',storage,async()=>({revision:1}),()=>{},String);
 const id=book.add({...emptyRecipe(),name:'已移轉食譜'},{id:'moved',revision:1});
 book.edit(id,{...book.drafts.get(id).document,notes:'尚未送出的備註'});
 storage.setItem('store:moved:prices','{"line":"retained"}');
 book.refresh({...ws,moved_recipe_ids:['moved']});
 assert.equal(book.drafts.has(id),false);assert.equal(book.tabs.includes(id),false);
 assert.equal(book.overlay(ws).recipes.length,0);
 const archive=JSON.parse(storage.getItem('store:workspace-v2:moved-archive'));
 assert.equal(archive.moved.draft.document.notes,'尚未送出的備註');
 assert.equal(archive.moved.prices,'{"line":"retained"}');
 assert.equal(storage.getItem('store:moved:prices'),null);
 const other=book.add({...emptyRecipe(),name:'未移轉的草稿'});
 book.refresh({...ws,moved_recipe_ids:['moved']});assert.equal(book.drafts.has(other),true);
});

test('fill prices visits components once and preserves manual and locked quotes',()=>{
 const blank={id:'new',name:'糖',quantity:'10',unit:'g'};
 const locked={...blank,id:'locked'};
 const manual={...blank,id:'manual'};
 const unmatched={...blank,id:'missing',name:'未知'};
 const child={id:'child',revision:1,updated_at:'',document:{...emptyRecipe(),kind:'prep',name:'配件',lines:[blank,locked,manual,unmatched]},cost:{total:null,subtotal:8,missing:3,lines:[{id:'locked',amount:8,price:null,reason:null}]}};
 const root={id:'root',revision:0,updated_at:'',document:{...emptyRecipe(),name:'主表',component_order:['child'],lines:[{id:'use',name:'配件',quantity:'1',unit:'g',recipe_id:'child'}]},cost:{total:null,subtotal:0,missing:1,lines:[]}};
 const draft={amount:'9',rawAmount:null,unit:'g',content:'',contentUnit:'g',source:'手動',date:'2026-10-06'};
 const workspace={...ws,can_price:true,recipes:[root,child],prices:[{key:'n:糖',name:'糖',product_id:null,unit:'g',price:2,source:'請購表',effective_date:'2026-10-06'}]};
 const existing={child:{manual:draft}};
 const result=recipeFillBlankPrices('root',workspace,existing);
 assert.equal(result.filled,1);assert.equal(result.missing,1);
 assert.equal(result.drafts.child.new.amount,'2');
 assert.equal(result.drafts.child.manual,draft);
 assert.equal(result.drafts.child.locked,undefined);
 assert.equal(existing.child.new,undefined);
 assert.equal(recipeEditorDisplayCost(child.document,workspace,result.drafts.child,'child').lines[0].amount,20);
 const commit=recipeCommitPrices(child.document,workspace,result.drafts.child);
 assert.equal(commit.find(row=>row.line_id==='new').price,2);
 assert.equal(recipeFillBlankPrices('root',workspace,result.drafts).filled,0);
});
test('fill prices leaves incompatible units blank',()=>{
 const card={id:'r',revision:0,updated_at:'',document:{...emptyRecipe(),lines:[{id:'x',name:'糖',quantity:'2',unit:'顆'}]},cost:{total:null,subtotal:0,missing:1,lines:[]}};
 const result=recipeFillBlankPrices('r',{...ws,recipes:[card],prices:[{key:'n:糖',name:'糖',product_id:null,unit:'g',price:2,source:'請購表',effective_date:'2026-10-06'}]},{});
 assert.equal(result.filled,0);assert.equal(result.missing,1);
});
