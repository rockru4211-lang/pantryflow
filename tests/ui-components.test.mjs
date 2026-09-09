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
