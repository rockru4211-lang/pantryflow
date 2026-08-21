import type { ReceiptExtraction } from "./receipt-schema.ts";

export type GeminiAttempt = {
  attempt: number;
  status: number;
  response: Record<string, unknown>;
};

export class CriticalWriteError extends Error {
  constructor(
    public readonly operation: string,
    public readonly databaseError: unknown,
  ) {
    super(`Critical Supabase write failed: ${operation}`);
    this.name = "CriticalWriteError";
  }
}

export function assertCriticalWrite(
  result: { error?: unknown },
  operation: string,
) {
  if (result.error) throw new CriticalWriteError(operation, result.error);
  return result;
}

export function traceableError(error: unknown) {
  if (error instanceof CriticalWriteError) {
    return {
      message: error.message,
      operation: error.operation,
      databaseError: serializeError(error.databaseError),
    };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

function serializeError(error: unknown) {
  if (!error || typeof error !== "object") return String(error);
  const value = error as Record<string, unknown>;
  return {
    code: value.code,
    message: value.message,
    details: value.details,
    hint: value.hint,
  };
}

type RetryOptions = {
  maxAttempts?: number;
  retryBaseMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  random?: () => number;
  onAttempt?: (
    attempts: GeminiAttempt[],
    response: Record<string, unknown>,
  ) => Promise<void>;
};

export async function fetchGeminiWith503Retry(
  fetcher: typeof fetch,
  url: string,
  request: RequestInit,
  options: RetryOptions = {},
) {
  const maxAttempts = options.maxAttempts ?? 4;
  const retryBaseMs = options.retryBaseMs ?? 1000;
  const sleep = options.sleep ??
    ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const random = options.random ?? Math.random;
  const attempts: GeminiAttempt[] = [];
  let response: Response | null = null;
  let body: Record<string, unknown> = {};

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    response = await fetcher(url, request);
    body = await readJsonResponse(response);
    attempts.push({ attempt, status: response.status, response: body });
    await options.onAttempt?.(attempts, body);
    if (response.status !== 503 || attempt === maxAttempts) break;
    await sleep(retryDelayMs(attempt, response, retryBaseMs, random));
  }

  if (!response) throw new Error("GEMINI_REQUEST_NOT_SENT");
  return { response, body, attempts };
}

export async function readJsonResponse(
  response: Response,
): Promise<Record<string, unknown>> {
  const body = await response.text();
  if (!body) return {};
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" ? parsed : { value: parsed };
  } catch {
    return { raw_text: body };
  }
}

export function retryDelayMs(
  attempt: number,
  response: Response,
  retryBaseMs = 1000,
  random: () => number = Math.random,
) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(30_000, seconds * 1000);
    }
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay) && dateDelay > 0) {
      return Math.min(30_000, dateDelay);
    }
  }
  const exponential = Math.min(8000, retryBaseMs * (2 ** (attempt - 1)));
  return exponential + Math.floor(random() * 250);
}

export function normalizeExtraction(parsed: Partial<ReceiptExtraction> | null) {
  const warnings: string[] = [];
  const document = parsed?.document && typeof parsed.document === "object" &&
      !Array.isArray(parsed.document)
    ? parsed.document
    : {};
  const lines = Array.isArray(parsed?.lines) ? parsed.lines : [];
  if (
    !parsed?.document || typeof parsed.document !== "object" ||
    Array.isArray(parsed.document)
  ) {
    warnings.push("Gemini 回應缺少 document，已建立人工確認欄位");
  }
  if (!Array.isArray(parsed?.lines)) {
    warnings.push("Gemini 回應缺少 lines，需人工確認品項");
  }
  return { document, lines, warnings };
}

export function rawResponseSnapshot(
  response: Record<string, unknown>,
  attempts: GeminiAttempt[],
  outputText: string,
) {
  return { response, attempts, output_text: outputText || null };
}

export function readGeminiOutput(response: Record<string, unknown>) {
  const candidates = Array.isArray(response.candidates)
    ? response.candidates
    : [];
  const candidate = candidates[0] as Record<string, unknown> | undefined;
  const content = candidate?.content as Record<string, unknown> | undefined;
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  return parts.map((part) =>
    typeof (part as Record<string, unknown>)?.text === "string"
      ? String((part as Record<string, unknown>).text)
      : ""
  ).join("").trim();
}

export function readGeminiBlockReason(response: Record<string, unknown>) {
  const feedback = response.promptFeedback as
    | Record<string, unknown>
    | undefined;
  const candidates = Array.isArray(response.candidates)
    ? response.candidates
    : [];
  const candidate = candidates[0] as Record<string, unknown> | undefined;
  return String(feedback?.blockReason || candidate?.finishReason || "");
}

export function geminiErrorMessage(response: Record<string, unknown>) {
  const error = response.error as Record<string, unknown> | undefined;
  return typeof error?.message === "string" ? error.message : "request failed";
}
