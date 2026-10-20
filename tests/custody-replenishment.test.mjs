import test from 'node:test';import assert from 'node:assert/strict';
import {searchCustodyReminders,applyCustodyReminder,custodyStatus,custodyNotificationEntries} from '../lib/custody-reminders.ts';
import {visibleWork} from '../lib/workflow-rules.ts';
const reminder={id:'r',product_id:'p',store_id:'a',name:'冷凍鴨肝',count_name:'鴨肝',code:'FG-001',names:['鴨肝','法式鴨肝'],supplier:'甲',unit:'包',remaining:53,safety_stock:60,kind:'supplier',revision:1,note:''};
test('custody keyword and code suggestions retain supplier boundaries and show zero balance',()=>{
 const rows=[reminder,{...reminder,id:'other',supplier:'乙'},{...reminder,id:'zero',remaining:0}];
 assert.deepEqual(searchCustodyReminders(rows,'鴨肝','甲').map(r=>r.id),['r','zero']);
 assert.equal(searchCustodyReminders(rows,'ＦＧ－００１','甲').length,2);
 assert.equal(searchCustodyReminders(rows,'法式鴨肝','乙')[0].id,'other');
 assert.equal(searchCustodyReminders(rows,'','甲').length,0);
 assert.equal(searchCustodyReminders(rows,'鴨肝','').length,3);
});
test('choosing a custody record links explicit id and unit without changing quantity or physical count',()=>{
 const draft={supplier:'甲',lines:[{product_name:'鴨肝',quantity:'2',unit:'',unit_price:'10',subtotal:'20',ingredient_id:'wrong',row_key:'a'},{product_name:'other',quantity:'1'}]};
 const selected=applyCustodyReminder(draft,0,reminder);
 assert.equal(selected.lines[0].custody_reminder_id,'r');assert.equal(selected.lines[0].product_name,'冷凍鴨肝');assert.equal(selected.lines[0].unit,'包');assert.equal(selected.lines[0].quantity,'2');
 assert.equal(selected.lines[0].ingredient_id,null);assert.equal(selected.lines[0].subtotal,'20');assert.deepEqual(selected.lines[1],draft.lines[1]);
 assert.equal(applyCustodyReminder({...draft,supplier:'乙'},0,reminder).supplier,'乙');assert.equal(draft.lines[0].product_name,'鴨肝');
});
test('strict threshold, confirmed ETA, partial arrivals and overdue use separate states',()=>{
 assert.equal(custodyStatus(reminder,'2026-10-20'),'LOW');
 assert.equal(custodyStatus({...reminder,safety_stock:53},'2026-10-20'),'OK');
 assert.equal(custodyStatus({...reminder,safety_stock:null},'2026-10-20'),'OK');
 const order={status:'ORDERED',expected_on:null,ordered_quantity:100,received_quantity:2};
 assert.equal(custodyStatus({...reminder,order},'2026-10-20'),'WAITING_DATE');
 assert.equal(custodyStatus({...reminder,order:{...order,expected_on:'2026-10-20'}},'2026-10-20'),'ORDERED');
 assert.equal(custodyStatus({...reminder,remaining:100,order:{...order,expected_on:'2026-10-19'}},'2026-10-20'),'OVERDUE');
 assert.equal(custodyStatus({...reminder,remaining:153,order:null},'2026-10-20'),'OK');
});
test('actionable custody alerts remain in notifications across months and stop after ETA confirmation',()=>{
 const rows=[{...reminder,notified_at:'2026-01-01T02:00:00Z'}];
 const notices=custodyNotificationEntries(rows);assert.equal(notices.length,1);
 assert.equal(visibleWork(notices,'notifications','2026-10','all','').length,1);
 assert.equal(custodyNotificationEntries([{...rows[0],order:{status:'ORDERED',expected_on:'2099-01-01'}}]).length,0);
 assert.equal(custodyNotificationEntries([{...rows[0],remaining:100}]).length,0);
 assert.equal(custodyNotificationEntries([reminder]).length,0);
});
