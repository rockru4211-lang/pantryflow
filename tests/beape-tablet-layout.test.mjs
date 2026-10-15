import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {usesUnifiedMobile} from '../lib/mobile-workflow.ts';
const source=readFileSync('app/pilot/use-desktop-admin.ts','utf8');
const compiled=ts.transpileModule(source.replace("import {useSyncExternalStore} from 'react';",''),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function device(width,touch){
 let subscribed,removed;
 const media={matches:false,addEventListener:(name,fn)=>{assert.equal(name,'change');subscribed=fn;},removeEventListener:(name,fn)=>{assert.equal(name,'change');removed=fn;}};
 const scope={exports:{},window:{matchMedia(query){assert.match(query,/min-width:900px/);assert.match(query,/hover:hover/);assert.match(query,/pointer:fine/);media.matches=width>=900&&!touch;return media;}},useSyncExternalStore(subscribe,getSnapshot){const unsubscribe=subscribe(()=>{});const result=getSnapshot();unsubscribe();assert.equal(subscribed,removed);return result;}};
 runInNewContext(compiled,scope);return scope.exports.useDesktopAdmin();
}
test('tablet portrait, landscape, reload and rotation keep the BeApe field workspace',()=>{
 for(const width of [768,820,1024,1180,1366,820]){
  const desktop=device(width,true);assert.equal(desktop,false);
  for(const role of ['STAFF','SUPERVISOR','LOGISTICS','OWNER'])assert.equal(usesUnifiedMobile(desktop,role,'SINGLE_RESTAURANT'),true);
  assert.equal(usesUnifiedMobile(desktop,'ADMIN'),false);
  assert.equal(usesUnifiedMobile(desktop,'STAFF','CHAIN_RESTAURANT'),false);
 }
 assert.equal(device(1440,false),true);assert.equal(device(390,true),false);
});
test('tablet CSS follows touch capabilities for home, navigation, cards and work pages',()=>{
 for(const file of ['mobile-work-home.css','mobile-work-pages.css','mobile-special-work.css']){
  const css=readFileSync('app/pilot/'+file,'utf8');
  assert.match(css,/@media screen and \(max-width:899px\), screen and \(hover:none\), screen and \(pointer:coarse\)/);
 }
 const css=readFileSync('app/pilot/mobile-work-home.css','utf8');assert.match(css,/phone-app\[data-unified-mobile=true\]:not\(\.auth-phone\)\{height:100dvh;max-height:none/);
});
test('BeApe public branding and deployment contract remain distinct from Xu',()=>{
 const release=JSON.parse(readFileSync('release-source.json','utf8'));
 assert.equal(release.canonicalBranch,'beape');assert.equal(release.workerName,'beape-ops');
 for(const file of ['app/layout.tsx','app/demo/page.tsx','app/demo/demo-experience.tsx','app/pilot/reports-workspace.tsx','app/pilot/receiving-workspace.tsx','app/pilot/expiry-waste-workspace.tsx']){
  const text=readFileSync(file,'utf8');assert.doesNotMatch(text,/序｜|序如何|序只|序保存|`序-\$/);
 }
});
