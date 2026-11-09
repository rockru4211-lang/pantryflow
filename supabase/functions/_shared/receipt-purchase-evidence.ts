import { receiptJsonSchema } from "./receipt-schema.ts";

const evidence = ["QUANTITY", "TRANSACTION_AMOUNT", "MARKED", "UNCERTAIN", "CATALOG"] as const;
const lines = receiptJsonSchema.properties.lines;

export const purchaseReceiptJsonSchema = {
  ...receiptJsonSchema,
  properties: {
    ...receiptJsonSchema.properties,
    lines: {
      ...lines,
      items: {
        ...lines.items,
        required: [...lines.items.required, "purchase_evidence"],
        properties: {
          ...lines.items.properties,
          purchase_evidence: { type: "string", enum: evidence },
        },
      },
    },
  },
} as const;

function numericValue(field: unknown): number | undefined {
  if (!field || typeof field !== "object" || !("value" in field)) return undefined;
  const value = field.value;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Only explicit evidence can enter BeApe purchase details automatically. */
export function purchaseDisposition(line: Record<string, unknown>): "purchase" | "review" | "skip" {
  switch (line.purchase_evidence) {
    case "CATALOG":
      return "skip";
    case "QUANTITY":
      return (numericValue(line.quantity) ?? 0) > 0 ? "purchase" : "review";
    case "TRANSACTION_AMOUNT":
      return (numericValue(line.subtotal_ex_tax) ?? 0) !== 0 ? "purchase" : "review";
    case "MARKED":
      return "purchase";
    default:
      return "review";
  }
}
