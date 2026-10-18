import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as costing from '../lib/recipe-cost.ts';
import * as attachment from '../lib/recipe-attachment.ts';
import * as loss from '../lib/recipe-loss.ts';
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
const icons=Object.fromEntries(['ArrowLeft','BookOpen','Check','ChevronDown','ChevronRight','Copy','Plus','Search','Trash2','X'].map(name=>[name,()=>null]));
function harness(storage=new Map()){
 const hooks=[];let cursor=0,tree;
 const react={...React,useState(initial){const index=cursor++;hooks[index]??={value:typeof initial==='function'?initial():initial};return[hooks[index].value,value=>{hooks[index].value=typeof value==='function'?value(hooks[index].value):value;}];},useRef(value){const index=cursor++;hooks[index]??={value:{current:value}};return hooks[index].value;},useEffect(){cursor++;},useCallback(fn){cursor++;return fn;}};
 const props={document:{...costing.emptyRecipe(),name:'炒洋蔥',kind:'prep',yield:'675',unit:'g',portion_quantity:'30',lines:[{id:'a',name:'洋蔥',product_id:'p',quantity:'1000',unit:'g'}]},recipeId:'r',workspace:{recipes:[],products:[{id:'p',name:'洋蔥',unit:'kg'},{id:'q',name:'海鹽',unit:'g'}],prices:[{key:'p:p',unit:'g',price:.07,source:'已核對進貨',effective_date:'2026-09-29'}],can_price:false},status:'已儲存',saving:false,onChange:patch=>{props.document={...props.document,...patch};},onBack(){},onCopy(){},onSave(){},onPrice:async()=>true};
 const pricingScope={exports:{},require:()=>costing};runInNewContext(compile(readFileSync(new URL('../lib/recipe-price-draft.ts',import.meta.url),'utf8')),pricingScope);
 const modules={'react':react,'lucide-react':icons,'@/lib/recipe-cost':costing,'@/lib/recipe-loss':loss,'./recipe-loss-control':{default:()=>null},'@/lib/recipe-attachment':attachment,'@/lib/recipe-price-draft':pricingScope.exports,'./recipe-inline-price':{recipeInputUnits:['g','公斤','台斤','ml','L','顆','片','份','包','桶','瓶','盒','卷'],default:props=>React.createElement('input',{'aria-label':props.line.name+'成本單價'})},'./recipe-modal':{default:props=>React.createElement('dialog',{'aria-label':props.title,open:true},props.children)},'./recipe-price-editor':{default:()=>null,recipeUnitMoney:value=>`NT$ ${value.toFixed(4)}`}};
 const load=path=>{const scope={React,exports:{},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},crypto:{randomUUID},require:name=>modules[name],requestAnimationFrame:()=>{}};runInNewContext(compile(readFileSync(new URL(path,import.meta.url),'utf8')),scope);return scope.exports;};
 modules['./recipe-editor-core']=load('../app/pilot/recipe-editor-core.tsx');const editor=load('../app/pilot/recipe-editor.tsx');
 const render=()=>{cursor=0;const wrapper=editor.default(props);tree=wrapper.type(wrapper.props);return tree;};
 function nodes(predicate){const found=[];function visit(n){if(Array.isArray(n))return n.forEach(visit);if(!React.isValidElement(n))return;if(predicate(n))found.push(n);visit(n.props.children);}visit(tree);return found;}
 function text(n){if(Array.isArray(n))return n.map(text).join('');if(n===null||n===undefined||typeof n==='boolean')return'';return React.isValidElement(n)?text(n.props.children):String(n);}
 function button(name){const found=nodes(n=>n.type==='button'&&(n.props['aria-label']===name||text(n)===name));assert.equal(found.length,1,`One ${name} button`);return found[0];}
 function input(name){const found=nodes(n=>n.type==='input'&&n.props['aria-label']===name);assert.equal(found.length,1);return found[0];}
 render();return{props,render,nodes,input,button,click(name){button(name).props.onClick();render();},fill(name,value){input(name).props.onChange({target:{value}});render();},html(){return renderToStaticMarkup(tree);}};
}
test('recipe editor presents name, editable quantities and live costing together',()=>{const h=harness();assert.match(h.html(),/配方名稱/);assert.match(h.html(),/洋蔥用量/);assert.match(h.html(),/NT\$ 70.00/);assert.doesNotMatch(h.html(),/建立配方步驟|查看成本/);h.fill('洋蔥用量','2000');assert.match(h.html(),/NT\$ 140.00/);assert.equal(h.props.document.lines[0].quantity,'2000');h.fill('每次取用量','60');assert.ok(Math.abs(costing.recipePortionCost(h.props.document,costing.recipeCost(h.props.document,h.props.workspace))-140*60/675)<1e-9);});
test('switching recipe type never overwrites a filled yield or units',()=>{const h=harness();h.click('配件');assert.equal(h.props.document.yield,'675');h.click('主食譜');assert.equal(h.props.document.yield,'675');assert.equal(h.props.document.unit,'g');});
test('removed ingredient can be restored in its original position',()=>{const h=harness();h.nodes(n=>n.props.line?.id==='a'&&n.props.onRemove)[0].props.onRemove();h.render();assert.equal(h.props.document.lines.length,0);h.click('復原');assert.equal(h.props.document.lines[0].quantity,'1000');assert.equal(h.props.document.lines[0].product_id,'p');});
test('search addition keeps verified product identity and avoids duplicate rows',()=>{const h=harness();h.fill('搜尋食材或備料','海鹽');const result=h.nodes(n=>n.type==='button'&&n.props['aria-label']==='加入海鹽')[0];assert.ok(result);result.props.onClick();h.render();assert.equal(h.props.document.lines[1].product_id,'q');assert.equal(h.props.document.lines[1].quantity,'');h.fill('搜尋食材或備料','海鹽');h.nodes(n=>n.type==='button'&&n.props['aria-label']==='加入海鹽')[0].props.onClick();h.render();assert.equal(h.props.document.lines.length,2);assert.match(h.html(),/已計入金額/);});
test('only authorized price editors receive price controls',()=>{const h=harness();h.click('編輯洋蔥');assert.doesNotMatch(h.html(),/洋蔥成本單價/);h.props.workspace.can_price=true;h.render();assert.match(h.html(),/洋蔥成本單價/);});
test('portion conversions require known costs, compatible units and valid finished yields',()=>{const d={...costing.emptyRecipe(),kind:'prep',yield:'1',unit:'公斤',portion_quantity:'30',portion_unit:'g'},cost={total:100};assert.equal(costing.recipePortionCost(d,cost),3);assert.equal(costing.recipePortionCost({...d,portion_unit:'ml'},cost),null);assert.equal(costing.recipePortionCost({...d,yield:''},cost),null);assert.equal(costing.recipePortionCost({...d,portion_quantity:'0'},cost),null);assert.equal(costing.recipePortionCost(d,{total:null}),null);});
test('purchase price remains visible before usage without a normalized-rate column',()=>{const h=harness();h.props.embedded=true;h.render();h.fill('洋蔥用量','');assert.doesNotMatch(h.html(),/洋蔥換算單價/);assert.match(h.html(),/0\.07 元／g/);assert.match(h.html(),/—/);h.fill('洋蔥用量','40');assert.match(h.html(),/NT\$ 2.80/);assert.equal(h.props.document.lines[0].unit,'g');});
test('direct ingredient selection brings its price while preserving recipe usage',()=>{const h=harness();h.props.embedded=true;h.render();h.props.workspace.prices.push({key:'p:q',unit:'g',price:.065,source:'已核對進貨',effective_date:'2026-09-30'});h.fill('第1項食材名稱','海鹽');assert.equal(h.props.document.lines[0].product_id,'q');assert.equal(h.props.document.lines[0].quantity,'1000');assert.equal(h.props.document.lines[0].unit,'g');assert.match(h.html(),/0\.065 元／g/);assert.match(h.html(),/NT\$ 65.00/);h.fill('第1項食材名稱','未建檔食材');assert.equal(h.props.document.lines[0].product_id,undefined);assert.match(h.html(),/—/);assert.doesNotMatch(h.html(),/NT\$ 65.00/);});
test('duplicate catalog names are never silently mapped to an arbitrary product',()=>{const h=harness();h.props.embedded=true;h.render();h.props.workspace.products.push({id:'q2',name:'海鹽',unit:'g'});h.fill('第1項食材名稱','海鹽');assert.equal(h.props.document.lines[0].product_id,undefined);assert.equal(h.props.document.lines[0].quantity,'1000');});
test('component expands in its usage row and opens the linked recipe without changing costs',async()=>{const h=harness();let opened;h.props.document={...costing.emptyRecipe(),name:'主菜',lines:[{id:'linked',name:'舊名稱',recipe_id:'child',quantity:'2',unit:'份'}]};h.props.workspace.recipes=[{id:'child',document:{...costing.emptyRecipe(),name:'配件新名稱',kind:'prep',yield:'10',unit:'份',notes:'慢火煮',lines:[{id:'c',name:'洋蔥',product_id:'p',quantity:'1000',unit:'g'}]}}];h.props.onOpenPrep=id=>{opened=id;};h.render();const before=JSON.stringify(h.props.document);assert.doesNotMatch(h.html(),/recipe-inline-component"|<dialog/);h.click('編輯配件配件新名稱');assert.match(h.html(),/配件新名稱|慢火煮/);assert.match(h.html(),/計入成本 NT\$ 14.00/);assert.doesNotMatch(h.html(),/洋蔥用量|<dialog/);h.click('開啟配件食譜 ');await Promise.resolve();await Promise.resolve();assert.equal(opened,'child');assert.equal(JSON.stringify(h.props.document),before);h.click('編輯配件配件新名稱');assert.doesNotMatch(h.html(),/recipe-inline-component"/);});
test('dish ingredient prices edit in the same row and preserve usage',()=>{const h=harness();h.props.document.kind='dish';h.props.workspace.can_price=true;h.render();assert.match(h.html(),/洋蔥成本單價/);assert.doesNotMatch(h.html(),/<dialog/);h.fill('第1項食材名稱','海鹽');assert.equal(h.props.document.lines[0].quantity,'1000');});
test('component editor supports portion yield and never rewrites ingredient quantities',()=>{const h=harness();h.props.embedded=true;h.render();h.fill('製成量','10');const select=h.nodes(n=>n.type==='select'&&n.props['aria-label']==='製成單位')[0];select.props.onChange({target:{value:'份'}});h.render();assert.equal(h.props.document.unit,'份');assert.equal(h.props.document.lines[0].quantity,'1000');assert.equal(h.props.document.lines[0].unit,'g');assert.match(h.html(),/NT\$ 7.0000/);assert.match(h.html(),/儲存並帶回主表/);assert.doesNotMatch(h.html(),/每次取用量/);});
test('standalone prep uses the same compact table and divides the batch by its visible finished yield',()=>{const h=harness();h.props.workspace.can_price=true;h.props.document.source_name='迷你羅曼凱薩沙拉';h.render();assert.match(h.html(),/recipe-compact-row/);assert.doesNotMatch(h.html(),/洋蔥成本單價|recipe-table-head/);const basics=h.nodes(n=>n.type==='details'&&n.props.className==='recipe-basic-settings')[0];assert.equal(basics.props.open,false);const trial=h.nodes(n=>n.type==='details'&&n.props.className==='recipe-portion')[0];assert.equal(trial.props.open,undefined);const quantity=h.input('製成量');assert.equal(quantity.props.value,'675');h.fill('製成量','1150');assert.equal(h.props.document.lines[0].quantity,'1000');assert.equal(h.props.document.lines[0].unit,'g');assert.match(h.html(),/NT\$ 0.0609/);assert.equal(h.props.document.portion_quantity,'30');h.click('編輯洋蔥單價');assert.match(h.html(),/<dialog/);assert.match(h.html(),/洋蔥成本單價/);});
test('an existing line can choose a prep source while preserving usage and notes',()=>{const h=harness();h.props.document.lines[0].note='保留原做法';h.props.workspace.recipes=[{id:'prep',updated_at:'2026-09-30',document:{...costing.emptyRecipe(),name:'炒洋蔥',kind:'prep',yield:'675',unit:'g',lines:[{id:'x',name:'洋蔥',quantity:'1000',unit:'g',product_id:'p'}]}}];h.click('編輯洋蔥單價');const select=h.nodes(n=>n.type==='select'&&n.props['aria-label']==='洋蔥配件成本來源')[0];assert.ok(select);select.props.onChange({target:{value:'prep'}});h.render();assert.equal(h.props.document.lines[0].recipe_id,'prep');assert.equal(h.props.document.lines[0].product_id,undefined);assert.equal(h.props.document.lines[0].quantity,'1000');assert.equal(h.props.document.lines[0].unit,'g');assert.equal(h.props.document.lines[0].note,'保留原做法');assert.doesNotMatch(h.html(),/<dialog/);});
test('explicit output suggestion requires a click and preserves ingredient quantities',()=>{const h=harness();h.props.document.unit='份';h.props.document.yield='1';h.props.document.notes='製成培根碎 40g 培根油 27g';h.props.embedded=true;h.render();assert.match(h.html(),/採用 40g/);assert.equal(h.props.document.yield,'1');assert.equal(h.props.document.unit,'份');h.click('採用 40g');assert.equal(h.props.document.yield,'40');assert.equal(h.props.document.unit,'g');assert.equal(h.props.document.lines[0].quantity,'1000');assert.equal(h.props.document.lines[0].unit,'g');assert.doesNotMatch(h.html(),/採用 40g/);});
test('usage stays visible and unreferenced source components remain accessible without adding costs',async()=>{const h=harness();let opened;const prep=(id,name,lines=[])=>({id,document:{...costing.emptyRecipe(),name,kind:'prep',source_name:'沙拉',yield:'100',unit:'g',lines}});const base=prep('base','醬底',[{id:'raw',name:'洋蔥',quantity:'1000',unit:'g',product_id:'p'}]),sauce=prep('sauce','醬汁',[{id:'base-use',name:'醬底',quantity:'50',unit:'g',recipe_id:'base'}]),bread=prep('bread','麵包',base.document.lines);h.props.document={...costing.emptyRecipe(),name:'沙拉',source_name:'沙拉',source_section_order:['醬底','醬汁','麵包'],lines:[{id:'sauce-use',name:'醬汁',quantity:'7',unit:'g',recipe_id:'sauce'}]};h.props.workspace.recipes=[bread,sauce,base];h.props.onOpenPrep=id=>{opened=id;};h.render();assert.notEqual(h.nodes(n=>n.props['aria-label']==='食材與用量')[0].props.hidden,true);assert.deepEqual(h.nodes(n=>n.type==='button'&&String(n.props['aria-label']).startsWith('編輯配件')).map(n=>n.props['aria-label']),['編輯配件醬底','編輯配件醬汁','編輯配件麵包']);const before=JSON.stringify(h.props.document),total=costing.recipeCost(h.props.document,h.props.workspace).total;h.click('編輯配件醬汁');assert.match(h.html(),/醬底/);h.click('編輯配件麵包');await Promise.resolve();await Promise.resolve();assert.equal(opened,'bread');assert.equal(JSON.stringify(h.props.document),before);assert.equal(costing.recipeCost(h.props.document,h.props.workspace).total,total);});
test('changing a usage unit preserves the entered quantity',()=>{const h=harness();h.props.embedded=true;h.render();const select=h.nodes(n=>n.type==='select'&&String(n.props['aria-label']).startsWith('洋蔥')&&n.props.value==='g')[0];assert.ok(select);select.props.onChange({target:{value:'卷'}});h.render();assert.equal(h.props.document.lines[0].quantity,'1000');assert.equal(h.props.document.lines[0].unit,'卷');h.fill('洋蔥用量','2');assert.equal(h.props.document.lines[0].quantity,'2');});
test('changing ingredient identity clears transferred price snapshots rather than reusing another item cost',()=>{const h=harness();h.props.embedded=true;h.props.document.lines[0].transfer_prices=[];h.props.document.lines[0].transfer_price_at='2026-10-02T01:00:00Z';h.render();h.fill('第1項食材名稱','海鹽');assert.equal(h.props.document.lines[0].transfer_prices,undefined);assert.equal(h.props.document.lines[0].transfer_price_at,undefined);});

