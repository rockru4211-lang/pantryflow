import test from 'node:test';
import assert from 'node:assert/strict';
import {configureDemo,resetDemo,demoClient,selectDemoStore} from '../lib/demo-client.mjs';

const single='SINGLE_RESTAURANT',chain='CHAIN_RESTAURANT';
const call=async(name,args)=>{const result=await demoClient.rpc(name,args);assert.equal(result.error,null,JSON.stringify(result.error));return result.data;};
const ledger=store=>call('get_pilot_receipt_ledger',{p_store_id:store});
const rowsFor=(rows,batch)=>rows.filter(row=>row.batch_id===batch).map(({batch_id,run_id,row_key})=>({batch_id,run_id,row_key}));
const confirm=(store,rows)=>call('confirm_pilot_receipt_ledger',{p_store_id:store,p_rows:rows});
const detail=(store,batch)=>call('get_pilot_receipt',{p_store_id:store,p_batch_id:batch});
const stock=store=>call('app_workspace',{p_store_id:store,p_section:'stock'});
async function setup(){
 const context=configureDemo('LOGISTICS',single),store=context.stores[0].id;
 const batches=await call('get_pilot_receipts',{p_store_id:store});
 return {store,other:context.stores[1].id,pending:batches.find(b=>!b.review_saved).id,complete:batches.find(b=>b.review_saved).id};
}
async function correct(store,batch,key,name,value){
 const receipt=await detail(store,batch),field=receipt.fields.find(field=>field.row_key===key&&field.field_name===name);
 assert.ok(field);await call('correct_pilot_receipt_field',{p_store_id:store,p_field_id:field.id,p_value:value});
}
async function upload(store,{recognize=true}={}){
 configureDemo('STAFF',single);selectDemoStore(store);
 const batch=await call('begin_pilot_receipt_upload',{p_store_id:store,p_fingerprint:crypto.randomUUID(),p_group_mode:'SEPARATE_RECEIPTS',p_documents:[{sha256:'a'.repeat(64),name:'ledger-test.png',mime_type:'image/png',byte_size:3}]});
 if(recognize){
  const uploaded=await demoClient.storage.from('receipt-documents').upload(batch.documents[0].storage_path,new Uint8Array([1,2,3]));assert.equal(uploaded.error,null);
  const recognized=await demoClient.functions.invoke('enqueue-receipt-ocr',{body:{batchId:batch.batch_id}});assert.equal(recognized.error,null);
 }
 configureDemo('LOGISTICS',single);return batch.batch_id;
}
test.beforeEach(async()=>{await resetDemo();});

test('demo ledger keeps pending, completed and unmapped source rows without inventing OCR results',async()=>{
 const {store,other,pending,complete}=await setup();const rows=await ledger(store);
 assert.equal(rows.length,4);assert.equal(rows.filter(row=>row.status==='PENDING').length,2);assert.equal(rows.filter(row=>row.status==='COMPLETE').length,2);
 const row=rows.find(row=>row.batch_id===pending&&row.row_key==='row-0');
 assert.equal(row.run_id,`${pending}-ocr`);assert.equal(row.product_code,'P001');assert.equal(row.product_name,'高麗菜');assert.equal(row.source_product,'高麗菜');assert.equal(row.quantity,5);assert.equal(row.unit_price,45);assert.equal(row.subtotal,225);assert.equal(row.mapped,true);assert.equal(row.review_allowed,true);
 assert.ok(rows.filter(row=>row.batch_id===complete).every(row=>row.status==='COMPLETE'));
 assert.ok((await ledger(other)).every(row=>!rows.some(first=>first.batch_id===row.batch_id)));
 await correct(store,pending,'document','receipt_date','2099-01-01');
 assert.deepEqual((await ledger(store)).slice(0,2).map(row=>[row.batch_id,row.row_key]),[[pending,'row-0'],[pending,'row-1']]);
 const receipt=await detail(store,pending),key='row-0';
 await call('app_operation',{p_store_id:store,p_action:'receipt.edit-card',p_request_id:crypto.randomUUID(),p_data:{batch_id:pending,run_id:receipt.run.id,row_key:key,mapping_mode:'NONE',previous_product_id:receipt.mappings.find(m=>m.row_key===key).product_id,fields:receipt.fields.filter(f=>f.row_key===key).map(f=>({id:f.id,old:f.value,value:f.field_name==='product'?'尚未對應的原品名':f.value}))}});
 const unmapped=(await ledger(store)).find(row=>row.batch_id===pending&&row.row_key===key);
 assert.equal(unmapped.status,'NEEDS_MAPPING');assert.equal(unmapped.mapped,false);assert.equal(unmapped.product_id,null);assert.equal(unmapped.product_code,null);assert.equal(unmapped.product_name,'尚未對應的原品名');
 const unrecognized=await upload(store,{recognize:false});
 assert.equal((await ledger(store)).some(row=>row.batch_id===unrecognized),false);
 assert.equal((await call('get_pilot_receipts',{p_store_id:store})).some(batch=>batch.id===unrecognized),true);
 const rejected=await confirm(store,[{batch_id:unrecognized,run_id:`${unrecognized}-ocr`,row_key:'row-0'}]);assert.equal(rejected.failed[0].error,'OCR_VERSION_CHANGED');
});

