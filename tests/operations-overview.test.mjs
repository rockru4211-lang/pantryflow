import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingOverviewReceipts,overviewPriceRises,overviewContracts,prioritizeOverviewRows,OVERVIEW_LIMIT} from '../lib/operations-overview.ts';
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

test('overview preview ranks across stores before limiting and preserves all remaining records',()=>{
 const rows=Array.from({length:9},(_,i)=>({id:String(i),storeId:'a',priority:1,order:`2026-10-${String(i+1).padStart(2,'0')}`}));
 rows.push({id:'urgent',storeId:'b',priority:0,order:'2026-10-13'});
 const before=structuredClone(rows),sorted=prioritizeOverviewRows(rows);
 assert.deepEqual(sorted.slice(0,OVERVIEW_LIMIT).map(r=>r.id),['urgent','0','1','2','3']);
 assert.equal(sorted.length,10);assert.deepEqual(rows,before);
 assert.deepEqual(prioritizeOverviewRows([{id:'small',storeId:'a',priority:-5},{id:'large',storeId:'b',priority:-30}]).map(r=>r.id),['large','small']);
 assert.deepEqual(prioritizeOverviewRows([{id:'unknown',storeId:'a'},{id:'due',storeId:'b',order:'2026-10-01'}]).map(r=>r.id),['due','unknown']);
});

test('combined tasks exclude completed work, preserve sources and rank overdue work across types',async()=>{
 const {overviewTasks}=await import('../lib/operations-overview.ts');
 const job={id:'same',name:'冰箱',status:'QUOTE',created_at:'2026-10-15T00:00:00Z',scheduled_at:'2026-10-20T02:00:00Z',last_report:''};
 const purchase={id:'same',name:'餐盤',status:'SENT',arrival_date:'2026-10-14',desired_date:'2026-10-19'};
 const inputs=[[job,{...job,id:'done',status:'DONE'},{...job,id:'historic',created_at:'2026-10-01T00:00:00Z'}],[purchase,{...purchase,id:'arrived',status:'ARRIVED'},{...purchase,id:'cancelled',status:'CANCELLED'}],[{id:'incident',category:'設備',title:'漏水',status:'OPEN',created_at:'2026-10-15'},{id:'closed',category:'設備',title:'完成',status:'COMPLETE'}]];
 const before=structuredClone(inputs);const rows=overviewTasks(...inputs,'2026-10-15');
 assert.deepEqual(rows.map(r=>r.id),['repair:same','purchase:same','incident:incident']);
 assert.equal(rows[1].detail,'2026-10-14');assert.equal(rows[1].view,'purchase-notes');assert.equal(rows[0].status,'等待報價');
 const ranked=prioritizeOverviewRows(rows.map((r,i)=>({...r,storeId:String(i)})));
 assert.equal(ranked[0].id,'purchase:same');assert.deepEqual(inputs,before);
 assert.equal(overviewTasks([{...job,scheduled_at:null}],[],[],'2026-10-15')[0].detail,'尚未安排');
});
