import test from 'node:test';import assert from 'node:assert/strict';
import {configureDemo,demoContext,demoClient,resetDemo,selectDemoStore} from '../lib/demo-client.mjs';
import {managementPolicy} from '../lib/management-policy.mjs';
const call=async(name,args)=>{const r=await demoClient.rpc(name,args);assert.equal(r.error,null,JSON.stringify(r.error));return r.data;};
const op=(s,a,d,id=crypto.randomUUID())=>call('app_operation',{p_store_id:s,p_action:a,p_data:d,p_request_id:id});
const read=(s,section)=>call('app_workspace',{p_store_id:s,p_section:section});
test.beforeEach(()=>resetDemo());
test('store creation generates code, grants creator and retries once with independent settings',async()=>{
 const c=configureDemo('OWNER','SINGLE_RESTAURANT'),a=c.stores[0].id,b=c.stores[1].id,key=crypto.randomUUID();const before=await read(b,'settings');
 const created=await op(a,'store.create',{name:'南門店'},key);assert.match(created.store.store_code,/^S[A-F0-9]{12}$/);assert.equal((await op(a,'store.create',{name:'南門店'},key)).id,created.id);assert.equal(demoContext().stores.length,3);
 assert.equal((await read(created.id,'members')).members.length,1);assert.equal((await read(created.id,'catalog')).products.length,0);
 const local=await read(a,'settings');await op(a,'settings.save',{revision:local.revision,settings:{count_cadence:'MANUAL'}});assert.deepEqual(await read(b,'settings'),before);
 selectDemoStore(created.id);assert.equal(demoContext().stores.find(s=>s.id===created.id).can_manage_stores,true);
 configureDemo('OWNER','SINGLE_RESTAURANT');assert(demoContext().stores.some(s=>s.name==='南門店'));
});
test('each store retains its own member role, settings and custom permission after reopening',async()=>{
 const c=configureDemo('OWNER','SINGLE_RESTAURANT'),a=c.stores[0].id,b=c.stores[1].id;const member=(await read(a,'members')).members.find(m=>m.role==='SUPERVISOR');const before=(await read(b,'members')).members.find(m=>m.user_id===member.user_id);
 await op(a,'member.save',{...member,role:'LOGISTICS',display_name:'A 店後勤',can_manage_business:false,extra_permissions:['REPORTS_VIEW']});assert.deepEqual((await read(b,'members')).members.find(m=>m.user_id===member.user_id),before);
 const again=configureDemo('SUPERVISOR','SINGLE_RESTAURANT');assert.equal(again.user.id,member.user_id);assert.equal(again.stores.find(s=>s.id===a).role,'LOGISTICS');assert.equal(again.stores.find(s=>s.id===a).can_manage_stores,false);assert.equal(again.stores.find(s=>s.id===b).role,'SUPERVISOR');selectDemoStore(b);assert.equal(demoContext().user.id,member.user_id);
});
test('chain manager is restricted to employees even with a legacy enterprise admin grant',async()=>{
 const c=configureDemo('SUPERVISOR','CHAIN_RESTAURANT',true),s=c.stores[0];assert.equal(s.can_manage_stores,false);assert.equal(s.can_manage_members,true);assert.deepEqual(s.assignable_roles,['STAFF']);
 for(const action of ['store.create','settings.save','business.save'])assert.equal((await demoClient.rpc('app_operation',{p_store_id:s.id,p_action:action,p_data:{name:'不可建立'},p_request_id:crypto.randomUUID()})).error.code,'FORBIDDEN');
 const forbidden=await demoClient.functions.invoke('manage-staff',{body:{action:'create',storeId:s.id,displayName:'不能建立老闆',role:'OWNER'}});assert(forbidden.error);
 const valid=await demoClient.functions.invoke('manage-staff',{body:{action:'create',storeId:s.id,displayName:'店內員工',role:'STAFF'}});assert.equal(valid.error,null);assert.equal((await read(s.id,'members')).members.find(m=>m.user_id===valid.data.staffId).role,'STAFF');
 const own=(await read(s.id,'members')).members.find(m=>m.user_id===c.user.id);assert.equal((await demoClient.rpc('app_operation',{p_store_id:s.id,p_action:'member.save',p_data:{...own,role:'OWNER'},p_request_id:crypto.randomUUID()})).error.code,'FORBIDDEN');
});
test('role policy keeps staff closed, supervisors scoped and owner creation exclusive',()=>{
 assert.deepEqual(managementPolicy('STAFF','SINGLE_RESTAURANT',true),{can_manage_stores:false,can_manage_members:false,assignable_roles:[]});
 assert.equal(managementPolicy('LOGISTICS','CHAIN_RESTAURANT',false).can_manage_stores,false);assert.equal(managementPolicy('LOGISTICS','CHAIN_RESTAURANT',true).can_manage_stores,true);
 assert(!managementPolicy('SUPERVISOR','SINGLE_RESTAURANT',true).assignable_roles.includes('OWNER'));
});