const priceDraft={amount:'80',rawAmount:null,unit:'公斤',content:'',contentUnit:'g',source:'手動補價',date:'2026-10-05'};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
for(const scenario of ['incomplete','complete'])test(`price ${scenario} draft is retained for one atomic recipe save`,async()=>{
 const storage=new Map(),h=harness(storage);let saved=0,calls=0;
 h.props.draftKey='price-draft';h.props.workspace.can_price=true;h.props.embedded=true;h.props.onSave=()=>saved++;h.props.onPrice=async()=>{calls++;return false;};h.render();
 const draft={...priceDraft,...(scenario==='incomplete'?{amount:''}:{})};
 h.nodes(n=>n.props.line?.id==='a'&&n.props.workspace)[0].props.onChange(draft);h.render();h.click('儲存並帶回主表');await settle();h.render();
 assert.equal(saved,1);assert.equal(calls,0);assert.deepEqual(JSON.parse(storage.get('price-draft')).a,draft);assert.doesNotMatch(h.html(),/待補成本/);
});
test('failed device persistence keeps price editor open',async()=>{
 const storage={get:()=>null,set:()=>{throw Error('quota');},delete:()=>{throw Error('quota');}},h=harness(storage);let saved=false;
 h.props.draftKey='draft';h.props.workspace.can_price=true;h.props.embedded=true;h.props.onSave=()=>saved=true;h.render();h.nodes(n=>n.props.line?.id==='a'&&n.props.workspace)[0].props.onChange({...priceDraft,date:''});h.render();h.click('儲存並帶回主表');await settle();h.render();assert.equal(saved,false);assert.match(h.html(),/無法保留裝置草稿/);
});
test('closing an ingredient dialog keeps the price draft without a background price request',async()=>{
 const storage=new Map(),h=harness(storage);let calls=0;h.props.draftKey='draft';h.props.workspace.can_price=true;h.props.onPrice=async()=>{calls++;return false;};h.render();h.click('編輯洋蔥');h.nodes(n=>n.props.line?.id==='a'&&n.props.workspace)[0].props.onChange(priceDraft);h.render();h.click('完成編輯');await settle();h.render();assert.doesNotMatch(h.html(),/<dialog/);assert.equal(calls,0);assert.equal(JSON.parse(storage.get('draft')).a.amount,'80');
});

