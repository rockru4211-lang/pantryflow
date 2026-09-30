import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as costing from '../lib/recipe-cost.ts';

const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
const icons=Object.fromEntries(['ArrowLeft','BookOpen','Check','ChevronDown','Copy','Plus','Search','Trash2','X'].map(name=>[name,()=>null]));
function harness(){
 const hooks=[];let cursor=0,tree;
 const react={...React,useState(initial){const index=cursor++;hooks[index]??={value:typeof initial==='function'?initial():initial};return[hooks[index].value,value=>{hooks[index].value=typeof value==='function'?value(hooks[index].value):value;}];},useRef(value){const index=cursor++;hooks[index]??={value:{current:value}};return hooks[index].value;},useEffect(){cursor++;},useCallback(fn){cursor++;return fn;}};
 const props={document:{...costing.emptyRecipe(),name:'炒洋蔥',kind:'prep',yield:'675',unit:'g',portion_quantity:'30',lines:[{id:'a',name:'洋蔥',product_id:'p',quantity:'1000',unit:'g'}]},recipeId:'r',workspace:{recipes:[],products:[{id:'p',name:'洋蔥',unit:'kg'},{id:'q',name:'海鹽',unit:'g'}],prices:[{key:'p:p',unit:'g',price:.07,source:'已核對進貨',effective_date:'2026-09-29'}],can_price:false},status:'已儲存',saving:false,onChange:patch=>{props.document={...props.document,...patch};},onBack(){},onCopy(){},onSave(){},onPrice:async()=>true};
 const pricingScope={exports:{},require:()=>costing};runInNewContext(compile(readFileSync(new URL('../lib/recipe-price-draft.ts',import.meta.url),'utf8')),pricingScope);
 const scope={React,exports:{},crypto:{randomUUID},require:name=>({'react':react,'lucide-react':icons,'@/lib/recipe-cost':costing,'@/lib/recipe-price-draft':pricingScope.exports,'./recipe-inline-price':{recipeInputUnits:['g','公斤','台斤','ml','L','顆','片','份','包','桶','瓶','盒'],default:props=>React.createElement('input',{'aria-label':props.line.name+'成本單價'})},'./recipe-price-editor':{default:()=>null,recipeUnitMoney:value=>`NT$ ${value.toFixed(4)}`}})[name],requestAnimationFrame:()=>{}};
 runInNewContext(compile(readFileSync(new URL('../app/pilot/recipe-editor.tsx',import.meta.url),'utf8')),scope);
 const render=()=>{cursor=0;tree=scope.exports.default(props);return tree;};
 function nodes(predicate){const found=[];function visit(n){if(Array.isArray(n))return n.forEach(visit);if(!React.isValidElement(n))return;if(predicate(n))found.push(n);visit(n.props.children);}visit(tree);return found;}
 function text(n){if(Array.isArray(n))return n.map(text).join('');if(n===null||n===undefined||typeof n==='boolean')return'';return React.isValidElement(n)?text(n.props.children):String(n);}
 function button(name){const found=nodes(n=>n.type==='button'&&(n.props['aria-label']===name||text(n)===name));assert.equal(found.length,1,`One ${name} button`);return found[0];}
 function input(name){const found=nodes(n=>n.type==='input'&&n.props['aria-label']===name);assert.equal(found.length,1);return found[0];}
 render();return{props,render,nodes,input,button,click(name){button(name).props.onClick();render();},fill(name,value){input(name).props.onChange({target:{value}});render();},html(){return renderToStaticMarkup(tree);}};
}

test('recipe editor presents name, editable quantities and live costing together',()=>{
 const h=harness();assert.match(h.html(),/配方名稱/);assert.match(h.html(),/洋蔥用量/);assert.match(h.html(),/NT\$ 70.00/);assert.doesNotMatch(h.html(),/建立配方步驟|查看成本/);
 h.fill('洋蔥用量','2000');assert.match(h.html(),/NT\$ 140.00/);assert.equal(h.props.document.lines[0].quantity,'2000');
 h.fill('每次取用量','60');assert.ok(Math.abs(costing.recipePortionCost(h.props.document,costing.recipeCost(h.props.document,h.props.workspace))-140*60/675)<1e-9);
});
test('switching recipe type never overwrites a filled yield or units',()=>{const h=harness();h.click('備料配方');assert.equal(h.props.document.yield,'675');h.click('出餐菜色');assert.equal(h.props.document.yield,'675');assert.equal(h.props.document.unit,'g');});
test('removed ingredient can be restored in its original position',()=>{const h=harness();h.click('移除洋蔥');assert.equal(h.props.document.lines.length,0);h.click('復原');assert.equal(h.props.document.lines[0].quantity,'1000');assert.equal(h.props.document.lines[0].product_id,'p');});
test('search addition keeps verified product identity and avoids duplicate rows',()=>{
 const h=harness();h.fill('搜尋食材或備料','海鹽');const result=h.nodes(n=>n.type==='button'&&n.props.children?.[0]?.props?.children?.[0]?.props?.children==='海鹽')[0];assert.ok(result);result.props.onClick();h.render();assert.equal(h.props.document.lines[1].product_id,'q');assert.equal(h.props.document.lines[1].quantity,'');
 h.fill('搜尋食材或備料','海鹽');h.nodes(n=>n.type==='button'&&n.props.children?.[0]?.props?.children?.[0]?.props?.children==='海鹽')[0].props.onClick();h.render();assert.equal(h.props.document.lines.length,2);assert.match(h.html(),/成本尚未完整/);
});
test('only authorized price editors receive price controls',()=>{const h=harness();assert.doesNotMatch(h.html(),/洋蔥成本單價/);h.props.workspace.can_price=true;h.render();assert.match(h.html(),/洋蔥成本單價/);});

test('portion conversions require known costs, compatible units and valid finished yields',()=>{
 const d={...costing.emptyRecipe(),kind:'prep',yield:'1',unit:'公斤',portion_quantity:'30',portion_unit:'g'};
 const cost={total:100};assert.equal(costing.recipePortionCost(d,cost),3);
 assert.equal(costing.recipePortionCost({...d,portion_unit:'ml'},cost),null);
 assert.equal(costing.recipePortionCost({...d,yield:''},cost),null);
 assert.equal(costing.recipePortionCost({...d,portion_quantity:'0'},cost),null);
 assert.equal(costing.recipePortionCost(d,{total:null}),null);
});
