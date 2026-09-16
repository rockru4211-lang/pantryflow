import { supabase } from '@/lib/supabase-browser';
import type { Values } from './admin-receipt-register';

/** Additive RPC contract until database.types.ts is regenerated after migration.
 * Uses the existing scoped/authenticated client (no second client or service key).
 * No receipt-confirmation, stock, user management or arbitrary RPC is exposed here.
 */
export type AdminRpcArgs = {
  get_admin_receipt_register: { p_store_id: string };
  get_admin_receipt_document: { p_batch_id: string };
  get_admin_receipt_history: { p_batch_id: string; p_before: number | null };
  set_admin_receipt_codes: { p_store_id: string; p_enabled: boolean };
  save_admin_receipt_row: {
    p_batch_id: string; p_run_id: string; p_row_key: string; p_revision: number;
    p_source_token: string; p_values: Values; p_reviewed: boolean; p_request_id: string;
  };
  save_admin_receipt_arrival: {
    p_batch_id: string; p_revision: number; p_arrived_on: string | null; p_request_id: string;
  };
};
type RpcResult = { data: unknown; error: {message: string; code?: string} | null };
export function adminRpc<N extends keyof AdminRpcArgs>(name: N, args: AdminRpcArgs[N]): PromiseLike<RpcResult> {
  // The new functions are not yet in the pre-migration generated Database type.
  // Keep the only cast at this boundary and strongly type every caller above.
  const call = supabase.rpc.bind(supabase) as unknown as
    <K extends keyof AdminRpcArgs>(name: K, args: AdminRpcArgs[K]) => PromiseLike<RpcResult>;
  return call(name, args);
}
