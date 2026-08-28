import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';
import test from'node:test';

const countSource=await readFile(new URL('../pilot-v1/pages/count.js',import.meta.url),'utf8');
const homeSource=await readFile(new URL('../pilot-v1/pages/home.js',import.meta.url),'utf8');
const appSource=await readFile(new URL('../pilot-v1/app.js',import.meta.url),'utf8');
const css=await readFile(new URL('../pilot-v1/design-tokens.css',import.meta.url),'utf8');

test('count is the only frontline primary workflow',()=>{
  assert.match(homeSource,/今天唯一要做的事/);
  assert.match(homeSource,/今日盤點/);
  assert.match(homeSource,/廢棄與效期功能暫時不放進主要流程/);
  assert.doesNotMatch(homeSource,/const workItems=/);
  assert.match(homeSource,/data-feature="receiving"/);
});

test('first-time manager setup is one-time and Excel-first',()=>{
  assert.match(countSource,/第一次只設定一次/);
  assert.match(countSource,/最快方式：匯入現有 Excel/);
  assert.match(countSource,/不用整理成固定範本/);
  assert.match(countSource,/沒有 Excel，手動建立區域/);
  assert.doesNotMatch(countSource,/count-schedule-settings/);
});

test('ready count setup becomes daily automatic without manual publishing',()=>{
  assert.match(appSource,/countFrequency:'DAILY'/);
  assert.match(appSource,/countDaysOfWeek:\[1,2,3,4,5,6,7\]/);
  assert.match(appSource,/ensureScheduledCountSession/);
  assert.match(countSource,/不必每天發布任務/);
});

test('blind count hides history and preserves autosave guidance',()=>{
  assert.match(countSource,/不顯示上次數量、差異、成本或金額/);
  assert.match(countSource,/每輸入一項就自動保存/);
  assert.doesNotMatch(countSource,/跨裝置區域鎖定將於/);
  assert.match(css,/\.quantity-input input/);
});
