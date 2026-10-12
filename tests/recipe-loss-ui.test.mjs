import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as loss from '../lib/recipe-loss.ts';
function harness(line={id:'b',name:'牛肉',quantity:'300',unit:'g'}){
 const states=[];let cursor=0,tree;const changes=[];
 const props={line,notes:'',disabled:false,onChange:patch=>{changes.push(patch);props.line={...props.line,...patch};}};
 const react={...React,useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];}};
 const source=ts.transpileModule(readFileSync(new URL('../app/pilot/recipe-loss-control.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
 const scope={React,exports:{},require:name=>name==='react'?react:loss};runInNewContext(source,scope);
 const render=()=>{cursor=0;tree=scope.exports.default(props);};
 const text=n=>Array.isArray(n)?n.map(text).join(''):React.isValidElement(n)?text(n.props.children):n==null||typeof n==='boolean'?'':String(n);
 const find=predicate=>{let found;const visit=n=>{if(Array.isArray(n))return n.forEach(visit);if(!React.isValidElement(n))return;if(predicate(n))found=n;visit(n.props.children);};visit(tree);return found;};
 const click=name=>{const n=find(n=>n.type==='button'&&(n.props['aria-label']===name||text(n)===name));assert.ok(n,name);assert.ok(!n.props.disabled);n.props.onClick();render();};
 const fill=(name,value)=>{const n=find(n=>n.props['aria-label']===name);assert.ok(n,name);n.props.onChange({target:{value}});render();};
 render();return {props,changes,click,fill,find,render,text:()=>text(tree)};
}
test('loss setting is optional, cancelled input does not mutate, apply and clear update one line',()=>{
 const h=harness();assert.equal(h.text(),'⋯');h.click('牛肉設定耗損');h.fill('耗損率百分比','24');h.click('關閉耗損設定');assert.equal(h.changes.length,0);
 h.click('牛肉設定耗損');h.fill('耗損率百分比','24');h.click('套用');assert.equal(h.props.line.edible_rate,'0.76');assert.equal(h.text(),'耗損 24%');
 h.click('牛肉修改耗損');h.click('清除耗損');assert.equal(h.props.line.quantity_basis,'gross');assert.equal(h.text(),'⋯');
});
test('weight input is explicit and invalid input keeps the existing rate intact',()=>{
 const h=harness();h.click('牛肉設定耗損');h.fill('耗損率百分比','100');h.click('套用');assert.ok(h.find(n=>n.props.role==='alert'));assert.equal(h.changes.length,0);
 h.click('重量換算');h.fill('耗損原料重量','3.55');h.fill('耗損原料重量單位','kg');h.fill('耗損可食用重量','2700');h.click('套用');assert.ok(Math.abs(Number(h.props.line.edible_rate)-2700/3550)<1e-12);assert.equal(h.text(),'耗損 23.94%');
});
test('components have no duplicate loss control and busy recipes cannot be edited',()=>{
 assert.equal(harness({id:'x',name:'醬料',recipe_id:'prep'}).text(),'');
 const h=harness();h.props.disabled=true;h.render();assert.ok(h.find(n=>n.type==='button').props.disabled);
});
