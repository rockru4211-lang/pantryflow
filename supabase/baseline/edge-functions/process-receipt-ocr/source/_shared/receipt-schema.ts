export const receiptJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["document", "lines"],
  properties: {
    document: {
      type: "object",
      additionalProperties: false,
      required: ["supplier_name", "document_number", "receipt_date", "subtotal_ex_tax", "tax", "total_inc_tax"],
      properties: {
        supplier_name: fieldSchema("string"),
        document_number: fieldSchema("string"),
        receipt_date: fieldSchema("string"),
        subtotal_ex_tax: fieldSchema(["number", "null"]),
        tax: fieldSchema(["number", "null"]),
        total_inc_tax: fieldSchema(["number", "null"]),
      },
    },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["row_key", "product", "specification", "unit", "quantity", "unit_price_ex_tax", "subtotal_ex_tax"],
        properties: {
          row_key: { type: "string" },
          product: fieldSchema("string"),
          specification: fieldSchema("string"),
          unit: fieldSchema("string"),
          quantity: fieldSchema(["number", "null"]),
          unit_price_ex_tax: fieldSchema(["number", "null"]),
          subtotal_ex_tax: fieldSchema(["number", "null"]),
        },
      },
    },
  },
} as const;

function fieldSchema(type: string | string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["raw", "value", "confidence", "legibility", "region"],
    properties: {
      raw: { type: ["string", "null"] },
      value: { type },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      legibility: { type: "string", enum: ["CLEAR", "AMBIGUOUS", "UNREADABLE"] },
      region: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["page", "x", "y", "width", "height"],
            properties: {
              page: { type: "integer", minimum: 1 },
              x: { type: "number", minimum: 0, maximum: 1 },
              y: { type: "number", minimum: 0, maximum: 1 },
              width: { type: "number", minimum: 0, maximum: 1 },
              height: { type: "number", minimum: 0, maximum: 1 },
            },
          },
        ],
      },
    },
  };
}

type OcrField = {
  raw: string | null;
  value: unknown;
  confidence: number;
  legibility: "CLEAR" | "AMBIGUOUS" | "UNREADABLE";
  region: unknown;
};

export type ReceiptExtraction = {
  document: Record<string, OcrField>;
  lines: Array<{ row_key: string } & Record<string, OcrField | string>>;
};

export function classifyField(field: OcrField, notes: string[] = []) {
  if (field.legibility === "UNREADABLE" || field.value === null || field.value === "") {
    return { status: "UNREADABLE", notes: [...notes, "欄位無法可靠辨識"] };
  }
  if (field.legibility !== "CLEAR" || field.confidence < 0.88 || notes.length) {
    return { status: "REVIEW", notes };
  }
  return { status: "TRUSTED", notes };
}

export function validateLine(line: Record<string, OcrField | string>): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const quantity = Number((line.quantity as OcrField)?.value);
  const unitPrice = Number((line.unit_price_ex_tax as OcrField)?.value);
  const subtotal = Number((line.subtotal_ex_tax as OcrField)?.value);
  if ([quantity, unitPrice, subtotal].every(Number.isFinite)) {
    const expected = quantity * unitPrice;
    if (Math.abs(expected - subtotal) > Math.max(1, Math.abs(subtotal) * 0.01)) {
      for (const name of ["quantity", "unit_price_ex_tax", "subtotal_ex_tax"]) {
        result[name] = ["數量 × 單價與小計不一致"];
      }
    }
  }
  const rawName = String((line.product as OcrField)?.raw || "");
  const valueName = String((line.product as OcrField)?.value || "");
  if (/功夫[腿麵面]/.test(rawName + valueName)) {
    result.product = ["關鍵品名可能為「功夫腿／功夫麵」，必須人工核對原圖"];
  }
  return result;
}


