import test from "node:test";
import assert from "node:assert/strict";
import {
  expiryCategory,
  monthRange,
  taipeiDate,
  wasteSummary,
  expiryError,
} from "../lib/expiry-waste.ts";
test("Taiwan date and reminder categories are mutually exclusive at boundaries", () => {
  assert.equal(taipeiDate(new Date("2026-09-08T16:00:00Z")), "2026-09-09");
  for (const reason of ["保存期限短", "使用速度慢", "容易被遺忘"]) {
    assert.equal(expiryCategory("2026-09-08", reason, "2026-09-09"), "urgent");
    assert.equal(expiryCategory("2026-09-09", reason, "2026-09-09"), "urgent");
    assert.equal(
      expiryCategory("2026-09-12", reason, "2026-09-09"),
      "upcoming",
    );
  }
  assert.equal(
    expiryCategory("2026-09-13", "使用速度慢", "2026-09-09"),
    "special",
  );
  assert.equal(expiryCategory("2026-09-13", "保存期限短", "2026-09-09"), null);
  assert.deepEqual(monthRange("2028-02"), ["2028-02-01", "2028-02-29"]);
  assert.deepEqual(monthRange("2026-12"), ["2026-12-01", "2026-12-31"]);
});
test("waste summaries never add incompatible quantities or price missing data as zero", () => {
  const summary = wasteSummary([
    { quantity: 3, unit: "公斤", reason: "效期到期", reference_amount: 120 },
    { quantity: 2, unit: "瓶", reason: "品質異常", reference_amount: null },
    { quantity: 1, unit: "包", reason: "效期到期", reference_amount: 0 },
  ]);
  assert.deepEqual(summary, {
    count: 3,
    reason: "效期到期、品質異常",
    amount: 120,
    unpriced: 1,
  });
  assert.ok(!("quantity" in summary));
  assert.match(expiryError({ message: "ERP_LIST_CHANGED" }), /重新開啟/);
});
