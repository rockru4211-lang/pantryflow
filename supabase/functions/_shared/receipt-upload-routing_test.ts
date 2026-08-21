import "../../../receipt-upload-routing.js";

type RoutingModule = {
  groupReceiptFiles: <T>(files: T[], sameReceiptMultiPage?: boolean) => T[][];
  settleReceiptGroups: <T, R>(
    groups: T[][],
    worker: (files: T[], groupIndex: number) => Promise<R>,
  ) => Promise<Array<{ ok: boolean; groupIndex: number; value?: R; error?: unknown }>>;
};

const routing = (globalThis as typeof globalThis & {
  PantryReceiptUploadRouting: RoutingModule;
}).PantryReceiptUploadRouting;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("receipt upload defaults each image to an independent batch", () => {
  const groups = routing.groupReceiptFiles(["a.jpg", "b.jpg", "c.jpg"]);
  assert(groups.length === 3, "default routing should create one batch per image");
  assert(groups.every((group) => group.length === 1), "each default batch should contain one image");
});

Deno.test("receipt upload groups images only when multi-page is explicit", () => {
  const groups = routing.groupReceiptFiles(["front.jpg", "back.jpg"], true);
  assert(groups.length === 1, "multi-page routing should create one batch");
  assert(groups[0].length === 2, "multi-page batch should preserve every page");
});

Deno.test("one receipt failure does not reject or hide successful receipts", async () => {
  const groups = routing.groupReceiptFiles(["good-1.jpg", "bad.jpg", "good-2.jpg"]);
  const results = await routing.settleReceiptGroups(groups, async ([file]) => {
    if (file === "bad.jpg") throw new Error("simulated upload failure");
    return `batch-for-${file}`;
  });
  assert(results.length === 3, "every receipt should have a result");
  assert(results.filter((result) => result.ok).length === 2, "two receipts should succeed");
  assert(results.filter((result) => !result.ok).length === 1, "one receipt should fail independently");
});

Deno.test("receipt batches upload in stable order without stopping after failure", async () => {
  const visited: string[] = [];
  const groups = routing.groupReceiptFiles(["first.jpg", "bad.jpg", "last.jpg"]);
  const results = await routing.settleReceiptGroups(groups, async ([file]) => {
    visited.push(file);
    if (file === "bad.jpg") throw new Error("simulated upload failure");
    return file;
  });
  assert(visited.join(",") === "first.jpg,bad.jpg,last.jpg", "uploads should keep source order");
  assert(results[2].ok, "a later receipt must still run after an earlier failure");
});

Deno.test("mobile upload copy makes separate receipts the checked default", async () => {
  const html = await Deno.readTextFile(new URL("../../../index.html", import.meta.url));
  assert(/value="separate" checked/.test(html), "separate receipt routing must be the UI default");
  assert(html.includes("同一張貨單的多頁"), "multi-page choice must be explicit");
  assert(html.includes("其中一張失敗不影響其他張"), "mobile copy must explain failure isolation");
});

Deno.test("cloud orchestration keeps OCR runs independent and append-only", async () => {
  const app = await Deno.readTextFile(new URL("../../../app.js", import.meta.url));
  const backend = await Deno.readTextFile(new URL("../../../pilot-backend.js", import.meta.url));
  assert(app.includes("Promise.allSettled(successful.map"), "OCR calls should settle independently");
  assert(backend.includes("groupFiles => this.uploadReceiptBatch(groupFiles)"), "each group should create its own batch");
  assert(!/receipt_ocr_(?:runs|fields)'\)\.delete/.test(backend), "routing must not delete OCR originals");
  assert(!/receipt_review_corrections'\)\.delete/.test(backend), "routing must not delete corrections");
});