test('32 per 1kg bag and 400g usage show purchased price and 12.80 cost',()=>{
 const h=harness();h.props.document.lines=[{id:'flour',name:'麵粉',quantity:'400',unit:'g'}];
 h.props.workspace.prices=[{key:'n:麵粉',name:'麵粉',unit:'g',price:.032,purchase:{amount:32,quantity:1,unit:'包',content_quantity:1000,content_unit:'g',conversion_basis:'package'},source:'請購表',effective_date:'2026-10-06'}];
 h.render();assert.match(h.html(),/NT\$ 32／包/);assert.match(h.html(),/每 包 1000 g/);assert.match(h.html(),/12.80/);assert.doesNotMatch(h.html(),/0\.032/);
 h.props.embedded=true;h.render();assert.match(h.html(),/32 元／包/);assert.match(h.html(),/NT\$ 12.80/);assert.doesNotMatch(h.html(),/換算單價|0\.032/);
});
test('partial cost displays a dash without a blocking missing-cost badge',()=>{
 const h=harness();h.props.workspace.prices=[];h.render();assert.match(h.html(),/—/);assert.doesNotMatch(h.html(),/待補成本|待補齊/);
});
test('return stays enabled during a save and preserves all typed price data',async()=>{
 const storage=new Map(),h=harness(storage);let returned=0;
 h.props.draftKey='draft';h.props.embedded=true;h.props.workspace.can_price=true;h.props.onBack=()=>returned++;h.render();
 h.nodes(n=>n.props.line?.id==='a'&&n.props.workspace)[0].props.onChange(priceDraft);h.props.locked=true;h.render();
 const back=h.button('返回主表（保留草稿）');assert.notEqual(back.props.disabled,true);
 const field=h.nodes(n=>n.type==='fieldset')[0];const has=(n,target)=>n===target||Array.isArray(n)&&n.some(x=>has(x,target))||!!n?.props&&has(n.props.children,target);
 assert.equal(has(field,back),false);h.click('返回主表（保留草稿）');await settle();assert.equal(returned,1);assert.equal(JSON.parse(storage.get('draft')).a.amount,'80');
});
test('save timeout reason stays visible in the footer even with pending price drafts',()=>{
 const h=harness(new Map());h.props.embedded=true;h.props.workspace.can_price=true;h.render();h.nodes(n=>n.props.line?.id==='a'&&n.props.workspace)[0].props.onChange(priceDraft);h.props.status='尚未同步：儲存逾時，輸入內容已保留';h.render();
 const footer=h.nodes(n=>n.type==='footer'&&n.props.className==='recipe-footer')[0];assert.match(renderToStaticMarkup(footer),/儲存逾時/);
});