test('numeric fields preserve null and explicit zero and follow SQL numeric text matching',async()=>{
 const {store,pending}=await setup();
 for(const [quantity,price,expectedQuantity,expectedPrice,subtotal] of [[null,45,null,45,null],[0,45,0,45,0],[5,null,5,null,null],['0','0',0,0,0],['-1.25','2.5',-1.25,2.5,-3.125],['',45,null,45,null],[' 2 ',45,null,45,null],['+2',45,null,45,null],['1e3',45,null,45,null]]){
  await correct(store,pending,'row-0','quantity',quantity);await correct(store,pending,'row-0','unit_price_ex_tax',price);
  const row=(await ledger(store)).find(row=>row.batch_id===pending&&row.row_key==='row-0');
  assert.deepEqual([row.quantity,row.unit_price,row.subtotal],[expectedQuantity,expectedPrice,subtotal]);
 }
 await correct(store,pending,'row-0','quantity',null);await correct(store,pending,'row-1','unit_price_ex_tax',null);
 const before=await stock(store);await confirm(store,rowsFor(await ledger(store),pending));const after=await stock(store);
 const rows=(await ledger(store)).filter(row=>row.batch_id===pending);assert.ok(rows.every(row=>row.status==='COMPLETE'));
 assert.equal(rows.find(row=>row.row_key==='row-0').quantity,null);assert.equal(rows.find(row=>row.row_key==='row-1').unit_price,null);assert.ok(rows.every(row=>row.subtotal===null));
 assert.equal(after.products[0].stock.total,before.products[0].stock.total,'a missing quantity cannot be posted as inventory');
 const receipt=await detail(store,pending);assert.equal(receipt.fields.find(f=>f.row_key==='row-0'&&f.field_name==='quantity').raw_value,5);assert.equal(receipt.fields.find(f=>f.row_key==='row-0'&&f.field_name==='quantity').value,null);
});

test('whole-receipt selection stays local, confirms only the named receipt and never reposts stock',async t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('demo ledger must never access a network'));
 const {store,pending,complete}=await setup(),otherPending=await upload(store);
 const before=await stock(store),rows=rowsFor(await ledger(store),pending);
 assert.deepEqual(await confirm(store,rows),{confirmed:2,failed_count:0,failed:[]});
 assert.equal((await detail(store,pending)).review.complete,true);assert.equal((await detail(store,otherPending)).review.complete,false);
 const after=await stock(store);assert.equal(after.products[0].stock.total,before.products[0].stock.total+5);assert.equal(after.products[1].stock.total,before.products[1].stock.total+5);
 assert.deepEqual(await confirm(store,rows),{confirmed:2,failed_count:0,failed:[]});
 assert.deepEqual((await stock(store)).positions,after.positions);
 // Seeded completed receipts are already published even without a local posting marker.
 assert.deepEqual(await confirm(store,rowsFor(await ledger(store),complete)),{confirmed:2,failed_count:0,failed:[]});
 assert.deepEqual((await stock(store)).positions,after.positions);assert.equal((await detail(store,complete)).review.complete,true);
});

