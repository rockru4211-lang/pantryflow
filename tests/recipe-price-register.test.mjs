import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {runInNewContext} from 'node:vm';
import * as cost from '../lib/recipe-cost.ts';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const exported={exports:{}};runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/recipe-price-register.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exported.exports,require:()=>cost,Intl,Set,Map});
const {registerDraft,registerPriceInput,priceRegisterRows,pricePackage,priceNeedsAttention}=exported.exports;
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

function uiHarness(canPrice=true){
 const state=[];let cursor=0,tree;
 const react={...React,useState(initial){const index=cursor++;state[index]??={value:typeof initial==='function'?initial():initial};return [state[index].value,v=>{state[index].value=typeof v==='function'?v(state[index].value):v;}];},useRef(initial){const index=cursor++;state[index]??={value:{current:initial}};return state[index].value;}};
 const saved=[];const props={workspace:{recipes:[],products:[],prices:[],suppliers:[{id:'s',name:'大永'}],can_price:canPrice},loaded:true,onSave:async d=>{saved.push(d);return true;}};
 const ui={exports:{}};const compiled=ts.transpileModule(readFileSync(new URL('../app/pilot/recipe-price-register.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
 runInNewContext(compiled,{React:react,exports:ui.exports,document:{activeElement:null},require:name=>name==='react'?react:name==='lucide-react'?{Plus:()=>null,Search:()=>null}:name.includes('/recipe-cost')?cost:name.includes('/recipe-price-register')?exported.exports:name==='./recipe-inline-price'?{recipeInputUnits:['g','公斤','台斤','ml','L','顆','片','份','包','桶','瓶','盒']}:name==='./recipe-modal'?{default:({children})=>React.createElement('section',null,children)}:{},Intl,Set,Map});
 const render=()=>{cursor=0;tree=ui.exports.default(props);return tree;};const walk=n=>!n||typeof n!=='object'?[]:[n,...React.Children.toArray(n.props?.children).flatMap(walk)];
 const find=label=>walk(tree).find(n=>n.props?.['aria-label']===label);
 const click=text=>{const n=walk(tree).find(n=>n.type==='button'&&renderToStaticMarkup(n).includes(text));assert.ok(n,text);n.props.onClick();render();};
 render();return {props,saved,render,html:()=>renderToStaticMarkup(tree),click,fill(label,value){const n=find(label);assert.ok(n,label);n.props.onChange({target:{value}});render();},submit(){walk(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});},tree:()=>tree};
}
test('central form saves supplier and 750g package without a recipe usage field',async()=>{
 const h=uiHarness();h.click('新增價格');h.fill('對照食材名稱','奶油');h.fill('食材供應商','大永');h.fill('採購單價','150');h.fill('採購單位','包');h.fill('每採購單位內容量','750');
 assert.match(h.html(),/\$0.2／g/);assert.doesNotMatch(h.html(),/食譜使用量/);h.submit();await new Promise(resolve=>setImmediate(resolve));h.render();
 assert.equal(h.saved[0].supplier_id,'s');assert.equal(h.saved[0].purchase.content_quantity,750);assert.equal(h.saved[0].price,.2);assert.match(h.html(),/價格已儲存/);
});
test('supervisor can inspect prices but receives no write control',()=>{
 const h=uiHarness(false);h.props.workspace.prices=[{key:'n:奶油',name:'奶油',unit:'g',price:.2,purchase:{amount:150,quantity:1,unit:'包',content_quantity:750,content_unit:'g'}}];h.render();assert.doesNotMatch(h.html(),/新增價格/);h.click('查看');assert.doesNotMatch(h.html(),/type="submit"/);assert.match(h.html(),/<fieldset disabled=""/);
});
