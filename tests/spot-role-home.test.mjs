import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const source=readFileSync(new URL('../app/pilot/role-home.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('home.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const code=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&['RoleHome','OtherWorkspace'].includes(n.name?.text)||ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)==='viewTitles')).map(n=>n.getText(ast)).join('\n');
const scope={React,exports:{},icons:{},ClipboardList:()=>null,localMonth:()=> '2026-09',useState:React.useState,useEffect:()=>{},hasCrossStore:()=>true,canManageBusiness:()=>false,canViewReports:()=>false,canExportData:()=>false,useWorkFeed:()=>({rows:[{category:'spot',pending:true}],error:''}),useDashboard:()=>({data:{s:{receipt_issues:0,expiry_urgent:0,incidents:0}},error:''})};
runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText,scope);
test('supervisor home and other work hide spot checks even with stale pending spot data',()=>{
 const store={id:'s',role:'SUPERVISOR',settings:{}};
 for(const component of [scope.exports.default,scope.exports.OtherWorkspace]){
  const html=renderToStaticMarkup(React.createElement(component,{store,stores:[store],onNavigate(){},onStore(){},onBack(){}}));
  assert.doesNotMatch(html,/抽盤/);assert.match(html,/盤點|分區與解凍/);
 }
});
