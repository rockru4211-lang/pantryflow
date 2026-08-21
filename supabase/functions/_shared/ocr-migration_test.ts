const migrationUrl = new URL(
  "../../migrations/20260821142316_allocate_receipt_ocr_run_version.sql",
  import.meta.url,
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("OCR migration serializes version allocation and inserts under the same transaction", async () => {
  const sql = await Deno.readTextFile(migrationUrl);
  assert(
    sql.includes(
      "pg_advisory_xact_lock(hashtextextended(p_batch_id::text, 0))",
    ),
    "per-batch transaction lock is required",
  );
  assert(
    sql.indexOf("pg_advisory_xact_lock") < sql.indexOf("max(r.version)"),
    "the lock must be acquired before version allocation",
  );
  assert(
    sql.indexOf("max(r.version)") <
      sql.indexOf("insert into public.receipt_ocr_runs"),
    "version allocation and insert must remain in the locked function",
  );
  assert(
    sql.includes("set status = 'PROCESSING'"),
    "batch PROCESSING update must share the allocation transaction",
  );
});

Deno.test("OCR allocator RPC is restricted to service_role", async () => {
  const sql = await Deno.readTextFile(migrationUrl);
  assert(
    sql.includes("security invoker"),
    "allocator must use security invoker",
  );
  assert(
    sql.includes("from public, anon, authenticated"),
    "public browser roles must be revoked",
  );
  assert(
    sql.includes("to service_role"),
    "only service_role should be granted execution",
  );
});

Deno.test("OCR Edge Function checks every critical run and batch update", async () => {
  const source = await Deno.readTextFile(
    new URL("../process-receipt-ocr/index.ts", import.meta.url),
  );
  const writes = source.matchAll(
    /await admin\.from\("(receipt_ocr_runs|receipt_upload_batches)"\)[\s\S]*?\.update\([\s\S]*?;\n/g,
  );
  let count = 0;
  for (const write of writes) {
    count += 1;
    assert(
      write[0].includes('.select("id").single()'),
      `${write[1]} update must fail when zero rows are affected`,
    );
  }
  assert(count === 5, `expected 5 critical updates, found ${count}`);
  assert(
    /assertCriticalWrite\(\s*createRunResult,\s*"receipt_ocr_runs\.create_versioned_run"/
      .test(
        source,
      ),
    "atomic run allocation RPC errors must be checked",
  );
});
