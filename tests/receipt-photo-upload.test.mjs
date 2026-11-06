import assert from 'node:assert/strict';
import {test} from 'node:test';
import {uploadReceiptPhotoGroup} from '../lib/receipt-photo-upload.ts';

const hash = 'a'.repeat(64);
const photos = [{file: new File(['photo'], 'receipt.jpg', {type: 'image/jpeg'}), hash}];
const manifest = stored => ({batch_id: 'batch', documents: [{sha256: hash, storage_path: 'receipt.jpg', stored}]});

function mockUpload(responses, storageError = null) {
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push([name, args.p_store_id]);
      return {data: responses.shift(), error: null};
    },
    storage: {from: bucket => ({upload: async path => {
      calls.push([bucket, path]);
      return {error: storageError};
    }})},
    functions: {invoke: async (name, {body}) => {
      calls.push([name, body.batchId]);
      return {data: {results: [{queued: true}]}, error: null};
    }},
  };
  return {client, calls};
}

test('a confirmed duplicate skips storage and OCR and returns only a server-authorized original', async () => {
  for (const originalId of ['original', undefined]) {
    const {client, calls} = mockUpload([{duplicate: true, batch_id: originalId}]);
    assert.deepEqual(await uploadReceiptPhotoGroup(client, 'store', photos, false, true), {duplicate: true, batchId: originalId ?? null});
    assert.deepEqual(calls, [['begin_baihuayuan_receipt_upload', 'store']]);
  }
});

test('a concurrent upload completed during the storage retry stops before OCR', async () => {
  const {client, calls} = mockUpload([manifest(false), {duplicate: true, batch_id: 'batch'}], Error('file already exists'));
  assert.deepEqual(await uploadReceiptPhotoGroup(client, 'store', photos, false, true), {duplicate: true, batchId: 'batch'});
  assert.deepEqual(calls, [['begin_baihuayuan_receipt_upload', 'store'], ['receipt-documents', 'receipt.jpg'], ['begin_baihuayuan_receipt_upload', 'store']]);
});

test('a saved file with OCR still pending resumes the original upload', async () => {
  const {client, calls} = mockUpload([manifest(false), manifest(true)], Error('upload response lost'));
  assert.deepEqual(await uploadReceiptPhotoGroup(client, 'store', photos, false, true), {duplicate: false, batchId: 'batch'});
  assert.deepEqual(calls, [['begin_baihuayuan_receipt_upload', 'store'], ['receipt-documents', 'receipt.jpg'], ['begin_baihuayuan_receipt_upload', 'store'], ['enqueue-receipt-ocr', 'batch']]);
});
