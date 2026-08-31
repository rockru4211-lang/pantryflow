import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';
import test from'node:test';
import{businessSetupPage}from'../pilot-v1/pages/login.js';
import{countPage}from'../pilot-v1/pages/count.js';
import{countAccessForRole}from'../pilot-v1/services/roles.js';

const app=await readFile(new URL('../pilot-v1/app.js',import.meta.url),'utf8');
const auth=await readFile(new URL('../pilot-v1/services/auth.js',import.meta.url),'utf8');
const dataSource=await readFile(new URL('../pilot-v1/services/data.js',import.meta.url),'utf8');
const css=await readFile(new URL('../pilot-v1/design-tokens.css',import.meta.url),'utf8');

const workspace={
  sessions:[{id:'session-1',status:'CLOSED',started_at:'2026-08-27 10:00',completed_at:'2026-08-27 10:30'}],
  focusSession:{id:'session-1',status:'CLOSED',started_at:'2026-08-27 10:00',completed_at:'2026-08-27 10:30'},
  zones:[{id:'zone-1',name:'冷藏庫'},{id:'zone-2',name:'乾貨區'}],
  products:[{id:'product-1',name:'牛菲力',product_code:'BEEF-001',count_unit:'kg'}],
  assignments:[{zone_id:'zone-1',product_id:'product-1'},{zone_id:'zone-2',product_id:'product-1'}],
  progress:[{session_id:'session-1',zone_id:'zone-1',status:'COMPLETED'},{session_id:'session-1',zone_id:'zone-2',status:'COMPLETED'}],
  entries:[{session_id:'session-1',zone_id:'zone-1',product_id:'product-1',quantity:2,unit:'kg'}],
  drafts:[],
  discrepancies:[{id:'difference-1',session_id:'session-1',product_id:'product-1',previous_quantity:4,estimated_quantity:2,difference:-2,status:'PENDING'}]
};

test('business setup presents two operating modes without creating separate login flows',()=>{
  const html=businessSetupPage({businessType:'SINGLE_RESTAURANT'});
  assert.match(html,/營運模式/);
  assert.match(html,/中小餐廳／單店｜App 盤點＋匯出/);
  assert.match(html,/連鎖餐飲／多門市｜紙本謄寫＋跨店追蹤/);
  assert.match(html,/未啟用功能不會出現在員工畫面/);
  assert.match(auth,/p_business_type:input\.businessType/);
});

test('small restaurant employee completion keeps export and hides every paper-only control',()=>{
  const html=countPage(workspace,{role:'STAFF',businessType:'SINGLE_RESTAURANT'});
  assert.match(html,/盤點完成/);
  assert.match(html,/匯出原格式回填版/);
  assert.match(html,/匯出完整稽核明細/);
  assert.match(html,/可列印或另存 PDF/);
  assert.doesNotMatch(html,/紙本|謄寫|跨店/);
});

test('employee can open a real count detail page and print it as PDF',()=>{
  const completion=countPage(workspace,{role:'STAFF',businessType:'SINGLE_RESTAURANT'});
  const detail=countPage(workspace,{role:'STAFF',businessType:'SINGLE_RESTAURANT',context:{detailSessionId:'session-1'}});
  assert.match(completion,/data-count-detail="session-1"/);
  for(const label of['本次盤點明細','冷藏庫','牛菲力','2 kg','匯出原格式回填版','匯出完整稽核明細','列印／另存 PDF'])assert.match(detail,new RegExp(label));
  assert.match(app,/data-count-detail/);
});

test('chain employee completion requires paper transcription and still allows export',()=>{
  const html=countPage(workspace,{role:'STAFF',businessType:'CHAIN_RESTAURANT'});
  assert.match(html,/連鎖餐飲模式/);
  assert.match(html,/謄寫店內紙本/);
  assert.match(html,/必做・留下經手人與完成時間/);
  assert.match(html,/匯出原格式回填版/);
  assert.match(html,/匯出完整稽核明細/);
  assert.match(html,/data-paper-count="session-1"/);
});

test('paper guide is conditional and never asks staff to enter the paper values again',()=>{
  const chain=countPage(workspace,{role:'STAFF',businessType:'CHAIN_RESTAURANT',context:{paperSessionId:'session-1'}});
  const small=countPage(workspace,{role:'STAFF',businessType:'SINGLE_RESTAURANT',context:{paperSessionId:'session-1'}});
  assert.match(chain,/依公司既有盤點表完成謄寫/);
  assert.match(chain,/不需要把紙本內容再輸回 App/);
  assert.match(chain,/我已完成紙本謄寫/);
  assert.match(small,/此商家未啟用紙本謄寫/);
});

