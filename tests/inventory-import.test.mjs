import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { parseInventoryWorkbook } from '../lib/inventory-import.ts';

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
  assert.deepEqual(parsed.rows[0].missingFields, ['品項代碼', '單位', '區域', '期初數量']);
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
