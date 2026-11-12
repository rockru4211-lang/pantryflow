import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDay, calendarDayKey, moveWorkMonth, splitWorkDateRange, validWorkDateRange, workMonthRange } from '../lib/work-date-selection.ts';

test('month navigation and date selection handle leap days and year boundaries',()=>{
 assert.equal(moveWorkMonth('2026-01',-1),'2025-12');
 assert.equal(moveWorkMonth('2026-12',1),'2027-01');
 assert.deepEqual(workMonthRange('2028-02'),{from:'2028-02-01',to:'2028-02-29'});
 assert.equal(calendarDayKey(calendarDay('2028-02-29')),'2028-02-29');
 assert.equal(calendarDay('2026-02-29'),undefined);
 assert.equal(validWorkDateRange({from:'2026-11-02',to:'2026-10-29'}),false);
 assert.equal(validWorkDateRange({from:'2026-10-29',to:'2026-11-02'}),true);
});

test('bounded waste requests cover a long period without skipped or repeated dates',()=>{
 assert.deepEqual(splitWorkDateRange({from:'2026-10-01',to:'2028-02-29'},366),[
  {from:'2026-10-01',to:'2027-10-02'},
  {from:'2027-10-03',to:'2028-02-29'},
 ]);
});
