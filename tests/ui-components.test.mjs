import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});

after(async () => {
  await vite.close();
});

test('My page preserves role and explicit store grants with contiguous setup numbering',async()=>{
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://hewanlhkyzptbdbrvtpl.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||= 'ci-placeholder-publishable-key';
  const {default:MyWorkspace}=await vite.ssrLoadModule('/app/pilot/my-workspace.tsx');
  const {managementPolicy}=await import('../lib/management-policy.mjs');
  for(const business_type of ['SINGLE_RESTAURANT','CHAIN_RESTAURANT'])for(const role of ['STAFF','SUPERVISOR','LOGISTICS','OWNER']){
    const grant=role==='OWNER';
    const policy=managementPolicy(role,business_type,grant);
    const store={role,business_type,...policy,can_manage_business:grant,permissions:{reports_view:role!=='STAFF',data_export:role==='OWNER'}};
    const html=renderToStaticMarkup(React.createElement(MyWorkspace,{store,demo:true,canChangePassword:false,onNavigate:()=>{},onCountSettings:()=>{},onSignOut:()=>{}}));
    assert.equal(html.includes('<strong>門市設定</strong>'),policy.can_manage_stores);
    assert.equal(html.includes('<strong>員工與權限</strong>'),policy.can_manage_members);
    assert.equal(html.includes('<strong>品項與盤點資料</strong>'),role!=='STAFF');
    assert.equal(html.includes('<h2 id="my-operations-title">'),role!=='STAFF');
    assert.equal(html.includes('<strong>資料匯出</strong>'),role==='OWNER');
    const steps=[...html.matchAll(/class="my-step"[^>]*>(\d+)</g)].map(m=>Number(m[1]));
    assert.deepEqual(steps,Array.from({length:steps.length},(_,i)=>i+1));
    assert.doesNotMatch(html,/變更密碼|type="password"|disabled=/);
    for(const copy of html.matchAll(/class="my-menu-copy">(.*?)<\/span>/g))assert.match(copy[1],/<small>[^<]+<\/small>/);
  }
});

test('My page applies the selected store grants instead of another store or a global role',async()=>{
  const {default:MyWorkspace}=await vite.ssrLoadModule('/app/pilot/my-workspace.tsx');
  const render=store=>renderToStaticMarkup(React.createElement(MyWorkspace,{store,demo:false,canChangePassword:false,onNavigate:()=>{},onCountSettings:()=>{},onSignOut:()=>{}}));
  const a={role:'SUPERVISOR',business_type:'SINGLE_RESTAURANT',can_manage_stores:true,can_manage_members:true,permissions:{reports_view:true,data_export:true}};
  assert.match(render(a),/<strong>門市設定<\/strong>/);
  const b={...a,role:'STAFF',can_manage_stores:false,can_manage_members:false,permissions:{reports_view:false,data_export:false}};
  assert.doesNotMatch(render(b),/門市管理|營運資料|變更密碼/);
  assert.match(render(b),/個人設定/);
  assert.match(render(b),/>登出<\/button>/);
  assert.match(render({...b,permissions:{reports_view:true,data_export:false}}),/<strong>報表中心<\/strong>/);
});

async function readCssTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return readCssTree(entryPath);
      }
      return entry.name.endsWith(".css") ? readFile(entryPath, "utf8") : "";
    }),
  );
  return contents.join("\n");
}

test("receipt review renders all three lines and document fields only once", async () => {
  const { default: ReceiptReviewFields } = await vite.ssrLoadModule("/app/pilot/receipt-review-fields.tsx");
  const fields = [
    { id: "supplier", row_key: "document", field_name: "supplier_name", value: "原供應商" },
    { id: "c", row_key: "line-0003", field_name: "product", value: "第三項" },
    { id: "a", row_key: "line-0001", field_name: "product", value: "第一項" },
    { id: "q", row_key: "line-0002", field_name: "quantity", value: null },
    { id: "b", row_key: "line-0002", field_name: "product", value: "第二項" },
    { id: "zero", row_key: "line-0003", field_name: "quantity", value: 0 },
  ];
  const rendered = [];
  const html = renderToStaticMarkup(React.createElement(ReceiptReviewFields, {
    fields,
    renderField: f => { rendered.push(f); return React.createElement("button", { key: f.id }, f.value ?? "未提供"); },
  }));
  assert.equal((html.match(/原供應商/g) || []).length, 1);
  assert.equal((html.match(/aria-label="第 [123] 項"/g) || []).length, 3);
  assert.ok(html.indexOf("第一項") < html.indexOf("第二項"));
  assert.ok(html.indexOf("第二項") < html.indexOf("第三項"));
  assert.equal(rendered.length, fields.length);
  assert.equal(rendered.find(f => f.id === "q").value, null);
  assert.equal(rendered.find(f => f.id === "zero").value, 0);
  assert.deepEqual(rendered.map(f => f.id), ["supplier", "a", "b", "q", "c", "zero"]);
});

