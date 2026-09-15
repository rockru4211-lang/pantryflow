import test from 'node:test';import assert from 'node:assert/strict';
import {configureDemo,demoContext,demoClient,resetDemo,selectDemoStore} from '../lib/demo-client.mjs';
const rpc=async(n,a)=>{const r=await demoClient.rpc(n,a);assert.equal(r.error,null,JSON.stringify(r.error));return r.data;};
const ws=(s,p)=>rpc('app_workspace',{p_store_id:s,p_section:p});
const op=(s,a,d,k=crypto.randomUUID())=>rpc('app_operation',{p_store_id:s,p_action:a,p_data:d,p_request_id:k});
const denied=async(s,a,d)=>assert((await demoClient.rpc('app_operation',{p_store_id:s,p_action:a,p_data:d,p_request_id:crypto.randomUUID()})).error);
const life=async(s,a,id=s,k)=>{const store=(await ws(s,'business')).stores.find(x=>x.id===id);return op(s,a,store,k);};
test.beforeEach(()=>resetDemo());
test('two stores retain separate receipts, pending counts and dedicated members after reopening',async()=>{
 const c=configureDemo('OWNER','SINGLE_RESTAURANT'),[a,b]=c.stores.map(x=>x.id);
 for(const [s,name] of [[a,'A 專屬'],[b,'B 專屬']])assert.equal((await demoClient.functions.invoke('manage-staff',{body:{action:'create',storeId:s,displayName:name,role:'OWNER'}})).error,null);
 assert(!(await ws(a,'members')).members.some(m=>m.display_name==='B 專屬'));
 assert(!(await ws(b,'members')).members.some(m=>m.display_name==='A 專屬'));
 assert((await ws(a,'members')).members.find(m=>m.user_id===c.user.id).is_enterprise_admin);
 configureDemo('SUPERVISOR','SINGLE_RESTAURANT');const batch=(await rpc('get_pilot_receipts',{p_store_id:a}))[0];
 for(const row of ['row-0','row-1'])await rpc('save_pilot_receipt_review',{p_store_id:a,p_batch_id:batch.id,p_row_key:row});
 for(let i=0;i<3;i++)for(const s of [a,b]){selectDemoStore(s);assert.equal((await rpc('get_app_dashboard',{p_store_id:s})).receipt_pending,s===a?0:1);assert((await rpc('get_pilot_receipts',{p_store_id:s})).every(r=>r.id.startsWith(s)));}
 configureDemo('OWNER','SINGLE_RESTAURANT');assert.equal((await rpc('get_app_dashboard',{p_store_id:a})).receipt_pending,0);assert.equal((await rpc('get_app_dashboard',{p_store_id:b})).receipt_pending,1);
});
test('deactivation excludes operational reads and selection, retains archive and permits idempotent loan return then restore',async()=>{
 const c=configureDemo('OWNER','SINGLE_RESTAURANT'),[a,b]=c.stores.map(x=>x.id);const before=await ws(a,'store-archive');
 await denied(a,'store.delete',(await ws(a,'business')).stores[0]);await life(a,'store.deactivate');assert(!demoContext().stores.some(s=>s.id===a));
 assert((await demoClient.rpc('get_app_dashboard',{p_store_id:a})).error);assert.throws(()=>selectDemoStore(a));assert.deepEqual((await ws(a,'store-archive')).receipts,before.receipts);
 configureDemo('SUPERVISOR','SINGLE_RESTAURANT');const loan=(await ws(a,'archived-transfers')).records[0],key=crypto.randomUUID(),d={id:loan.id,quantity:3,revision:loan.revision};
 const saved=await op(a,'movement.return',d,key);assert.equal(saved.status,'RETURNED');assert.deepEqual(await op(a,'movement.return',d,key),saved);assert.equal((await ws(a,'archived-transfers')).records[0].events.length,1);
 configureDemo('OWNER','SINGLE_RESTAURANT');await life(b,'store.restore',a);assert(demoContext().stores.some(s=>s.id===a));assert.equal((await ws(a,'store-archive')).receipts.length,before.receipts.length);
});
test('inline product edits keep in-flight drafts, quantity, unit snapshots and other store data',async()=>{
 const [a,b]=configureDemo('SUPERVISOR','SINGLE_RESTAURANT').stores.map(s=>s.id);const p=(await ws(a,'catalog')).products[0],other=await ws(b,'catalog');
 const session=await rpc('ensure_pilot_daily_count',{p_store_id:a});const history=await rpc('get_pilot_count_results',{p_session_id:a+'-count-history'});
 await rpc('save_pilot_count_drafts',{p_session_id:session,p_entries:[{product_id:p.id,zone_id:a+'-zone-0',quantity:5,unit:p.base_unit},{product_id:a+'-product-1',zone_id:a+'-zone-0',quantity:7,unit:'包'}]});
 const d={id:p.id,name:'修改後高麗菜',unit:'箱',specification:'新規格',updated_at:p.updated_at},key=crypto.randomUUID();const saved=await op(a,'product.edit-basic',d,key);assert.deepEqual(await op(a,'product.edit-basic',d,key),saved);
 await rpc('complete_pilot_count_zone',{p_session_id:session,p_zone_id:a+'-zone-0'});const results=await rpc('get_pilot_count_results',{p_session_id:session});assert.equal(results[0].quantity,5);assert.equal(results[0].unit,p.base_unit);assert.equal(results[0].name,p.name);
 assert.deepEqual(await rpc('get_pilot_count_results',{p_session_id:a+'-count-history'}),history);assert.deepEqual(await ws(b,'catalog'),other);
 configureDemo('STAFF','SINGLE_RESTAURANT');await denied(a,'product.edit-basic',{...d,updated_at:saved.updated_at});
 configureDemo('SUPERVISOR','SINGLE_RESTAURANT');await denied(a,'product.edit-basic',{...d,updated_at:'2000-01-01'});await denied(a,'product.edit-basic',{...d,id:other.products[0].id});assert.equal((await ws(a,'catalog')).products[0].name,d.name);
});
test('archived receipt payload excludes costs for staff and chain roles',async()=>{
 for(const [role,type] of [['STAFF','SINGLE_RESTAURANT'],['OWNER','CHAIN_RESTAURANT']]){const s=configureDemo(role,type).stores[0].id;const a=await ws(s,'store-archive');assert(a.receipts.every(r=>r.fields.every(f=>!['unit_price_ex_tax','subtotal_ex_tax','tax','total_inc_tax'].includes(f.field_name))));if(role==='STAFF')assert(a.waste.every(w=>w.reference_price==null));}
});
