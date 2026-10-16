import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,row} from './helpers/receipt-bulk-harness.mjs';
const desktop=rows=>harness((rows||[row('a'),row('b')]).map(r=>({review_completed:true,...r})),{desktopMode:true});
function selectAll(h){h.button('選取貨單').props.onClick();h.field('選取全部可編輯貨單').props.onChange({target:{checked:true}});h.render();}
test('desktop starts with inline editable items and one save; cancellation restores saved data',async()=>{
 const h=desktop();h.edit('a 數量','3');h.button('取消修改').props.onClick();h.render();assert.equal(h.calls.length,0);assert.equal(h.field('a 數量').props.value,'2');h.edit('a 數量','4');h.save();await h.settle();assert.equal(h.calls[0].data.lines[0].quantity,4);assert(h.field('a 數量'));
});
test('completed, checked and incomplete receipts keep details without a separate handoff button',()=>{
 const h=desktop([{...row('old'),status:'CHECKED'}, {...row('a'),finance_sent_at:'2026-10-16'},row('b'),{...row('missing'),lines:[{...row('missing').lines[0],unit_price:null}]}]);
 assert.equal(h.button('送對帳單（2張）'),undefined);assert.equal(h.button('送對帳'),undefined);
 assert.equal(h.props.rows.length,4);assert.equal(h.calls.length,0);
});
test('missing prices remain saveable; failed save keeps inputs and reuses its token',async()=>{
 const h=desktop();h.edit('a 未稅單價','');h.fail('a');h.save();await h.settle();
 assert.equal(h.field('a 未稅單價').props.value,'');const request=h.calls[0].request;
 h.fail('');h.save();await h.settle();assert.equal(h.calls[1].request,request);assert.equal(h.calls[1].data.lines[0].unit_price,null);
 assert.equal(h.calls.filter(c=>c.handoff).length,0);
});
test('deletion stays inside more and affects whole selected receipts only',async()=>{
 const h=desktop();const removed=[];h.props.onFlag=async(id,state)=>{removed.push({id,state});return false;};selectAll(h);await h.button('移除（2張）').props.onClick();await h.settle();assert.deepEqual(removed,[{id:'a',state:'REMOVED'}]);
});
test('removed receipts can be restored without financial writes',async()=>{
 const h=desktop([{...row('a'),record_state:'REMOVED'}]);const restored=[];h.props.onFlag=async(id,state)=>{restored.push({id,state});return true;};selectAll(h);await h.button('還原（1張）').props.onClick();await h.settle();assert.deepEqual(restored,[{id:'a',state:'LIVE'}]);assert.equal(h.calls.length,0);
});

test('saved but unreviewed receipts are not offered for handoff',()=>{
 const h=desktop([{...row('a'),review_completed:false},{...row('b'),review_completed:true}]);
 assert.equal(h.button('送對帳單（1張）'),undefined);assert.ok(h.button('查看／修改'));assert.equal(h.calls.length,0);
});
