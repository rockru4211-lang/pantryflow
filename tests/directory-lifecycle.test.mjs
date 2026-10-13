import test from 'node:test';
import assert from 'node:assert/strict';
import {directoryState,lifecycleOperations,lifecycleConfirmation} from '../lib/directory-lifecycle.ts';
import {supplierImport} from '../lib/supplier-directory.ts';
import {prepareAdministrativeImport,contractDue} from '../lib/administrative-directory.ts';
test('removed is distinct from inactive; all directories share allowed transitions',()=>{
 assert.equal(directoryState({is_active:true}),'使用中');assert.equal(directoryState({archived:true}),'已停用');
 assert.equal(directoryState({is_removed:true,is_active:false}),'已移除');
 assert.deepEqual(lifecycleOperations('使用中'),['deactivate','remove']);
 assert.deepEqual(lifecycleOperations('已停用'),['activate','remove']);
 assert.deepEqual(lifecycleOperations('已移除'),['restore']);
 assert.deepEqual(lifecycleOperations('已移除',true),['restore','delete']);
 assert.match(lifecycleConfirmation('供應商','remove',true),/兩店共用/);
});
test('reimport never revives removed or paused supplier identities',()=>{
 const s={id:'one',name:'甲供應商',is_active:false,is_removed:true,updated_at:'2026-10-13',aliases:[]};
 assert.deepEqual(supplierImport([{'供應商名稱':s.name,'合作狀態':'常用'}],[s]),[]);
 const drafts=supplierImport([{'供應商名稱':s.name,'合作狀態':'常用'},{'供應商名稱':'乙供應商'}],[{...s,is_removed:false}]);
 assert.equal(drafts.length,2);assert.equal(drafts[0].id,s.id);assert.equal(drafts[0].is_active,false);assert.equal(drafts[1].is_active,true);
 const partial=supplierImport([{'供應商名稱':s.name},{'供應商名稱':'乙供應商'}],[s]);assert.equal(partial.length,1);assert.equal(partial[0].name,'乙供應商');
});
test('removed equipment stays deduplicated and inactive contracts stop due reminders',()=>{
 const row={id:'one',name:'冰箱',category:'設備資料',summary:'',link:'',note:'',archived:true,is_removed:true,revision:3};
 assert.equal(prepareAdministrativeImport([{'資料名稱':'冰箱'}],[row],()=> 'new').rows.length,0);
 assert.equal(row.revision,3);assert.equal(row.is_removed,true);
 assert.equal(contractDue({...row,category:'合約文件',contract_end:'2026-10-13'},'2026-10-13'),false);
});

test('exported lifecycle states preserve first import and skip removed rows',()=>{
 const suppliers=supplierImport([{'供應商名稱':'甲','使用狀態':'已移除'},{'供應商名稱':'乙','使用狀態':'已停用'}],[]);
 assert.equal(suppliers.length,1);assert.equal(suppliers[0].is_active,false);
 const docs=prepareAdministrativeImport([{'資料名稱':'甲','狀態':'已移除'},{'資料名稱':'乙','狀態':'已停用'}],[],()=> 'new');
 assert.equal(docs.skipped,1);assert.equal(docs.rows.length,1);assert.equal(docs.rows[0].archived,true);
});
