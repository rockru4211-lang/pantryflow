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
 const {WasteHistoryRows}=await vite.ssrLoadModule('/app/pilot/expiry-waste-cards.tsx');
 const rows=[{id:'a',name:'測試奶油',quantity:1.25,unit:'瓶',reason:'效期到期',store_name:'QA',actor_name:'小林',created_at:'2026-09-09T02:00:00Z',delay_reason:'交接遺漏',reference_amount:null,source:'EXPIRY'}];
 const render=(audit,showAmount)=>renderToStaticMarkup(React.createElement(WasteHistoryRows,{rows,audit,showAmount}));
 assert.match(render(false,false),/1.25 瓶/);
 assert.doesNotMatch(render(false,false),/交接遺漏|參考金額/);
 assert.match(render(true,true),/交接遺漏/);assert.match(render(true,true),/參考金額未提供/);
 assert.doesNotMatch(render(true,true),/NT\$0/);
});
