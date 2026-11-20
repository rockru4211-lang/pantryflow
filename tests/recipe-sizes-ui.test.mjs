import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as model from '../lib/recipe-cost.ts';
import * as display from '../lib/recipe-display.ts';
import * as organization from '../lib/recipe-organization.ts';
const line=(id,name,quantity)=>({id,name,quantity:String(quantity),unit:'g'});
const card={id:'r',revision:1,updated_at:'',document:{name:'小牛排',kind:'dish',yield:'1',unit:'份',notes:'',lines:[line('sauce','醬汁',1),line('meat','小牛肋排',499),line('25','25oz=709-737g',737),line('24','24oz=681-708g',708)]},cost:{total:3000,subtotal:3000,missing:0,lines:[{id:'sauce',amount:60},{id:'meat',amount:798.4}]}};
function harness(){
 const slots=[];let cursor=0;
 const react={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],value=>slots[index]=typeof value==='function'?value(slots[index]):value];},useEffect(){cursor++;},useRef(value){const index=cursor++;slots[index]??={current:value};return slots[index];}};
 const runtime={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
 const scope={exports:{},require(name){
  if(name==='react')return react;if(name==='react/jsx-runtime')return runtime;if(name==='lucide-react')return {};
  if(name==='@/lib/recipe-model'||name==='@/lib/recipe-cost')return model;
  if(name==='@/lib/recipe-display')return display;if(name==='@/lib/recipe-organization')return organization;
  if(name==='@/lib/data-access')return {canData:()=>false};if(name==='@/lib/app-workspace')return {appError:String};
  if(name==='@/lib/supabase-browser')return {supabase:{}};
  if(name==='./recipe-editor')return {recipeMoney:n=>n===null?'—':`NT$ ${n.toFixed(2)}`};
  if(name==='./recipe-price-editor')return {recipeUnitMoney:n=>`NT$ ${n.toFixed(4)}`};
  if(name==='./recipe-modal')return {default:'modal'};if(name.endsWith('.css'))return {};
  throw Error(name);
 }};
 runInNewContext(ts.transpileModule(readFileSync(new URL('../app/pilot/recipe-detail.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,scope);
 const props={card,workspace:{recipes:[card],products:[],prices:[],can_price:false},store:{id:'s',name:'BeApe',role:'STAFF'},onBack(){},onEdit(){},reload:async()=>{},beforeUpdate:()=>true};
 return {render(){cursor=0;return scope.exports.default(props);}};
}
function nodes(tree){if(!tree)return [];if(Array.isArray(tree))return tree.flatMap(nodes);if(typeof tree!=='object')return [];return [tree,...nodes(tree.props?.children)];}
const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):String(n??'');
test('recipe detail switches one portion, preserves the raw recipe and exposes all size comparisons',()=>{
 const before=JSON.stringify(card),h=harness();let tree=h.render();
 const total=()=>nodes(tree).find(n=>n.props?.className==='recipe-detail-total');
 assert.match(text(total()),/25 OZ 單份成本NT\$ 1239.20/);
 const table=nodes(tree).find(n=>n.type==='tbody');assert.equal(nodes(table).filter(n=>n.type==='tr').length,2);
 assert.ok(nodes(tree).some(n=>n.type==='summary'&&text(n)==='各尺寸成本比較'));
 nodes(tree).find(n=>n.type==='button'&&text(n)==='24 OZ').props.onClick();tree=h.render();
 assert.match(text(total()),/24 OZ 單份成本NT\$ 1192.80/);
 assert.ok(nodes(tree).some(n=>n.type==='td'&&text(n)==='708 g'));
 assert.equal(JSON.stringify(card),before);
});
