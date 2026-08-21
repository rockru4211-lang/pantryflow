import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { classifyField, receiptJsonSchema, validateLine } from "../_shared/receipt-schema.ts";
import type { ReceiptExtraction } from "../_shared/receipt-schema.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const serverKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const openAiKey = Deno.env.get("OPENAI_API_KEY") || "";
const model = Deno.env.get("OPENAI_VISION_MODEL") || "gpt-5.6-terra";
const promptVersion = Deno.env.get("OCR_PROMPT_VERSION") || "receipt-v1";
const bucket = Deno.env.get("RECEIPT_BUCKET") || "receipt-documents";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!supabaseUrl || !publishableKey || !serverKey || !openAiKey) {
    return jsonResponse({ error: "SERVER_CONFIGURATION_MISSING" }, 500);
  }

  const authorization = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, serverKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return jsonResponse({ error: "UNAUTHORIZED" }, 401);

  let batchId = "";
  let runId = "";
  try {
    const body = await req.json();
    batchId = String(body.batchId || "");
    if (!/^[0-9a-f-]{36}$/i.test(batchId)) return jsonResponse({ error: "INVALID_BATCH_ID" }, 400);

    const { data: profile, error: profileError } = await userClient
      .from("profiles").select("id,organization_id,role").eq("id", userData.user.id).single();
    if (profileError || !profile) return jsonResponse({ error: "PROFILE_NOT_FOUND" }, 403);

    const { data: batch, error: batchError } = await userClient
      .from("receipt_upload_batches")
      .select("id,organization_id,uploaded_by,status,receipt_documents(id,storage_path,mime_type,page_order)")
      .eq("id", batchId).single();
    if (batchError || !batch || batch.organization_id !== profile.organization_id) {
      return jsonResponse({ error: "BATCH_NOT_FOUND" }, 404);
    }
    if (profile.role !== "ADMIN" && batch.uploaded_by !== userData.user.id) {
      return jsonResponse({ error: "FORBIDDEN" }, 403);
    }
    if (!batch.receipt_documents?.length) return jsonResponse({ error: "NO_DOCUMENTS" }, 400);

    const { data: lastRun } = await admin.from("receipt_ocr_runs")
      .select("version").eq("batch_id", batchId).order("version", { ascending: false }).limit(1).maybeSingle();
    const version = Number(lastRun?.version || 0) + 1;
    const { data: run, error: runError } = await admin.from("receipt_ocr_runs").insert({
      organization_id: profile.organization_id,
      batch_id: batchId,
      version,
      provider: "openai",
      model,
      prompt_version: promptVersion,
      status: "PROCESSING",
      started_by: userData.user.id,
    }).select("id").single();
    if (runError) throw runError;
    runId = run.id;

    await admin.from("receipt_upload_batches").update({ status: "PROCESSING" }).eq("id", batchId);

    const content: Array<Record<string, unknown>> = [{
      type: "input_text",
      text: [
        "你是台灣餐飲進貨單辨識器。逐字保留原文，不得猜測看不清楚的字。",
        "辨識供應商、單號、日期、未稅小計、稅額、含稅總額與每筆商品。",
        "raw 是原圖逐字抄錄；value 才是標準化值。看不清楚時 value 使用 null 或空字串，legibility=UNREADABLE。",
        "region 使用整張圖片 0..1 正規化座標。不要因為常見商品名稱而替換原圖文字。",
      ].join("\n"),
    }];

    const documents = [...batch.receipt_documents].sort((a, b) => a.page_order - b.page_order);
    for (const document of documents) {
      const { data: blob, error: downloadError } = await admin.storage.from(bucket).download(document.storage_path);
      if (downloadError) throw downloadError;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      content.push({ type: "input_text", text: `以下是第 ${document.page_order} 頁：` });
      content.push({ type: "input_image", image_url: `data:${document.mime_type};base64,${btoa(binary)}`, detail: "high" });
    }

    const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        store: false,
        input: [{ role: "user", content }],
        text: { format: { type: "json_schema", name: "receipt_extraction", strict: true, schema: receiptJsonSchema } },
      }),
    });
    const rawResponse = await openAiResponse.json();
    if (!openAiResponse.ok) throw new Error(`OPENAI_${openAiResponse.status}: ${rawResponse?.error?.message || "request failed"}`);
    const outputText = rawResponse.output?.flatMap((item: { content?: unknown[] }) => item.content || [])
      .find((item: { type?: string }) => item.type === "output_text")?.text;
    if (!outputText) throw new Error("OPENAI_EMPTY_STRUCTURED_OUTPUT");
    const extraction = JSON.parse(outputText) as ReceiptExtraction;

    const fields: Record<string, unknown>[] = [];
    for (const [fieldName, field] of Object.entries(extraction.document)) {
      const result = classifyField(field);
      fields.push(toField(profile.organization_id, batchId, run.id, null, "document", fieldName, field, result));
    }
    for (const line of extraction.lines) {
      const validations = validateLine(line);
      for (const fieldName of ["product", "specification", "unit", "quantity", "unit_price_ex_tax", "subtotal_ex_tax"]) {
        const field = line[fieldName] as Parameters<typeof classifyField>[0];
        const result = classifyField(field, validations[fieldName] || []);
        const page = Number((field.region as { page?: number } | null)?.page || 1);
        const document = documents.find((item) => item.page_order === page) || documents[0];
        fields.push(toField(profile.organization_id, batchId, run.id, document.id, line.row_key, fieldName, field, result));
      }
    }

    const { error: fieldError } = await admin.from("receipt_ocr_fields").insert(fields);
    if (fieldError) throw fieldError;
    await admin.from("receipt_ocr_runs").update({
      status: "SUCCEEDED", raw_response: rawResponse, completed_at: new Date().toISOString(),
    }).eq("id", run.id);
    await admin.from("receipt_upload_batches").update({ status: "READY_FOR_REVIEW" }).eq("id", batchId);

    const summary = fields.reduce((acc: Record<string, number>, field) => {
      const key = String(field.review_status);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return jsonResponse({ runId: run.id, version, model, fieldCount: fields.length, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (runId) {
      await admin.from("receipt_ocr_runs").update({
        status: "FAILED", error_code: "OCR_PROCESSING_FAILED", error_message: message, completed_at: new Date().toISOString(),
      }).eq("id", runId);
    }
    if (batchId) await admin.from("receipt_upload_batches").update({ status: "READY_FOR_REVIEW" }).eq("id", batchId);
    return jsonResponse({ error: "OCR_PROCESSING_FAILED", message }, 500);
  }
});

function toField(
  organizationId: string,
  batchId: string,
  runId: string,
  documentId: string | null,
  rowKey: string,
  fieldName: string,
  field: { raw: unknown; value: unknown; confidence: number; region: unknown },
  result: { status: string; notes: string[] },
) {
  return {
    organization_id: organizationId,
    batch_id: batchId,
    document_id: documentId,
    ocr_run_id: runId,
    row_key: rowKey,
    field_name: fieldName,
    raw_value: field.raw,
    normalized_value: field.value,
    confidence: Math.max(0, Math.min(1, Number(field.confidence || 0))),
    review_status: result.status,
    source_region: field.region,
    validation_notes: result.notes,
  };
}
