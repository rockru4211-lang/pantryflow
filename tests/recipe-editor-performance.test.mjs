import test from 'node:test';import assert from 'node:assert/strict';
import{emptyRecipe}from'../lib/recipe-cost.ts';import{recipeEditorRecipeIds,recipeLocalDraftWorkspace}from'../lib/recipe-price-draft.ts';import{RecipeDraftBook}from'../lib/recipe-drafts-core.ts';
const card=(id,lines=[],extra={})=>({id,revision:1,updated_at:'',document:{...emptyRecipe(),name:id,lines,...extra},cost:{total:4,subtotal:4,missing:0,lines:lines.map(line=>({id:line.id,amount:4,reason:null,price:null}))}});
const ws=recipes=>({recipes,prices:[],products:[],can_price:true});
test('editing scope includes nested and source components while keeping unrelated snapshots untouched',()=>{
 const main=card('main',[{id:'use',name:'sauce',recipe_id:'sauce',quantity:'1',unit:'份'}],{source_import_id:'batch',source_name:'file',source_section_order:['main','sauce','side']}),sauce=card('sauce',[],{kind:'prep',source_import_id:'batch',source_name:'file'}),side=card('side',[],{kind:'prep',source_import_id:'batch',source_name:'file'});
 const others=Array.from({length:500},(_,i)=>card(`unrelated-${i}`)),workspace=ws([main,sauce,side,...others]);
 const ids=recipeEditorRecipeIds(workspace,'main');assert.deepEqual(new Set(ids),new Set(['main','sauce','side']));
 let unrelatedReads=0;for(const other of others)Object.defineProperty(other.document,'lines',{get(){unrelatedReads++;return [];}});
 const preview=recipeLocalDraftWorkspace(workspace,{},ids);assert.equal(unrelatedReads,0);assert.equal(preview.recipes[3],others[0]);assert.equal(others[0].cost.total,4);
 assert.equal(recipeLocalDraftWorkspace(workspace,{},[]),workspace);
});
test('a scoped child price edit updates its open parent without repricing a different recipe',()=>{
 const raw={id:'raw',name:'食材',quantity:'20',unit:'g'},sauce=card('sauce',[raw],{kind:'prep',yield:'100',unit:'g'});sauce.cost={lines:[{id:'raw',amount:null,price:null,reason:'待補價格'}],total:null,subtotal:0,missing:1};
 const main=card('main',[{id:'use',name:'sauce',recipe_id:'sauce',quantity:'25',unit:'g'}]);main.cost={lines:[{id:'use',amount:null,price:null,reason:'待補配件成本'}],total:null,subtotal:0,missing:1};const other=card('other',[{...raw,id:'other-raw'}]);
 const workspace=ws([main,sauce,other]),draft={amount:'200',rawAmount:null,unit:'公斤',content:'',contentUnit:'g',source:'手動補價',date:'2026-11-20'};
 const preview=recipeLocalDraftWorkspace(workspace,{sauce:{raw:draft}},recipeEditorRecipeIds(workspace,'main'));
 assert.equal(preview.recipes[1].cost.total,4);assert.equal(preview.recipes[0].cost.total,1);assert.equal(preview.recipes[2],other);assert.equal(main.cost.total,null);
});
test('overlay does not serialize unchanged same-revision drafts on each typing preview',()=>{
 const storage=new Map(),book=new RecipeDraftBook('test',{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},async()=>({revision:2}),()=>{},String);
 let serializations=0;const recipes=Array.from({length:40},(_,i)=>{const c=card('r'+i);c.document=new Proxy(c.document,{get(target,key){if(key==='toJSON')serializations++;return Reflect.get(target,key);}});book.drafts.set(c.id,{id:c.id,revision:1,document:c.document,saved:JSON.stringify(c.document)});return c;});
 serializations=0;const preview=book.overlay(ws(recipes));assert.equal(serializations,0);assert.equal(preview.recipes.length,40);
 book.drafts.set('r0',{...book.drafts.get('r0'),document:{...recipes[0].document,name:'已輸入新名稱'}});assert.equal(book.overlay(ws(recipes)).recipes[0].document.name,'已輸入新名稱');
});
