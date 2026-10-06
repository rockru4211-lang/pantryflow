import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,row} from './helpers/receipt-bulk-harness.mjs';
test('explicit save accepts missing unit, tax and adjustment explanation',async()=>{
 const h=harness(['a','b'].map(id=>({...row(id),adjustment:-10})));h.button('編輯明細').props.onClick();h.edit('a 數量','3');h.edit('b 單位','');h.save();await h.settle();assert.equal(h.calls.length,2);assert(h.calls.every(c=>c.data.adjustment===-10&&c.data.adjustment_note===''&&c.data.tax===null&&c.data.checked===false));assert.match(h.text(),/已儲存/);
});
test('invalid amount does not prevent saving another invoice and input survives',async()=>{
 const h=harness();h.button('編輯明細').props.onClick();h.edit('a 未稅單價','abc');h.edit('b 數量','3');h.save();await h.settle();assert.deepEqual(h.calls.map(c=>c.id),['b']);assert.equal(h.field('a 未稅單價').props.value,'abc');assert.match(h.text(),/1 張未儲存/);assert.equal(await h.props.leave(),true);
});
