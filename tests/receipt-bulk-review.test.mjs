import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,row} from './helpers/receipt-bulk-harness.mjs';
test('starts read-only, enters table editing, and saves only the changed receipt automatically',async()=>{
 const h=harness();assert.equal(h.field('a 數量'),undefined);h.button('編輯明細').props.onClick();h.edit('a 數量','3');h.tick();await h.settle();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].id,'a');assert.equal(h.calls[0].data.lines[0].subtotal,150);assert.equal(h.calls[0].data.revision,1);assert.equal(h.calls[0].data.checked,false);assert.equal(h.calls[0].data.reviewed,false);assert.match(h.text(),/已儲存/);assert.equal(h.button('儲存修改'),undefined);
});
test('failed receipt retains draft and request ID; retry does not resubmit saved receipts',async()=>{
 const h=harness();h.button('編輯明細').props.onClick();h.edit('a 數量','3');h.edit('b 數量','4');h.fail('b');h.tick();await h.settle();
 assert.equal(h.calls.length,2);const request=h.calls[1].request;assert.equal(h.field('b 數量').props.value,'4');assert.match(h.text(),/儲存失敗/);
 h.fail('');h.button('重試').props.onClick();await h.settle();assert.equal(h.calls.length,3);assert.equal(h.calls[2].request,request);assert.equal(h.calls[2].id,'b');
});
test('an in-flight save never disables input or overwrites newer keystrokes',async()=>{
 const h=harness();h.button('編輯明細').props.onClick();const release=h.hold();h.edit('a 數量','3');h.tick();assert.equal(h.calls.length,1);
 h.edit('a 數量','4');release();await h.settle();assert.equal(h.field('a 數量').props.value,'4');h.tick();await h.settle();assert.equal(h.calls[1].data.lines[0].quantity,4);assert.equal(h.calls[1].data.revision,2);assert.match(h.text(),/已儲存/);
});
test('Chinese input composition postpones autosave until composition ends',async()=>{
 const h=harness();h.button('編輯明細').props.onClick();h.compose(true);h.edit('a 備註','進貨備註');h.tick();assert.equal(h.calls.length,0);h.compose(false);h.tick();await h.settle();assert.equal(h.calls[0].data.lines[0].note,'進貨備註');
});
test('finish editing saves immediately and returns to read-only; navigation flushes pending edits',async()=>{
 const h=harness();h.button('編輯明細').props.onClick();h.edit('a 數量','3');h.button('完成編輯').props.onClick();await h.settle();assert(h.button('編輯明細'));assert.equal(h.calls.length,1);
 h.button('編輯明細').props.onClick();h.edit('b 數量','4');assert.equal(await h.props.leave(),true);await h.settle();assert.equal(h.calls.length,2);
});
test('clean draft follows refreshed server data; dirty draft keeps its original conflict revision',()=>{
 const h=harness();h.props.rows=[{...row('a'),revision:2,lines:[{...row('a').lines[0],quantity:7}]}];h.render();h.button('編輯明細').props.onClick();assert.equal(h.field('a 數量').props.value,'7');h.edit('a 數量','8');h.props.rows=[{...row('a'),revision:3}];assert.equal(h.field('a 數量').props.value,'8');h.tick();assert.equal(h.calls[0].data.revision,2);
});
