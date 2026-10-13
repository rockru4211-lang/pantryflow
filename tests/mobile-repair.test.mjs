import test from 'node:test';
import assert from 'node:assert/strict';
import {completedRepair,repairReported} from '../lib/mobile-repair.ts';
test('completion preserves the same record, revision and prior repair detail',()=>{
 const original={id:'repair-a',name:' 冰箱 ',category:'維修紀錄',repair_date:'2026-10-12',repair_reason:' 溫控器故障，已更換 ',repair_result:'10/11 廠商檢查',summary:'維修廠商：原廠',link:'https://example.com',note:'保固內',revision:3,archived:false};
 const result=completedRepair(original);
 assert.equal(result.id,original.id);assert.equal(result.revision,3);assert.equal(result.name,'冰箱');assert.equal(result.repair_reason,'溫控器故障，已更換');
 assert.equal(result.repair_result,'已完成維修\n10/11 廠商檢查');assert.equal(result.summary,original.summary);assert.equal(result.link,original.link);assert.equal(result.note,original.note);
 assert.deepEqual(completedRepair(result),result);assert.equal(original.repair_result,'10/11 廠商檢查');
});
test('historical text is not automatically treated as a confirmed completion',()=>{
 for(const repair_result of ['', '等待廠商', '已檢查但未完成', '已完成維修前檢查'])assert.equal(repairReported({repair_result}),false);
 assert.equal(repairReported({repair_result:'已完成維修'}),true);
});
