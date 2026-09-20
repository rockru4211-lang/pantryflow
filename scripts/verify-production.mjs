import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

// Read public static assets only. Never sign in, upload a file or invoke OCR.
export function assetReferences(source,baseUrl) {
  const base=new URL(baseUrl);
  const found=new Set();
  // Follow Vite build assets, not library defaults such as unused pdf.worker.mjs.
  for(const match of source.matchAll(/["'`]((?:\.\/|\/?assets\/)[A-Za-z0-9_./-]+-[A-Za-z0-9_-]+\.(?:m?js|css))["'`]/g)) {
    const path=match[1].startsWith('assets/')?'/'+match[1]:match[1];
    const url=new URL(path,base);
    if(url.origin===base.origin&&url.pathname.startsWith('/assets/'))found.add(url.href);
  }
  return [...found];
}

export async function verifyProduction({appUrl,expectedSha,fetcher=fetch}) {
  assert.match(expectedSha,/^[a-f0-9]{40}$/,'A full tested commit SHA is required');
  const origin=new URL(appUrl);
  assert.equal(origin.protocol,'https:','Production verification requires HTTPS');
  const read=async(url,kind)=>{
    const response=await fetcher(url,{headers:{'Cache-Control':'no-cache','Accept':kind==='html'?'text/html':'*/*'},redirect:'error',signal:AbortSignal.timeout(15000)});
    assert.equal(response.status,200,`Cannot load ${url}: HTTP ${response.status}`);
    const type=response.headers.get('content-type')||'';
    assert.match(type,kind==='html'?/text\/html/i:kind==='css'?/text\/css/i:/(?:javascript|ecmascript)/i,`Wrong content type for ${url}: ${type}`);
    if(kind==='html')assert.match(response.headers.get('cache-control')||'',/(?:^|[,\s])no-store(?:$|[,\s])/i,'App HTML must discover current asset names');
    const text=await response.text();
    assert(text.trim().length>0,`Empty response: ${url}`);
    assert(!/^\s*(?:<!doctype|<html)/i.test(text)||kind==='html',`HTML fallback returned for module ${url}`);
    return text;
  };
  const html=await read(origin.href,'html');
  const queue=assetReferences(html,origin.href);
  assert(queue.some(url=>/\/authenticated-workspace-[^/]+\.js$/.test(url)),'The production workspace asset is missing');
  const checked=new Map();
  while(queue.length) {
    const url=queue.shift();
    if(checked.has(url))continue;
    assert(checked.size<100,'Unexpected asset graph: more than 100 files');
    const source=await read(url,url.endsWith('.css')?'css':'js');
    checked.set(url,source);
    queue.push(...assetReferences(source,url).filter(ref=>!checked.has(ref)));
  }
  const workspace=[...checked].find(([url])=>/\/authenticated-workspace-[^/]+\.js$/.test(url));
  assert(new RegExp(`(?<![a-f0-9])${expectedSha}(?![a-f0-9])`).test(workspace[1]),'Production is serving a different source commit');
  assert([...checked.keys()].some(url=>/\/pdf-[^/]+\.js$/.test(url)),'PDF parser was not found in the deployed asset graph');
  assert([...checked.keys()].some(url=>/\/pdf\.worker\.min-[^/]+\.mjs$/.test(url)),'PDF worker was not found in the deployed asset graph');
  return {url:origin.href,sha:expectedSha,workspace:workspace[0],assets:checked.size};
}

async function main() {
  const contract=JSON.parse(await readFile(new URL('../release-source.json',import.meta.url),'utf8'));
  const expectedSha=process.env.EXPECTED_BUILD_SHA||'';
  const attempts=Number(process.env.PRODUCTION_VERIFY_ATTEMPTS||'1');
  assert(Number.isInteger(attempts)&&attempts>=1&&attempts<=6,'Invalid verification attempt limit');
  for(let attempt=1;attempt<=attempts;attempt++) {
    try { console.log(JSON.stringify(await verifyProduction({appUrl:contract.appUrl,expectedSha})));return; }
    catch(error) {
      if(attempt===attempts)throw error;
      console.warn(`Deployment is not ready (${attempt}/${attempts}): ${error.message}`);
      await new Promise(resolve=>setTimeout(resolve,10000));
    }
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
