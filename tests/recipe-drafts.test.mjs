import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as costing from '../lib/recipe-cost.ts';
const scope={exports:{},require:()=>costing,crypto,File};
runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/recipe-drafts.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,scope);
const {RecipeDraftBook,importRecipeFiles,importedRecipeCards}=scope.exports;
const storage=()=>{const map=new Map();return{getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};};
const empty={recipes:[],products:[],prices:[],can_price:true};
const doc=name=>({...costing.emptyRecipe(),name,lines:[{id:crypto.randomUUID(),name:'鹽',quantity:'120',unit:'g',note:'原食譜用量'}]});
const book=(write=async p=>({revision:p.revision+1}),store=storage(),key='user:store-a')=>new RecipeDraftBook(key,store,write,()=>{},e=>String(e.message||e));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
const file=(name,text)=>new File([text],name);
const reader=f=>f.text();
const recipe='【醬汁】\n鹽 120g\n製成 1150g\n【出餐】\n醬汁 30g';

test('switching during a save keeps each revision, payload and cost quantity independent',async()=>{
 const gate=deferred(),calls=[];const b=book(async p=>{calls.push(p);if(calls.length===1)await gate.promise;return{revision:p.revision+1};});
 const a=b.add(doc('A')),z=b.add(doc('B'));b.select(a);const saving=b.save(a);b.select(z);b.edit(z,{...b.drafts.get(z).document,yield:'4'});await b.save(z);
 b.edit(a,{...b.drafts.get(a).document,yield:'1150'});gate.resolve();await saving;
 assert.equal(b.active,z);assert.equal(b.drafts.get(a).revision,2);assert.equal(b.drafts.get(z).revision,1);
 assert.equal(b.drafts.get(a).document.yield,'1150');assert.equal(b.drafts.get(z).document.yield,'4');assert.equal(b.drafts.get(a).document.lines[0].quantity,'120');
 assert.equal(calls[2].id,a);assert.equal(calls[2].revision,1);assert.equal(b.dirty(a),false);
});
test('unconfirmed write survives reload and replays unchanged before newer edits',async()=>{
 const persisted=storage(),calls=[];let fail=true;const writer=async p=>{calls.push(p);if(fail)throw Error('network lost');return{revision:p.revision+1};};
 let b=book(writer,persisted);const id=b.add(doc('A'));assert.equal(await b.save(id),false);const request=calls[0].request;
 b.edit(id,{...b.drafts.get(id).document,yield:'1150'});b=book(writer,persisted);fail=false;assert.equal(await b.save(id),true);
 assert.equal(calls[1].request,request);assert.equal(calls[1].document.yield,calls[0].document.yield);assert.notEqual(calls[2].request,request);assert.equal(calls[2].revision,1);assert.equal(b.drafts.get(id).document.yield,'1150');
});
test('partial batch success, duplicate selection, retry and result removal preserve prior recipes',async()=>{
 const b=book(),good=file('沙拉.docx',recipe),bad=file('失敗.pdf','bad');let fail=true;const read=async f=>{if(f===bad&&fail)throw Error('掃描圖片');return f===bad?recipe:f.text();};
 await importRecipeFiles([good,bad],b,empty,read,()=>{});assert.equal(b.imports[0].state,'ready');assert.equal(b.imports[1].state,'error');assert.equal(b.tabs.length,1);assert.equal(b.drafts.size,2);
 const ids=[...b.drafts.keys()];await importRecipeFiles([good],b,empty,read,()=>{});assert.equal(b.drafts.size,2);
 fail=false;await importRecipeFiles([bad],b,empty,read,()=>{});assert.equal(b.drafts.size,4);assert.equal(b.tabs.length,2);await b.saveAll();
 const original=b.imports.find(i=>i.name===good.name);b.removeImport(original.id);await importRecipeFiles([good],b,empty,read,()=>{});
 assert.equal(b.drafts.size,6);for(const id of ids){assert.ok(b.drafts.has(id));assert.equal(b.drafts.get(id).revision,1);}
});
test('two files with the same section names keep their own nested component IDs and usage',async()=>{
 const b=book();await importRecipeFiles([file('菜A.docx',recipe),file('菜B.pdf',recipe)],b,empty,reader,()=>{});
 const workspace=b.overlay(empty);assert.equal(b.tabs.length,2);
 for(const id of b.tabs){const root=workspace.recipes.find(r=>r.id===id);const children=costing.recipeComponents(root,workspace);assert.equal(children.length,1);assert.equal(root.document.lines[0].quantity,'30');assert.equal(children[0].recipe.document.lines[0].quantity,'120');assert.equal(root.document.source_import_id,children[0].recipe.document.source_import_id);}
 assert.notEqual(workspace.recipes.find(r=>r.id===b.tabs[0]).document.lines[0].recipe_id,workspace.recipes.find(r=>r.id===b.tabs[1]).document.lines[0].recipe_id);
});
test('drafts, imports and retry requests are scoped to the user and store; refresh cannot erase unsaved edits',async()=>{
 const persisted=storage(),a=book(undefined,persisted,'user:store-a'),id=a.add(doc('草稿'));await importRecipeFiles([file('菜.docx',recipe)],a,empty,reader,()=>{});
 const b=book(undefined,persisted,'user:store-b');assert.equal(b.drafts.size,0);assert.equal(b.imports.length,0);
 a.refresh({...empty,recipes:[{id,revision:5,document:doc('別人修改'),cost:{},updated_at:''}]});assert.equal(a.drafts.get(id).document.name,'草稿');assert.equal(a.drafts.get(id).revision,0);
 assert.equal(book(undefined,persisted,'other-user:store-a').drafts.size,0);assert.equal(book(undefined,persisted,'user:store-a').drafts.get(id).document.name,'草稿');
});
test('duplicate or cyclic component names are not arbitrarily linked and original text is preserved',()=>{
 const cards=importedRecipeCards('【醬汁】\n醬汁 5g\n製成 100g\n【醬汁】\n鹽 10g\n製成 100g\n【出餐】\n醬汁 30g','菜.docx',empty);
 const root=cards.find(c=>c.document.kind==='dish');assert.equal(root.document.lines[0].recipe_id,undefined);assert.equal(root.document.lines[0].quantity,'30');
});
test('closed tabs do not delete historical recipes; clean restored tabs accept newer cloud revisions',async()=>{
 const persisted=storage(),b=book(undefined,persisted),id=b.add(doc('A'));await b.save(id);b.close(id);assert.equal(b.tabs.length,0);assert.ok(b.drafts.has(id));
 const next=book(undefined,persisted);next.refresh({...empty,recipes:[{id,revision:2,document:doc('最新版本'),cost:{},updated_at:''}]});assert.equal(next.drafts.get(id).document.name,'最新版本');assert.equal(next.drafts.get(id).revision,2);
});