test('compact and embedded editors share actions and only configured loss shows beside quantity',()=>{
 for(const embedded of [false,true]){
  const h=harness();h.props.embedded=embedded;h.render();assert.equal(h.nodes(n=>n.props.onRemove&&n.props.line?.id==='a').length,1);
  assert.equal(h.nodes(n=>n.props.className==='recipe-loss-summary').length,0);
  const actions=h.nodes(n=>n.props.onRemove&&n.props.line?.id==='a')[0];
  actions.props.onChange({...loss.recipeLossPatch('weight','','1000','750','g','g'),note:'去皮切絲'});h.render();
  assert.match(h.html(),/去皮切絲/);assert.equal(h.nodes(n=>n.props.className==='recipe-loss-summary').length,1);
  h.click('洋蔥修改耗損');assert.equal(h.nodes(n=>n.props.onRemove&&n.props.line?.id==='a')[0].props.view,'loss');
 }
});

 test('inline viewing preserves a locked parent cost despite newer component prices',()=>{const h=harness();const child={id:'child',document:{...costing.emptyRecipe(),name:'醬汁',kind:'prep',yield:'100',unit:'g',lines:[{id:'raw',name:'洋蔥',quantity:'1000',unit:'g',product_id:'p'}]}};h.props.document={...costing.emptyRecipe(),name:'主菜',lines:[{id:'use',name:'醬汁',quantity:'10',unit:'g',recipe_id:'child'}]};const saved={total:3,subtotal:3,missing:0,lines:[{id:'use',amount:3,reason:null,price:null}]};h.props.workspace.recipes=[child,{id:'r',document:structuredClone(h.props.document),cost:saved}];h.render();h.click('編輯配件醬汁');assert.match(h.html(),/計入成本 NT\$ 3.00/);assert.equal(h.props.workspace.recipes[1].cost.total,3);h.fill('醬汁用量','20');assert.match(h.html(),/計入成本 NT\$ 6.00/);assert.equal(h.props.workspace.recipes[1].cost.total,3);});
 test('missing component has a recoverable source picker and no empty component card',()=>{const h=harness();h.props.document={...costing.emptyRecipe(),name:'主菜',lines:[{id:'missing',name:'醬汁',recipe_id:'missing',quantity:'10',unit:'g'}]};h.render();assert.doesNotMatch(h.html(),/recipe-components-panel/);h.click('編輯配件醬汁');assert.match(h.html(),/找不到此配件/);h.click('選擇配件來源');assert.match(h.html(),/<dialog/);});

