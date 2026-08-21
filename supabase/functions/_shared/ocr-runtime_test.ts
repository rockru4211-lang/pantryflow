import {
  assertCriticalWrite,
  CriticalWriteError,
  fetchGeminiWith503Retry,
  normalizeExtraction,
  rawResponseSnapshot,
  readGeminiOutput,
  traceableError,
} from "./ocr-runtime.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sequenceFetch(responses: Response[]) {
  return (() => {
    const response = responses.shift();
    if (!response) throw new Error("unexpected fetch");
    return Promise.resolve(response);
  }) as typeof fetch;
}

Deno.test("Gemini: consecutive 503 responses retry exponentially and then succeed", async () => {
  const delays: number[] = [];
  const persisted: number[] = [];
  const result = await fetchGeminiWith503Retry(
    sequenceFetch([
      jsonResponse(503, { error: { message: "busy-1" } }),
      jsonResponse(503, { error: { message: "busy-2" } }),
      jsonResponse(200, {
        candidates: [{
          content: { parts: [{ text: '{"document":{},"lines":[]}' }] },
        }],
      }),
    ]),
    "https://example.invalid",
    {},
    {
      sleep: (delay) => {
        delays.push(delay);
        return Promise.resolve();
      },
      random: () => 0,
      onAttempt: (attempts) => {
        persisted.push(attempts.length);
        return Promise.resolve();
      },
    },
  );
  assert(result.response.status === 200, "final response should succeed");
  assert(result.attempts.length === 3, "all three attempts should be retained");
  assert(
    JSON.stringify(delays) === JSON.stringify([1000, 2000]),
    "delays should be exponential",
  );
  assert(
    JSON.stringify(persisted) === JSON.stringify([1, 2, 3]),
    "every attempt should invoke persistence",
  );
});

Deno.test("Gemini: exhausted 503 retries retain all attempts", async () => {
  const result = await fetchGeminiWith503Retry(
    sequenceFetch(
      Array.from(
        { length: 4 },
        (_, index) =>
          jsonResponse(503, { error: { message: `busy-${index + 1}` } }),
      ),
    ),
    "https://example.invalid",
    {},
    { sleep: () => Promise.resolve(), random: () => 0 },
  );
  assert(result.response.status === 503, "final response should remain 503");
  assert(result.attempts.length === 4, "all four attempts should be retained");
  assert(
    (result.body.error as Record<string, unknown>).message === "busy-4",
    "last raw response should be retained",
  );
});

Deno.test("Gemini: non-JSON body is retained verbatim", async () => {
  const raw = "upstream proxy returned HTML";
  const result = await fetchGeminiWith503Retry(
    sequenceFetch([new Response(raw, { status: 502 })]),
    "https://example.invalid",
    {},
  );
  assert(
    result.body.raw_text === raw,
    "non-JSON body should be retained as raw_text",
  );
  assert(
    readGeminiOutput(result.body) === "",
    "non-JSON body should not be treated as OCR output",
  );
});

Deno.test("OCR: missing document routes required fields to manual review", () => {
  const normalized = normalizeExtraction({ lines: [] });
  assert(
    Object.keys(normalized.document).length === 0,
    "missing document should normalize to an empty object",
  );
  assert(
    normalized.warnings.some((warning) => warning.includes("document")),
    "document warning should be present",
  );
});

Deno.test("OCR: missing lines routes batch to manual review", () => {
  const normalized = normalizeExtraction({ document: {} });
  assert(
    normalized.lines.length === 0,
    "missing lines should normalize to an empty array",
  );
  assert(
    normalized.warnings.some((warning) => warning.includes("lines")),
    "lines warning should be present",
  );
});

Deno.test("OCR: raw response, attempts and output remain append-friendly", () => {
  const attempts = [
    { attempt: 1, status: 503, response: { error: "busy" } },
    { attempt: 2, status: 200, response: { candidates: [] } },
  ];
  const snapshot = rawResponseSnapshot(
    attempts[1].response,
    attempts,
    "original OCR text",
  );
  assert(
    snapshot.response === attempts[1].response,
    "final raw response should be retained",
  );
  assert(snapshot.attempts.length === 2, "attempt history should be retained");
  assert(
    snapshot.output_text === "original OCR text",
    "raw OCR text should be retained",
  );
});

Deno.test("Supabase: critical write errors identify the failed operation", () => {
  let caught: unknown;
  try {
    assertCriticalWrite(
      { error: { code: "23505", message: "duplicate" } },
      "receipt_ocr_runs.create_versioned_run",
    );
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof CriticalWriteError, "critical write must throw");
  const traced = traceableError(caught);
  assert(
    traced.operation === "receipt_ocr_runs.create_versioned_run",
    "trace must retain the operation",
  );
  assert(
    (traced.databaseError as Record<string, unknown>).code === "23505",
    "trace must retain the database error code",
  );
});

Deno.test("Supabase: successful critical writes do not throw", () => {
  const result = { data: { id: "run-id", version: 2 }, error: null };
  assert(
    assertCriticalWrite(result, "receipt_ocr_runs.create_versioned_run") ===
      result,
    "successful result should be returned",
  );
});
