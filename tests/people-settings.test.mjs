import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as access from '../lib/store-access.ts';
const source=readFileSync(new URL('../lib/people-settings.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const exports={};new Function('exports','require',compiled)(exports,name=>{assert.equal(name,'./store-access');return access;});
const {personDraft,personChanges,personTitle,filterPeople,hasPersonChanges}=exports;
const p={user_id:'staff',display_name:'小明',is_owner:false,company_member:false,company_title:null,role:'SUPERVISOR',revision:'v1',can_manage_access:true,can_edit_profile:true,can_grant_export:false,access_store_ids:['a','b'],allowed_titles:['主管','員工'],stores:[{id:'a',name:'BeApe',role:'SUPERVISOR',access_mode:'EDIT'},{id:'x',name:'Other',role:'STAFF',access_mode:'VIEW'}]};
test('one person retains different store roles until explicitly changed',()=>{
 const draft=personDraft(p);assert.equal(personTitle(p),'依各店設定');assert.equal(hasPersonChanges(p,draft),false);
 const result=personChanges(p,{...draft,access:{...draft.access,b:'VIEW',x:'NONE'}});
 assert.equal(result.profile,null);assert.deepEqual(result.access,[{store_id:'b',access_mode:'VIEW'}]);assert.equal(draft.access.x,'VIEW');
});
test('name and store edits form one patch without changing credentials or optional grants',()=>{
 const draft=personDraft(p);const result=personChanges(p,{...draft,name:' 小明主管 ',access:{...draft.access,b:'VIEW'}});
 assert.deepEqual(result.profile,{display_name:'小明主管',title:'依各店設定',export_mode:'KEEP'});
 assert.equal(result.access.length,1);assert(!('login_identifier' in result.profile));
});
test('locked owners and current users cannot emit profile or access writes',()=>{
 const locked={...p,is_owner:true,can_edit_profile:false,can_manage_access:false};
 assert.deepEqual(personChanges(locked,{...personDraft(locked),name:'changed',access:{a:'NONE'}}),{profile:null,access:[]});
});
test('search and store filter show each cross-store person only once',()=>{
 const rows=[{...p,user_id:'r',display_name:'RuRu',stores:[{id:'a'},{id:'b'}]},p];
 assert.deepEqual(filterPeople(rows,'rUr','b').map(x=>x.user_id),['r']);assert.equal(filterPeople(rows,'','a').length,2);assert.equal(filterPeople(rows,'無人','ALL').length,0);
});

test('removed people leave the active list but remain searchable under their historical stores',()=>{
 const removed={...p,user_id:'removed',is_removed:true,stores:[],removed_stores:[{id:'b'}]};
 assert.deepEqual(filterPeople([p,removed],'','ALL').map(x=>x.user_id),[p.user_id]);
 assert.deepEqual(filterPeople([p,removed],'','b',true).map(x=>x.user_id),['removed']);
 assert.equal(filterPeople([removed],'','a',true).length,0);
});
test('every pending store needs its own eligible handoff recipient',()=>{
 const person={...p,removal_stores:[{id:'a',pending_count:1,handoff_candidates:[{user_id:'next'}]},{id:'b',pending_count:2,handoff_candidates:[{user_id:'other'}]}]};
 assert.equal(exports.personHandoffs(person,{}),null);
 assert.equal(exports.personHandoffs(person,{a:'next'}),null);
 assert.equal(exports.personHandoffs(person,{a:'next',b:'next'}),null);
 assert.equal(exports.personHandoffs(person,{a:person.user_id,b:'other'}),null);
 assert.deepEqual(exports.personHandoffs(person,{a:'next',b:'other',outside:'intruder'}),[{store_id:'a',user_id:'next'},{store_id:'b',user_id:'other'}]);
 assert.deepEqual(exports.personHandoffs({...p,removal_stores:[{id:'a',pending_count:0,handoff_candidates:[]}]},{}),[]);
});

test('personnel search includes active and removed login identifiers',()=>{
 const active={...p,stores:[{id:'a',login_identifier:'XM-007'}]};
 const removed={...p,is_removed:true,stores:[],removed_stores:[{id:'b',login_identifier:'OLD-007'}]};
 assert.equal(filterPeople([active],'xm-007','a').length,1);
 assert.equal(filterPeople([removed],'old-007','b',true).length,1);
 assert.equal(filterPeople([removed],'old-007','b').length,0);
});
test('PIN state never assumes that a PIN-login identity has activated',()=>{
 assert.equal(exports.personPinLabel({...p,pin_status:'SET'}),'PIN 已設定');
 assert.equal(exports.personPinLabel({...p,pin_status:'UNSET'}),'尚未設定 PIN');
 assert.equal(exports.personPinLabel({...p,pin_status:'OTHER'}),'帳號登入');
 assert.equal(exports.personPinLabel({...p,stores:[{uses_pin:true}]}),'狀態未確認');
});