test('source reference preserves sheet tabs, notes and costs and rejects unsafe link protocols',()=>{
 const h=harness(),before=JSON.stringify(h.props.document.lines);
 h.props.document.notes='原始製作說明';h.render();
 const url='https://docs.google.com/spreadsheets/d/example/edit#gid=123';
 h.fill('原始食譜表連結',url);
 const links=h.nodes(n=>n.type==='a'&&n.props.href===url);
 assert.equal(links.length,1);assert.equal(links[0].props.target,'_blank');assert.equal(links[0].props.rel,'noopener noreferrer');
 assert.equal(h.props.document.notes,'原始製作說明');assert.equal(JSON.stringify(h.props.document.lines),before);assert.match(h.html(),/NT\$ 70.00/);
 for(const invalid of ['javascript:alert(1)','data:text/html,test','file:///tmp/test','https://user:password@example.com','未完成網址']){h.fill('原始食譜表連結',invalid);assert.equal(h.nodes(n=>n.type==='a').length,0);assert.match(h.html(),/可先儲存/);}
 h.fill('原始食譜表連結','');assert.equal(h.props.document.source_url,'');assert.equal(h.nodes(n=>n.type==='a').length,0);
});

test('dish groups preserve original line indexes, locked costs and undo order',()=>{
 const h=harness();
 h.props.document={...costing.emptyRecipe(),name:'主菜',lines:[{id:'sauce',name:'醬汁',quantity:'10',unit:'g',recipe_id:'child'},{id:'meat',name:'肉',quantity:'100',unit:'g'},{id:'garnish',name:'配菜',quantity:'1',unit:'份',recipe_id:'other'}]};
 h.props.workspace.recipes=[{id:'r',document:structuredClone(h.props.document),cost:{total:35,subtotal:35,missing:0,lines:[{id:'sauce',amount:3,reason:null,price:null},{id:'meat',amount:30,reason:null,price:null},{id:'garnish',amount:2,reason:null,price:null}]}}];
 h.render();const sections=h.nodes(n=>n.type==='section');
 const formula=sections.find(n=>n.props['aria-label']==='食材與用量'),components=sections.find(n=>n.props['aria-label']==='配件');
 assert.match(renderToStaticMarkup(formula),/data-line-id="meat"/);assert.doesNotMatch(renderToStaticMarkup(formula),/data-line-id="sauce"/);
 assert.match(renderToStaticMarkup(components),/計入成本/);assert.match(renderToStaticMarkup(components),/3.00/);assert.match(renderToStaticMarkup(components),/醬汁用量/);
 h.fill('肉用量','200');assert.match(h.html(),/NT\$ 65.00/);
 h.nodes(n=>n.props.line?.id==='sauce'&&n.props.onRemove)[0].props.onRemove();h.render();h.click('復原');assert.equal(h.props.document.lines[0].id,'sauce');assert.equal(h.props.document.lines[1].quantity,'200');
});
test('existing dish opens directly to formula and settings remain editable through overflow',()=>{
 const h=harness();h.props.document.kind='dish';h.render();const before=JSON.stringify(h.props.document);
 assert.doesNotMatch(h.html(),/配方名稱|原始食譜表連結/);assert.match(h.html(),/出餐用料/);h.click('食譜設定');
 assert.match(h.html(),/配方名稱|原始食譜表連結/);h.fill('製成量','2');h.click('完成設定');assert.doesNotMatch(h.html(),/<dialog/);
 assert.equal(h.props.document.yield,'2');assert.equal(h.props.document.lines[0].quantity,'1000');assert.notEqual(JSON.stringify(h.props.document),before);
});

