import test from 'node:test';
import assert from 'node:assert/strict';
import {inventorySpots,readInventorySpots} from '../lib/inventory-spot.ts';
import {inventoryExportRows} from '../lib/inventory-monthly.ts';
const row={product_id:'ham',unit:'公斤',current_quantity:5,zones:[],comparison:'MATCHED'};
const item={product_id:'ham',unit:'公斤',zone_id:'cold',zone:'冷藏',quantity:0.8,original_quantity:1,note:'已使用'};
const check={id:'one',store_id:'store',source_id:'source',status:'OPEN',created_at:'2026-10-01T00:00:00Z',items:[item]};
test('shows saved decimal difference and reason without replacing inventory',()=>{
 const [result]=inventorySpots([row],[check],'store','source');
 assert.equal(result.current_quantity,5);assert.equal(result.spots[0].quantity,0.8);assert.equal(result.spots[0].difference,-0.2);assert.equal(result.spots[0].note,'已使用');assert.equal(row.spots,undefined);
});
test('deduplicates trials per zone; newest unfilled does not silently reuse old quantity',()=>{
 const latest={...check,id:'two',created_at:'2026-10-02',items:[{...item,quantity:null},{...item,zone_id:'bar',zone:'吧台',quantity:0,original_quantity:null}]};
 const [result]=inventorySpots([row],[check,latest],'store','source');
 assert.equal(result.spots.length,2);assert.equal(result.spots.find(s=>s.zone_id==='cold').quantity,null);
 assert.equal(result.spots.find(s=>s.zone_id==='bar').quantity,0);assert.equal(result.spots.find(s=>s.zone_id==='bar').difference,null);
});
test('isolates store, source, units and unpublished drafts',()=>{
 const excluded=[{...check,store_id:'elsewhere'},{...check,source_id:'previous'},{...check,status:'DRAFT'},{...check,items:[{...item,unit:'包'}]}];
 assert.deepEqual(inventorySpots([row],excluded,'store','source')[0].spots,[]);
});
test('export includes numbers, baseline and reason by zone',()=>{
 const [result]=inventoryExportRows(inventorySpots([row],[check],'store','source'));
 assert.equal(result['抽盤數量'],'冷藏：0.8');assert.equal(result['抽盤差異'],'冷藏：-0.2');assert.equal(result['抽盤原因'],'冷藏：已使用');
});
test('reader filters summaries before details and fails closed on mismatched response',async()=>{
 const calls=[];
 const rpc=async(action,data)=>{calls.push([action,data]);return action==='list'?{checks:[check,{...check,id:'foreign',source_id:'other'}]}:check;};
 assert.deepEqual(await readInventorySpots(rpc,'store','source','2026-10-01'),[check]);
 assert.deepEqual(calls,[['list',{month:'2026-10'}],['detail',{id:'one'}]]);
 await assert.rejects(readInventorySpots(async action=>action==='list'?{checks:[check]}:{...check,store_id:'other'},'store','source','2026-10-01'),/INVALID_SPOT_RESPONSE/);
 await assert.rejects(readInventorySpots(async()=>{throw Error('permission denied');},'store','source','2026-10-01'),/permission denied/);
});
