import { utils, type WorkBook } from "xlsx";

export type InventoryField = "name" | "specification" | "unit" | "zone" | "code" | "openingQuantity";

export type InventoryImportRow = {
  sourceId: string;
  sheetName: string;
  sourceRow: number;
  name: string;
  specification: string;
  unit: string;
  zoneName: string;
  productCode: string;
  openingQuantity: number;
  generatedCode: boolean;
  missingFields: string[];
};

export type InventoryParseFailure = {
  sheetName: string;
  sourceRow: number;
  reason: string;
};

export type InventorySheetDetection = {
  sheetName: string;
  headerRow: number | null;
  mapping: Partial<Record<InventoryField, string>>;
  dataRows: number;
};

export type InventoryWorkbookParse = {
  sheets: InventorySheetDetection[];
  rows: InventoryImportRow[];
  failures: InventoryParseFailure[];
};

const aliases: Record<InventoryField, string[]> = {
  name: ["品項名稱", "食材名稱", "商品名稱", "物料名稱", "品項", "品名", "名稱"],
  specification: ["品項規格", "商品規格", "規格"],
  unit: ["盤點單位", "計量單位", "庫存單位", "單位"],
  zone: ["儲存區域", "儲物區", "盤點區域", "區域", "位置", "庫位", "儲位"],
  code: ["品項代碼", "商品代碼", "食材代碼", "物料代碼", "編碼", "代碼", "sku"],
  openingQuantity: ["期初庫存", "期初數量", "目前數量", "庫存數量", "現有庫存", "數量"],
};

const fieldOrder = Object.keys(aliases) as InventoryField[];

export function normalizeInventoryText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\r?\n/g, "")
    .replace(/[\t ]+/g, " ")
    .trim();
}

function normalizeHeader(value: unknown) {
  return normalizeInventoryText(value).toLocaleLowerCase("zh-TW").replace(/[\s_－—–:：/\\]+/g, "");
}

function findField(header: unknown): InventoryField | null {
  const normalized = normalizeHeader(header);
  if (!normalized) return null;
  const candidates = fieldOrder.flatMap(field => aliases[field].map(alias => ({ field, alias: normalizeHeader(alias) })));
  const exact = candidates.find(candidate => normalized === candidate.alias);
  if (exact) return exact.field;
  return candidates
    .filter(candidate => normalized.includes(candidate.alias))
    .sort((a, b) => b.alias.length - a.alias.length)[0]?.field ?? null;
}

function detectHeader(matrix: unknown[][]) {
  let best: { rowIndex: number; mapping: Partial<Record<InventoryField, number>>; score: number } | null = null;
  for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 30); rowIndex += 1) {
    const mapping: Partial<Record<InventoryField, number>> = {};
    matrix[rowIndex].forEach((header, columnIndex) => {
      const field = findField(header);
      if (field && mapping[field] === undefined) mapping[field] = columnIndex;
    });
    if (mapping.name === undefined) continue;
    const score = Object.keys(mapping).length;
    if (!best || score > best.score) best = { rowIndex, mapping, score };
  }
  return best;
}

function stableProductCode(name: string, specification: string, unit: string) {
  const input = `${name}|${specification}|${unit}`.normalize("NFKC").toLocaleLowerCase("zh-TW");
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const value = input.charCodeAt(index);
    first = Math.imul(first ^ value, 0x01000193);
    second = Math.imul(second ^ value, 0x85ebca6b);
  }
  return `SEQ-${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`.toUpperCase();
}

function isNonProductLabel(name: string) {
  return /^(盤點人員簽名|簽名|備註|合計|總計)$/.test(name.replace(/\s/g, ""));
}

function parseOpeningQuantity(value: unknown) {
  const text = normalizeInventoryText(value);
  if (!text) return { value: 0, missing: true, error: "" };
  const parsed = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0) return { value: 0, missing: false, error: `期初數量「${text}」不是有效的非負數字` };
  return { value: parsed, missing: false, error: "" };
}

export function parseInventoryWorkbook(workbook: WorkBook): InventoryWorkbookParse {
  const rows: InventoryImportRow[] = [];
  const failures: InventoryParseFailure[] = [];
  const sheets: InventorySheetDetection[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false, blankrows: true });
    const detected = detectHeader(matrix);
    if (!detected) {
      sheets.push({ sheetName, headerRow: null, mapping: {}, dataRows: 0 });
      failures.push({ sheetName, sourceRow: 0, reason: "找不到品項名稱欄位" });
      continue;
    }

    const labels: Partial<Record<InventoryField, string>> = {};
    for (const field of fieldOrder) {
      const columnIndex = detected.mapping[field];
      if (columnIndex !== undefined) labels[field] = normalizeInventoryText(matrix[detected.rowIndex][columnIndex]);
    }

    let dataRows = 0;
    for (let rowIndex = detected.rowIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
      const sourceRow = rowIndex + 1;
      const source = matrix[rowIndex];
      const value = (field: InventoryField) => {
        const columnIndex = detected.mapping[field];
        return columnIndex === undefined ? "" : normalizeInventoryText(source[columnIndex]);
      };
      const name = value("name");
      if (!name || isNonProductLabel(name)) continue;

      const specification = value("specification");
      const suppliedUnit = value("unit");
      const suppliedZone = value("zone");
      const suppliedCode = value("code");
      const opening = parseOpeningQuantity(value("openingQuantity"));
      if (opening.error) {
        failures.push({ sheetName, sourceRow, reason: opening.error });
        continue;
      }

      const unit = suppliedUnit || "待補單位";
      const zoneName = suppliedZone || "未分類";
      const productCode = suppliedCode.toLocaleUpperCase("en-US") || stableProductCode(name, specification, unit);
      const missingFields = [
        !suppliedCode && "品項代碼",
        !suppliedUnit && "單位",
        !suppliedZone && "區域",
        opening.missing && "期初數量",
      ].filter((field): field is string => Boolean(field));

      rows.push({
        sourceId: `${sheetName}:${sourceRow}`,
        sheetName,
        sourceRow,
        name,
        specification,
        unit,
        zoneName,
        productCode,
        openingQuantity: opening.value,
        generatedCode: !suppliedCode,
        missingFields,
      });
      dataRows += 1;
    }
    sheets.push({ sheetName, headerRow: detected.rowIndex + 1, mapping: labels, dataRows });
  }

  return { sheets, rows, failures };
}
