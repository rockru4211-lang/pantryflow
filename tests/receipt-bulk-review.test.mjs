import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,row} from './helpers/receipt-bulk-harness.mjs';
test('starts read-only, enters table editing, and saves only the changed receipt when Save is clicked',async()=>{
 const h=harness();assert.equal(h.field('a 數量'),undefined);h.button('編輯明細').props.onClick();h.edit('a 數量','3');h.save();await h.settle();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].id,'a');assert.equal(h.calls[0].data.lines[0].subtotal,150);assert.equal(h.calls[0].data.revision,1);assert.equal(h.calls[0].data.checked,false);assert.equal(h.calls[0].data.reviewed,false);assert.match(h.text(),/已儲存/);assert.equal(h.button('儲存修改'),undefined);
});
test('failed receipt retains draft and request ID; retry does not resubmit saved receipts',async()=>{
 const h=harness();h.button('編輯明細').props.onClick();h.edit('a 數量','3');h.edit('b 數量','4');h.fail('b');h.save();await h.settle();
 assert.equal(h.calls.length,2);const request=h.calls[1].request;assert.equal(h.field('b 數量').props.value,'4');assert.match(h.text(),/儲存失敗/);
 h.fail('');h.button('重試').props.onClick();await h.settle();assert.equal(h.calls.length,3);assert.equal(h.calls[2].request,request);assert.equal(h.calls[2].id,'b');
});
test('an in-flight save never disables input or overwrites newer keystrokes',async()=>{
 const h=harness();h.button('編輯明細').props.onClick();const release=h.hold();h.edit('a 數量','3');h.save();assert.equal(h.calls.length,1);
 h.edit('a 數量','4');release();await h.settle();assert.equal(h.field('a 數量').props.value,'4');h.save();await h.settle();assert.equal(h.calls[1].data.lines[0].quantity,4);assert.equal(h.calls[1].data.revision,2);assert.match(h.text(),/已儲存/);
});
test('Save waits until Chinese input composition ends',async()=>{
 const h=harness();h.button('編輯明細').props.onClick();h.compose(true);h.edit('a 備註','進貨備註');h.save();assert.equal(h.calls.length,0);h.compose(false);h.save();await h.settle();assert.equal(h.calls[0].data.lines[0].note,'進貨備註');
});
test('finish editing saves immediately; navigation preserves edits without starting a write',async()=>{
 const h=harness();h.button('編輯明細').props.onClick();h.edit('a 數量','3');h.button('完成編輯').props.onClick();await h.settle();assert(h.button('編輯明細'));assert.equal(h.calls.length,1);
 h.button('編輯明細').props.onClick();h.edit('b 數量','4');assert.equal(await h.props.leave(),true);await h.settle();assert.equal(h.calls.length,1);
});
test('clean draft follows refreshed server data; dirty draft keeps its original conflict revision',()=>{
 const h=harness();h.props.rows=[{...row('a'),revision:2,lines:[{...row('a').lines[0],quantity:7}]}];h.render();h.button('編輯明細').props.onClick();assert.equal(h.field('a 數量').props.value,'7');h.edit('a 數量','8');h.props.rows=[{...row('a'),revision:3}];assert.equal(h.field('a 數量').props.value,'8');h.save();assert.equal(h.calls[0].data.revision,2);
});

test('loading with no changes never traps navigation',async()=>{
 const h=harness();h.props.disabled=true;h.render();assert.equal(await h.props.leave(),true);
});
test('unavailable data preserves a recovery draft and allows leaving instead of deadlocking',async()=>{
 const h=harness();h.button('編輯明細').props.onClick();h.edit('a 數量','8');h.props.disabled=true;h.render();
 assert.equal(await h.props.leave(),true);assert.equal(h.calls.length,0);assert.equal(h.field('a 數量'),undefined);
 h.props.disabled=false;h.render();assert.equal(h.field('a 數量').props.value,'8');h.save();await h.settle();assert.equal(h.calls[0].data.lines[0].quantity,8);
});

