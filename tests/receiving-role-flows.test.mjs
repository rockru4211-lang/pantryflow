import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';
import test from'node:test';
import{receivingPage}from'../pilot-v1/pages/receiving.js';

const app=await readFile(new URL('../pilot-v1/app.js',import.meta.url),'utf8');
const dataSource=await readFile(new URL('../pilot-v1/services/data.js',import.meta.url),'utf8');
const css=await readFile(new URL('../pilot-v1/design-tokens.css',import.meta.url),'utf8');
const batches=[
  {id:'batch-processing',batch_number:'#001',work_date:'2026-08-27',status:'PROCESSING',receipt_documents:[{id:'a'}]},
  {id:'batch-review',batch_number:'#002',work_date:'2026-08-27',status:'READY_FOR_REVIEW',receipt_documents:[{id:'b'},{id:'c'}]},
  {id:'batch-published',batch_number:'#003',work_date:'2026-08-27',status:'COMPLETED',receipt_documents:[{id:'d'}]}
];
const detail={
  batch:batches[1],
  documents:[],
  runs:[{id:'run-1',version:1,status:'REVIEWING',provider:'OCR',model:'pilot'}],
  fields:[
    {id:'supplier',ocr_run_id:'run-1',row_key:'document',field_name:'supplier_name',raw_value:'供應商 A',review_status:'TRUSTED'},
    {id:'subtotal',ocr_run_id:'run-1',row_key:'document',field_name:'subtotal_ex_tax',raw_value:'1000',review_status:'TRUSTED'},
    {id:'tax',ocr_run_id:'run-1',row_key:'document',field_name:'tax',raw_value:'50',review_status:'TRUSTED'},
    {id:'total',ocr_run_id:'run-1',row_key:'document',field_name:'total_inc_tax',raw_value:'1050',review_status:'TRUSTED'},
    {id:'product-1',ocr_run_id:'run-1',row_key:'1',field_name:'product',raw_value:'鮮奶 1L',review_status:'TRUSTED'},
    {id:'quantity-1',ocr_run_id:'run-1',row_key:'1',field_name:'quantity',raw_value:'2',normalized_value:2,review_status:'TRUSTED'},
    {id:'unit-1',ocr_run_id:'run-1',row_key:'1',field_name:'unit',raw_value:'瓶',review_status:'TRUSTED'},
    {id:'price-1',ocr_run_id:'run-1',row_key:'1',field_name:'unit_price_ex_tax',raw_value:'80',normalized_value:80,review_status:'TRUSTED'},
    {id:'line-subtotal-1',ocr_run_id:'run-1',row_key:'1',field_name:'subtotal_ex_tax',raw_value:'160',normalized_value:160,review_status:'TRUSTED'}
  ],
  corrections:[]
};

test('staff and manager capture multiple photos without exposing backoffice publication',()=>{
  const staff=receivingPage({batches,detail:null},{role:'STAFF',businessType:'SINGLE_RESTAURANT'});
  const manager=receivingPage({batches,detail:null},{role:'SUPERVISOR',businessType:'CHAIN_RESTAURANT'});
  for(const label of['同一張貨單','不同貨單','拍攝／選擇多張照片','最多 10 張','識別中 → 現場確認 → 資料核對'])assert.match(staff,new RegExp(label));
  for(const label of['PantryFlow 進貨紀錄','啟用 ERP 輔助','今日到貨驗收'])assert.match(manager,new RegExp(label));
  assert.doesNotMatch(staff,/核對完成並發布|人工修正/);
});

test('logistics corrects OCR evidence while owner only receives completed management summary',()=>{
  const logistics=receivingPage({batches,detail},{role:'LOGISTICS',businessType:'SINGLE_RESTAURANT'});
  const owner=receivingPage({batches,detail},{role:'OWNER',businessType:'CHAIN_RESTAURANT'});
  for(const label of['進貨資料核對','只有完成核對資料會進入正式統計','未稅小計','稅額','含稅總額','重新整理狀態','原始照片、AI 原值、人工修正'])assert.match(logistics,new RegExp(label));
  for(const label of['進貨管理摘要','不進入後勤逐張修整工作台','供應商與品項趨勢','少送／多送與重大異常','驗收稽查'])assert.match(owner,new RegExp(label));
  assert.doesNotMatch(owner,/保存人工修正|待核對資料/);
});

test('receipt detail uses document totals and renders every recognized product line',()=>{
  const manager=receivingPage({batches,detail},{role:'SUPERVISOR',businessType:'SINGLE_RESTAURANT'});
  assert.match(manager,/辨識品項與實收/);
  assert.match(manager,/鮮奶 1L/);
  assert.match(manager,/貨單數量 <b>2 瓶<\/b>/);
  assert.match(manager,/未稅單價 <b>80 TWD<\/b>/);
  assert.match(manager,/name="value" value="1000"/);
  assert.match(manager,/未稅小計 <b>160 TWD<\/b>/);
});

test('header-only OCR is not presented as a complete receiving result',()=>{
  const headerOnly={...detail,fields:detail.fields.filter(field=>field.row_key==='document')};
  const manager=receivingPage({batches,detail:headerOnly},{role:'SUPERVISOR',businessType:'SINGLE_RESTAURANT'});
  assert.match(manager,/沒有辨識到品名/);
  assert.match(manager,/不得把只有表頭的結果當成完整進貨資料/);
  assert.match(manager,/data-retry-receipt/);
});

test('receiving upload limits, grouping, preview and retry wiring are explicit',()=>{
  assert.match(app,/files\.length>10/);
  assert.match(app,/SEPARATE_RECEIPTS/);
  assert.match(app,/URL\.createObjectURL/);
  assert.match(app,/data-receipt-remove-index/);
  assert.match(app,/retryReceiptOcr/);
  assert.match(dataSource,/ui_status:latest\?\.status==='FAILED'\?'FAILED':batch\.status/);
  assert.match(css,/receipt-photo-preview/);
  assert.doesNotMatch(`${app}\n${dataSource}`,/localStorage.*receipt|receipt.*localStorage/i);
});