test("emits the catalog's animation and scrolling utilities", async () => {
  const css = await readCssTree(path.join(root, "dist"));

  assert.match(css, /--tw-enter-opacity/);
  assert.match(css, /scrollbar-width:\s*thin/);
  assert.match(css, /scrollbar-width:\s*none/);
  assert.match(css, /scrollbar-gutter:\s*stable/);
  assert.match(css, /scroll-fade-reveal-b/);
  assert.match(css, /mask-image:/);
  assert.match(css, /tw-shimmer/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("forwards progress semantics to the primitive", async () => {
  const { Progress } = await vite.ssrLoadModule("/components/ui/progress.tsx");
  const html = renderToStaticMarkup(React.createElement(Progress, { value: 37 }));

  assert.match(html, /aria-valuenow="37"/);
  assert.match(html, /aria-valuetext="37%"/);
  assert.match(html, /data-state="loading"/);
});

test("emits chart themes for the starter's media dark mode", async () => {
  const { ChartStyle } = await vite.ssrLoadModule("/components/ui/chart.tsx");
  const html = renderToStaticMarkup(
    React.createElement(ChartStyle, {
      id: "contract",
      config: {
        latency: { theme: { light: "#ffffff", dark: "#000000" } },
      },
    }),
  );

  assert.match(html, /\[data-chart=contract\]/);
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
  assert.doesNotMatch(html, /\.dark/);
});

test("renders sidebar skeletons deterministically", async () => {
  const { SidebarMenuSkeleton } = await vite.ssrLoadModule(
    "/components/ui/sidebar.tsx",
  );
  const first = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton));
  const second = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton));

  assert.equal(first, second);
  assert.match(first, /--skeleton-width:70%/);
});

test('expiry content preserves name-date-zone order and only field roles see urgent actions', async()=>{
 const {ExpiryFoodList}=await vite.ssrLoadModule('/app/pilot/expiry-waste-cards.tsx');
 const items=[{id:'a',name:'測試奶油',expires_on:'2026-09-09',zone_name:'冷藏區A',category:'urgent'}];
 const render=canOperate=>renderToStaticMarkup(React.createElement(ExpiryFoodList,{items,today:'2026-09-09',canOperate,onDiscard:()=>{},onUsed:()=>{}}));
 const html=render(true);
 assert.ok(html.indexOf('測試奶油')<html.indexOf('2026/09/09'));
 assert.ok(html.indexOf('2026/09/09')<html.indexOf('冷藏區A'));
 assert.match(html,/登記廢棄/);assert.match(html,/已使用完/);
 assert.doesNotMatch(render(false),/登記廢棄|已使用完/);
 const upcoming=renderToStaticMarkup(React.createElement(ExpiryFoodList,{items:[{...items[0],category:'upcoming'}],today:'2026-09-09',canOperate:true,onDiscard:()=>{},onUsed:()=>{}}));
 assert.doesNotMatch(upcoming,/登記廢棄|已使用完|目前不需操作/);
});

test('waste history gates delay audit and optional amounts without hiding actual quantities',async()=>{
 const {WasteHistoryRows,WasteDetail}=await vite.ssrLoadModule('/app/pilot/expiry-waste-cards.tsx');
 const rows=[{id:'a',name:'測試奶油',quantity:1.25,unit:'瓶',reason:'效期到期',store_name:'QA',actor_name:'小林',created_at:'2026-09-09T02:00:00Z',delay_reason:'交接遺漏',reference_amount:null,source:'EXPIRY'}];
 const render=(audit,showAmount)=>renderToStaticMarkup(React.createElement(WasteHistoryRows,{rows,audit,showAmount}));
 assert.match(render(false,false),/1.25 瓶/);
 assert.doesNotMatch(render(false,false),/交接遺漏|參考金額/);
 assert.doesNotMatch(render(true,true),/完整紀錄|交接遺漏|參考金額/);
 const detail=renderToStaticMarkup(React.createElement(WasteDetail,{row:rows[0],audit:true,showAmount:true}));
 assert.match(detail,/交接遺漏/);assert.match(detail,/未提供/);
 assert.doesNotMatch(render(true,true),/NT\$0/);
});


