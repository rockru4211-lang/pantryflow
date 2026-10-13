import test from 'node:test';
import assert from 'node:assert/strict';
import {repairWorkEntries,repairLocalTime,repairYearOf} from '../lib/equipment-workflow.ts';
import {visibleWork} from '../lib/workflow-rules.ts';
import {showNotification} from '../lib/notification-preferences.ts';
const job={id:'j',name:'冰箱',status:'QUOTE',last_report:'等報價',updated_at:'2026-10-13T07:00:00Z',events:[{id:'e',action:'report',status:'QUOTE',body:'等報價',actor_name:'現場',created_at:'2026-10-13T07:00:00Z'}]};
test('quote remains pending while its report is a separate notification and history entry',()=>{const rows=repairWorkEntries([job]);assert.equal(visibleWork(rows,'tasks','','all','').length,1);assert.equal(visibleWork(rows,'notifications','2026-10','all','').length,1);assert.equal(visibleWork(rows,'activity','2026-10','all','').length,1);assert.equal(showNotification(rows[1],{bulletins:false,completed:false}),true);assert.equal(rows[1].id,'j');});
test('completed report clears task only; all event history survives',()=>{const done={...job,status:'DONE',events:[...job.events,{...job.events[0],id:'e2',status:'DONE',body:'已修好'}]};const rows=repairWorkEntries([done]);assert.equal(visibleWork(rows,'tasks','','all','').length,0);assert.equal(rows.length,2);});
test('Taiwan appointment roundtrip and completion year stay stable',()=>{assert.equal(repairLocalTime('2026-10-14T06:00:00Z'),'2026-10-14T14:00');assert.equal(repairYearOf({report_date:'2025-12-31',updated_at:'2026-01-01T00:00:00Z'}),'2025');});
