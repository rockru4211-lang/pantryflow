import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as model from '../lib/recipe-model.ts';
import * as comparison from '../lib/recipe-cost-comparison.ts';
function load(file,react,extra={}){
 const runtime={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};
 const scope={exports:{},require(name){if(name==='react')return react;if(name==='react/jsx-runtime')return runtime;if(name==='lucide-react')return {};if(name==='@/lib/recipe-model')return model;if(name==='@/lib/recipe-cost-comparison')return comparison;if(name.endsWith('.css'))return {};if(name in extra)return extra[name];throw Error(name);}};
 runInNewContext(ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,scope);return scope.exports.default;
}
function nodes(tree){if(!tree)return [];if(Array.isArray(tree))return tree.flatMap(nodes);if(typeof tree!=='object')return [];return [tree,...nodes(tree.props?.children),...nodes(tree.props?.row),...nodes(tree.props?.detail)];}
const text=n=>{if(Array.isArray(n))return n.map(text).join('');return typeof n==='object'&&n?text(n.props?.children):String(n??'');};
test('comparison controls expand/collapse nested sources, switch history and close without mutation',()=>{
 const state=[],react={useState(initial){const index=react.index++;state[index]??=initial;return [state[index],value=>state[index]=typeof value==='function'?value(state[index]):value];},index:0};
 const Component=load('../app/pilot/recipe-cost-comparison.tsx',react,{'./recipe-modal':{default:'modal'}});
 const line={id:'l',name:'配件',quantity:'1',unit:'份',recipe_id:'p'},cost={total:10,subtotal:10,missing:0,lines:[{id:'l',amount:10,price:null,reason:null}]};
 const card={id:'r',document:{name:'食譜',yield:'1',unit:'份',lines:[line]},cost,latest_cost:cost};let closed=0;
 const render=()=>{react.index=0;return Component({card,onClose:()=>closed++});};
 let tree=render();let button=nodes(tree).find(n=>n.type==='button'&&n.props['aria-expanded']===false);button.props.onClick();tree=render();button=nodes(tree).find(n=>n.type==='button'&&n.props['aria-expanded']===true);assert.ok(button);button.props.onClick();assert.ok(nodes(render()).some(n=>n.props?.['aria-expanded']===false));
 nodes(render()).find(n=>n.type==='button'&&text(n)==='基準紀錄').props.onClick();assert.ok(nodes(render()).some(n=>n.props?.className==='record-note'));
 nodes(render()).find(n=>n.type==='button'&&text(n)==='關閉').props.onClick();assert.equal(closed,1);assert.equal(card.cost.total,10);
});
test('shared native modal Escape cancel closes once and respects busy state',()=>{
 const Modal=load('../app/pilot/recipe-modal.tsx',{useEffect(){},useRef(){return {current:null};}});let closed=0,prevented=0;
 const props={title:'成本浮動明細',onClose:()=>closed++,children:null};
 Modal(props).props.onCancel({preventDefault:()=>prevented++});assert.equal(closed,1);assert.equal(prevented,1);
 Modal({...props,busy:true}).props.onCancel({preventDefault:()=>prevented++});assert.equal(closed,1);
});
