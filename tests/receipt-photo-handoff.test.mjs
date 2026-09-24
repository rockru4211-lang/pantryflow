import {test} from 'node:test';
import assert from 'node:assert/strict';
import {receiptPhotoIssues} from '../lib/receipt-photo-quality.ts';

test('only explicit physical defects on supplied photos request retakes',()=>{
 assert.deepEqual(receiptPhotoIssues([
  {page:1,reason:'BLUR',confidence:.99},{page:2,reason:'GLARE',confidence:.95},
  {page:3,reason:'MISSING_PRICE',confidence:1},{page:4,reason:'OCR_FAILED',confidence:1},
  {page:5,reason:'CROPPED',confidence:.6},{page:99,reason:'CROPPED',confidence:1},
  {page:1,reason:'BLUR',confidence:.99},null,
 ],[1,2,3,4,5]),[{page:1,reason:'BLUR'},{page:2,reason:'GLARE'}]);
});
test('missing quality metadata and malformed provider responses never demand retakes',()=>{
 for(const value of [undefined,null,'bad json',{},[{page:'1',reason:'BLUR',confidence:1}],[{page:1,reason:'toString',confidence:1}],[{page:1,reason:'GLARE',confidence:'1'}]])assert.deepEqual(receiptPhotoIssues(value,[1]),[]);
});
test('PDFs and unavailable pages are excluded by the caller-supplied source list',()=>{
 assert.deepEqual(receiptPhotoIssues([{page:1,reason:'CROPPED',confidence:.95}],[]),[]);
});

test('actual staff and supervisor receipt routes expose only upload and retakes, including stale detail links',async()=>{
 const React=(await import('react')).default;
 const {renderToStaticMarkup}=await import('react-dom/server');
 const {createServer}=await import('vite');
 const {fileURLToPath}=await import('node:url');
 const root=fileURLToPath(new URL('..',import.meta.url));
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://qckwzwyeqpuqogbydvvl.supabase.co';
 process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='ci-placeholder-publishable-key';
 const vite=await createServer({appType:'custom',configFile:false,root,resolve:{alias:{'@':root}},server:{middlewareMode:true,hmr:false}});
 try{
  const {default:Entry}=await vite.ssrLoadModule('/app/pilot/receiving-workspace.tsx');
  for(const role of ['STAFF','SUPERVISOR'])for(const initialPage of ['list','upload','status','review','published']){
   const html=renderToStaticMarkup(React.createElement(Entry,{storeId:'store',organizationId:'org',userId:'user',role,businessType:'SINGLE_RESTAURANT',initialPage,initialBatchId:'old-receipt',onBack:()=>{}}));
   assert.match(html,/拍照／選取貨單/);assert.match(html,/需要重拍/);
   assert.doesNotMatch(html,/核對收貨|確認收貨|貨單紀錄|AI 識別中|單價|開始核對/);
  }
 }finally{await vite.close();}
});
