import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import React from 'react';
import ts from 'typescript';
import * as valuation from '../lib/inventory-valuation.ts';
import {inventoryOriginalPurchaseLabel} from '../lib/inventory-cost.ts';
import {moneyAmount} from '../lib/operations-sheet.ts';

const pendingRow={row_key:'target',source_signature:'before',name:'茴香酒',unit:'罐',current_quantity:.4,
 previous_quantity:1,previous_amount:600,unit_price:null,amount:null,review_note:'',missing_price:true,needs_review:true};
const confirmedRow={...pendingRow,source_signature:'after',unit_price:600,amount:240,missing_price:false,needs_review:false,
 price_purchase:{unit:'罐',amount:600,quantity:1},price_source:'本月已儲存價格'};
test('confirmed valuation updates the selected row and report total without changing other counts or the prior baseline',()=>{
 const other={...pendingRow,row_key:'other',current_quantity:2,amount:100,unit_price:50,missing_price:false,needs_review:false};
 const month={rows:[pendingRow,other],summary:{items:2,subtotal:100,missing_prices:1,pending:1,
  previous_subtotal:700,previous_missing_prices:0,amount_difference:null}};
 const result=valuation.inventoryWithSavedValuation(month,confirmedRow);
 assert.equal(result.summary.subtotal,340);assert.equal(result.summary.amount_difference,-360);
 assert.equal(result.summary.missing_prices,0);assert.equal(result.summary.pending,0);
 assert.equal(result.summary.previous_subtotal,700);assert.equal(result.rows[1],other);
 assert.equal(month.rows[0].unit_price,null);assert.equal(month.summary.subtotal,100);
 const original={id:'target',values:{name:'茴香酒',supplier:'大永',code:'F006157',zone:'酒櫃'},meta:{row:{...pendingRow,purchase_quantity:3},catalog:{id:'catalog'}}};
 const sheet=valuation.inventorySavedValuationRow(original,confirmedRow);
 assert.equal(sheet.values.price,'600');assert.equal(sheet.values.amount,'240');
 assert.equal(sheet.values.code,'F006157');assert.equal(sheet.values.supplier,'大永');
 assert.equal(sheet.meta.row.source_signature,'after');assert.equal(sheet.meta.row.purchase_quantity,3);
 assert.deepEqual(sheet.meta.catalog,{id:'catalog'});
});
const workspaceSource=readFileSync(new URL('../app/pilot/unified-operations-workspace.tsx',import.meta.url),'utf8');
const workspaceAst=ts.createSourceFile('workspace.tsx',workspaceSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let saveDeclaration;
function findSave(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='saveValuation')saveDeclaration=node;ts.forEachChild(node,findSave);}
findSave(workspaceAst);
const saveCode=ts.transpileModule(saveDeclaration.getText(workspaceAst),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function saveHarness(overrides={}){
 let inventory={source_id:'session',rows:[pendingRow],summary:{items:1,subtotal:null,missing_prices:1,pending:1,previous_subtotal:600,previous_missing_prices:0}};
 let rows=[{id:'target',values:{name:'茴香酒',supplier:'大永'},meta:{row:pendingRow}}],refreshes=0,requests=0;
 const scope={...valuation,valuationRow:pendingRow,valuationTarget:{},inventory,store:{id:'shop'},month:'2026-10',
  generation:{current:1},readController:{current:new AbortController()},setLoading(){},setError(){},
  inventoryEditExpected:r=>({source_signature:r.source_signature}),friendly:e=>e.message,
  load:async()=>{refreshes++;throw Error('full refresh timed out');},
  rpc:async()=>{requests++;return {saved:true,row:confirmedRow};},
  setInventory:fn=>{inventory=fn(inventory);},setRows:fn=>{rows=fn(rows);},...overrides};
 runInNewContext(saveCode,scope);
 return {scope,save:choice=>scope.saveValuation(choice),get inventory(){return inventory;},get rows(){return rows;},
  get requests(){return requests;},get refreshes(){return refreshes;}};
}
test('price application completes from the confirmed server row without a second workspace read',async()=>{
 const h=saveHarness();await h.save({quote:{},automatic:false});
 assert.equal(h.requests,1);assert.equal(h.refreshes,0);assert.equal(h.scope.readController.current.signal.aborted,true);
 assert.equal(h.rows[0].values.amount,'240');assert.equal(h.inventory.summary.subtotal,240);
});
test('failed saves preserve displayed values and staged editing never writes early',async()=>{
 const h=saveHarness({rpc:async()=>{throw Error('network');}});
 await assert.rejects(h.save({}),/network/);assert.equal(h.rows[0].meta.row.unit_price,null);
 let staged;const edit=saveHarness({valuationTarget:{apply:choice=>{staged=choice;}}});
 const choice={automatic:false};await edit.save(choice);assert.equal(staged,choice);assert.equal(edit.requests,0);
});
test('a response from a previous month cannot replace the newly selected report',async()=>{
 const h=saveHarness();h.scope.rpc=async()=>{h.scope.generation.current++;return {saved:true,row:confirmedRow};};
 await h.save({});assert.equal(h.rows[0].meta.row.unit_price,null);
});

const purchase={unit:'包',amount:65,quantity:1,content_quantity:500,content_unit:'g'};
const quote={price:.13,purchase,source:'請購表',date:'2026-08-25'};
test('inventory package labels mean counted packages while explicit weight units retain weight prices',()=>{
 for(const unit of ['包','g/包','500g/包','kg/包','５００ｇ／包']){
  assert.equal(valuation.inventoryValuationPrice({quote,automatic:false},unit,1),65);
  const draft=valuation.inventoryValuationDraft({name:'中寬捲麵',unit,quantity:'2',price:'.13'}, {quote,automatic:false});
  assert.equal(draft.unit,'包');assert.equal(draft.price,'65');assert.equal(draft.amount,'130');
 }
 assert.equal(valuation.inventoryValuationPrice({quote,automatic:false},'克',500),.13);
 assert.equal(valuation.inventoryValuationPrice({quote,automatic:false},'公斤',.5),130);
 assert.equal(valuation.inventoryCountUnit('g/公斤'),'g/公斤');
 assert.equal(valuation.inventoryCountUnit('12瓶/箱'),'12瓶/箱');
 assert.equal(valuation.inventoryValuationPrice({quote,automatic:false},'罐',1),null);
});
test('differently counted packs require an explicit count and retain the original invoice price',()=>{
 const dozen={price:null,purchase:{unit:'打',amount:780,quantity:1}};
 assert.equal(valuation.inventoryValuationPrice({quote:dozen,automatic:false},'瓶',3),null);
 assert.equal(valuation.inventoryValuationPrice({quote:dozen,automatic:false,count_per_unit:12},'瓶',3),65);
 assert.equal(dozen.purchase.amount,780);
 const set={price:null,purchase:{unit:'組',amount:300,quantity:1}};
 assert.equal(valuation.inventoryValuationPrice({quote:set,automatic:false,count_per_unit:6},'罐',2),50);
});
const code=ts.transpileModule(readFileSync(new URL('../app/pilot/inventory-valuation-dialog.tsx',import.meta.url),'utf8')
 .replace(/^import .*;\n/gm,'').replace('export default function','function'),
 {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):String(n??'');
function all(n,predicate){return Array.isArray(n)?n.flatMap(item=>all(item,predicate)):n&&typeof n==='object'?[...(predicate(n)?[n]:[]),...all(n.props?.children,predicate)]:[];}
function dialog(overrides={}){
 const hooks=[],saved=[];let index=0;
 const props={name:'中寬捲麵',code:'',supplier:'大永',quantity:1,unit:'g/包',cutoff:'2026-10-31',original:quote,
  read:async()=>[],save:async choice=>saved.push(choice),onClose(){},...overrides};
 const scope={React,...valuation,inventoryOriginalPurchaseLabel,moneyAmount,WorkspaceEditDialog:'dialog',
  useEffect(){},useRef:value=>{const i=index++;return hooks[i]||(hooks[i]={current:value});},
  useState:value=>{const i=index++;if(!(i in hooks))hooks[i]=typeof value==='function'?value():value;
   return [hooks[i],next=>{hooks[i]=typeof next==='function'?next(hooks[i]):next;}];}};
 runInNewContext(code,scope);
 return {saved,render(){index=0;return scope.InventoryValuationDialog(props);}};
}
test('package price lookup allows direct application without conversion, including old package-labelled drafts',async()=>{
 const h=dialog({initialChoice:{quote,automatic:false,count_per_unit:500}});
 const tree=h.render();
 assert.doesNotMatch(text(tree),/單位換算|約有多少/);
 assert.match(text(tree),/1 包 × NT\$ 65／包/);
 const apply=all(tree,n=>n.type==='button'&&text(n)==='帶入此列')[0];
 assert.equal(apply.props.disabled,false);
 await apply.props.onClick();
 for(let i=0;i<20;i++)await Promise.resolve();
 assert.equal(h.saved.length,1);
 assert.equal(h.saved[0].count_per_unit,undefined);
});
test('lookup requests a quantity only when invoice and count units differ',()=>{
 const dozen={price:null,purchase:{unit:'打',amount:780,quantity:1}};
 const h=dialog({unit:'瓶',quantity:3,original:dozen});
 assert.match(text(h.render()),/1 打 有多少 瓶/);
 const input=all(h.render(),n=>n.type==='input'&&n.props.type==='number')[0];
 input.props.onChange({target:{value:'12'}});
 assert.match(text(h.render()),/3 瓶 × NT\$ 65／瓶/);
 assert.match(text(h.render()),/NT\$ 195.00/);
});
