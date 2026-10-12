import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as loss from '../lib/recipe-loss.ts';
import * as model from '../lib/recipe-model.ts';
function harness(line={id:'b',name:'牛肉',quantity:'300',unit:'g'}){
 let states=[],cursor=0,tree;const changes=[];
 const props={line,notes:'',disabled:false,view:null,onViewChange:view=>{if(props.view!==view)states=[];props.view=view;},onChange:patch=>{changes.push(patch);props.line={...props.line,...patch};},onRemove:()=>{props.removed=true;}};
 const react={...React,useRef:()=>({current:null}),useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];}};
 const source=ts.transpileModule(readFileSync(new URL('../app/pilot/recipe-loss-control.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
 const scope={React,exports:{},require:name=>name==='react'?react:name==='@/lib/recipe-model'?model:loss};runInNewContext(source,scope);
 const render=()=>{cursor=0;tree=scope.exports.default(props);};
 const text=n=>Array.isArray(n)?n.map(text).join(''):React.isValidElement(n)?text(n.props.children):n==null||typeof n==='boolean'?'':String(n);
 const find=predicate=>{let found;const visit=n=>{if(Array.isArray(n))return n.forEach(visit);if(!React.isValidElement(n))return;if(predicate(n))found=n;visit(n.props.children);};visit(tree);return found;};
 const click=name=>{const n=find(n=>n.type==='button'&&(n.props['aria-label']===name||text(n)===name));assert.ok(n,name);assert.ok(!n.props.disabled);n.props.onClick();render();};
 const fill=(name,value)=>{const n=find(n=>n.props['aria-label']===name);assert.ok(n,name);n.props.onChange({target:{value}});render();};
 render();return {props,changes,click,fill,find,render,text:()=>text(tree)};
}
const openLoss=h=>{h.click('牛肉更多操作');h.click('設定耗損');};
test('one optional row menu, cancellation, apply and clear',()=>{
 const h=harness();assert.equal(h.text(),'⋯');h.click('牛肉更多操作');assert.match(h.text(),/設定耗損新增備註移除食材/);h.click('設定耗損');h.fill('耗損率百分比','24');h.click('關閉食材操作');assert.equal(h.changes.length,0);
 openLoss(h);h.fill('耗損率百分比','24');h.click('套用');assert.equal(h.props.line.edible_rate,'0.76');assert.equal(h.text(),'⋯');assert.equal(loss.recipeLossLabel(h.props.line),'耗損 24%');
 openLoss(h);h.click('不計耗損');assert.equal(h.props.line.quantity_basis,'gross');assert.equal(loss.recipeLossLabel(h.props.line),'');
});
test('invalid input does not mutate; measured weights survive JSON storage and reopening',()=>{
 const h=harness();openLoss(h);h.fill('耗損率百分比','100');h.click('套用');assert.ok(h.find(n=>n.props.role==='alert'));assert.equal(h.changes.length,0);
 h.fill('食譜提供的耗損資料','weight');h.fill('耗損原料重量','3.55');h.fill('耗損原料重量單位','kg');h.fill('耗損可食用重量','2700');h.click('套用');assert.ok(Math.abs(Number(h.props.line.edible_rate)-2700/3550)<1e-12);
 const reopened=harness(JSON.parse(JSON.stringify(h.props.line)));openLoss(reopened);assert.equal(reopened.find(n=>n.props['aria-label']==='耗損原料重量').props.value,'3.55');assert.equal(reopened.find(n=>n.props['aria-label']==='耗損原料重量單位').props.value,'kg');reopened.click('套用');assert.equal(reopened.props.line.edible_rate,h.props.line.edible_rate);
});
test('edible percent and already included are mutually exclusive calculation modes',()=>{
 const h=harness();openLoss(h);h.fill('食譜提供的耗損資料','edible');h.fill('可食用率百分比','96');h.click('套用');assert.equal(h.props.line.edible_rate,'0.96');openLoss(h);
 h.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});h.render();assert.equal(h.find(n=>n.props['aria-label']==='可食用率百分比'),undefined);h.click('套用');assert.equal(model.recipeEdibleFactor(h.props.line),1);assert.equal(loss.recipeLossLabel(h.props.line),'已含耗損');
});
test('notes can be cancelled, saved, reopened, and cleared without changing cost fields',()=>{
 const h=harness({...{id:'b',name:'牛肉',quantity:'250',unit:'g'},...loss.includedRecipeLoss()});
 h.click('牛肉更多操作');h.click('新增備註');h.fill('牛肉備註','去筋膜、切厚片');h.click('取消');assert.equal(h.changes.length,0);
 h.click('牛肉更多操作');h.click('新增備註');h.fill('牛肉備註','去筋膜、切厚片');h.click('套用備註');assert.equal(h.props.line.note,'去筋膜、切厚片');assert.equal(loss.recipeLossLabel(h.props.line),'已含耗損');
 h.click('牛肉更多操作');h.click('編輯備註');assert.equal(h.find(n=>n.props['aria-label']==='牛肉備註').props.value,'去筋膜、切厚片');h.fill('牛肉備註','');h.click('套用備註');assert.equal(h.props.line.note,'');
 h.click('牛肉更多操作');h.click('移除食材');assert.equal(h.props.removed,true);
});
test('component menu allows notes and removal but never duplicates yield loss; locked menu disabled',()=>{
 const h=harness({id:'x',name:'醬料',recipe_id:'prep'});h.click('醬料更多操作');assert.doesNotMatch(h.text(),/設定耗損/);assert.match(h.text(),/新增備註移除食材/);
 const busy=harness();busy.props.disabled=true;busy.render();assert.ok(busy.find(n=>n.type==='button').props.disabled);
});
