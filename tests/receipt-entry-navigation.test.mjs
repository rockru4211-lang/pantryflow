import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptEntryDestination,receiptEntryPage} from '../lib/receipt-entry-navigation.ts';
const row={lines:[{product_name:'麵粉',unit_price:null}],edit_revision:0};
test('OCR output alone opens entry; saved partial prices open editable items',()=>{
 assert.equal(receiptEntryDestination(row),'entry');
 assert.equal(receiptEntryDestination({...row,edit_revision:1}),'items');
 for(const marker of [{entry_completed:true},{reviewed:true},{finance_sent_at:'2026-10-15'},{received_at:'2026-10-01'},{receipt_status:'COMPLETED'}])assert.equal(receiptEntryDestination({...row,...marker}),'items');
 assert.equal(receiptEntryDestination({...row,lines:[],edit_revision:1}),'entry');
});
test('old office receipt links use the list host while field and chain routes remain intact',()=>{
 for(const page of ['status','review','published']){assert.equal(receiptEntryPage(page,true),'list');assert.equal(receiptEntryPage(page,false),page);}
 for(const page of ['upload','inbox','issue','company-tasks'])assert.equal(receiptEntryPage(page,true),page);
});