test('manager, logistics and owner receive separate count information architectures',()=>{
  const manager=countPage(workspace,{role:'SUPERVISOR',businessType:'CHAIN_RESTAURANT'});
  const logistics=countPage(workspace,{role:'LOGISTICS',businessType:'CHAIN_RESTAURANT'});
  const owner=countPage(workspace,{role:'OWNER',businessType:'CHAIN_RESTAURANT'});
  for(const label of['本店盤點管理','盤點設定','區域與品項','差異原因確認','紙本稽查'])assert.match(manager,new RegExp(label));
  for(const label of['盤點資料工作台','整理盤點明細','差異分類與檢討','建立分析報告','不改原始實盤'])assert.match(logistics,new RegExp(label));
  for(const label of['盤點管理摘要','查看後勤分析結論','門市稽核追蹤','盤點政策'])assert.match(owner,new RegExp(label));
  assert.doesNotMatch(logistics,/發布今日盤點任務|區域與品項|保存事件/);
  assert.doesNotMatch(owner,/開始整理今日資料|區域與品項|保存事件/);
  assert.doesNotMatch(manager,/盤點資料工作台|查看後勤分析結論/);
});

test('count role capabilities prevent logistics and owner from entering blind count',()=>{
  assert.equal(countAccessForRole('STAFF').canCount,true);
  assert.equal(countAccessForRole('SUPERVISOR').canConfigure,true);
  assert.equal(countAccessForRole('LOGISTICS').canAnalyze,true);
  assert.equal(countAccessForRole('LOGISTICS').canCount,false);
  assert.equal(countAccessForRole('OWNER').canGovern,true);
  assert.equal(countAccessForRole('OWNER').canCount,false);
  const denied=countPage(workspace,{role:'LOGISTICS',context:{sessionId:'session-1',zoneId:'zone-1'}});
  assert.match(denied,/此角色不執行現場盲盤/);
});

test('app loads organization mode, wires source-position export and keeps paper persistence out of localStorage',()=>{
  assert.match(auth,/db\.from\('organizations'\)\.select\('business_type'\)/);
  assert.match(app,/businessType:state\.profile\.business_type/);
  assert.match(app,/countExportRows/);
  assert.match(app,/downloadCountWorkbook/);
  assert.match(app,/盤點回填版.*盤點完整稽核明細/);
  assert.match(dataSource,/export async function countExportRows/);
  assert.doesNotMatch(`${app}\n${dataSource}`,/localStorage.*paper|paper.*localStorage/i);
});

test('manager setup validates source mapping and separates SME selection from chain policy',()=>{
  const setup={...workspace,sessions:[],focusSession:null,progress:[],entries:[],discrepancies:[]};
  const small=countPage(setup,{role:'SUPERVISOR',businessType:'SINGLE_RESTAURANT'});
  const chain=countPage(setup,{role:'SUPERVISOR',businessType:'CHAIN_RESTAURANT'});
  for(const label of['匯入原盤點表','已對應','將新建','重複','缺少單位','來源工作表／欄位／列號','本次盤點品項','沿用上次選擇'])assert.match(small,new RegExp(label));
  assert.match(chain,/由公司範本固定，門市不可自行取消/);
  assert.doesNotMatch(chain,/沿用上次選擇/);
  assert.match(app,/data-count-import-file/);
  assert.match(app,/COUNT_ZONE_INCOMPLETE/);
});

test('safe count imports publish immediately while conflicts stop before any write',()=>{
  assert.match(app,/if\(!preview\.canPublish\).*renderPage\('count'.*importPreview:preview.*return.*publishCountImport/s);
  assert.match(app,/正在辨識並建立盤點細項/);
  const complete=countPage(workspace,{role:'SUPERVISOR',businessType:'SINGLE_RESTAURANT',context:{importComplete:{fileName:'盤點表.xlsx',rowCount:42,zoneCount:2,newCount:11,duplicateCount:2}}});
  assert.match(complete,/已建立 42 個盤點細項/);
  assert.match(complete,/2 個區域・11 個新商品・合併 2 筆重複資料/);
  assert.doesNotMatch(complete,/確認並建立/);
});

test('manager can import the next template and start a new task after historical counts',()=>{
  const closed={...workspace,activeSession:null,focusSession:{id:'closed-1',status:'CLOSED',started_at:'昨天'},sessions:[{id:'closed-1',status:'CLOSED',started_at:'昨天'}]};
  const html=countPage(closed,{role:'SUPERVISOR',businessType:'SINGLE_RESTAURANT'});
  assert.match(html,/匯入原盤點表/);
  assert.match(html,/發布今日盤點任務/);
  assert.match(html,/上次盤點已完成/);
});

test('count module preserves the locked white canvas and role accent treatment',()=>{
  assert.match(css,/PF-COUNT-MODES-FINAL-20260827/);
  assert.match(css,/\.count-after-list button.*background:#fff/);
  assert.match(css,/\.count-role-intro span.*var\(--role-soft\).*var\(--role-accent\)/);
});
