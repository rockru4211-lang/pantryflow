import fs from 'node:fs';import assert from 'node:assert/strict';import{execFileSync}from'node:child_process';
const contract=JSON.parse(fs.readFileSync('release-source.json','utf8'));
assert.equal(contract.deploymentProvider,'cloudflare');
assert.equal(contract.appUrl,'https://pantryflow.rockru4211.workers.dev/');
for (const path of ['app/manifest.ts','app/layout.tsx','lib/auth-flow.ts','supabase/config.toml','legacy-redirect/index.html']) {
 const source=fs.readFileSync(path,'utf8');
 assert(source.includes(contract.appUrl.replace(/\/$/,'')),`${path} must use the production App URL`);
 assert(!source.includes('pantryflow-app-shell-preview.rockru4211.chatgpt.site'),`${path} still points to the retired preview`);
}
assert(fs.existsSync('app/pilot/pilot-client.tsx'));assert(!fs.existsSync('pilot-v1'));
assert(fs.readFileSync('lib/supabase-browser.ts','utf8').includes(contract.supabaseProject));
const pages=fs.readFileSync('.github/workflows/deploy-pages.yml','utf8');
assert(pages.includes('path: legacy-redirect'));assert(!pages.includes('path: pilot-v1'));
const migrations=fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql'));
assert(migrations.length>27);assert.equal(new Set(migrations.map(x=>x.slice(0,14))).size,migrations.length);
if(process.argv.includes('--release')){
 assert.equal(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),'','Release tree must be clean');
 const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 for(const [repository,branch]of[[contract.canonicalRepository,contract.canonicalBranch]]){
  const remote=execFileSync('git',['ls-remote',repository,`refs/heads/${branch}`],{encoding:'utf8'}).trim().split(/\s/)[0];
  assert.equal(remote,sha,'Release source differs from published branch');
 }
 if(process.env.NEXT_PUBLIC_BUILD_SHA)assert.equal(process.env.NEXT_PUBLIC_BUILD_SHA,sha);
 console.log('Exact canonical source SHA verified in GitHub (Cloudflare deployment must be checked separately):',sha);
}else console.log('Source contract and migration inventory verified:',migrations.length,'migrations');
