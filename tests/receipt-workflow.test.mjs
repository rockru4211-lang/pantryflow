import {test} from 'node:test';
import assert from 'node:assert/strict';
import {displayReceiptValue,receiptRows,receiptValue,receiptFingerprint,receiptGroups} from '../lib/receipt-workflow.ts';
import {classifyField,validateLine} from '../supabase/functions/_shared/receipt-schema.ts';
const field=value=>({value,raw:value==null?null:String(value),confidence:0.99,legibility:'CLEAR',region:null});
test('receipt quantities preserve blank versus explicit zero and fractional original units',()=>{
 assert.equal(displayReceiptValue(null),'未提供');assert.equal(displayReceiptValue(0),'0');assert.equal(displayReceiptValue(1.25),'1.25');
 const fields=[{row_key:'line-0001',field_name:'quantity',value:1.25},{row_key:'line-0001',field_name:'unit',value:'BT'}];
 assert.equal(receiptValue(fields,'line-0001','quantity'),1.25);assert.equal(receiptValue(fields,'line-0001','unit'),'BT');
 assert.equal(receiptValue(fields,'line-0001','unit_price_ex_tax'),null);
});
test('receipt manifest retries are stable while page sequence is preserved',async()=>{
 const a='a'.repeat(64),b='b'.repeat(64);const first=await receiptFingerprint('SAME_RECEIPT',[a,b]);
 assert.equal(first,await receiptFingerprint('SAME_RECEIPT',[a,b]));assert.notEqual(first,await receiptFingerprint('SAME_RECEIPT',[b,a]));
 assert.deepEqual(receiptGroups([a,b],true),[[a,b]]);assert.deepEqual(receiptGroups([a,b],false),[[a],[b]]);
});
test('OCR line ordering is deterministic and never includes document headers',()=>{
 assert.deepEqual(receiptRows([{row_key:'line-0010'},{row_key:'document'},{row_key:'line-0002'},{row_key:'line-0001'},{row_key:'line-0001'}]),['line-0001','line-0002','line-0010']);
});
test('missing prices are not coerced to zero and conflicting totals need review',()=>{
 assert.deepEqual(validateLine({quantity:field(2),unit_price_ex_tax:field(null),subtotal_ex_tax:field(1372)}),{});
 const conflicts=validateLine({quantity:field(2),unit_price_ex_tax:field(720),subtotal_ex_tax:field(1372)});assert.equal(conflicts.quantity.length,1);
 assert.equal(classifyField(field(null)).status,'UNREADABLE');assert.equal(classifyField({...field('商品'),confidence:0.5}).status,'REVIEW');
});
