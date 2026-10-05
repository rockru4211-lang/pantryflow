import test from 'node:test';
import assert from 'node:assert/strict';
import {applyInventoryCosts,inventoryCostCandidates,inventoryCostNote,inventoryCostRatio,inventoryPriceSource,inventoryMonthEnd,withoutInventoryCostSource} from '../lib/inventory-cost.ts';
const row={row_key:'ham:kg',product_id:'ham',name:'火腿',unit:'公斤',current_quantity:1.2,unit_price:null,review_note:'現場已確認',acknowledged:false};
const line={row_key:'1',product_id:'ham',product_name:'火腿',unit:'g',quantity:1000,unit_price:1.8};
const account={batch_id:'receipt-1',receipt_date:'2026-09-25',supplier_name:'供應商',record_state:'LIVE',pending:false,source_changed:false,amount_conflict:false,status:'UNCHECKED',reviewed:true,source_fingerprint:'v1',lines:[line]};
const candidates=(rows=[row],accounts=[account],month='2026-09')=>inventoryCostCandidates(rows,accounts,month);
test('correct dimensional conversion, container units never guessed',()=>{
 assert.equal(inventoryCostRatio('g','公斤'),1000);assert.equal(inventoryCostRatio('公斤','g'),.001);
 assert.equal(inventoryCostRatio('L','毫升'),.001);assert.equal(inventoryCostRatio('公升','公斤'),null);
 assert.equal(inventoryCostRatio('包','公斤'),null);assert.equal(inventoryCostRatio('卷','卷'),1);
 assert.equal(inventoryMonthEnd('2026-09'),'2026-09-30');assert.equal(inventoryMonthEnd('2024-02'),'2024-02-29');
 assert.equal(candidates()[0].price,1800);assert.equal(row.unit_price,null);
});
test('latest at month end; future, invalid and wrong identity cannot supply price',()=>{
 const older={...account,batch_id:'old',receipt_date:'2026-08-31',lines:[{...line,unit_price:1}]};
 const future={...account,batch_id:'future',receipt_date:'2026-10-01',lines:[{...line,unit_price:3}]};
 assert.equal(candidates([row],[older,account,future])[0].price,1800);
 assert.equal(candidates([row],[older,future])[0].price,1000);
 assert.equal(candidates([row],[{...account,receipt_date:'2026-02-30'}]).length,0);
 assert.equal(candidates([row],[{...account,lines:[{...line,product_id:'other'}]}]).length,0);
 assert.equal(candidates([row],[{...account,receipt_date:'115/9/25'}])[0].date,'2026-09-25');
});
test('exclude unverified edits, stale source, removed, test, freight, custody, invalid prices',()=>{
 for(const patch of [{reviewed:false},{record_state:'TEST'},{record_state:'REMOVED'},{source_changed:true},{pending:true},{amount_conflict:true},{status:'RECHECK'}])assert.equal(candidates([row],[{...account,...patch}]).length,0,JSON.stringify(patch));
 for(const patch of [{handling:'FREIGHT'},{handling:'CUSTODY_RELEASE'},{product_name:'運費'},{unit_price:null},{unit_price:NaN},{unit_price:-1},{quantity:0},{unit_price:1e9}])assert.equal(candidates([row],[{...account,lines:[{...line,...patch}]}]).length,0);
 assert.equal(candidates([row],[{...account,reviewed:false,receipt_status:'COMPLETED',edit_revision:0}]).length,1);
 assert.equal(candidates([row],[{...account,reviewed:false,receipt_status:'COMPLETED',edit_revision:1}]).length,0);
});
test('same day conflicting prices stay pending; deduplicate sources; zero legitimate',()=>{
 assert.equal(candidates([row],[account,{...account,batch_id:'receipt-2',lines:[{...line,unit_price:2}]}]).length,0);
 assert.equal(candidates([row],[account,account]).length,1);
 assert.equal(candidates([{...row,unit_price:1800}]).length,0);
 assert.equal(candidates([row],[{...account,lines:[{...line,unit_price:0}]}])[0].price,0);
});
test('source persists without overwriting notes and manual edit can clear provenance',()=>{
 const c=candidates()[0],note=inventoryCostNote(row,c);
 assert.match(note,/現場已確認/);assert.match(note,/2026-09-25/);assert.match(note,/receipt-1\/1/);
 assert.equal(withoutInventoryCostSource(note),'現場已確認');
 assert.equal(inventoryCostNote({...row,review_note:note},c),note);
 assert.match(inventoryPriceSource({...row,unit_price:1800,review_note:note}),/未稅/);
 assert.throws(()=>inventoryCostNote({...row,review_note:'字'.repeat(2000)},c),/NOTE_TOO_LONG/);
});
test('revision chained writes preserve acknowledgement and notes; stop on uncertain write, no retry',async()=>{
 const row2={...row,row_key:'second'},state={source_id:'session',revision:'v1',closed:false,rows:[row,row2]};
 const plan=candidates(state.rows);const writes=[],saved=[];
 await assert.rejects(applyInventoryCosts(state,plan,async payload=>{
  writes.push(payload);if(writes.length===2)throw Error('network lost');
  return {...state,revision:'v2',rows:[{...row,unit_price:1800},row2]};
 },(s,n)=>saved.push([s.revision,n])),/network lost/);
 assert.equal(writes.length,2);assert.equal(writes[0].revision,'v1');assert.equal(writes[1].revision,'v2');
 assert.equal(writes[0].acknowledged,false);assert.match(writes[0].note,/現場已確認/);assert.deepEqual(saved,[['v2',1]]);
 assert.equal(row.unit_price,null);
});
test('closed or historical snapshots and concurrent price edits cannot be overwritten',async()=>{
 for(const flags of [{closed:true},{historical:true}])await assert.rejects(applyInventoryCosts({source_id:'s',rows:[row],...flags},candidates(),()=>assert.fail('must not write'),()=>{}),/CLOSED/);
 await assert.rejects(applyInventoryCosts({source_id:'s',rows:[{...row,unit_price:99}]},candidates(),()=>assert.fail('must not write'),()=>{}),/REVISION_CHANGED/);
});
