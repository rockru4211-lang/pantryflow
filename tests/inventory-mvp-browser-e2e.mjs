import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';
import test from'node:test';
import{countPage}from'../pilot-v1/pages/count.js';

const app=await readFile(new URL('../pilot-v1/app.js',import.meta.url),'utf8');
const data=await readFile(new URL('../pilot-v1/services/data.js',import.meta.url),'utf8');
const completion=await readFile(new URL('../supabase/baseline/production-applied/20260823133159_single_store_operational_slice.sql',import.meta.url),'utf8');

const active={
  sessions:[{id:'session-1',status:'IN_PROGRESS',started_at:'2026-08-29'}],activeSession:{id:'session-1',status:'IN_PROGRESS'},focusSession:{id:'session-1',status:'IN_PROGRESS'},
  zones:[{id:'zone-1',name:'冷藏庫'},{id:'zone-2',name:'乾貨區'}],
  products:[{id:'product-1',name:'鮮奶',product_code:'MILK-1',count_unit:'瓶'}],
  assignments:[{zone_id:'zone-1',product_id:'product-1'},{zone_id:'zone-2',product_id:'product-1'}],
  progress:[{session_id:'session-1',zone_id:'zone-1',status:'NOT_STARTED'},{session_id:'session-1',zone_id:'zone-2',status:'NOT_STARTED'}],entries:[],drafts:[{session_id:'session-1',zone_id:'zone-1',product_id:'product-1',quantity:3,unit:'瓶'}],discrepancies:[]
};

test('inventory MVP browser contract: blind count restores drafts and never exposes comparison data',()=>{
  const html=countPage(active,{role:'STAFF',context:{sessionId:'session-1',zoneId:'zone-1'}});
  assert.match(html,/value="3"/);
  assert.match(html,/已自動保存/);
  const form=html.slice(html.indexOf('<form id="blind-count"'));
  assert.doesNotMatch(form,/期初|上次數量|previous_quantity|difference|成本|金額/);
  assert.match(app,/createThrottledDraftSaver/);
  assert.match(app,/await flushCountDrafts\(\)/);
});

test('inventory MVP database contract: multi-zone completion creates immutable entries then discrepancies',()=>{
  const functionBody=completion.slice(completion.indexOf('create or replace function public.complete_pilot_count_zone'));
  assert.match(functionBody,/insert into public\.count_entries[\s\S]*if not exists\(select 1 from public\.count_zone_progress[\s\S]*insert into public\.inventory_count_discrepancies[\s\S]*update public\.inventory_count_sessions set status=case/);
  assert.match(completion,/inventory_count_resolution_events/);
  assert.match(completion,/parent_entry_id/);
  assert.doesNotMatch(completion,/update public\.count_entries set quantity/i);
  assert.match(data,/\.eq\('entered_by',userId\)/);
});

test('inventory MVP role contract: staff cannot see discrepancy workflow and manager cannot edit initial entries',()=>{
  const staff=countPage({...active,discrepancies:[{id:'d1',status:'PENDING',product_id:'product-1'}]},{role:'STAFF'});
  const manager=countPage({...active,activeSession:null,focusSession:{id:'session-1',status:'REVIEWING'},sessions:[{id:'session-1',status:'REVIEWING'}],discrepancies:[{id:'d1',status:'PENDING',product_id:'product-1',previous_quantity:4,estimated_quantity:3,difference:-1}]},{role:'SUPERVISOR'});
  assert.doesNotMatch(staff,/保存事件|更正事件|重盤事件/);
  assert.match(manager,/選擇原因/);
  assert.match(manager,/建立重盤事件/);
  assert.match(manager,/建立更正事件/);
});
