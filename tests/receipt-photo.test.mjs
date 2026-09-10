import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeReceiptPhoto} from '../lib/receipt-photo.ts';
import {receiptFingerprint} from '../lib/receipt-workflow.ts';
const heicBytes=new Uint8Array([0,0,0,24,...Buffer.from('ftypheic'),0,0,0,0,...Buffer.from('mif1heic')]);
test('HEIC MIME is detected without a filename or picker MIME; original bytes stay identical',async()=>{
 const original=new File([heicBytes],'receipt',{type:'',lastModified:123});
 const normalized=await normalizeReceiptPhoto(original);
 assert.equal(normalized.type,'image/heic');assert.equal(normalized.name,original.name);assert.equal(normalized.lastModified,123);
 assert.deepEqual(new Uint8Array(await normalized.arrayBuffer()),heicBytes);
 const a=Buffer.from(await crypto.subtle.digest('SHA-256',await original.arrayBuffer())).toString('hex');
 const b=Buffer.from(await crypto.subtle.digest('SHA-256',await normalized.arrayBuffer())).toString('hex');
 assert.equal(await receiptFingerprint('SAME_RECEIPT',[a]),await receiptFingerprint('SAME_RECEIPT',[b]));
});
test('a renamed non-image is not accepted as HEIC, and file limits remain enforced',async()=>{
 await assert.rejects(normalizeReceiptPhoto(new File(['not a photo'],'fake.HEIC',{type:'image/heic'})),/RECEIPT_FILE_FORMAT/);
 await assert.rejects(normalizeReceiptPhoto(new File([],'empty.jpg',{type:'image/jpeg'})),/RECEIPT_FILE_SIZE/);
 await assert.rejects(normalizeReceiptPhoto(new File([new Uint8Array(10485761)],'big.heic',{type:'image/heic'})),/RECEIPT_FILE_SIZE/);
});
test('existing PDF and JPEG originals pass through unchanged',async()=>{
 for(const type of ['image/jpeg','application/pdf']) {
  const file=new File(['fixture'],'receipt',{type});assert.equal(await normalizeReceiptPhoto(file),file);
 }
});
