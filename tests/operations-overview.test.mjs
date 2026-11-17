import test from 'node:test';
import assert from 'node:assert/strict';
import {overviewSpotDifferences,overviewPriceRises,overviewContracts,prioritizeOverviewRows,OVERVIEW_LIMIT} from '../lib/operations-overview.ts';
const receipt=(id,date,amount,extra={})=>({
 id,effective_date:date,created_at:date,supplier_key:'id:vendor',receipt_supplier:'大誼',
 receipt_price:amount,receipt_unit:'罐',receipt_purchase:{amount,quantity:1,unit:'罐',content_quantity:340,content_unit:'g'},...extra,
});
const ingredient={id:'crab',name:'Crab Roe',aliases:[],purchase:{amount:800,quantity:1,unit:'罐'},
 sources:[receipt('prev','2026-09-01',900),receipt('latest','2026-10-02',990),
  {id:'sheet',effective_date:'2026-11-02',source_kind:'purchase',source:'請購表：食材',purchase:{amount:500,quantity:1,unit:'罐'}}],
};
const data={ingredients:[ingredient],suppliers:[{id:'vendor',name:'大誼',active:true}],supply_states:[]};
test('overview compares the latest two confirmed receipts, preserving original amounts and ignoring request-sheet prices',()=>{
 const before=structuredClone(data);
 const [rise]=overviewPriceRises(data);
 assert.equal(rise.previous.amount,900);
 assert.equal(rise.current.amount,990);
 assert.equal(rise.purchasePercent,10);
 assert.deepEqual(data,before);
 assert.deepEqual(overviewPriceRises({...data,supply_states:[{ingredient_id:'crab',supplier_key:'*',stopped:true}]}),[]);
});

test('overview leaves unmatched supplier, unit, package size and missing price out of the comparison',()=>{
 const [previous,latest,reference]=ingredient.sources;
 for(const edited of [
  {...latest,supplier_key:'id:other',receipt_supplier:'其他供應商'},
  {...latest,receipt_purchase:{...latest.receipt_purchase,unit:'盒'}},
  {...latest,receipt_purchase:{...latest.receipt_purchase,content_quantity:500}},
  {...latest,receipt_price:null},
  {...latest,receipt_price:800,receipt_purchase:{...latest.receipt_purchase,amount:800}},
 ]){
  const row={...ingredient,sources:[previous,edited,reference]};
  assert.deepEqual(overviewPriceRises({...data,ingredients:[row]}),[]);
 }
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

test('spot follow-up lists only unexplained measured differences in active checks',()=>{
 const item={entry_id:'one',name:'火腿',zone:'冰箱',unit:'公斤',quantity:0,original_quantity:2,review_status:'UNCHECKED',note:'',reason:null};
 const check={id:'check',status:'OPEN',created_at:'2026-11-10T00:00:00Z',items:[
  item,{...item,entry_id:'positive',quantity:2.5,reason:'UNKNOWN'},
  {...item,entry_id:'missing-count',quantity:null},{...item,entry_id:'same',quantity:2},
  {...item,entry_id:'onsite-reason',note:'已使用'},{...item,entry_id:'known-reason',reason:'USED'},
  {...item,entry_id:'closed',review_status:'CLOSED'},{...item,entry_id:'unknown-baseline',original_quantity:null},
 ]};
 const rows=overviewSpotDifferences(check);
 assert.deepEqual(rows.map(({id,recordId,detail})=>[id,recordId,detail]),[
  ['spot:check:one','check','-2 公斤'],['spot:check:positive','check','+0.5 公斤'],
 ]);
 assert.deepEqual(overviewSpotDifferences({...check,status:'CLOSED'}),[]);
});