test('hidden dirty receipts do not autosave or lock an empty date; returning retains edits',async()=>{
 const h=harness();h.button('編輯明細').props.onClick();h.edit('a 數量','8');
 h.props.rows=[];h.render();h.tick();await h.settle();
 assert.equal(h.calls.length,0);assert.doesNotMatch(h.text(),/等待儲存|儲存中/);
 h.props.rows=[row('a')];h.render();assert.equal(h.field('a 數量').props.value,'8');
 h.save();await h.settle();assert.equal(h.calls.length,1);
});
test('navigation and finish editing stay responsive during a pending save',async()=>{
 const h=harness();h.button('編輯明細').props.onClick();h.edit('a 數量','8');const release=h.hold();
 h.save();assert.equal(h.button('完成編輯').props.disabled,false);
 h.button('完成編輯').props.onClick();assert(h.button('編輯明細'));
 assert.equal(await h.props.leave(),true);release();await h.settle();
});

test('bulk saving and pending state never lock date, search, tabs or add controls',()=>{
 const source=readFileSync(new URL('../app/pilot/receiving-workspace.tsx',import.meta.url),'utf8');
 const body=source.match(/const ledgerEditing=useCallback\(\(key:string,active:boolean\)=>\{(.*?)\},\[\]\);/s)[1];
 const scope={editingLedgerRows:{current:new Set()},setSheetEditing(value){scope.sheet=value;},setFilterEditingLocked(value){scope.filters=value;}};
 const signal=runInNewContext('(key,active)=>{'+body+'}',scope);
 for(const key of ['bulk-review','bulk-pending','bulk-saving']){signal(key,true);assert.equal(scope.sheet,false);assert.equal(scope.filters,false);}
 signal('receipt-account',true);assert.equal(scope.sheet,true);assert.equal(scope.filters,true);
 signal('receipt-account',false);assert.equal(scope.sheet,false);assert.equal(scope.filters,false);
});

test('a stale draft merges independent server edits and retries once with latest revision',async()=>{
 const h=harness();h.button('編輯明細').props.onClick();h.edit('a 數量','3');
 h.props.rows=[{...row('a'),revision:2,note:'另一人備註'},row('b')];h.conflict('a');h.save();await h.settle();
 assert.equal(h.calls.length,2);assert.equal(h.reads(),1);assert.equal(h.calls[1].data.revision,2);
 assert.equal(h.calls[1].data.note,'另一人備註');assert.equal(h.calls[1].data.lines[0].quantity,3);
 assert.notEqual(h.calls[0].request,h.calls[1].request);assert.match(h.text(),/已儲存/);
});
test('same-field conflict preserves both choices and allows other receipts to save',async()=>{
 const h=harness();h.button('編輯明細').props.onClick();h.edit('a 數量','3');h.edit('b 數量','4');
 h.props.rows=[{...row('a'),revision:2,lines:[{...row('a').lines[0],quantity:5,subtotal:250}]},row('b')];
 h.conflict('a');h.save();await h.settle();assert.equal(h.calls.length,2);assert.equal(h.calls[1].id,'b');
 assert.match(h.text(),/你的輸入「3」，已存資料「5」/);h.tick();await h.settle();assert.equal(h.calls.length,2);
 h.button('保留我的修改並儲存').props.onClick();await h.settle();
 assert.equal(h.calls.length,3);assert.equal(h.calls[2].data.revision,2);assert.equal(h.calls[2].data.lines[0].quantity,3);
});
test('a second conflict stops; rerenders and navigation never cause an unbounded retry',async()=>{
 const h=harness();h.button('編輯明細').props.onClick();h.edit('a 數量','3');h.conflict('always');
 h.save();await h.settle();assert.equal(h.calls.length,2);
 for(let i=0;i<10;i++){h.tick();await h.settle();}await h.props.leave();await h.settle();
 assert.equal(h.calls.length,2);assert.match(h.text(),/貨單已由其他人/);
});

test('typing and waiting never writes until the explicit Save action',async()=>{
 const h=harness();h.button('編輯明細').props.onClick();h.edit('a 數量','0');
 for(let i=0;i<5;i++){h.tick();await h.settle();}
 assert.equal(h.calls.length,0);assert.match(h.text(),/有修改尚未儲存/);
 h.save();await h.settle();assert.equal(h.calls[0].data.lines[0].quantity,0);assert.match(h.text(),/已儲存/);
});