test('one-serving cooking section creates the full dish and keeps each prep yield and portion',()=>{
 const source='【牛豬腸】製成1100g 一份量120g\n牛絞肉500g\n豬絞肉500g\n【炒洋蔥】製成675g 一份30g\n洋蔥1kg\n芥花油50g\n細海鹽7g\n【炒蛤蠣】一份量\n初榨橄欖油10g\n蒜仁5g\n炒洋蔥30g\n拜雍火腿邊角料15g\n牛豬腸絞肉120g\n大蛤蠣200g\n雪莉酒10g';
 const known={...empty,recipes:[{id:'old-prep',document:{...doc('牛豬腸'),kind:'prep'}},{id:'old-dish',document:{...doc('已確認菜色'),lines:[{id:'old',name:'牛豬腸絞肉',unit:'g',quantity:'120',recipe_id:'old-prep'}]}}]};
 const cards=importedRecipeCards(source,'牛豬腸蛤蠣小炒.docx',known),root=cards.find(c=>c.document.kind==='dish');
 assert.equal(cards.length,3);assert.equal(root.document.name,'牛豬腸蛤蠣小炒');assert.equal(root.document.source_section_name,'炒蛤蠣');assert.equal(root.document.yield,'1');assert.equal(root.document.unit,'份');assert.equal(root.document.lines.length,7);
 const beef=cards.find(c=>c.document.name==='牛豬腸'),onion=cards.find(c=>c.document.name==='炒洋蔥');
 assert.equal(beef.document.yield,'1100');assert.equal(beef.document.portion_quantity,'120');assert.equal(onion.document.yield,'675');assert.equal(onion.document.portion_quantity,'30');
 assert.equal(root.document.lines[2].recipe_id,onion.id);assert.equal(root.document.lines[2].quantity,'30');assert.equal(root.document.lines[4].recipe_id,beef.id);assert.equal(root.document.lines[4].name,'牛豬腸絞肉');assert.equal(root.document.lines[4].quantity,'120');
 assert.equal(costing.recipeComponents(root,{...empty,recipes:cards}).length,2);
 const first=importedRecipeCards(source,'首次匯入.docx',empty).find(c=>c.document.kind==='dish');assert.equal(first.document.lines[4].recipe_id,undefined,'unconfirmed name was guessed');
});
test('batch save writes dependent preps first even when a dish appears first in the file',async()=>{
 const stored=new Set(),calls=[];const b=book(async p=>{for(const line of p.document.lines)if(line.recipe_id&&!stored.has(line.recipe_id))throw Error('missing referenced prep');stored.add(p.id);calls.push(p.document.name);return{revision:p.revision+1};});
 await importRecipeFiles([file('菜.docx','【出餐】\n醬汁30g\n【醬汁】製成100g\n鹽10g')],b,empty,reader,()=>{});
 assert.equal(await b.saveAll(),true);assert.deepEqual(calls,['醬汁','出餐']);assert.equal([...b.drafts.keys()].some(id=>b.dirty(id)),false);
});
