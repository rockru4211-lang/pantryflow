import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {configureDemo,resetDemo,demoClient,isDemoPath,selectDemoStore} from '../lib/demo-client.mjs';

const call=async(name,args)=>{const result=await demoClient.rpc(name,args);assert.equal(result.error,null,JSON.stringify(result.error));return result.data;};
const single='SINGLE_RESTAURANT',chain='CHAIN_RESTAURANT';
const context=(role='STAFF',type=single,admin=false)=>configureDemo(role,type,admin);
const op=(store,action,data={},request=crypto.randomUUID())=>call('app_operation',{p_store_id:store,p_action:action,p_data:data,p_request_id:request});
test.beforeEach(()=>{resetDemo();context();});

test('only the exact public demo route selects the mock transport',()=>{
  for(const path of ['/demo','/demo/'])assert.equal(isDemoPath(path),true);
  for(const path of ['/','/pilot','/?demo=true','/demo/account','/demonstration','/DEMO'])assert.equal(isDemoPath(path),false);
  const production=readFileSync('lib/supabase-browser.ts','utf8');
  assert.match(production,/isDemoPath\(window.location.pathname\)/);
  assert.match(production,/function createProductionClient/);
  assert.match(readFileSync('app/pilot/pilot-client.tsx','utf8'),/<AuthenticatedWorkspace/);
  assert.match(readFileSync('app/demo/demo-experience.tsx','utf8'),/<AuthenticatedWorkspace/);
});

test('all eight identities have seeded dashboards and correct ERP and permissions',async()=>{
  for(const type of [single,chain])for(const role of ['STAFF','SUPERVISOR','LOGISTICS','OWNER']){
    const c=context(role,type);assert.equal(c.stores.length,2);assert.equal(c.stores[0].role,role);assert.equal(c.stores[0].business_type,type);
    assert.equal(c.stores[0].can_manage_business,role==='OWNER');assert.equal(c.stores[0].has_erp,type===chain);
    const d=await call('get_app_dashboard',{p_store_id:c.stores[0].id});assert.ok(d.count);assert.equal(d.count_items,4);assert.equal(d.expiry_urgent,1);
    const expiry=await call('get_pilot_expiry_waste',{p_store_id:c.stores[0].id});assert.equal(expiry.permissions.field,['STAFF','SUPERVISOR'].includes(role));
  }
});

test('extra business permission does not change the work identity',async()=>{
  const c=context('LOGISTICS',single,true);assert.equal(c.stores[0].role,'LOGISTICS');assert.equal(c.stores[0].can_manage_business,true);
  assert.ok((await call('app_workspace',{p_store_id:c.stores[0].id,p_section:'members'})).members.length);
  const staff=context('STAFF',single,true);assert.equal(staff.stores[0].can_manage_business,false);
  const denied=await demoClient.rpc('app_workspace',{p_store_id:staff.stores[0].id,p_section:'members'});assert.equal(denied.error.code,'FORBIDDEN');
});

test('a completed employee count is visible to the supervisor with submitted quantities',async()=>{
  const store=context().stores[0].id;
  const dashboard=await call('get_app_dashboard',{p_store_id:store});const session=dashboard.count.id;
  const zones=await demoClient.from('count_zones').select('*').eq('store_id',store).order('sort_order');
  for(const zone of zones.data){const entries=zone.zone_products.map((p,i)=>({zone_id:zone.id,product_id:p.product_id,quantity:i+2}));
    const saved=await call('save_pilot_count_drafts',{p_session_id:session,p_entries:entries});assert.equal(saved.length,2);
    await call('complete_pilot_count_zone',{p_session_id:session,p_zone_id:zone.id});
  }
  context('SUPERVISOR');const after=await call('get_app_dashboard',{p_store_id:store});assert.equal(after.count.status,'CLOSED');assert.equal(after.count_completed,2);
  const results=await call('get_pilot_count_results',{p_session_id:session});assert.equal(results.length,4);assert.equal(results[0].quantity,2);
});

test('expiry removal is idempotent and appears in history for another identity',async()=>{
  const store=context().stores[0].id;const before=await call('get_pilot_expiry_waste',{p_store_id:store});
  const args={p_store_id:store,p_action:'USED',p_data:{expiry_id:before.items[0].id},p_request_id:crypto.randomUUID()};
  await call('save_pilot_expiry_waste',args);await call('save_pilot_expiry_waste',args);context('SUPERVISOR');
  const after=await call('get_pilot_expiry_waste',{p_store_id:store});assert.equal(after.items.length,1);assert.equal(after.used.length,1);assert.equal(after.used[0].name,'開封鮮奶');
});

