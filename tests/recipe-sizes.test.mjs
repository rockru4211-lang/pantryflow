import test from 'node:test';
import assert from 'node:assert/strict';
import {recipeSizes,recipeSizeBase,recipeSizeView,recipeSizedCard} from '../lib/recipe-model.ts';
import {recipeDirectoryCost} from '../lib/recipe-display.ts';
import {recipeCostComparison} from '../lib/recipe-cost-comparison.ts';
import {recipeExportEntries,recipeWorkbookData,recipePrintHtml} from '../lib/recipe-export.ts';
const line=(id,name,quantity,unit='g')=>({id,name,quantity:String(quantity),unit});
const document={name:'小牛佐羊肚菌醬',kind:'dish',yield:'1',unit:'份',notes:'保留原文',lines:[line('sauce','羊肚菌醬',60),{...line('meat','小牛肋排',499),product_id:'beef',edible_rate:'.8'},line('25','25oz=709-737g',737),line('24','24oz=681-708g',708)],source_cost_per_portion:999};
const cost={total:99999,subtotal:99999,missing:0,lines:[{id:'24',amount:1132.8,price:null,reason:null},{id:'meat',amount:998,price:{price:1.6,unit:'g'},reason:null},{id:'sauce',amount:60,price:null,reason:null},{id:'25',amount:1179.2,price:null,reason:null}]};
const card={id:'r',revision:3,recipe_code:'R000044',updated_at:'',document,cost};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('strict OZ alternatives replace the original meat once and retain shared recipe costs',()=>{
 const before=JSON.stringify(card),view=recipeSizeView(document,cost,'25');
 assert.equal(recipeSizeBase(document).id,'meat');assert.deepEqual(recipeSizes(document).map(s=>s.label),['25 OZ','24 OZ']);
 assert.deepEqual(view.document.lines.map(l=>l.id),['sauce','meat']);assert.equal(view.document.lines[1].quantity,'737');
 // Saved meat amount already includes loss: rescale it once, never reapply .8.
 close(view.cost.total,1534);assert.equal(view.cost.lines.find(l=>l.id==='meat').price.price,1.6);
 close(recipeSizeView(document,cost,'24').cost.total,1476);
 assert.equal(view.document.lines[1].product_id,'beef');assert.equal(JSON.stringify(card),before);
});
test('pack names, a single size, duplicate size headings and prep recipes remain ordinary recipes',()=>{
 for(const doc of [{...document,lines:[line('a','牛排醬 25oz',1),line('b','牛排醬 24oz',1)]},{...document,lines:document.lines.slice(0,3)},{...document,lines:[...document.lines,line('dup','25 OZ',737)]},{...document,kind:'prep'}])assert.equal(recipeSizes(doc).length,0);
});
test('zero and unknown prices stay distinct; hidden alternative prices never block a selected size',()=>{
 const zero={...cost,lines:cost.lines.map(l=>({...l,amount:0}))};assert.equal(recipeSizeView(document,zero,'25').cost.total,0);
 for(const missing of ['sauce','meat']){const partial={...cost,lines:cost.lines.filter(l=>l.id!==missing)};assert.equal(recipeSizeView(document,partial,'25').cost.total,null);}
 assert.equal(recipeSizeView({...document,lines:document.lines.map(l=>l.id==='25'?{...l,quantity:''}:l)},cost,'25').cost.total,null);
 assert.equal(recipeSizeView(document,{...cost,lines:cost.lines.filter(l=>l.id!=='24'&&l.id!=='25')},'25').cost.total,1534);
});
test('ambiguous cuts require an explicit price source and never infer zero cost',()=>{
 const doc={...document,lines:[...document.lines,line('second','一級菲力',500)]};
 assert.equal(recipeSizeBase(doc),null);assert.equal(recipeSizeView(doc,cost).cost.total,null);
 assert.equal(recipeSizeBase({...doc,size_base_line_id:'meat'}).id,'meat');
 assert.equal(recipeSizeBase({...doc,size_base_line_id:'absent'}),null);
});
test('size weights support kilograms and keep missing quantities unresolved',()=>{
 const doc={...document,lines:document.lines.map(l=>l.id==='meat'?{...l,quantity:'.499',unit:'kg'}:l)};
 close(recipeSizeView(doc,cost,'25').cost.total,1534);
});
test('directory shows single-size cost range and latest comparison uses the same selected size',()=>{
 const display=recipeDirectoryCost(card);close(display.amount,1476);close(display.maximum,1534);
 const latest={...cost,lines:cost.lines.map(row=>row.id==='meat'?{...row,amount:row.amount*2}:row)};
 const result=recipeCostComparison({...card,latest_cost:latest},undefined,'24');
 close(result.before,1476);close(result.after,2892);close(result.delta,1416);assert.equal(result.sizeLabel,'24 OZ');
 const projected=recipeSizedCard({...card,approved_cost:{document,cost,at:'',id:'a',origin:'saved_version'}},'24');
 assert.equal(projected.approved_cost.cost.total,1476);assert.equal(projected.document.lines.length,2);
});
test('Excel and print export separate sizes using actual shared costs and original POS mapping',()=>{
 const workspace={recipes:[card],products:[],prices:[],can_price:true},before=JSON.stringify(workspace);
 const entries=recipeExportEntries(workspace,['r']);assert.equal(entries.length,2);
 assert.deepEqual(entries.map(e=>e.card.document.name),['小牛佐羊肚菌醬 · 25 OZ','小牛佐羊肚菌醬 · 24 OZ']);
 close(entries[0].card.cost.total,1534);close(entries[1].card.cost.total,1476);
 const sheets=recipeWorkbookData('BeApe',workspace,['r'],true,{r:'小牛排'});assert.equal(sheets[0].rows.length,3);assert.equal(sheets[0].rows[1][1],'小牛排');assert.equal(sheets[0].rows[1][7],1534);
 const html=recipePrintHtml('BeApe',workspace,['r'],true);assert.match(html,/25 OZ/);assert.match(html,/24 OZ/);assert.doesNotMatch(html,/99,999/);
 assert.equal(JSON.stringify(workspace),before);
});

test('the existing calf recipe gives the source-sheet 25 OZ cost without its duplicate default steak',()=>{
 const doc={...document,lines:[line('common','共用醬汁與調味',1),line('meat','小牛肋排',499),line('26','26oz=738-765g',765),line('25','25oz=709-737g',737)]};
 const saved={total:16623.801696035243,subtotal:16623.801696035243,missing:0,lines:[{id:'common',amount:329.4016960352423,price:null,reason:null},{id:'meat',amount:798.4000000000001,price:null,reason:null}]};
 close(recipeSizeView(doc,saved,'25').cost.total,1508.6016960352422);
 close(recipeSizeView(doc,saved,'26').cost.total,1553.4016960352424);
});
