import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as selection from '../lib/recipe-export-selection.ts';
import * as organization from '../lib/recipe-organization.ts';
import * as exports from '../lib/recipe-export.ts';
import * as model from '../lib/recipe-cost.ts';

const card=(id,lifecycle,kind='dish')=>({id,recipe_code:`R00${id}`,revision:2,updated_at:'',document:{...model.emptyRecipe(),name:`食譜${id}`,lifecycle,kind},cost:{total:0,subtotal:0,missing:0,lines:[]}});
const recipes=[card('1','serving'),card('2','unused'),card('3','archived'),card('4','ready'),card('5','reserve'),card('prep','serving','prep')];
test('export starts with serving main recipes only and retains all legacy groups for explicit selection',()=>{
 assert.deepEqual(selection.initialRecipeExportSelection(recipes),{status:'serving',selected:['1']});
 assert.deepEqual(selection.initialRecipeExportSelection(recipes.filter(r=>r.id!=='1')),{status:'all',selected:[]});
 assert.deepEqual(selection.recipeExportChoices(recipes,'unset').map(r=>r.id),['5']);
 assert.equal(selection.recipeExportChoices(recipes,'all').length,5);
 assert.deepEqual(selection.recipeExportChoices(recipes,'unused','Ｒ００２').map(r=>r.id),['2']);
});

function harness(mode='export',posState={ready:true,rows:[{scope:'',target_id:'1',mapping:'POS菜名'},{scope:'menu',target_id:'1',mapping:'其他菜單'}],error:''}){
 const slots=[],effects=[];let cursor=0;
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=cursor++;slots[i]??={current:initial};return slots[i];},useMemo(fn){return fn();},useEffect(fn,deps){const i=cursor++;if(!slots[i]||deps.some((value,index)=>!Object.is(value,slots[i][index]))){slots[i]=deps;effects.push(fn);}}};
 const runtime={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};
 const calls=[];
 const workspace={recipes,products:[],prices:[],can_price:true};
 const scope={exports:{},require(name){
  if(name==='react')return react;
  if(name==='react/jsx-runtime')return runtime;
  if(name==='lucide-react')return {Download:'i',Printer:'i'};
  if(name==='@/lib/app-workspace')return {readWorkspace:async()=>workspace,appError:String,parseAppContext:()=>({stores:[]})};
  if(name==='@/lib/supabase-browser')return {supabase:{rpc:async()=>({data:{}})}};
  if(name==='@/lib/recipe-cost')return model;
  if(name==='@/lib/recipe-organization')return organization;
  if(name==='@/lib/recipe-export-selection')return selection;
  if(name==='@/lib/recipe-export')return {...exports,exportRecipeWorkbook:async(...args)=>calls.push(args),openRecipePrint:(...args)=>calls.push(args)};
  if(name==='./pos-cost-mappings')return {usePosCostMappings:()=>({...posState,reload:async()=>{}})};
  if(name==='./recipe-modal')return {default:'dialog'};
  throw Error(name);
 }};
 const code=ts.transpileModule(readFileSync(new URL('../app/pilot/recipe-tools.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 runInNewContext(code,scope);
 const props={mode,store:{id:'s',name:'BeApe',business_type:'SINGLE_RESTAURANT',organization_id:'org'},userId:'u',onClose(){},onMoved(){}};
 return {calls,render(){cursor=0;const tree=scope.exports.default(props);effects.splice(0).forEach(fn=>fn());return tree;}};
}
function nodes(tree){if(!tree)return [];if(Array.isArray(tree))return tree.flatMap(nodes);if(typeof tree!=='object')return [];return [tree,...nodes(tree.props?.children)];}
function text(tree){return Array.isArray(tree)?tree.map(text).join(''):typeof tree==='object'&&tree?text(tree.props?.children):String(tree??'');}
const button=(tree,name)=>nodes(tree).find(n=>n.type==='button'&&text(n).startsWith(name));
const choices=tree=>nodes(nodes(tree).find(n=>n.props?.['aria-label']==='可匯出的主食譜')).filter(n=>n.type==='input');
const selectAll=tree=>nodes(tree).find(n=>n.type==='input'&&typeof n.props.ref==='function');
test('export modal keeps hidden selections across status/search, bulk changes only visible rows, and exports exactly the chosen roots',async()=>{
 const before=JSON.stringify(recipes),h=harness();h.render();await new Promise(resolve=>setImmediate(resolve));let tree=h.render();
 assert.ok(button(tree,'使用中'),text(tree));assert.equal(button(tree,'使用中').props['aria-pressed'],true);
 assert.equal(choices(tree).length,1);assert.equal(choices(tree)[0].props.checked,true);
 button(tree,'未使用').props.onClick();tree=h.render();
 assert.equal(choices(tree).length,1);assert.equal(choices(tree)[0].props.checked,false);
 selectAll(tree).props.onChange({target:{checked:true}});tree=h.render();
 assert.match(text(tree),/跨分類共 2 份已選取/);
 button(tree,'全部').props.onClick();tree=h.render();
 assert.equal(choices(tree).filter(n=>n.props.checked).length,2);
 nodes(tree).find(n=>n.props?.['aria-label']==='搜尋匯出食譜').props.onChange({target:{value:'R002'}});tree=h.render();
 assert.equal(choices(tree).length,1);
 selectAll(tree).props.onChange({target:{checked:false}});tree=h.render();
 assert.match(text(tree),/跨分類共 1 份已選取/);
 await button(tree,'匯出 Excel').props.onClick();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(Array.from(h.calls[0][2]),['1']);
 assert.equal(h.calls[0][4]['1'],'POS菜名');
 button(h.render(),'清除全部').props.onClick();tree=h.render();
 assert.equal(button(tree,'匯出 Excel').props.disabled,true);
 assert.equal(JSON.stringify(recipes),before);
});
test('transfer keeps its single-recipe selector and does not expose export-only filters',async()=>{
 const h=harness('transfer');h.render();await new Promise(resolve=>setImmediate(resolve));const tree=h.render();
 assert.equal(nodes(tree).some(n=>n.props?.['aria-label']==='匯出食譜使用狀態'),false);
 const select=nodes(tree).find(n=>n.type==='select');
 assert.ok(select,text(tree));assert.equal(select.props.value,'1');
 assert.equal(nodes(select).filter(n=>n.type==='option').length,5);
});

test('Excel waits for saved POS mappings and exposes retry instead of silently omitting names',async()=>{
 const h=harness('export',{ready:false,rows:[],error:'POS 對應暫時無法讀取。'});h.render();await new Promise(resolve=>setImmediate(resolve));const tree=h.render();
 assert.equal(button(tree,'匯出 Excel').props.disabled,true);assert.ok(button(tree,'重新讀取 POS 對應'));
 await button(tree,'匯出 Excel').props.onClick();assert.equal(h.calls.length,0);
});
