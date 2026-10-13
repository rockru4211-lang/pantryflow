import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingOverviewReceipts,overviewPriceRises,overviewContracts} from '../lib/operations-overview.ts';
const ingredient={id:'ham',name:'火腿',unit:'g',cost_price:2,selected_reference:null,review_status:'confirmed',aliases:[],revision:1,sources:[{id:'new',price:2.2,unit:'g',source_kind:'purchase',review_status:'confirmed',supplier_key:'A',effective_date:'2026-10-13'}]};
test('price rise uses confirmed comparable candidate and never mutates locked baseline',()=>{
 const data={ingredients:[ingredient],supply_states:[]};const before=structuredClone(data);const rows=overviewPriceRises(data);
 assert.equal(rows.length,1);assert(Math.abs(rows[0].percent-10)<1e-9);assert.deepEqual(data,before);
 for(const row of [{...ingredient,cost_price:null},{...ingredient,cost_price:0},{...ingredient,cost_price:3},{...ingredient,dismissed_reference:'new',dismissed_value:2.2},{...ingredient,sources:[{...ingredient.sources[0],unit:'kg'}]},{...ingredient,sources:[{...ingredient.sources[0],review_status:'pending'}]}])assert.deepEqual(overviewPriceRises({...data,ingredients:[row]}),[]);
 assert.deepEqual(overviewPriceRises({...data,supply_states:[{ingredient_id:'ham',supplier_key:'*',stopped:true}]}),[]);
});
test('receipt reminder excludes archived, tests, reviewed, received and duplicate batches',()=>{
 const rows=['pending','removed','test','reviewed','received','complete','pending'].map(batch_id=>({batch_id,review_complete:batch_id==='reviewed',has_goods_receipt:batch_id==='received',state:batch_id==='complete'?'COMPLETE':'NEEDS_REVIEW'}));
 assert.deepEqual(pendingOverviewReceipts(rows,[{entity_id:'removed',state:'REMOVED'},{entity_id:'test',state:'TEST'}]).map(r=>r.batch_id),['pending']);
});
test('contract reminders preserve existing three-calendar-month rule and overdue state',()=>{
 const row={id:'a',name:'合約',category:'合約文件',archived:false,contract_end:'2027-01-13'};
 const rows=overviewContracts([row,{...row,id:'future',contract_end:'2027-01-14'},{...row,id:'old',contract_end:'2026-10-12'},{...row,id:'archived',archived:true},{...row,id:'equipment',category:'設備資料'}],'2026-10-13');
 assert.deepEqual(rows.map(r=>r.id),['old','a']);assert.equal(rows[0].days,-1);assert.equal(rows[1].days,92);
});
