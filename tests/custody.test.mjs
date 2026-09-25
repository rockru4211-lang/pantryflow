import test from 'node:test';
import assert from 'node:assert/strict';
import {custodyWarnings,custodyToday,custodyError} from '../lib/custody.ts';
const account={kind:'supplier',remaining:20,minimum:30,unit:'包',warning_days:30,lots:[{label:'A',remaining:20,expires_on:'2026-10-05'},{label:'B',remaining:0,expires_on:'2026-09-01'}]};
test('custody reminders use Taipei dates, ignore exhausted batches and preserve threshold boundary',()=>{
 assert.equal(custodyToday(new Date('2026-09-24T16:00:00Z')),'2026-09-25');
 assert.deepEqual(custodyWarnings(account,'2026-09-25'),['低於安全水位 30 包，請聯絡補購','A 即將到期（2026-10-05）']);
 assert.equal(custodyWarnings({...account,remaining:30,lots:[]},'2026-09-25').length,0);
 assert.deepEqual(custodyWarnings({...account,kind:'reserved',lots:[{label:'A',remaining:1,expires_on:'2026-09-24'}]},'2026-09-25'),['A 已到期（2026-09-24）']);
});
test('conflict and stock shortage errors explain the required action without exposing server internals',()=>{
 assert.match(custodyError({message:'CUSTODY_CHANGED'}),/重新讀取/);
 assert.match(custodyError({message:'INSUFFICIENT_STOCK'}),/門市可用庫存不足/);
 assert.doesNotMatch(custodyError({message:'secret connection info'}),/secret/);
});
