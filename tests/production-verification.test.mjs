import test from 'node:test';
import assert from 'node:assert/strict';
import {assetReferences,verifyProduction} from '../scripts/verify-production.mjs';

const origin='https://app.example/';
const sha='a'.repeat(40);
function fixture(overrides={}) {
  const pages={
    '/':{body:'<script src="/assets/authenticated-workspace-A1.js"></script>',type:'text/html',cache:'no-store'},
    '/assets/authenticated-workspace-A1.js':{body:`const sha="${sha}";import("./pdf-B2.js");const worker="/assets/pdf.worker.min-C3.mjs";`,type:'application/javascript'},
    '/assets/pdf-B2.js':{body:'export const parser=true;',type:'text/javascript'},
    '/assets/pdf.worker.min-C3.mjs':{body:'const worker=true;',type:'application/javascript'},
    ...overrides,
  };
  const requests=[];
  const fetcher=async url=>{
    requests.push(url);
    const page=pages[new URL(url).pathname];
    return new Response(page?.body||'missing',{status:page?.status||(!page?404:200),headers:{'content-type':page?.type||'text/plain','cache-control':page?.cache||'public,max-age=31536000'}});
  };
  return {requests,run:()=>verifyProduction({appUrl:origin,expectedSha:sha,fetcher})};
}
test('verifies the served commit and nested PDF modules without calling APIs',async()=>{
  const f=fixture();assert.equal((await f.run()).assets,3);
  assert(f.requests.every(url=>url===origin||new URL(url).pathname.startsWith('/assets/')));
});
test('rejects stale HTML, wrong version, missing worker and HTML fallback',async()=>{
  for(const [overrides,error] of [
    [{'/' :{body:'<script src="/assets/authenticated-workspace-A1.js"></script>',type:'text/html',cache:'max-age=3600'}},/discover current asset names/],
    [{'/assets/authenticated-workspace-A1.js':{body:'const sha="old";import("./pdf-B2.js");const w="/assets/pdf.worker.min-C3.mjs";',type:'text/javascript'}},/different source commit/],
    [{'/assets/pdf.worker.min-C3.mjs':{body:'missing',type:'text/plain',status:404}},/HTTP 404/],
    [{'/assets/pdf-B2.js':{body:'<!doctype html><html>fallback</html>',type:'text/html'}},/Wrong content type/],
  ])await assert.rejects(fixture(overrides).run,error);
});
test('follows only local static assets and deduplicates cyclic module references',async()=>{
  assert.deepEqual(assetReferences('"https://evil.example/assets/run.js";"./../../api/delete.js";"./pdf.worker.mjs";"./pdf-B2.js"',origin+'assets/workspace.js'),[origin+'assets/pdf-B2.js']);
  const f=fixture({'/assets/pdf-B2.js':{body:'import("./authenticated-workspace-A1.js");',type:'text/javascript'}});
  assert.equal((await f.run()).assets,3);assert.equal(f.requests.length,4);
});
