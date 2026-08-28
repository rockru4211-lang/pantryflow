import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';
import test from'node:test';
import{homePage}from'../pilot-v1/pages/home.js';
import{layout}from'../pilot-v1/components/layout.js';
import{homeRouteForRole,normalizeStoreRole,roleHomeKind}from'../pilot-v1/services/roles.js';
import{unavailableRolePage}from'../pilot-v1/pages/login.js';

const app=await readFile(new URL('../pilot-v1/app.js',import.meta.url),'utf8');
const css=await readFile(new URL('../pilot-v1/design-tokens.css',import.meta.url),'utf8');
const homeSource=await readFile(new URL('../pilot-v1/pages/home.js',import.meta.url),'utf8');

test('real membership role values route to the correct home without employee fallback',()=>{
  assert.equal(normalizeStoreRole('EMPLOYEE'),'STAFF');
  assert.equal(normalizeStoreRole('STAFF'),'STAFF');
  assert.equal(homeRouteForRole('EMPLOYEE'),'#/employee/home');
  assert.equal(homeRouteForRole('STAFF'),'#/employee/home');
  assert.equal(homeRouteForRole('ADMIN'),'#/manager/home');
  assert.equal(homeRouteForRole('SUPERVISOR'),'#/manager/home');
  assert.equal(homeRouteForRole('LOGISTICS'),'#/logistics/home');
  assert.equal(homeRouteForRole('OWNER'),'#/owner/home');
  assert.equal(homeRouteForRole('UNKNOWN'),null);
  assert.equal(roleHomeKind('LOGISTICS'),'logistics');
  assert.equal(roleHomeKind('OWNER'),'owner');
  assert.match(app,/normalizeStoreRole\(state\.store\?\.role\)/);
  assert.doesNotMatch(homeSource,/\|\|roleContent\.STAFF/);
});

test('employee home is reduced to the single daily count action',()=>{
  const html=layout({storeName:'測試門市',displayName:'測試員工',role:'STAFF',page:'home',content:homePage({role:'STAFF'})});
  for(const label of['今天唯一要做的事','今日盤點','開始盤點','系統會自動保存','進貨驗收','確認實收與差異'])assert.match(html,new RegExp(label));
  assert.doesNotMatch(html,/缺貨風險|即期提醒|每日作業|廢棄|效期巡檢/);
  assert.equal((html.match(/data-route=/g)||[]).length,6);
  assert.match(html,/data-route="tasks"[\s\S]*?<span>待辦<\/span>/);
  assert.doesNotMatch(html,/data-route="scan"|>掃描</);
  assert.match(html,/role-employee/);assert.match(html,/data-feature="count"/);
  assert.match(html,/<svg[^>]*ui-icon/);
  assert.match(html,/aria-label="通知"><svg/);
  assert.doesNotMatch(html,/♧|▣|▤|♲|◷|>!<|>\?</);
});

test('manager home is reduced to one-time count setup and keeps orange identity',()=>{
  for(const role of['ADMIN','SUPERVISOR']){const html=layout({storeName:'測試門市',displayName:'測試主管',role,page:'home',content:homePage({role})});for(const label of['只需設定一次','開始設定盤點','匯入 Excel 或建立區域後','開始設定'])assert.match(html,new RegExp(label));assert.match(html,/role-manager/)}
  assert.match(css,/\.role-manager\{--role-accent:#d66e22/);
});

test('logistics and owner have distinct blue and purple management homes',()=>{
  const logistics=layout({storeName:'測試門市',role:'LOGISTICS',page:'home',content:homePage({role:'LOGISTICS'})});
  const owner=layout({storeName:'測試門市',role:'OWNER',page:'home',content:homePage({role:'OWNER'})});
  for(const label of['今日待核對','營運成果','管理功能','商品／編碼','供應商','成本分析','報表中心'])assert.match(logistics,new RegExp(label));
  for(const label of['營運摘要','重大進貨異常','營運成果','管理設定','成員與權限','商家設定','模組開關','Audit Log'])assert.match(owner,new RegExp(label));
  assert.doesNotMatch(owner,/收貨待核對|編碼待確認|貨單差異/);
  assert.match(logistics,/role-logistics/);assert.match(owner,/role-owner/);
  assert.match(css,/\.role-logistics\{--role-accent:#2f6fc1/);
  assert.match(css,/\.role-owner\{--role-accent:#7a4bb7/);
});

test('unknown roles never masquerade as a supported role',()=>{
  for(const role of['UNKNOWN']){assert.equal(homeRouteForRole(role),null);assert.throws(()=>homePage({role}),/ROLE_HOME_NOT_AVAILABLE/)}
  assert.match(unavailableRolePage('UNKNOWN'),/尚未指派角色／門市/);
});

test('authenticated app uses white canvas, white header, low-shadow cards and explicit back history',()=>{
  assert.match(css,/body:has\(\.app-view\).*background:#fff/);
  assert.match(css,/\.app-view \.app-topbar.*background:#fff/);
  assert.match(css,/box-shadow:0 3px 12px/);
  assert.match(app,/state\.history\.push/);assert.match(app,/data-back/);assert.match(app,/state\.history\.pop/);
});

test('production role pages preserve the approved 390px mobile preview canvas',()=>{
  assert.match(css,/PF-PREVIEW-PARITY-20260827/);
  assert.match(css,/\.app-view\{width:min\(100%,390px\)/);
  assert.match(css,/\.operation-grid\{grid-template-columns:repeat\(3,1fr\)\}/);
  assert.match(css,/\.bottom-nav\{width:min\(100%,390px\)/);
});

test('rendered role homes contain no internal release labels',()=>{
  const forbidden=/封閉 Pilot|legacy-demo|preview|pilot-v1/i;
  for(const role of['STAFF','ADMIN','SUPERVISOR','LOGISTICS','OWNER'])assert.doesNotMatch(layout({storeName:'測試門市',role,page:'home',content:homePage({role})}),forbidden);
});

test('login and app share the finalized multi-petal daisy and line icon system',async()=>{
  const icons=await readFile(new URL('../pilot-v1/components/icons.js',import.meta.url),'utf8');
  const login=await readFile(new URL('../pilot-v1/pages/login.js',import.meta.url),'utf8');
  assert.match(icons,/daisyMark/);
  assert.match(icons,/<ellipse cx="32" cy="16"/);
  assert.match(login,/daisyMark/);
  assert.match(css,/\.operation-card span \.ui-icon/);
  assert.match(css,/\.bottom-nav \.nav-icon/);
});
