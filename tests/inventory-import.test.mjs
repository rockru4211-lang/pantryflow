import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { parseInventoryWorkbook, readInventoryWorkbook } from '../lib/inventory-import.ts';

const makeSheet = rows => XLSX.utils.aoa_to_sheet(rows);

test('inventory parser detects a header below title rows and reads every worksheet', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, makeSheet([
    ['餐廳盤點表'],
    ['年份', '', '', '週期'],
    ['品名', '規格', '單位', '期初庫存'],
    ['白細砂糖\n1kg', '1kg/包', '包', '2'],
    ['盤點人員簽名'],
  ]), 'Table 1');
  XLSX.utils.book_append_sheet(workbook, makeSheet([
    ['第二頁'],
    ['日期'],
    ['品名', '規格', '單位', '期初庫存'],
    ['義式肉醬', '1.2kg/包', '包', ''],
  ]), 'Table 2');

  const parsed = parseInventoryWorkbook(workbook);
  assert.deepEqual(parsed.sheets.map(sheet => [sheet.sheetName, sheet.headerRow, sheet.dataRows]), [
    ['Table 1', 3, 1],
    ['Table 2', 3, 1],
  ]);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].name, '白細砂糖1kg');
  assert.equal(parsed.rows[0].openingQuantity, 2);
  assert.equal(parsed.rows[1].openingQuantity, 0);
  assert.equal(parsed.failures.length, 0);
});

test('inventory parser normalizes full-width aliases and applies only documented defaults', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, makeSheet([
    ['　品 項 名 稱　', 'ＳＫＵ', '盤點 單位', '儲存 區域', '期初 數量'],
    [' 鮮奶油 ', '', '', '', ''],
  ]), '庫存');

  const parsed = parseInventoryWorkbook(workbook);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].name, '鮮奶油');
  assert.equal(parsed.rows[0].unit, '待補單位');
  assert.equal(parsed.rows[0].zoneName, '未分類');
  assert.equal(parsed.rows[0].openingQuantity, 0);
  assert.match(parsed.rows[0].productCode, /^SEQ-[A-F0-9]{16}$/);
  assert.deepEqual(parsed.rows[0].missingFields, ['品項代碼', '單位', '供應商', '區域', '期初數量']);
});

test('generated product codes are stable and do not merge same-name items with different units', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, makeSheet([
    ['品名', '規格', '單位'],
    ['地瓜', '', '包'],
    ['地瓜', '96個/箱', '個'],
  ]), '品項');

  const first = parseInventoryWorkbook(workbook);
  const second = parseInventoryWorkbook(workbook);
  assert.equal(first.rows.length, 2);
  assert.equal(first.rows[0].productCode, second.rows[0].productCode);
  assert.notEqual(first.rows[0].productCode, first.rows[1].productCode);
});

test('invalid opening quantities are reported with their original worksheet row', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, makeSheet([
    ['品名', '期初數量'],
    ['鮮奶', '-1'],
  ]), '錯誤列');

  const parsed = parseInventoryWorkbook(workbook);
  assert.equal(parsed.rows.length, 0);
  assert.deepEqual(parsed.failures, [{ sheetName: '錯誤列', sourceRow: 2, reason: '期初數量「-1」不是有效的非負數字' }]);
});

test('inventory parser recognizes supplier aliases without making supplier mandatory', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, makeSheet([
    ['品名', '單位', '廠 商 名 稱'],
    ['鮮奶', '瓶', '測試乳品商'],
    ['奶油', '盒', ''],
  ]), '供應商');

  const parsed = parseInventoryWorkbook(workbook);
  assert.equal(parsed.rows[0].supplierName, '測試乳品商');
  assert.equal(parsed.rows[1].supplierName, '');
  assert.equal(parsed.rows[0].missingFields.includes('供應商'), false);
  assert.equal(parsed.rows[1].missingFields.includes('供應商'), true);
});

test('blank rows are skipped but nonblank rows without a product name fail visibly', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, makeSheet([
    ['品名', '單位', '供應商'],
    ['', '', ''],
    ['', '包', '測試供應商'],
    ['合計', '', ''],
  ]), '逐列結果');

  const parsed = parseInventoryWorkbook(workbook);
  assert.deepEqual(parsed.failures, [{ sheetName: '逐列結果', sourceRow: 3, reason: '資料列缺少品項名稱' }]);
  assert.deepEqual(parsed.skipped, [
    { sheetName: '逐列結果', sourceRow: 2, reason: '空白列' },
    { sheetName: '逐列結果', sourceRow: 4, reason: '非品項資料列：合計' },
  ]);
  assert.deepEqual(parsed.sheets.map(sheet => [sheet.dataRows, sheet.failedRows, sheet.skippedRows]), [[0, 1, 2]]);
});

test('UTF-8 CSV files decode Chinese headers even without a byte-order mark', () => {
  const csv = new TextEncoder().encode('品項代碼,品名,規格,單位,供應商,期初庫存\nSEQ-TEST,白細砂糖,1kg/包,包,序 QA 供應商,0\n');
  const parsed = parseInventoryWorkbook(readInventoryWorkbook(csv, 'inventory.csv'));
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].name, '白細砂糖');
  assert.equal(parsed.rows[0].supplierName, '序 QA 供應商');
  assert.equal(parsed.failures.length, 0);
});
