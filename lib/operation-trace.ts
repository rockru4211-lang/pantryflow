import { releaseInfo } from './release';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const writes = /^(start_|save_|complete_|close_|resolve_|create_|assign_|fill_|import_|begin_|correct_|map_|publish_|register_|update_|delete_|remove_|record_|confirm_|enqueue_).*|^app_operation$|^owner_setup$/;
export const safeErrorCode = (value: unknown) => {
  const code = value && typeof value === 'object' && 'code' in value ? String(value.code) : '';
  return /^(?:[0-9A-Z]{5}|PGRST[0-9]{3}|[A-Z][A-Z0-9_]{2,63})$/.test(code) ? code : 'REQUEST_FAILED';
};
export type Attempt = { id: string; storeId?: string; resourceId?: string; operation: string; operationId?: string; fingerprint?: string };
export type AttemptStats = Record<string, number | string | Record<string, number>>;
let traceTransport: ((attempt: Attempt, phase: string, stats?: AttemptStats) => Promise<void>) | undefined;
export function newAttempt(operation: string, storeId?: string): Attempt { return {id:crypto.randomUUID(), operation, storeId}; }
export async function reportAttempt(attempt: Attempt, phase: string, stats?: AttemptStats) {
  try { await traceTransport?.(attempt, phase, stats); } catch { /* A tracing outage must not discard saved work. */ }
}

/** Metadata only: request/response bodies, names, quantities and credentials never enter the log. */
export function observedFetch(base: typeof fetch, endpoint: string, key: string): typeof fetch {
  async function send(attempt: Attempt, phase: string, stats: AttemptStats = {}, authorization?: string) {
    if (!authorization) return;
    await base(`${endpoint}/rest/v1/rpc/record_app_attempt`, {
      method:'POST', headers:{apikey:key,Authorization:authorization,'Content-Type':'application/json'},
      body:JSON.stringify({p_attempt_id:attempt.id,p_phase:phase,p_context:{operation:attempt.operation,
        store_id:attempt.storeId,resource_id:attempt.resourceId,operation_id:attempt.operationId,
        fingerprint:attempt.fingerprint,app_version:releaseInfo.commitSha,...stats}}),
      signal:AbortSignal.timeout(4000),
    });
  }
  // The active token remains only in memory and is updated only for this Supabase origin.
  let authorization: string | undefined;
  traceTransport = (attempt,phase,stats) => send(attempt,phase,stats,authorization);
  return async (input, init) => {
    const url = typeof input==='string'?input:input instanceof URL?input.href:input.url;
    if (!url.startsWith(`${endpoint}/`)) return base(input,init);
    const headers = new Headers(init?.headers ?? (input instanceof Request?input.headers:undefined));
    const auth = headers.get('Authorization');
    if(auth)authorization=auth;
    const path=new URL(url).pathname;
    const operation = path.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/)?.[1] || (path==='/functions/v1/enqueue-receipt-ocr'?'enqueue_receipt_ocr':undefined);
    if(!operation || operation==='record_app_attempt') return base(input,init);
    headers.set('x-pf-version',releaseInfo.commitSha);
    let args: Record<string,unknown> = {};
    try { if(typeof init?.body==='string')args=JSON.parse(init.body); } catch { /* unrecognized body: no payload logging */ }
    const imported = operation==='import_pilot_inventory' ? (args.p_rows as {file?:{attempt_id?:string}})?.file?.attempt_id : undefined;
    const attempt = newAttempt(operation,typeof args.p_store_id==='string'?args.p_store_id:undefined);
    if(imported&&uuid.test(imported))attempt.id=imported;
    attempt.resourceId=[args.p_session_id,args.p_batch_id,args.batchId,args.p_field_id,args.p_zone_id,args.p_discrepancy_id].find(x=>typeof x==='string'&&uuid.test(x)) as string|undefined;
    attempt.operationId=typeof args.p_request_id==='string'&&uuid.test(args.p_request_id)?args.p_request_id:undefined;
    headers.set('x-pf-attempt-id',attempt.id);
    const writing=writes.test(operation)&&operation!=='owner_setup'||operation==='owner_setup'&&args.p_action!==undefined&&args.p_action!=='read';
    if(writing&&!imported)await send(attempt,'START',{},auth||undefined).catch(()=>{});
    const started=performance.now();
    try {
      const result=await base(input,{...init,headers});
      if(!imported&&(writing||!result.ok)) {
        const body=!result.ok?await result.clone().json().catch(()=>({})):{};
        if(!writing)await send(attempt,'START',{},auth||undefined).catch(()=>{});
        await send(attempt,result.ok?'SUCCEEDED':'FAILED',{duration_ms:Math.round(performance.now()-started),http_status:result.status,
          ...(result.ok?{}:{error_code:safeErrorCode(body),stage:'request'})},auth||undefined).catch(()=>{});
      }
      return result;
    } catch(error) {
      if(!imported) {
        if(!writing)await send(attempt,'START',{},auth||undefined).catch(()=>{});
        await send(attempt,'FAILED',{error_code:error instanceof Error&&error.name==='AbortError'?'REQUEST_TIMEOUT':'NETWORK_ERROR',stage:'request',duration_ms:Math.round(performance.now()-started)},auth||undefined).catch(()=>{});
      }
      throw error;
    }
  };
}
