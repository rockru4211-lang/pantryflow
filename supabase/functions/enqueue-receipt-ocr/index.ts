import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const url = Deno.env.get("SUPABASE_URL") || "";
const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Custom authentication: normal requests validate the user's JWT through Auth;
// scheduled wake-ups validate a separate Vault secret through a service-only RPC.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")
    return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
  const scheduledSecret = req.headers.get("x-receipt-queue-secret");
  if (scheduledSecret) {
    const { data, error } = await admin.rpc("verify_receipt_queue_secret", {
      p_secret: scheduledSecret,
    });
    if (error || data !== true)
      return jsonResponse({ error: "UNAUTHORIZED" }, 401);
    EdgeRuntime.waitUntil(drainQueue());
    return jsonResponse({ accepted: true }, 202);
  }
  const user = createClient(url, anon, {
    global: {
      headers: { Authorization: req.headers.get("Authorization") || "",
        'x-pf-version':req.headers.get('x-pf-version')||'unversioned',
        'x-pf-attempt-id':req.headers.get('x-pf-attempt-id')||'' },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await user.auth.getUser();
  if (authError || !auth.user)
    return jsonResponse({ error: "UNAUTHORIZED" }, 401);
  const body = await req.json().catch(() => ({}));
  const ids: string[] = [
    ...new Set(
      (Array.isArray(body.batchIds) ? body.batchIds : [body.batchId]).map(
        String,
      ),
    ),
  ] as string[];
  if (
    !ids.length ||
    ids.length > 10 ||
    ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))
  )
    return jsonResponse({ error: "INVALID_BATCH_IDS" }, 400);
  const configured = await admin.rpc("configure_receipt_queue", {
    p_url: `${url}/functions/v1/enqueue-receipt-ocr`,
  });
  if (configured.error)
    return jsonResponse({ error: "QUEUE_CONFIGURATION_FAILED" }, 500);
  const results = [];
  for (const id of ids) {
    const { data, error } = await user.rpc("enqueue_receipt_ocr", {
      p_batch_id: id,
    });
    results.push({
      batchId: id,
      queued: !error,
      error: error?.message,
      status: data?.status,
    });
  }
  EdgeRuntime.waitUntil(drainQueue());
  return jsonResponse({ results }, results.some((r) => r.queued) ? 202 : 400);
});

async function drainQueue() {
  // One bounded wave per invocation; cron owns later retries and remaining jobs.
  const { data: jobs, error } = await admin.rpc("claim_receipt_ocr_jobs", {
    p_limit: 2,
  });
  if (error) {
    console.error("receipt_queue_claim_failed", error.code);
    return;
  }
  await Promise.allSettled(
    (jobs || []).map(async (job: Record<string, unknown>) => {
      try {
        const response = await fetch(
          `${url}/functions/v1/process-receipt-ocr`,
          {
            method: "POST",
            signal: AbortSignal.timeout(125000),
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              batchId: job.batch_id,
              jobId: job.id,
              leaseToken: job.lease_token,
              requestedBy: job.requested_by,
            }),
          },
        );
        if (!response.ok) throw new Error(`OCR_WORKER_${response.status}`);
      } catch (error) {
        // A processor which already failed the job owns its retry; lease validation
        // makes this recovery harmless when the result was committed successfully.
        const failed = await admin.rpc("fail_receipt_ocr_job", {
          p_job_id: job.id,
          p_lease_token: job.lease_token,
          p_error: error instanceof Error ? error.message : String(error),
        });
        if (failed.error && failed.error.message !== "OCR_JOB_LEASE_LOST")
          console.error("receipt_queue_recovery_failed", failed.error.code);
      }
    }),
  );
}