test('receipt preview uses real field contracts and closes only after all rows are confirmed',async()=>{
  const store=context().stores[0].id;const batches=await call('get_pilot_receipts',{p_store_id:store});const id=batches[0].id;
  const detail=await call('get_pilot_receipt',{p_batch_id:id});assert.equal(detail.fields.find(f=>f.field_name==='product').value,'高麗菜');
  const first=await call('save_pilot_receipt_review',{p_batch_id:id,p_row_key:'row-0'});assert.equal(first.complete,false);
  const second=await call('save_pilot_receipt_review',{p_batch_id:id,p_row_key:'row-1'});assert.equal(second.complete,true);
  assert.equal((await call('get_pilot_receipt',{p_batch_id:id})).batch.status,'COMPLETED');
});

test('record handoff persists across identities and completion rejects stale revisions',async()=>{
  const store=context().stores[0].id;const record=await op(store,'record.create',{kind:'handover',title:'晚班交接',body:'確認冷藏櫃',audience:[]});
  context('SUPERVISOR');const taken=await op(store,'record.take',{id:record.id,revision:record.revision,note:'已接手'});assert.equal(taken.status,'IN_PROGRESS');
  const completed=await op(store,'record.complete',{id:record.id,revision:taken.revision,note:'已確認'});assert.equal(completed.status,'COMPLETE');
  const stale=await demoClient.rpc('app_operation',{p_store_id:store,p_action:'record.complete',p_data:{id:record.id,revision:record.revision}});assert.equal(stale.error.code,'REVISION_CONFLICT');
});

test('loans support partial return and closure',async()=>{
  const store=context().stores[0].id;const rows=await call('app_workspace',{p_store_id:store,p_section:'transfers'});const loan=rows.records[0];
  const partial=await op(store,'movement.return',{id:loan.id,revision:1,quantity:1});assert.equal(partial.returned_quantity,1);assert.equal(partial.status,'OPEN');
  const closed=await op(store,'movement.return',{id:loan.id,revision:2,quantity:2});assert.equal(closed.status,'RETURNED');
});

test('owner can edit a demo member but staff cannot promote themselves',async()=>{
  const c=context('OWNER'),store=c.stores[0].id;const members=await call('app_workspace',{p_store_id:store,p_section:'members'});const target=members.members.find(m=>m.role==='SUPERVISOR');
  await op(store,'member.save',{...target,can_manage_business:true,extra_permissions:['REPORTS_VIEW']});
  assert.equal((await call('app_workspace',{p_store_id:store,p_section:'members'})).members.find(m=>m.user_id===target.user_id).can_manage_business,true);
  context('STAFF');const result=await demoClient.rpc('app_operation',{p_store_id:store,p_action:'member.save',p_data:{...target,role:'OWNER'}});assert.equal(result.error.code,'FORBIDDEN');
});

test('business and store data are isolated; reset restores seeded data',async()=>{
  const c=context(),store=c.stores[0].id;await op(store,'record.create',{kind:'incident',title:'只在第一店',body:'測試'});
  selectDemoStore(c.stores[1].id);const other=await call('app_workspace',{p_store_id:c.stores[1].id,p_section:'incidents'});assert.equal(other.records.length,1);
  context('STAFF',chain);const foreign=await demoClient.rpc('get_app_dashboard',{p_store_id:store});assert.equal(foreign.error.code,'FORBIDDEN');
  resetDemo();context();assert.equal((await call('app_workspace',{p_store_id:store,p_section:'incidents'})).records.length,1);
});

test('unknown calls, authentication and file upload fail without any network',async()=>{
  const old=globalThis.fetch;let requests=0;globalThis.fetch=()=>{requests++;throw Error('unexpected network');};
  try{
    for(const action of [demoClient.rpc('unknown'),demoClient.auth.signInWithPassword({}),demoClient.functions.invoke('manage-staff',{}),demoClient.storage.from('receipt-documents').upload('x','x'),demoClient.from('real_private_table').select('*')])assert.equal((await action).error.code,'DEMO_UNAVAILABLE');
    await call('get_app_dashboard',{p_store_id:context().stores[0].id});assert.equal(requests,0);
  }finally{globalThis.fetch=old;}
});
