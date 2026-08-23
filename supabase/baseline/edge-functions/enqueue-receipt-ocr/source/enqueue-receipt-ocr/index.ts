import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ||
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const serverKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SUPABASE_SECRET_KEY") || "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!supabaseUrl || !publishableKey || !serverKey) {
    return jsonResponse({ error: "SERVER_CONFIGURATION_MISSING" }, 500);
  }

  const authorization = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return jsonResponse({ error: "UNAUTHORIZED" }, 401);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const requestedIds = Array.isArray(body.batchIds) ? body.batchIds : [body.batchId];
  const batchIds = [...new Set(requestedIds.map(String))];
  if (!batchIds.length || batchIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
    return jsonResponse({ error: "INVALID_BATCH_IDS" }, 400);
  }

  const jobs = [];
  for (const batchId of batchIds) {
    const { data, error } = await userClient.rpc("enqueue_receipt_ocr", {
      p_batch_id: batchId,
    });
    if (error) return jsonResponse({ error: "ENQUEUE_FAILED", message: error.message }, 400);
    jobs.push(data);
  }

  EdgeRuntime.waitUntil(drainQueue());
  return jsonResponse({ queued: jobs.length, jobs }, 202);
});

async function drainQueue() {
  const admin = createClient(supabaseUrl, serverKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  for (let round = 0; round < 3; round += 1) {
    const { data: jobs, error } = await admin.rpc("claim_receipt_ocr_jobs", {
      p_limit: 2,
    });
    if (error) {
      console.error(JSON.stringify({ event: "receipt_ocr_queue_claim_failed", error }));
      return;
    }
    if (!jobs?.length) return;
    await Promise.allSettled(jobs.map((job: Record<string, unknown>) =>
      fetch(`${supabaseUrl}/functions/v1/process-receipt-ocr`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serverKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          batchId: job.batch_id,
          jobId: job.id,
          leaseToken: job.lease_token,
          requestedBy: job.requested_by,
        }),
      }).then(async (response) => {
        if (!response.ok) throw new Error(`OCR_WORKER_${response.status}: ${await response.text()}`);
      })
    ));
    if (round < 2) await new Promise((resolve) => setTimeout(resolve, 16000));
  }
}