test('partial success preserves saved rows and reports wrong store, run and row without confirming them',async()=>{
 const {store,other,pending}=await setup();const rows=rowsFor(await ledger(store),pending),foreign=(await ledger(other))[0];
 const before=await stock(store),otherBefore=await detail(other,foreign.batch_id);
 const result=await confirm(store,[rows[0],{batch_id:foreign.batch_id,run_id:foreign.run_id,row_key:foreign.row_key},{...rows[1],run_id:'old-run'},{...rows[1],row_key:'document'},{...rows[1],row_key:'missing-line'},null]);
 assert.equal(result.confirmed,1);assert.equal(result.failed_count,5);assert.deepEqual(result.failed.map(row=>row.error),['STORE_SCOPE_MISMATCH','OCR_VERSION_CHANGED','OCR_LINE_NOT_FOUND','OCR_LINE_NOT_FOUND','STORE_SCOPE_MISMATCH']);
 assert.equal(result.failed[1].batch_id,pending);assert.equal(result.failed[1].row_key,'row-1');
 const partial=await detail(store,pending);assert.deepEqual(partial.review.saved_rows,['row-0']);assert.equal(partial.review.complete,false);
 assert.ok((await ledger(store)).filter(row=>row.batch_id===pending).every(row=>row.status==='PENDING'),'saving one row cannot mark its receipt complete');
 assert.deepEqual((await stock(store)).positions,before.positions);assert.deepEqual((await detail(other,foreign.batch_id)).review,otherBefore.review);
 assert.deepEqual(await confirm(store,rows),{confirmed:2,failed_count:0,failed:[]});assert.equal((await detail(store,pending)).review.complete,true);
 const invalidRetry=await confirm(store,[{...rows[0],run_id:'old-run'}]);assert.equal(invalidRetry.failed[0].error,'OCR_VERSION_CHANGED');
});

test('ledger and confirmation enforce all eight identities, input shape and foreign business isolation',async()=>{
 for(const type of [single,chain])for(const role of ['STAFF','SUPERVISOR','LOGISTICS','OWNER']){
  await resetDemo();const store=configureDemo(role,type).stores[0].id;
  const result=await demoClient.rpc('get_pilot_receipt_ledger',{p_store_id:store});
  if(role==='STAFF'){
   assert.equal(result.error.code,'RECEIPT_REVIEWER_REQUIRED');const blocked=await demoClient.rpc('confirm_pilot_receipt_ledger',{p_store_id:store,p_rows:[]});assert.equal(blocked.error.code,'RECEIPT_REVIEWER_REQUIRED');continue;
  }
  assert.equal(result.error,null);const canReview=role==='OWNER'||role===(type===chain?'SUPERVISOR':'LOGISTICS');assert.ok(result.data.every(row=>row.review_allowed===canReview));
  const selected=result.data.filter(row=>row.status!=='COMPLETE');const saved=await confirm(store,selected);
  assert.equal(saved.confirmed,canReview?2:0);assert.equal(saved.failed_count,canReview?0:2);
  if(!canReview){assert.ok(saved.failed.every(row=>row.error==='RECEIPT_REVIEWER_REQUIRED'));assert.equal((await detail(store,selected[0].batch_id)).review.complete,false);}
 }
 await resetDemo();
 const {store,pending}=await setup();
 assert.deepEqual(await confirm(store,[]),{confirmed:0,failed_count:0,failed:[]});
 for(const rows of [null,undefined,{},'rows']){const result=await demoClient.rpc('confirm_pilot_receipt_ledger',{p_store_id:store,p_rows:rows});assert.equal(result.error.code,'ROWS_REQUIRED');}
 assert.equal((await detail(store,pending)).review.complete,false);
 configureDemo('OWNER',chain);
 for(const name of ['get_pilot_receipt_ledger','confirm_pilot_receipt_ledger']){const result=await demoClient.rpc(name,{p_store_id:store,p_rows:[]});assert.equal(result.error.code,'FORBIDDEN');}
});

test('a failed latest OCR run can expose saved fields but cannot be confirmed',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),storage=new Map();
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}});
 try{
  const {store,pending}=await setup();const original=await ledger(store);
  const [key,saved]=[...storage][0],state=JSON.parse(saved);
  state.businesses[single].spaces[store].batches.find(batch=>batch.id===pending).ocr_status='FAILED';
  storage.set(key,JSON.stringify(state));
  // Reload a separate demo transport from its synthetic browser storage snapshot.
  const isolated=await import(`../lib/demo-client.mjs?failed-ledger=${crypto.randomUUID()}`);isolated.configureDemo('LOGISTICS',single);
  const read=await isolated.demoClient.rpc('get_pilot_receipt_ledger',{p_store_id:store});assert.equal(read.error,null);assert.deepEqual(read.data,original);
  const result=await isolated.demoClient.rpc('confirm_pilot_receipt_ledger',{p_store_id:store,p_rows:rowsFor(read.data,pending)});
  assert.equal(result.error,null);assert.equal(result.data.confirmed,0);assert.equal(result.data.failed_count,2);assert.ok(result.data.failed.every(row=>row.error==='OCR_NOT_READY'));
  const after=await isolated.demoClient.rpc('get_pilot_receipts',{p_store_id:store});assert.equal(after.data.find(batch=>batch.id===pending).review_saved,false);
 }finally{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;}
});
