import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {parseRecipeText} from '../lib/recipe-model.ts';
const source=readFileSync(new URL('../supabase/functions/process-recipe-image/index.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
function setup({authenticated=true,allowed=true,readonly=false,upstream=200}={}){
 let handler,calls=0;
 const client={auth:{getUser:async()=>({data:{user:authenticated?{id:'test'}:null}})},rpc:async name=>name==='recipe_organization'?{error:allowed?null:{message:'denied'}}:{data:{stores:[{id:'00000000-0000-0000-0000-000000000001',access_mode:readonly?'VIEW':'EDIT'}]}}};
 const deno={env:{get:key=>key==='GEMINI_API_KEY'?'fixture-key':'fixture'},serve:fn=>{handler=fn;}};
 const fetcher=async()=>{calls++;return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({text:'【測試食譜】\n麵粉 | 400 | g | '})}]}}]}),{status:upstream});};
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 new Function('createClient','Deno','corsHeaders','jsonResponse','fetch',js)(()=>client,deno,{},(body,status=200)=>new Response(JSON.stringify(body),{status}),fetcher);
 const request=(bytes=[255,216,255,1])=>{const form=new FormData();form.append('storeId','00000000-0000-0000-0000-000000000001');form.append('file',new Blob([new Uint8Array(bytes)],{type:'image/jpeg'}),'recipe.jpg');return new Request('https://example.invalid',{method:'POST',body:form});};
 return {run:()=>handler(request()),calls:()=>calls,invalid:()=>handler(request([1,2,3]))};
}
test('image OCR denies anonymous, cross-store, and view-only requests before model calls',async()=>{for(const options of [{authenticated:false},{allowed:false},{readonly:true}]){const h=setup(options),r=await h.run();assert.ok([401,403].includes(r.status));assert.equal(h.calls(),0);}});
test('image OCR validates bytes, returns editable text and explains quota failures',async()=>{const h=setup();assert.equal((await h.invalid()).status,400);assert.equal(h.calls(),0);const result=await h.run();assert.equal(result.status,200);assert.match((await result.json()).text,/圖片辨識草稿/);const quota=await setup({upstream:429}).run();assert.equal(quota.status,429);assert.match((await quota.json()).message,/額度/);});
test('OCR material rows keep unknown quantities and unusual units without invented amounts',()=>{const [doc]=parseRecipeText('【測試】\n麵粉 | 400 | g | \n鹽 | | 茶匙 | 字跡不清\n水 | 0.5 | L | ','測試');assert.equal(doc.lines.length,3);assert.equal(doc.lines[0].quantity,'400');assert.equal(doc.lines[1].quantity,'');assert.equal(doc.lines[1].unit,'茶匙');assert.match(doc.lines[1].note,/需核對/);});
