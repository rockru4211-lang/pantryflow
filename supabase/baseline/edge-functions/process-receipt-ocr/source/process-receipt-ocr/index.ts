import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  classifyField,
  receiptJsonSchema,
  validateLine,
} from "../_shared/receipt-schema.ts";
import type { ReceiptExtraction } from "../_shared/receipt-schema.ts";
import {
  assertCriticalWrite,
  CriticalWriteError,
  fetchGeminiWith503Retry,
  geminiErrorMessage,
  normalizeExtraction,
  rawResponseSnapshot,
  readGeminiBlockReason,
  readGeminiOutput,
  traceableError,
} from "../_shared/ocr-runtime.ts";
import type { GeminiAttempt } from "../_shared/ocr-runtime.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ||
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const serverKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SUPABASE_SECRET_KEY") || "";
const geminiKey = Deno.env.get("GEMINI_API_KEY") || "";
const model = Deno.env.get("GEMINI_VISION_MODEL") || "gemini-3.6-flash";
const promptVersion = Deno.env.get("OCR_PROMPT_VERSION") || "receipt-gemini-v1";
const bucket = Deno.env.get("RECEIPT_BUCKET") || "receipt-documents";
const documentFieldNames = [
  "supplier_name",
  "document_number",
  "receipt_date",
  "subtotal_ex_tax",
  "tax",
  "total_inc_tax",
] as const;
const lineFieldNames = [
  "product",
  "specification",
  "unit",
  "quantity",
  "unit_price_ex_tax",
  "subtotal_ex_tax",
] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
  }
  if (!supabaseUrl || !publishableKey || !serverKey || !geminiKey) {
    return jsonResponse({ error: "SERVER_CONFIGURATION_MISSING" }, 500);
  }

  const authorization = req.headers.get("Authorization") || "";
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const batchIdFromBody = String(body.batchId || "");
  const jobId = String(body.jobId || "");
  const leaseToken = String(body.leaseToken || "");
  const requestedBy = String(body.requestedBy || "");
  const isQueueWorker = authorization === `Bearer ${serverKey}` &&
    /^[0-9a-f-]{36}$/i.test(jobId) &&
    /^[0-9a-f-]{36}$/i.test(leaseToken) &&
    /^[0-9a-f-]{36}$/i.test(requestedBy);
  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, serverKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = isQueueWorker
    ? { data: { user: { id: requestedBy } }, error: null }
    : await userClient.auth.getUser();
  if (userError || !userData.user) return jsonResponse({ error: "UNAUTHORIZED" }, 401);
  if (!isQueueWorker) return jsonResponse({ error: "QUEUE_REQUIRED" }, 403);

  let batchId = "";
  let runId = "";
  let rawResponse: Record<string, unknown> = {};
  const geminiAttempts: GeminiAttempt[] = [];
  let rawOutputText = "";
  const traceId = crypto.randomUUID();
  try {
    batchId = batchIdFromBody;
    if (!/^[0-9a-f-]{36}$/i.test(batchId)) {
      return jsonResponse({ error: "INVALID_BATCH_ID" }, 400);
    }

    const profileClient = isQueueWorker ? admin : userClient;
    const { data: profile, error: profileError } = await profileClient
      .from("profiles").select("id,organization_id,role").eq(
        "id",
        userData.user.id,
      ).single();
    if (profileError || !profile) {
      return jsonResponse({ error: "PROFILE_NOT_FOUND" }, 403);
    }

    const { data: batch, error: batchError } = await profileClient
      .from("receipt_upload_batches")
      .select(
        "id,organization_id,uploaded_by,status,receipt_documents(id,storage_path,mime_type,page_order)",
      )
      .eq("id", batchId).single();
    if (
      batchError || !batch || batch.organization_id !== profile.organization_id
    ) {
      return jsonResponse({ error: "BATCH_NOT_FOUND" }, 404);
    }
    if (profile.role !== "ADMIN" && batch.uploaded_by !== userData.user.id) {
      return jsonResponse({ error: "FORBIDDEN" }, 403);
    }
    if (!batch.receipt_documents?.length) {
      return jsonResponse({ error: "NO_DOCUMENTS" }, 400);
    }

    const createRunResult = await admin.rpc("create_receipt_ocr_run", {
      p_organization_id: profile.organization_id,
      p_batch_id: batchId,
      p_provider: "google-gemini",
      p_model: model,
      p_prompt_version: promptVersion,
      p_started_by: userData.user.id,
    });
    assertCriticalWrite(
      createRunResult,
      "receipt_ocr_runs.create_versioned_run",
    );
    const run = Array.isArray(createRunResult.data)
      ? createRunResult.data[0]
      : createRunResult.data;
    if (!run?.id || !Number.isInteger(run.version)) {
      throw new Error("OCR_RUN_ALLOCATION_RETURNED_INVALID_DATA");
    }
    const version = run.version;
    runId = run.id;

    const parts: Array<Record<string, unknown>> = [{
      text: [
        "你是台灣餐飲進貨單辨識器。逐字保留原文，不得猜測看不清楚的字。",
        "辨識供應商、單號、日期、未稅小計、稅額、含稅總額與每筆商品。",
        "raw 是原圖逐字抄錄；value 才是標準化值。看不清楚時 value 使用 null 或空字串，legibility=UNREADABLE。",
        "region 使用整張圖片 0..1 正規化座標。不要因為常見商品名稱而替換原圖文字。",
        "只輸出符合下列 JSON Schema 的 JSON，不要輸出 Markdown 或說明文字：",
        JSON.stringify(receiptJsonSchema),
      ].join("\n"),
    }];

    const documents = [...batch.receipt_documents].sort((a, b) =>
      a.page_order - b.page_order
    );
    for (const document of documents) {
      const { data: blob, error: downloadError } = await admin.storage.from(
        bucket,
      ).download(document.storage_path);
      if (downloadError) throw downloadError;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(
          ...bytes.subarray(offset, offset + 0x8000),
        );
      }
      parts.push({ text: `以下是第 ${document.page_order} 頁：` });
      parts.push({
        inlineData: { mimeType: document.mime_type, data: btoa(binary) },
      });
    }

    const geminiRequest = {
      method: "POST",
      headers: {
        "x-goog-api-key": geminiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      }),
    };
    const geminiResult = await fetchGeminiWith503Retry(
      fetch,
      `https://generativelanguage.googleapis.com/v1beta/models/${
        encodeURIComponent(model)
      }:generateContent`,
      geminiRequest,
      {
        onAttempt: async (attempts, response) => {
          geminiAttempts.splice(0, geminiAttempts.length, ...attempts);
          rawResponse = response;
          const persistAttemptResult = await admin.from("receipt_ocr_runs")
            .update({
              raw_response: rawResponseSnapshot(
                rawResponse,
                geminiAttempts,
                rawOutputText,
              ),
            }).eq("id", run.id).select("id").single();
          assertCriticalWrite(
            persistAttemptResult,
            "receipt_ocr_runs.persist_gemini_attempt",
          );
        },
      },
    );
    const geminiResponse = geminiResult.response;
    rawResponse = geminiResult.body;
    if (!geminiResponse.ok) {
      throw new Error(
        `GEMINI_${geminiResponse.status}: ${geminiErrorMessage(rawResponse)}`,
      );
    }
    rawOutputText = readGeminiOutput(rawResponse);
    if (!rawOutputText) {
      const blockReason = readGeminiBlockReason(rawResponse);
      throw new Error(
        `GEMINI_EMPTY_STRUCTURED_OUTPUT${
          blockReason ? `: ${blockReason}` : ""
        }`,
      );
    }

    const parsed = JSON.parse(stripJsonFence(rawOutputText)) as
      | Partial<ReceiptExtraction>
      | null;
    const { document: extractedDocument, lines: extractedLines, warnings } =
      normalizeExtraction(parsed);

    const fields: Record<string, unknown>[] = [];
    for (const fieldName of documentFieldNames) {
      const candidate = extractedDocument[fieldName];
      const field = isOcrField(candidate) ? candidate : unreadableField();
      if (!isOcrField(candidate)) {
        warnings.push(`document.${fieldName} 缺少或格式無效`);
      }
      fields.push(
        toField(
          profile.organization_id,
          batchId,
          run.id,
          null,
          "document",
          fieldName,
          field,
          classifyField(field),
        ),
      );
    }
    for (const [lineIndex, extractedLine] of extractedLines.entries()) {
      const line = extractedLine && typeof extractedLine === "object"
        ? extractedLine as Record<string, unknown>
        : {};
      const rowKey = typeof line.row_key === "string" && line.row_key.trim()
        ? line.row_key
        : `line-${lineIndex + 1}`;
      const normalizedLine: Record<
        string,
        Parameters<typeof classifyField>[0] | string
      > = { row_key: rowKey };
      for (const fieldName of lineFieldNames) {
        normalizedLine[fieldName] = isOcrField(line[fieldName])
          ? line[fieldName]
          : unreadableField();
        if (!isOcrField(line[fieldName])) {
          warnings.push(`${rowKey}.${fieldName} 缺少或格式無效`);
        }
      }
      const validations = validateLine(normalizedLine);
      for (const fieldName of lineFieldNames) {
        const field = normalizedLine[fieldName] as Parameters<
          typeof classifyField
        >[0];
        const result = classifyField(field, validations[fieldName] || []);
        const page = Number(
          (field.region as { page?: number } | null)?.page || 1,
        );
        const document = documents.find((item) => item.page_order === page) ||
          documents[0];
        fields.push(
          toField(
            profile.organization_id,
            batchId,
            run.id,
            document.id,
            rowKey,
            fieldName,
            field,
            result,
          ),
        );
      }
    }

    const { error: fieldError } = await admin.from("receipt_ocr_fields").insert(
      fields,
    );
    if (fieldError) throw fieldError;
    const uniqueWarnings = [...new Set(warnings)];
    const completeRunResult = await admin.from("receipt_ocr_runs").update({
      status: "SUCCEEDED",
      raw_response: rawResponseSnapshot(
        rawResponse,
        geminiAttempts,
        rawOutputText,
      ),
      error_code: uniqueWarnings.length ? "OCR_INCOMPLETE_OUTPUT" : null,
      error_message: uniqueWarnings.length ? uniqueWarnings.join("; ") : null,
      completed_at: new Date().toISOString(),
    }).eq("id", run.id).select("id").single();
    assertCriticalWrite(completeRunResult, "receipt_ocr_runs.mark_succeeded");
    const readyBatchResult = await admin.from("receipt_upload_batches").update({
      status: "READY_FOR_REVIEW",
    }).eq("id", batchId).select("id").single();
    assertCriticalWrite(
      readyBatchResult,
      "receipt_upload_batches.mark_ready_for_review",
    );
    if (isQueueWorker) {
      const completeJobResult = await admin.rpc("complete_receipt_ocr_job", {
        p_job_id: jobId,
        p_lease_token: leaseToken,
        p_ocr_run_id: run.id,
      });
      assertCriticalWrite(completeJobResult, "receipt_ocr_jobs.mark_succeeded");
    }

    const summary = fields.reduce((acc: Record<string, number>, field) => {
      const key = String(field.review_status);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return jsonResponse({
      runId: run.id,
      version,
      model,
      fieldCount: fields.length,
      summary,
      requiresManualReview: uniqueWarnings.length > 0,
      warnings: uniqueWarnings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const recoveryErrors: unknown[] = [];
    if (runId) {
      const failRunResult = await admin.from("receipt_ocr_runs").update({
        status: "FAILED",
        raw_response: rawResponseSnapshot(
          rawResponse,
          geminiAttempts,
          rawOutputText,
        ),
        error_code: "OCR_PROCESSING_FAILED",
        error_message: message,
        completed_at: new Date().toISOString(),
      }).eq("id", runId).select("id").single();
      if (failRunResult.error) {
        recoveryErrors.push(
          traceableError(
            new CriticalWriteError(
              "receipt_ocr_runs.mark_failed",
              failRunResult.error,
            ),
          ),
        );
      }
    }
    if (batchId) {
      const recoverBatchResult = await admin.from("receipt_upload_batches")
        .update({
          status: "READY_FOR_REVIEW",
        }).eq("id", batchId).select("id").single();
      if (recoverBatchResult.error) {
        recoveryErrors.push(
          traceableError(
            new CriticalWriteError(
              "receipt_upload_batches.recover_ready_for_review",
              recoverBatchResult.error,
            ),
          ),
        );
      }
    }
    if (isQueueWorker) {
      const failJobResult = await admin.rpc("fail_receipt_ocr_job", {
        p_job_id: jobId,
        p_lease_token: leaseToken,
        p_error: message,
      });
      if (failJobResult.error) recoveryErrors.push(traceableError(failJobResult.error));
      if (failJobResult.data?.status === "QUEUED") {
        const retryBatchResult = await admin.from("receipt_upload_batches")
          .update({ status: "PROCESSING" }).eq("id", batchId).select("id").single();
        if (retryBatchResult.error) recoveryErrors.push(traceableError(retryBatchResult.error));
      }
    }
    console.error(JSON.stringify({
      event: "receipt_ocr_processing_failed",
      traceId,
      batchId: batchId || null,
      runId: runId || null,
      error: traceableError(error),
      recoveryErrors,
    }));
    return jsonResponse(
      { error: "OCR_PROCESSING_FAILED", message, traceId },
      500,
    );
  }
});

function stripJsonFence(value: string) {
  return value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function unreadableField(): Parameters<typeof classifyField>[0] {
  return {
    raw: null,
    value: null,
    confidence: 0,
    legibility: "UNREADABLE",
    region: null,
  };
}

function isOcrField(
  value: unknown,
): value is Parameters<typeof classifyField>[0] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const field = value as Record<string, unknown>;
  return "raw" in field && "value" in field &&
    typeof field.confidence === "number" &&
    ["CLEAR", "AMBIGUOUS", "UNREADABLE"].includes(String(field.legibility)) &&
    "region" in field;
}

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

