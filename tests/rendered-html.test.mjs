import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders the formal application without preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.doesNotMatch(html, developmentPreviewMeta);
  assert.match(html, /序｜餐飲庫存管理/);
});

test('the public demo renders its identity picker without a login or session', async () => {
  const {default:worker}=await import('../dist/server/index.js');
  const response=await worker.fetch(new Request('http://localhost/demo',{headers:{accept:'text/html'}}),{ASSETS:{fetch:async()=>new Response('Not found',{status:404})}},{waitUntil(){},passThroughOnException(){}});
  assert.equal(response.status,200);
  const html=await response.text();
  assert.match(html,/不需帳號、門市代號或 PIN/);
  assert.match(html,/開始體驗/);
  for(const label of ['獨立餐廳','連鎖餐飲','員工','主管','行政／後勤','老闆'])assert.ok(html.includes(label),label);
  assert.doesNotMatch(html,/access_token|refresh_token|type="password"/);
});
