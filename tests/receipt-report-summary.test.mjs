import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const source=readFileSync(new URL('../app/pilot/unified-operations-workspace.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('workspace.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let summary;function visit(n){if(ts.isJsxAttribute(n)&&n.name.text==='reportSummary')summary=n.initializer.expression;ts.forEachChild(n,visit);}visit(ast);
const code=ts.transpileModule('const renderSummary='+summary.getText(ast)+';',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
function setup(tax=5,total=105){const rows=[{id:'a:1',meta:{batch:'a'},values:{amount:'60'}},{id:'a:2',meta:{batch:'a'},values:{amount:'40'}}];const scope={React,kind:'receipt',rows,accounts:{current:new Map([['a',{batch_id:'a',lines:[{row_key:'1'},{row_key:'2'}],tax,total}]])}};runInNewContext(code+'globalThis.render=renderSummary;',scope);return {rows,html:visible=>renderToStaticMarkup(scope.render(visible))};}
test('receipt summary counts a multi-line receipt tax and total only once',()=>{const h=setup();const html=h.html(h.rows);assert.match(html,/未稅合計：NT\$ 100/);assert.match(html,/稅額：NT\$ 5</);assert.match(html,/含稅合計：NT\$ 105/);});
test('partial line filters and draft edits never reuse whole receipt tax as a filtered total',()=>{const h=setup();for(const rows of [[h.rows[0]],[{...h.rows[0],values:{amount:'70'}},h.rows[1]]]){const html=h.html(rows);assert.match(html,/請查看完整貨單/);assert.doesNotMatch(html,/含稅合計：NT/);}});
test('unknown receipt taxes stay blank while explicitly zero taxes show zero',()=>{const h=setup(null,null);assert.match(h.html(h.rows),/稅額：<\/span>/);assert.match(h.html(h.rows),/貨單金額未完整/);const z=setup(0,100);assert.match(z.html(z.rows),/稅額：NT\$ 0</);});
