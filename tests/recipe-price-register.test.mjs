import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {runInNewContext} from 'node:vm';
import * as cost from '../lib/recipe-cost.ts';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const exported={exports:{}};runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/recipe-price-register.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exported.exports,require:()=>cost,Intl,Set,Map});
const {registerDraft,registerPriceInput,priceRegisterRows,pricePackage,priceNeedsAttention,priceMovement,priceMode}=exported.exports;
const draft=(patch={})=>({...registerDraft(),name:'測試食材',amount:'150',purchaseUnit:'包',content:'750',contentUnit:'g',unit:'g',supplier:'大永',...patch});
test('package, kilogram, Taiwanese catty and count pricing normalize independently',()=>{
 assert.equal(registerPriceInput(draft()).price,.2);
 assert.equal(registerPriceInput(draft({purchaseUnit:'公斤'})).price,.15);
 assert.equal(registerPriceInput(draft({purchaseUnit:'台斤'})).price,.25);
 assert.equal(registerPriceInput(draft({amount:'12',purchaseUnit:'顆',unit:'顆'})).price,12);
 assert.equal(registerPriceInput(draft({amount:'500',purchaseUnit:'桶',content:'5',contentUnit:'L',unit:'ml'})).price,.1);
 assert.throws(()=>registerPriceInput(draft({purchaseUnit:'L',content:'',unit:'g'})),/內容量/);
 assert.throws(()=>registerPriceInput(draft({purchaseUnit:'桶',content:'5',contentUnit:'L',unit:'g'})),/換算/);
 assert.equal(registerPriceInput(draft({amount:'0',estimate:'10',purchaseUnit:'份',unit:'份'})).purchase.cost_unit_price,10);
 assert.throws(()=>registerPriceInput(draft({estimate:'100'})),/高估/);
});
test('historical unknown date and original 750g quote round-trip without inventing price date',()=>{
 const price={key:'n:奶',name:'奶',product_id:null,unit:'g',price:.62,source:'歷史食譜',source_kind:'history',effective_date:null,reference_id:'ref',purchase:{amount:465,quantity:750,unit:'g'},source_ref:{supplier_name:'東遠'}};
 const d=registerDraft({name:'奶',unit:'g',product_id:null,price});const input=registerPriceInput(d);
 assert.equal(input.price,.62);assert.equal(input.effective_date,null);assert.equal(input.supplier_name,'東遠');
 assert.equal(pricePackage({...price,purchase:{amount:700,quantity:1,unit:'台斤'}}),'1 台斤＝600 g');
});
test('supplier and package variants stay separate; pending references never become current prices',()=>{
 const a={key:'n:肉',name:'肉',product_id:null,unit:'g',price:.2,source:'請購表',source_kind:'purchase',effective_date:'2026-10-01',reference_id:'a',purchase:{amount:150,quantity:1,unit:'包',content_quantity:750,content_unit:'g'},source_ref:{supplier_name:'甲'}};
 const ws={recipes:[{document:{name:'出餐',lines:[{name:'肉',quantity:'12',unit:'g'},{name:'油',quantity:'10',unit:'g'},{name:'配件',quantity:'1',unit:'份',recipe_id:'prep'}]}}],prices:[a],products:[],can_price:true,price_references:[{...a,review_status:'confirmed',created_at:'1'},{...a,reference_id:'b',source_ref:{supplier_name:'乙'},review_status:'confirmed',created_at:'2'},{...a,reference_id:'p',name:'油',key:'n:油',review_status:'pending',created_at:'3'},{...a,reference_id:'c',purchase:{...a.purchase,content_quantity:500},review_status:'confirmed',created_at:'0'}]};
 const before=JSON.stringify(ws);const rows=priceRegisterRows(ws);
 assert.equal(rows.filter(r=>r.status==='current').length,1);assert.equal(rows.filter(r=>r.status==='reference').length,2);assert.equal(rows.filter(r=>r.status==='pending').length,1);
 assert.ok(priceNeedsAttention(rows.find(r=>r.status==='pending')));assert.ok(!rows.some(r=>r.name==='配件'));assert.equal(JSON.stringify(ws),before);
});
test('unpriced mass is still missing when only a volume price exists',()=>{
 const rows=priceRegisterRows({recipes:[{document:{name:'醬',lines:[{name:'油',unit:'g',quantity:'10'}]}}],prices:[{key:'n:油',name:'油',unit:'ml',price:.1}],products:[],can_price:true});
 assert.ok(rows.some(r=>r.status==='missing'&&r.unit==='g'));assert.ok(rows.some(r=>r.status==='current'&&r.unit==='ml'));
});
test('historical catalog ingredients are searchable without creating inventory products',()=>{
 const price={key:'n:香草鹽',name:'香草鹽',product_id:null,unit:'g',price:.4,source_kind:'history'};
 const ws={recipes:[],products:[],prices:[price],price_references:[{key:'n:香料',name:'香料',unit:'顆',price:0,review_status:'pending'}],can_price:true};
 const before=JSON.stringify(ws),items=cost.recipeIngredientOptions(ws);
 assert.equal(items.find(x=>x.name==='香草鹽').price.price,.4);
 assert.equal(items.find(x=>x.name==='香料').price,undefined);
 const doc={name:'新食譜',kind:'prep',yield:'10',unit:'g',notes:'',lines:[{id:'a',name:'香草鹽',unit:'g',quantity:'10'}]};
 assert.equal(cost.recipeCost(doc,ws).total,4);assert.equal(JSON.stringify(ws),before);
});
test('an exact manual name quote remains selectable when inventory has the same name',()=>{
 const ws={recipes:[],products:[{id:'p',name:'蛋黃',unit:'公斤'}],prices:[{key:'n:蛋黃',name:'蛋黃',unit:'顆',price:8.4,source_kind:'manual'}],can_price:true};
 const items=cost.recipeIngredientOptions(ws);assert.equal(items.length,1);assert.equal(items[0].product_id,undefined);assert.equal(items[0].unit,'顆');
});
test('missing imported prices open blank instead of presenting zero as a free ingredient',()=>{
 const row={name:'待補食材',unit:'包',status:'pending',price:{price:0,unit:'包',purchase:{amount:0,quantity:1,unit:'包'},source_ref:{missing_price:true}}};
 assert.equal(registerDraft(row).amount,'');assert.equal(registerDraft({...row,status:'current'}).amount,'0');
});

