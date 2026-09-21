import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as workflow from '../lib/receipt-workflow.ts';
import {configureDemo,resetDemo,demoClient} from '../lib/demo-client.mjs';

const source=readFileSync(new URL('../lib/receipt-review-draft.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const exports={};
new Function('exports','require',compiled)(exports,name=>{assert.equal(name,'./receipt-workflow');return workflow;});
const {createReceiptReviewDraft,updateReceiptReviewField,updateReceiptReviewMapping,isReceiptReviewDirty,receiptReviewDraftError,buildReceiptReviewPayload,acknowledgeReceiptReviewSave,reconcileReceiptReviewDraft,receiptReviewDraftStorageKey,serializeReceiptReviewDrafts,parseReceiptReviewDrafts,hasStoredReceiptDraft}=exports;
const field=(row,name,value)=>({id:`${row}:${name}`,row_key:row,field_name:name,value,raw_value:value,confidence:0.9,review_status:'PENDING',corrected:false,source_region:null});
function snapshot(){return {batchId:'receipt-1',runId:'run-1',row:'row-0',fields:[field('document','supplier_name','供應商'),field('document','receipt_date','2026-09-21'),field('row-0','product','鮮奶'),field('row-0','specification','1L'),field('row-0','quantity',5),field('row-0','unit','瓶'),field('row-0','unit_price_ex_tax',null),field('row-0','note','保留原備註'),field('row-1','product','同張另一品項')],mapping:{product_id:'product-old',name:'鮮奶',unit:'瓶',specification:'1L'}};}
const set=(draft,name,value)=>updateReceiptReviewField(draft,draft.snapshot.find(field=>field.field_name===name).id,value);
function latestWithValues(source,values,mapping=source.mapping){return {...source,mapping,fields:source.fields.map(field=>Object.hasOwn(values,field.id)?{...field,value:values[field.id],corrected:true}:field)};}

test('row snapshots preserve original CAS values and only submit fields actually present',()=>{
 const source=snapshot();source.fields.push(field('row-0','source_extra',{page:1,confidence:'low'}));source.fields.find(field=>field.id==='row-0:unit_price_ex_tax').value='0';
 const draft=createReceiptReviewDraft(source);source.fields.find(field=>field.id==='row-0:quantity').value=99;
 const changed=set(draft,'quantity','0'),payload=buildReceiptReviewPayload(changed);
 assert.equal(payload.fields.find(field=>field.id==='row-0:quantity').old,5);assert.equal(payload.fields.find(field=>field.id==='row-0:quantity').value,0);
 assert.equal(payload.fields.find(field=>field.id==='row-0:unit_price_ex_tax').value,'0','untouched numeric strings remain original evidence');
 assert.deepEqual(payload.fields.find(field=>field.id==='row-0:source_extra').value,{page:1,confidence:'low'});
 assert.equal(payload.fields.length,draft.snapshot.length);assert.ok(payload.fields.every(field=>field.id.startsWith('row-0:')));assert.equal(payload.previous_product_id,'product-old');
 assert.throws(()=>updateReceiptReviewField(draft,'row-0:missing','added'),/OCR_LINE_NOT_FOUND/);
 const document=createReceiptReviewDraft({...source,row:'document'}),header=buildReceiptReviewPayload(set(document,'supplier_name','新供應商'));
 assert.deepEqual(header.fields.map(field=>field.id),['document:supplier_name','document:receipt_date']);assert.equal(header.previous_product_id,null);assert.equal(header.mapping_mode,'KEEP');
});

test('numeric edits keep null distinct from zero and ignore equivalent formatting without clearing mappings',()=>{
 const draft=createReceiptReviewDraft(snapshot());
 assert.equal(isReceiptReviewDirty(draft),false);assert.equal(isReceiptReviewDirty(set(draft,'quantity','5.0')),false);
 for(const [value,expected] of [['',null],['  ',null],['0',0],['0.00',0],['1.25',1.25],['-2',-2]]){
  const changed=set(draft,'quantity',value);assert.equal(buildReceiptReviewPayload(changed).fields.find(field=>field.id==='row-0:quantity').value,expected);assert.equal(changed.mappingMode,'KEEP');assert.equal(changed.productId,'product-old');
 }
 for(const value of ['NaN','Infinity','1e999','0x10','4,2','invalid']){const invalid=set(draft,'quantity',value);assert.equal(receiptReviewDraftError(invalid),'NUMBER_REQUIRED');assert.equal(isReceiptReviewDirty(invalid),true);assert.throws(()=>buildReceiptReviewPayload(invalid),/NUMBER_REQUIRED/);}
 assert.equal(set(draft,'product',' 鮮奶 ').mappingMode,'KEEP');
 const identityChanged=set(draft,'specification','2L');assert.equal(identityChanged.mappingMode,'NONE');assert.equal(identityChanged.productId,'');assert.equal(identityChanged.initialMapping.product_id,'product-old');
 assert.equal(set(draft,'note','新的備註').mappingMode,'KEEP');
});

test('mapping payloads use the existing SELECT contract and preserve previous product for every edit',()=>{
 const draft=createReceiptReviewDraft(snapshot());
 for(const [mode,id,expected] of [['KEEP','ignored','product-old'],['SELECT','product-new','product-new'],['NONE','ignored',null],['CREATE','ignored',null]]){
  const changed=updateReceiptReviewMapping(draft,mode,id),payload=buildReceiptReviewPayload(changed);
  assert.equal(payload.mapping_mode,mode);assert.equal(payload.product_id,expected);assert.equal(payload.previous_product_id,'product-old');
 }
 assert.equal(isReceiptReviewDirty(updateReceiptReviewMapping(draft,'SELECT','product-old')),false);
 assert.equal(receiptReviewDraftError(updateReceiptReviewMapping(draft,'SELECT')),'PRODUCT_MAPPING_REQUIRED');
 assert.equal(receiptReviewDraftError(updateReceiptReviewMapping(set(draft,'unit',''),'CREATE')),'PRODUCT_NAME_AND_UNIT_REQUIRED');
 assert.throws(()=>updateReceiptReviewMapping(draft,'EXISTING','product-new'),/INVALID_APP_INPUT/);
 assert.equal(receiptReviewDraftError(createReceiptReviewDraft({...snapshot(),row:'absent'})),'OCR_LINE_NOT_FOUND');
});

test('polling refreshes clean rows but preserves dirty rows through snapshot, mapping, run and row conflicts',()=>{
 const source=snapshot(),clean=createReceiptReviewDraft(source),dirty=set(clean,'quantity','7');
 const updated=latestWithValues(source,{'row-0:quantity':6});
 const refreshed=reconcileReceiptReviewDraft(clean,updated);assert.equal(refreshed.status,'refreshed');assert.equal(refreshed.draft.values['row-0:quantity'],'6');
 const unchanged=reconcileReceiptReviewDraft(dirty,{...source,fields:[...source.fields].reverse().map(field=>({...field,confidence:1}))});assert.equal(unchanged.status,'unchanged');assert.equal(unchanged.draft,dirty);
 for(const current of [updated,latestWithValues(source,{'row-0:quantity':7}),{...source,mapping:{...source.mapping,product_id:'colleague-product'}},{...source,fields:[...source.fields,field('row-0','tax',0)]}]){
  const conflict=reconcileReceiptReviewDraft(dirty,current);assert.equal(conflict.status,'conflict');assert.equal(conflict.draft,dirty);assert.equal(buildReceiptReviewPayload(conflict.draft).fields.find(field=>field.id==='row-0:quantity').old,5);
 }
 assert.equal(reconcileReceiptReviewDraft(dirty,{...source,runId:'run-2'}).status,'version-changed');
 assert.equal(reconcileReceiptReviewDraft(dirty,{...source,batchId:'other-receipt'}).status,'version-changed');
 assert.equal(reconcileReceiptReviewDraft(dirty,{...source,fields:source.fields.filter(field=>field.row_key!=='row-0')}).status,'missing');
});

test('acknowledged saves wait for the actual server snapshot, including generated CREATE mappings',async()=>{
 const source=snapshot();const changed=updateReceiptReviewMapping(set(createReceiptReviewDraft(source),'quantity','7'),'CREATE');const accepted=acknowledgeReceiptReviewSave(changed);
 assert.equal(isReceiptReviewDirty(accepted),true);assert.equal(buildReceiptReviewPayload(accepted).previous_product_id,'product-old');
 assert.equal(reconcileReceiptReviewDraft(accepted,source).status,'unchanged','old poll data cannot replace the accepted payload baseline');
 const latest=latestWithValues(source,{'row-0:quantity':7},{product_id:'generated-product',name:'鮮奶',unit:'瓶',specification:'demo-existing-spec'});
 const saved=reconcileReceiptReviewDraft(accepted,latest);assert.equal(saved.status,'saved');assert.equal(saved.draft.initialMapping.product_id,'generated-product');assert.equal(isReceiptReviewDirty(saved.draft),false);assert.equal(saved.draft.acknowledged,false);
 assert.equal(buildReceiptReviewPayload(saved.draft).fields.find(field=>field.id==='row-0:quantity').old,7);assert.equal(reconcileReceiptReviewDraft(saved.draft,latest).status,'unchanged');
 assert.equal(reconcileReceiptReviewDraft(accepted,latestWithValues(latest,{'row-0:quantity':8})).status,'conflict');
 assert.equal(reconcileReceiptReviewDraft(accepted,{...latest,mapping:null}).status,'conflict');
 assert.equal(set(accepted,'quantity','8').acknowledged,false);assert.equal(updateReceiptReviewMapping(accepted,'NONE').acknowledged,false);
 // The demo's existing CREATE path may reuse a same-name/unit product with its old specification.
 await resetDemo();const store=configureDemo('LOGISTICS','SINGLE_RESTAURANT').stores[0].id;
 const rpc=async(name,args)=>{const result=await demoClient.rpc(name,args);assert.equal(result.error,null,JSON.stringify(result.error));return result.data;};
 const batch=(await rpc('get_pilot_receipts',{p_store_id:store})).find(batch=>!batch.review_saved);
 const before=await rpc('get_pilot_receipt',{p_store_id:store,p_batch_id:batch.id}),mapping=before.mappings.find(mapping=>mapping.row_key==='row-0');
 const draft=updateReceiptReviewMapping(set(createReceiptReviewDraft({batchId:batch.id,runId:before.run.id,row:'row-0',fields:before.fields,mapping}),'specification','另一包裝規格'),'CREATE');
 const result=await rpc('app_operation',{p_store_id:store,p_action:'receipt.edit-card',p_data:buildReceiptReviewPayload(draft),p_request_id:crypto.randomUUID()});assert.equal(result.saved,true);
 const after=await rpc('get_pilot_receipt',{p_store_id:store,p_batch_id:batch.id}),current=after.mappings.find(mapping=>mapping.row_key==='row-0');
 assert.equal(current.product_id,mapping.product_id);assert.notEqual(current.specification,'另一包裝規格');
 const reconciled=reconcileReceiptReviewDraft(acknowledgeReceiptReviewSave(draft),{batchId:batch.id,runId:after.run.id,row:'row-0',fields:after.fields,mapping:current});assert.equal(reconciled.status,'saved');assert.equal(isReceiptReviewDirty(reconciled.draft),false);
});

test('scoped cached drafts block bulk confirmation until restored successful saves are reconciled',()=>{
 const source=snapshot(),dirty=set(createReceiptReviewDraft(source),'quantity','7'),cache=new Map(),storage={getItem:key=>cache.get(key)??null};
 const key=receiptReviewDraftStorageKey('user','store',source.batchId,source.runId);cache.set(key,serializeReceiptReviewDrafts({'row-0':dirty}));
 assert.equal(hasStoredReceiptDraft(storage,'user','store',source.batchId,source.runId),true);
 for(const args of [['other','store',source.batchId,source.runId],['user','other',source.batchId,source.runId],['user','store','other',source.runId],['user','store',source.batchId,'other']])assert.equal(hasStoredReceiptDraft(storage,...args),false);
 const restored=parseReceiptReviewDrafts(cache.get(key))['row-0'];assert.equal(restored.values['row-0:quantity'],'7');assert.equal(reconcileReceiptReviewDraft(restored,source).draft,restored);
 cache.set(key,serializeReceiptReviewDrafts({'row-0':acknowledgeReceiptReviewSave(restored)}));assert.equal(hasStoredReceiptDraft(storage,'user','store',source.batchId,source.runId),true);
 const saved=reconcileReceiptReviewDraft(parseReceiptReviewDrafts(cache.get(key))['row-0'],latestWithValues(source,{'row-0:quantity':7}));assert.equal(saved.status,'saved');
 cache.set(key,serializeReceiptReviewDrafts({'row-0':saved.draft}));assert.equal(hasStoredReceiptDraft(storage,'user','store',source.batchId,source.runId),false);
 for(const raw of [null,'bad json','{"version":99,"drafts":{}}',JSON.stringify({version:1,drafts:{'row-0':{...dirty,values:{}}}})])assert.equal(Object.keys(parseReceiptReviewDrafts(raw)).length,0);
 const malformed={...dirty,snapshot:[...dirty.snapshot,dirty.snapshot[0]]};assert.equal(Object.keys(parseReceiptReviewDrafts(JSON.stringify({version:1,drafts:{'row-0':malformed}}))).length,0);
 const unchangedAcknowledged=acknowledgeReceiptReviewSave(updateReceiptReviewMapping(createReceiptReviewDraft(source),'SELECT','product-old'));
 assert.equal(isReceiptReviewDirty(unchangedAcknowledged),false);cache.set(key,serializeReceiptReviewDrafts({'row-0':unchangedAcknowledged}));assert.equal(hasStoredReceiptDraft(storage,'user','store',source.batchId,source.runId),true);
 assert.equal(reconcileReceiptReviewDraft(parseReceiptReviewDrafts(cache.get(key))['row-0'],source).status,'saved');
 assert.notEqual(receiptReviewDraftStorageKey('user:x','store','batch','run'),receiptReviewDraftStorageKey('user','x:store','batch','run'));
});
