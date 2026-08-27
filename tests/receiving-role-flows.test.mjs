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
    {id:'supplier',ocr_run_id:'run-1',field_name:'supplier_name',raw_value:'供應商 A',review_status:'PENDING'},
    {id:'subtotal',ocr_run_id:'run-1',field_name:'subtotal_ex_tax',raw_value:'1000',review_status:'PENDING'},
    {id:'tax',ocr_run_id:'run-1',field_name:'tax',raw_value:'50',review_status:'PENDING'},
    {id:'total',ocr_run_id:'run-1',field_name:'total_inc_tax',raw_value:'1050',review_status:'PENDING'}
  ],
  corrections:[]
};

test('staff and manager capture multiple photos without exposing backoffice publication',()=>{
  const staff=receivingPage({batches,detail:null},{role:'STAFF',businessType:'SINGLE_RESTAURANT'});
  const manager=receivingPage({batches,detail:null},{role:'SUPERVISOR',businessType:'CHAIN_RESTAURANT'});
  for(const label of['同一張貨單','不同貨單','拍攝／選擇多張照片','最多 10 張','識別中 → 核對 → 發布'])assert.match(staff,new RegExp(label));
  for(const label of['ERP 統整公司貨單','少送／多送回報','前往驗收提醒設定'])assert.match(manager,new RegExp(label));
  assert.doesNotMatch(staff,/核對完成並發布|人工修正/);
});

test('logistics corrects OCR evidence while owner only receives completed management summary',()=>{
  const logistics=receivingPage({batches,detail},{role:'LOGISTICS',businessType:'SINGLE_RESTAURANT'});
  const owner=receivingPage({batches,detail},{role:'OWNER',businessType:'CHAIN_RESTAURANT'});
  for(const label of['進貨資料核對','只有完成核對資料會進入正式統計','未稅小計','稅額','含稅總額','重新整理狀態','原始照片、AI 原值、人工修正'])assert.match(logistics,new RegExp(label));
  for(const label of['進貨管理摘要','不進入後勤逐張修整工作台','供應商與品項趨勢','少送／多送與重大異常','驗收稽查'])assert.match(owner,new RegExp(label));
  assert.doesNotMatch(owner,/保存人工修正|待核對資料/);
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