function uiHarness(canPrice=true){
 const state=[];let cursor=0,tree;
 const effects=[];const react={...React,useEffect(fn){effects.push(fn);},useState(initial){const index=cursor++;state[index]??={value:typeof initial==='function'?initial():initial};return [state[index].value,v=>{state[index].value=typeof v==='function'?v(state[index].value):v;}];},useRef(initial){const index=cursor++;state[index]??={value:{current:initial}};return state[index].value;}};
 const saved=[];const props={workspace:{recipes:[],products:[],prices:[],suppliers:[{id:'s',name:'大永'}],can_price:canPrice},loaded:true,onSave:async d=>{saved.push(d);return true;}};
 const ui={exports:{}};const compiled=ts.transpileModule(readFileSync(new URL('../app/pilot/recipe-price-register.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
 runInNewContext(compiled,{React:react,exports:ui.exports,document:{activeElement:null},window:{addEventListener(){},removeEventListener(){}},require:name=>name==='react'?react:name==='lucide-react'?{Plus:()=>null,Search:()=>null,CheckCircle2:()=>null}:name.includes('/recipe-cost')?cost:name.includes('/recipe-price-register')?exported.exports:name==='./recipe-inline-price'?{recipeInputUnits:['g','公斤','台斤','ml','L','顆','片','份','包','桶','瓶','盒']}:name==='./recipe-modal'?{default:({children})=>React.createElement('section',null,children)}:{},Intl,Set,Map});
 const render=()=>{cursor=0;effects.length=0;tree=ui.exports.default(props);effects.forEach(fn=>fn());return tree;};const walk=n=>!n||typeof n!=='object'?[]:[n,...React.Children.toArray(n.props?.children).flatMap(walk)];
 const find=label=>walk(tree).find(n=>n.props?.['aria-label']===label);
 const click=text=>{const n=walk(tree).find(n=>n.type==='button'&&renderToStaticMarkup(n).includes(text));assert.ok(n,text);n.props.onClick();render();};
 render();return {props,saved,render,html:()=>renderToStaticMarkup(tree),click,fill(label,value){const n=find(label);assert.ok(n,label);n.props.onChange({target:{value}});render();},submit(){walk(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});},tree:()=>tree};
}
test('central form saves supplier and 750g package without a recipe usage field',async()=>{
 const h=uiHarness();h.click('新增食材');h.fill('對照食材名稱','奶油');h.fill('食材供應商','大永');h.fill('採購單價','150');h.fill('採購單位','包');h.fill('每採購單位內容量','750');
 assert.match(h.html(),/\$0.2／g/);assert.doesNotMatch(h.html(),/食譜使用量/);h.submit();await new Promise(resolve=>setImmediate(resolve));h.render();
 assert.equal(h.saved[0].supplier_id,'s');assert.equal(h.saved[0].purchase.content_quantity,750);assert.equal(h.saved[0].price,.2);assert.match(h.html(),/價格已儲存/);
});
test('supervisor can inspect prices but receives no write control',()=>{
 const h=uiHarness(false);h.props.workspace.prices=[{key:'n:奶油',name:'奶油',unit:'g',price:.2,purchase:{amount:150,quantity:1,unit:'包',content_quantity:750,content_unit:'g'}}];h.render();assert.doesNotMatch(h.html(),/新增食材/);h.click('查看');assert.doesNotMatch(h.html(),/type="submit"/);assert.match(h.html(),/<fieldset disabled=""/);
});
test('large registers page fifty rows while search still finds prices on later pages',()=>{
 const h=uiHarness();h.props.workspace.prices=Array.from({length:121},(_,i)=>({key:`n:食材${String(i).padStart(3,'0')}`,name:`食材${String(i).padStart(3,'0')}`,unit:'g',price:1}));h.render();
 assert.equal((h.html().match(/scope="row"/g)||[]).length,50);h.click('下一頁');assert.match(h.html(),/第 2／3 頁/);
 h.fill('搜尋食材或供應商','食材120');assert.match(h.html(),/食材120/);assert.equal((h.html().match(/scope="row"/g)||[]).length,1);
});

test('movements use actual prices, tolerate zero and never compare historical estimates',()=>{
 assert.ok(Math.abs(priceMovement({source_kind:'purchase',price:1.2,previous_price:1,cost_price:1.5}).percent-20)<1e-10);
 assert.equal(priceMovement({source_kind:'purchase',price:1,previous_price:0}).percent,null);
 assert.equal(priceMovement({source_kind:'history',price:1,previous_price:.5}),null);
 assert.equal(priceMovement({source_kind:'purchase',price:1}),null);
 assert.equal(priceMode({price:1,cost_price:1.5}),'高估價');
});
test('price page filters increases and protects unsaved matching edits',async()=>{
 const h=uiHarness();let leave;
 h.props.registerLeave=fn=>{leave=fn;};
 h.props.workspace.products=[{id:'product-a',name:'進貨奶油',unit:'包'}];
 h.props.workspace.prices=[{key:'n:奶油',name:'奶油',unit:'g',price:.24,previous_price:.2,source_kind:'purchase',source_ref:{supplier_name:'大永'},purchase:{amount:180,quantity:1,unit:'包',content_quantity:750,content_unit:'g'}},{key:'n:鹽',name:'鹽',unit:'g',price:.1,source_kind:'history'}];
 h.render();h.fill('篩選價格狀態','increase');assert.match(h.html(),/20%/);assert.doesNotMatch(h.html(),/<strong>鹽/);
 h.click('編輯');h.fill('對應進貨品項','product-a');assert.equal(await leave(),false);h.render();assert.match(h.html(),/請先儲存價格/);
 h.submit();await new Promise(resolve=>setImmediate(resolve));h.render();assert.equal(h.saved[0].matched_product_id,'product-a');assert.equal(h.saved[0].product_id,null);assert.equal(await leave(),true);
});
