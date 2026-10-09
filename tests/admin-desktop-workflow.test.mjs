import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,row} from './helpers/receipt-bulk-harness.mjs';
function desktop(rows){const h=harness(rows);h.props.desktopMode=true;h.render();return h;}
function selectAll(h){h.field('選取全部可編輯貨單').props.onChange({target:{checked:true}});h.render();}
test('desktop edit saves inline and cancellation restores the saved row',async()=>{
 const h=desktop();h.button('編輯全部').props.onClick();h.edit('a 數量','3');h.button('取消編輯').props.onClick();h.render();assert.equal(h.calls.length,0);h.button('編輯全部').props.onClick();assert.equal(h.field('a 數量').props.value,'2');h.edit('a 數量','4');await h.button('儲存變更').props.onClick();await h.settle();assert.equal(h.calls[0].data.lines[0].quantity,4);assert(h.button('編輯全部'));
});
test('finance handoff requires selection, preserves checked status, and stops on failure',async()=>{
 const h=desktop([{...row('a'),status:'CHECKED'},row('b')]);let navigated=0;h.props.onFinance=()=>navigated++;
 assert(h.button('加入對帳單（0張）').props.disabled);selectAll(h);h.fail('b');await h.button('加入對帳單（2張）').props.onClick();await h.settle();assert.equal(h.calls[0].data.reviewed,true);assert.equal(h.calls[0].data.checked,true);assert.equal(h.calls[1].data.checked,false);assert.equal(navigated,0);assert(h.button('加入對帳單（1張）'));h.fail('');await h.button('加入對帳單（1張）').props.onClick();await h.settle();assert.equal(navigated,1);assert.equal(h.calls.length,3);
});
test('deletion is scoped to whole selected receipts and cancelled operations keep selection',async()=>{
 const h=desktop();const removed=[];h.props.onFlag=async(id,state)=>{removed.push({id,state});return false;};selectAll(h);await h.button('刪除（2張）').props.onClick();await h.settle();assert.deepEqual(removed,[{id:'a',state:'REMOVED'}]);assert(h.button('刪除（2張）'));
});
test('removed receipts can be restored without a financial write',async()=>{
 const h=desktop([{...row('a'),record_state:'REMOVED'}]);const restored=[];h.props.onFlag=async(id,state)=>{restored.push({id,state});return true;};selectAll(h);await h.button('還原（1張）').props.onClick();await h.settle();assert.deepEqual(restored,[{id:'a',state:'LIVE'}]);assert.equal(h.calls.length,0);
});