test('desktop admin shell is reserved for independent restaurant logistics while all roles remain mobile-first otherwise', async()=>{
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://hewanlhkyzptbdbrvtpl.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||= 'ci-placeholder-publishable-key';
  const {FormalAppShell}=await vite.ssrLoadModule('/app/pilot/app-shell.tsx');
  const render=(role,businessType)=>renderToStaticMarkup(React.createElement(FormalAppShell,{
    role,businessType,storeName:'測試店',stores:[{id:'s1',name:'測試店'}],storeId:'s1',
    onStoreChange:()=>{},view:'home',activeView:'home',onNavigate:()=>{}
  },React.createElement('div',null,'內容')));
  assert.match(render('LOGISTICS','SINGLE_RESTAURANT'),/admin-web-shell/);
  assert.match(render('LOGISTICS','SINGLE_RESTAURANT'),/行政後勤導覽/);
  for(const role of ['STAFF','SUPERVISOR','OWNER'])assert.doesNotMatch(render(role,'SINGLE_RESTAURANT'),/admin-web-shell/);
  for(const role of ['STAFF','SUPERVISOR','LOGISTICS','OWNER'])assert.doesNotMatch(render(role,'CHAIN_RESTAURANT'),/admin-web-shell/);
});


test('chain-only onboarding resumes old independent drafts at brand confirmation',async()=>{
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://hewanlhkyzptbdbrvtpl.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||= 'ci-placeholder-publishable-key';
  const {default:OwnerSetup}=await vite.ssrLoadModule('/app/pilot/owner-setup.tsx');
  for(const step of ['business','store','manager']){
    const initial={required:true,step,revision:4,draft:{organization_name:'既有品牌',business_type:'SINGLE_RESTAURANT',store_mode:'SINGLE',store_name:'第一店',store_code:'TEST01',staff_login_mode:'NAME_OR_NICKNAME',work_role:'OWNER'}};
    const html=renderToStaticMarkup(React.createElement(OwnerSetup,{initial,email:'test@example.invalid',onComplete:async()=>{},onSignOut:async()=>{}}));
    assert.match(html,/id="owner-business"/);
    assert.match(html,/既有品牌/);
    assert.match(html,/連鎖餐飲/);
    assert.doesNotMatch(html,/獨立餐廳|name="business_type"|完成設定並進入序/);
    assert.equal(initial.draft.business_type,'SINGLE_RESTAURANT');
  }
});

test('independent memberships do not open the chain workspace or get converted',async()=>{
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://hewanlhkyzptbdbrvtpl.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||= 'ci-placeholder-publishable-key';
  const {default:Workspace}=await vite.ssrLoadModule('/app/pilot/authenticated-workspace.tsx');
  const stores=[{id:'old-store',business_type:'SINGLE_RESTAURANT',role:'OWNER'}];
  const html=renderToStaticMarkup(React.createElement(Workspace,{session:{user:{id:'user'}},profile:{display_name:'Test',role:'OWNER'},stores,selectedStoreId:'old-store',onSignOut:async()=>{}}));
  assert.match(html,/目前沒有連鎖餐飲門市/);
  assert.match(html,/返回登入/);
  assert.equal(stores[0].business_type,'SINGLE_RESTAURANT');
});

test('Xu inventory release has only count and settings navigation for each chain role',async()=>{
  const {FormalAppShell}=await vite.ssrLoadModule('/app/pilot/app-shell.tsx');
  for(const role of ['STAFF','SUPERVISOR','LOGISTICS','OWNER']){
    const html=renderToStaticMarkup(React.createElement(FormalAppShell,{
      role,businessType:'CHAIN_RESTAURANT',inventoryOnly:true,
      storeName:'試行店',stores:[{id:'a',name:'試行店'},{id:'b',name:'二店'}],storeId:'a',
      view:'count',activeView:'home',onStoreChange:()=>{},onNavigate:()=>{}
    }));
    const nav=html.match(/<nav class="shell-bottom-nav"[\s\S]*?<\/nav>/)[0];
    assert.equal((nav.match(/<button/g)||[]).length,2);
    assert.match(nav,/>盤點<\/span>/);assert.match(nav,/>設定<\/span>/);
    assert.doesNotMatch(nav,/待辦|通知|進貨|成本/);
    assert.match(html,/aria-label="目前門市"/);
  }
});

test('Xu inventory entry retains count engine and suppresses unrelated in-count actions',async()=>{
  const {default:CountWorkspace}=await vite.ssrLoadModule('/app/pilot/count-workspace.tsx');
  const html=renderToStaticMarkup(React.createElement(CountWorkspace,{
    stores:[{id:'store-a',name:'試行店',store_code:'A'}],organizationId:'org-a',
    session:{user:{id:'user-a'}},inventoryOnly:true,businessType:'CHAIN_RESTAURANT',
    canManage:true,canImport:true,canViewFullDetails:true,onBack:()=>{}
  }));
  assert.match(html,/本次盤點/);assert.match(html,/盤點歷史/);
  assert.doesNotMatch(html,/加入效期提醒|分區與解凍/);
});