test('concise notes preserve imported source and price basis through edit, clear and reopen',()=>{
 const original='來源：食譜成本總表\r\n原表每份成本（未稅）：402.48103\r\n原始內容：\r\nB10：洋蔥 | F10：1000 | H10：0.07\r\n';
 const h=harness();h.props.document.notes=original;h.render();
 assert.equal(h.nodes(n=>n.type==='textarea'&&n.props['aria-label']==='做法與重點備註')[0].props.value,'');
 const before=costing.recipeCost(h.props.document,h.props.workspace);
 h.nodes(n=>n.type==='textarea'&&n.props['aria-label']==='做法與重點備註')[0].props.onChange({target:{value:'出餐前加熱'}});h.render();
 assert.equal(costing.recipeNotesView(h.props.document.notes).original,original);
 assert.equal(costing.recipeNotesView(h.props.document.notes).text,'出餐前加熱');
 assert.deepEqual(costing.recipeCost(h.props.document,h.props.workspace),before);
 h.nodes(n=>n.type==='textarea'&&n.props['aria-label']==='做法與重點備註')[0].props.onChange({target:{value:''}});h.render();assert.equal(h.props.document.notes,original);
 assert.equal(costing.recipeNotesView('A5：先煎肉，再加鹽').text,'A5：先煎肉，再加鹽');
});
test('code slots use the matched canonical ingredient and never infer from a similar name',()=>{
 const row={id:'i',ingredient_code:'I0001',name:'洋蔥',unit:'g',aliases:[],cost_price:1,review_status:'confirmed',revision:1,selected_reference:null};
 const workspace={ingredients:[row,{...row,id:'old',ingredient_code:'OLD',canonical_ingredient_id:'i'}]};
 assert.equal(costing.recipeLineCode({ingredient_id:'old'},workspace),'I0001');
 assert.equal(costing.recipeLineCode({name:'洋蔥'},workspace),'—');
 assert.equal(costing.recipeLineCode({ingredient_id:'i',recipe_id:'prep'},workspace),'—');
});

test('dish usage collapses without losing values and component detail appears below the ledger',()=>{
 const h=harness();h.props.document={...costing.emptyRecipe(),name:'主菜',lines:[{id:'use',name:'醬汁',recipe_id:'child',quantity:'10',unit:'g'}]};h.props.workspace.recipes=[{id:'child',document:{...costing.emptyRecipe(),name:'醬汁',kind:'prep',yield:'100',unit:'g',lines:[{id:'raw',name:'洋蔥',product_id:'p',quantity:'1000',unit:'g'}]}}];h.render();
 h.click('編輯配件醬汁');const html=h.html();assert.ok(html.indexOf('recipe-inline-component"')>html.indexOf('recipe-component-ledger-scroll'));assert.match(html,/單位成本/);
 const before=JSON.stringify(h.props.document);h.click('收合出餐用料');assert.equal(h.nodes(n=>n.type==='div'&&n.props.hidden===true).length,1);assert.equal(JSON.stringify(h.props.document),before);h.click('展開出餐用料');assert.equal(h.input('醬汁用量').props.value,'10');assert.ok(h.button('儲存變更'));
});
