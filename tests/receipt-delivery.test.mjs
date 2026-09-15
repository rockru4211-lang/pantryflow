import test from 'node:test';
import assert from 'node:assert/strict';
import {configureDemo,resetDemo,demoClient,selectDemoStore} from '../lib/demo-client.mjs';
import {arrivalLabel,pendingDeliveryIssues} from '../lib/receipt-delivery.ts';
const type='CHAIN_RESTAURANT';
const rpc=async(name,args)=>{const r=await demoClient.rpc(name,args);assert.equal(r.error,null,JSON.stringify(r.error));return r.data;};
const op=(store,action,data,request=crypto.randomUUID())=>rpc('app_operation',{p_store_id:store,p_action:action,p_data:data,p_request_id:request});
const issue=()=>({id:crypto.randomUUID(),name:'冷藏鮮奶',reason:'效期太短',quantity:3,unit:'瓶',note:'等待供應商換貨',status:'OPEN'});
const setup=async()=>{resetDemo();const c=configureDemo('STAFF',type);const store=c.stores[0].id;const batches=await rpc('get_pilot_receipts',{p_store_id:store});return {c,store,batches};};

test('arrival never falls back to upload time and time is optional',()=>{
 assert.equal(arrivalLabel(), '到貨日期未填');
 assert.equal(arrivalLabel({arrived_on:'2026-09-02',arrived_time:null}), '到貨 2026-09-02');
 assert.equal(arrivalLabel({arrived_on:'2026-09-02',arrived_time:'08:30:00'}), '到貨 2026-09-02 08:30');
});
test('delivery and ERP save independently, retry once, preserve confirmed stock and history',async()=>{
 const {store,batches}=await setup();const b=batches[1];
 const before=await rpc('get_pilot_receipt',{p_batch_id:b.id});
 const request=crypto.randomUUID(), data={batch_id:b.id,revision:0,arrived_on:'2026-08-30',arrived_time:null,issues:[issue()]};
 const first=await op(store,'receipt.delivery',data,request);assert.deepEqual(await op(store,'receipt.delivery',data,request),first);
 await op(store,'receipt.erp-bulk',{batch_ids:[b.id]});
 const after=await rpc('get_pilot_receipt',{p_batch_id:b.id});
 assert.equal(after.batch.uploaded_at,b.uploaded_at);assert.equal(after.batch.work_date,b.work_date);assert.deepEqual(after.fields,before.fields);
 assert.equal(after.batch.delivery.arrived_on,'2026-08-30');assert.equal(after.batch.delivery.revision,1);assert.equal(pendingDeliveryIssues(after.batch.delivery),1);assert.ok(after.batch.erp_completed_at);
 assert.equal((await rpc('get_app_dashboard',{p_store_id:store})).receipt_issues,1);
 const completed={...first.issues[0],status:'COMPLETE',note:'已退貨給供應商'};
 await op(store,'receipt.delivery',{...first,batch_id:b.id,issues:[completed]});
 const final=await rpc('get_pilot_receipt',{p_batch_id:b.id});assert.equal(pendingDeliveryIssues(final.batch.delivery),0);assert.equal(final.batch.delivery.issues.length,1);assert.equal(final.batch.erp_completed_at,after.batch.erp_completed_at);
});
test('stale saves keep previous data, and existing issues cannot be omitted',async()=>{
 const {store,batches}=await setup(),data={batch_id:batches[0].id,revision:0,arrived_on:null,arrived_time:null,issues:[issue()]};
 await op(store,'receipt.delivery',data);
 for(const [bad,code] of [[data,'REVISION_CONFLICT'],[{...data,revision:1,issues:[]},'INVALID_ISSUE_REMOVAL']]){
  const r=await demoClient.rpc('app_operation',{p_store_id:store,p_action:'receipt.delivery',p_data:bad,p_request_id:crypto.randomUUID()});assert.equal(r.error.code,code);
 }
 assert.equal(pendingDeliveryIssues((await rpc('get_pilot_receipt',{p_batch_id:batches[0].id})).batch.delivery),1);
});
test('bulk ERP rejects mixed-store selection atomically and role changes cannot replay a cached write',async()=>{
 const {store,c,batches}=await setup(),other=c.stores[1].id;
 selectDemoStore(other);const foreign=(await rpc('get_pilot_receipts',{p_store_id:other}))[0];selectDemoStore(store);
 const mixed=await demoClient.rpc('app_operation',{p_store_id:store,p_action:'receipt.erp-bulk',p_data:{batch_ids:[batches[0].id,foreign.id]},p_request_id:crypto.randomUUID()});assert.equal(mixed.error.code,'RECEIPT_ACCESS_DENIED');
 assert.equal((await rpc('get_pilot_receipt',{p_batch_id:batches[0].id})).batch.erp_completed_at,null);
 const request=crypto.randomUUID(),data={batch_ids:[batches[0].id]};await op(store,'receipt.erp-bulk',data,request);
 for(const role of ['OWNER','LOGISTICS']){configureDemo(role,type);const r=await demoClient.rpc('app_operation',{p_store_id:store,p_action:'receipt.erp-bulk',p_data:data,p_request_id:request});assert.equal(r.error.code,'FORBIDDEN');}
 configureDemo('SUPERVISOR',type);assert.ok((await rpc('get_pilot_receipt',{p_batch_id:batches[0].id})).batch.erp_completed_at);
});
test('zero received is valid, closing requires a note, invalid time and negative quantities are denied',async()=>{
 const {store,batches}=await setup();const base={batch_id:batches[0].id,revision:0,arrived_on:null,arrived_time:null,issues:[{...issue(),reason:'未收到',quantity:0}]};
 await op(store,'receipt.delivery',base);
 for(const data of [{...base,revision:1,arrived_time:'12:30'},{...base,revision:1,issues:[{...base.issues[0],quantity:-1}]},{...base,revision:1,issues:[{...base.issues[0],status:'COMPLETE',note:''}]}]){
  const r=await demoClient.rpc('app_operation',{p_store_id:store,p_action:'receipt.delivery',p_data:data,p_request_id:crypto.randomUUID()});assert.ok(r.error);
 }
});
