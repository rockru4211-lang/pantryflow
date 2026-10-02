import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {verifyProduction} from './verify-production.mjs';

// Reuse the full exact-SHA/JS/CSS/PDF verification without fetching assets twice.
export async function verifyReceiptAccountingProduction({expectedSha,fetcher=fetch}) {
 const sources=[];
 const result=await verifyProduction({appUrl:'https://beape-ops.rockru4211.workers.dev/',expectedSha,fetcher:async(url,options)=>{
  const response=await fetcher(url,options);
  if(/\/assets\//.test(String(url)))sources.push(await response.clone().text());
  return response;
 }});
 const text=sources.join('\n');
 for(const marker of ['get_baihuayuan_receipt_accounting','save_baihuayuan_receipt_reconciliation','receipt-account-tabs','receipt-account-metrics','receipt-account-group','receipt-account-dialog'])assert(text.includes(marker),`Deployed receipt accounting feature missing: ${marker}`);
 return {...result,receiptAccountingAssets:true};
}
async function main(){
 const expectedSha=process.env.EXPECTED_BUILD_SHA||'';
 const attempts=Number(process.env.PRODUCTION_VERIFY_ATTEMPTS||'1');
 assert(Number.isInteger(attempts)&&attempts>=1&&attempts<=6,'Invalid verification attempt limit');
 for(let attempt=1;attempt<=attempts;attempt++){
  try{console.log(JSON.stringify(await verifyReceiptAccountingProduction({expectedSha})));return;}
  catch(error){if(attempt===attempts)throw error;console.warn(`Release not ready (${attempt}/${attempts}): ${error.message}`);await new Promise(resolve=>setTimeout(resolve,10000));}
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
