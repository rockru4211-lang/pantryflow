import test from 'node:test';import assert from 'node:assert/strict';
import {supplierImport,supplierExport,supplierPayload,supplierDraft,supplierStatus,supplierValidation,emptySupplier} from '../lib/supplier-directory.ts';
const original={id:'s',name:'青田',is_active:true,updated_at:'2026-10-11',cooperation_status:'BACKUP',aliases:['青田蔬果'],line_group:'青田訂貨群',bank_account:'001234',billing_cycle:'每月25日',supplier_category:'食材'};
test('export and reimport preserve identifiers, leading zeros, status and revision',()=>{const [draft]=supplierImport(supplierExport([original]),[original]);assert.equal(draft.id,'s');assert.equal(draft.bank_account,'001234');assert.equal(draft.updated_at,original.updated_at);assert.equal(draft.cooperation_status,'BACKUP');assert.deepEqual(supplierPayload(draft).aliases,original.aliases);assert.equal('clientKey' in supplierPayload(draft),false);});
test('first import and retry match saved records; omitted columns preserve existing data',()=>{const rows=[{'供應商名稱':'青田蔬果','電話':'02-1234'},{'供應商名稱':'新廠商','LINE 群組／社群名稱':'新群'}];const drafts=supplierImport(rows,[original]);assert.equal(drafts[0].id,'s');assert.equal(drafts[0].bank_account,'001234');assert.equal(drafts[1].id,'');assert.notEqual(drafts[0].clientKey,drafts[1].clientKey);const retry=supplierImport(rows,[original,{id:'new',name:'新廠商',is_active:true,updated_at:'later'}]);assert.equal(retry[1].id,'new');});
test('reject duplicate aliases, invalid status, unsafe links before any write',()=>{assert.throws(()=>supplierImport([{'供應商名稱':'青田'},{'供應商名稱':'青田蔬果'}],[original]));assert.throws(()=>supplierImport([{'供應商名稱':'新','合作狀態':'不明'}],[]));assert.throws(()=>supplierImport([{'供應商名稱':'新','LINE／訂貨連結':'javascript:alert(1)'}],[]));assert.throws(()=>supplierImport([{'供應商名稱':'青田'}],[original,{...original,id:'other'}]));});
test('pausing preserves backup preference; reimport uses paused identity rather than a new supplier',()=>{const paused={...original,is_active:false};assert.equal(supplierStatus(paused),'暫停合作');const [d]=supplierImport([{'供應商名稱':'青田','主要供應':'季節蔬菜'}],[paused]);assert.equal(d.id,'s');assert.equal(d.is_active,false);assert.equal(d.cooperation_status,'BACKUP');assert.equal(supplierStatus({...d,is_active:true}),'備用');assert.equal(supplierValidation({...emptySupplier,name:'A',order_method:'x'.repeat(81)}),'訂貨方式字數過長。');assert.equal(supplierDraft(original).line_group,'青田訂貨群');});

test('supplier categories expose only food, beverages and supplies while accepting old imports',async()=>{
 const {SUPPLIER_CATEGORIES,supplierCategory}=await import('../lib/supplier-categories.ts');
 assert.deepEqual(SUPPLIER_CATEGORIES,['食材','酒水','耗材']);
 for(const [old,next] of [['調料','食材'],['酒類','酒水'],['待分類',''],['耗材','耗材']]){
  assert.equal(supplierCategory(old),next);
  const [d]=supplierImport([{'供應商名稱':'青田','分類':old}],[original]);assert.equal(d.supplier_category,next);
  assert.equal(supplierExport([{...original,supplier_category:old}])[0]['分類'],next);
 }
 assert.throws(()=>supplierImport([{'供應商名稱':'新','分類':'器材'}],[]));
});

test('quick category edits normalize unset directory fields and preserve finance and paused state',()=>{
 const payload=supplierPayload(supplierDraft({...original,is_active:false,primary_supplies:null,line_group:null,company_name:null}));
 assert.equal(payload.primary_supplies,'');assert.equal(payload.line_group,'');assert.equal(payload.company_name,'');
 assert.equal(payload.bank_account,'001234');assert.equal(payload.is_active,false);assert.equal(payload.updated_at,original.updated_at);
});
