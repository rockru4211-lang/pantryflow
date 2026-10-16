import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import React from 'react';
import ts from 'typescript';
const source=readFileSync(new URL('../app/pilot/unit-select.tsx',import.meta.url),'utf8');
const code=ts.transpileModule(source.slice(source.indexOf('export default function')).replace('export default ',''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
function harness(){const states=[];let cursor=0;const added=[];const props={value:'包',units:['包','公斤'],onChange:v=>props.value=v,onUnitAdded:v=>added.push(v)};
 const scope={React,useState:v=>{const i=cursor++;if(!(i in states))states[i]=v;return [states[i],n=>states[i]=typeof n==='function'?n(states[i]):n];}};runInNewContext(code,scope);
 const render=()=>{cursor=0;return scope.UnitSelect(props);};const nodes=n=>Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...nodes(n.props?.children)]:[];
 return {added,props,find:type=>nodes(render()).find(n=>n.type===type),options:()=>nodes(render()).filter(n=>n.type==='option').map(n=>n.props.children)};
}
test('custom unit becomes selected dropdown option on blur and survives choosing an existing unit',()=>{
 const h=harness();h.find('select').props.onChange({target:{value:'__other'}});h.find('input').props.onChange({target:{value:' 趟 '}});h.find('input').props.onBlur();
 assert.equal(h.find('input'),undefined);assert.equal(h.find('select').props.value,'趟');assert.ok(h.options().includes('趟'));assert.deepEqual(h.added,['趟']);
 h.find('select').props.onChange({target:{value:'包'}});assert.ok(h.options().includes('趟'));
});
test('Enter commits a custom unit without submitting; IME composition and blanks do not commit',()=>{
 const h=harness();h.find('select').props.onChange({target:{value:'__other'}});h.find('input').props.onChange({target:{value:'趟'}});let prevented=0;
 h.find('input').props.onKeyDown({key:'Enter',nativeEvent:{isComposing:true},preventDefault(){prevented++;}});assert.equal(h.added.length,0);
 h.find('input').props.onKeyDown({key:'Enter',nativeEvent:{isComposing:false},preventDefault(){prevented++;}});assert.equal(prevented,1);assert.equal(h.find('input'),undefined);
 h.find('select').props.onChange({target:{value:'__other'}});h.find('input').props.onBlur();assert.equal(h.added.length,1);
});
