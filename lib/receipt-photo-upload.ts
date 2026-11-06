import type {supabase} from './supabase-browser';
import {receiptFingerprint} from './receipt-workflow.ts';

type Photo = {file: File; hash: string};
type UploadManifest =
  | {duplicate: true; batch_id?: string | null}
  | {duplicate?: false; batch_id: string; documents: {sha256: string; storage_path: string; stored: boolean}[]};

export type ReceiptPhotoUpload =
  | {duplicate: true; batchId: string | null}
  | {duplicate: false; batchId: string};

export async function uploadReceiptPhotoGroup(
  client: typeof supabase,
  storeId: string,
  photos: Photo[],
  sameReceipt: boolean,
  deduplicate: boolean,
): Promise<ReceiptPhotoUpload> {
  const mode = sameReceipt ? 'SAME_RECEIPT' : 'SEPARATE_RECEIPTS';
  const rpc = deduplicate ? 'begin_baihuayuan_receipt_upload' : 'begin_pilot_receipt_upload';
  const args = {
    p_store_id: storeId,
    p_group_mode: mode,
    p_fingerprint: await receiptFingerprint(mode, photos.map(photo => photo.hash)),
    p_documents: photos.map(({file, hash}) => ({sha256: hash, name: file.name, mime_type: file.type, byte_size: file.size})),
  };
  async function begin() {
    const {data, error} = await client.rpc(rpc, args);
    if (error) throw error;
    if (!data) throw new Error('ORIGINAL_UPLOAD_INCOMPLETE');
    return data as UploadManifest;
  }

  const manifest = await begin();
  if (manifest.duplicate) return {duplicate: true, batchId: manifest.batch_id || null};
  for (const doc of manifest.documents) {
    if (doc.stored) continue;
    const photo = photos.find(candidate => candidate.hash === doc.sha256);
    if (!photo) throw new Error('ORIGINAL_UPLOAD_INCOMPLETE');
    const {error} = await client.storage.from('receipt-documents').upload(doc.storage_path, photo.file, {
      contentType: photo.file.type,
      upsert: false,
    });
    if (error) {
      const retry = await begin().catch(() => {throw error;});
      if (retry.duplicate) return {duplicate: true, batchId: retry.batch_id || null};
      if (!retry.documents.some(d => d.sha256 === doc.sha256 && d.stored)) throw error;
    }
  }
  const queue = await client.functions.invoke('enqueue-receipt-ocr', {body: {batchId: manifest.batch_id}});
  if (queue.error || queue.data?.results?.some((result: {queued: boolean}) => !result.queued)) {
    throw new Error(queue.data?.results?.[0]?.error || 'QUEUE_FAILED');
  }
  return {duplicate: false, batchId: manifest.batch_id};
}
