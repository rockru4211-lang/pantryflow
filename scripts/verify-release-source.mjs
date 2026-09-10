import fs from 'node:fs';import assert from 'node:assert/strict';import{execFileSync}from'node:child_process';
const contract=JSON.parse(fs.readFileSync('release-source.json','utf8'));
const hosting=JSON.parse(fs.readFileSync('.openai/hosting.json','utf8'));
assert.equal(hosting.project_id,contract.siteProjectId);
assert(fs.existsSync('app/pilot/pilot-client.tsx'));assert(!fs.existsSync('pilot-v1'));
assert(fs.readFileSync('lib/supabase-browser.ts','utf8').includes(contract.supabaseProject));
const pages=fs.readFileSync('.github/workflows/deploy-pages.yml','utf8');
assert(pages.includes('path: legacy-redirect'));assert(!pages.includes('path: pilot-v1'));
const migrations=fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql'));
assert(migrations.length>27);assert.equal(new Set(migrations.map(x=>x.slice(0,14))).size,migrations.length);
if(process.argv.includes('--release')){
 assert.equal(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),'','Release tree must be clean');
 const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 for(const [repository,branch]of[[contract.canonicalRepository,contract.canonicalBranch],[contract.siteRepository,contract.siteBranch]]){
  const remote=execFileSync('git',['ls-remote',repository,`refs/heads/${branch}`],{encoding:'utf8'}).trim().split(/\s/)[0];
  assert.equal(remote,sha,'Release source differs from published branch');
 }
 if(process.env.NEXT_PUBLIC_BUILD_SHA)assert.equal(process.env.NEXT_PUBLIC_BUILD_SHA,sha);
 console.log('Exact source SHA verified in GitHub and Sites:',sha);
}else console.log('Source contract and migration inventory verified:',migrations.length,'migrations');
