import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

test('admin price fallback never treats a package as a kilogram or invents a conversion',()=>{
 const text=readFileSync(new URL('../app/pilot/transfers-workspace.tsx',import.meta.url),'utf8');
 const ast=ts.createSourceFile('transfers.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let fn;function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='priceFor')fn=n.initializer.getText(ast);ts.forEachChild(n,visit);}visit(ast);assert.ok(fn);
 const js=ts.transpileModule(`(${fn});`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const price=runInNewContext(js,{data:{products:[{id:'squid',unit:'公斤',suppliers:[{id:'vendor',unit_price:200,receipt_date:'2026-10-02'}]}]}});
 assert.equal(price({product_id:'squid',unit:'包',reference_price:null}).price,null);
 assert.equal(price({product_id:'squid',unit:'公斤',reference_price:null}).price,200);
 assert.equal(price({product_id:'squid',unit:'包',reference_price:0}).price,0);
 assert.equal(price({product_id:'squid',unit:'包',reference_price:80}).price,80);
});
