import test from 'node:test';
import assert from 'node:assert/strict';
import {countRecoveryKey,writeCountRecovery,readCountRecovery,countSyncState,countAuthRequired} from '../lib/count-sync-state.ts';
const memory=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};};
test('recovery keeps blanks, zero, notes, versions and retry identity isolated by user/store/session',()=>{
 const storage=memory(),key=countRecoveryKey('a','store','count');
 const value={drafts:{'dry:flour':{quantity:'0',note:'empty'},'kitchen:flour':{quantity:'',note:'not counted'}},versions:{'dry:flour':'v1','kitchen:flour':null},requests:[['payload','retry-id']],zone:'dry'};
 assert.equal(writeCountRecovery(storage,key,value),true);
 assert.deepEqual(readCountRecovery(storage,key),value);
 for(const args of [['b','store','count'],['a','other','count'],['a','store','next']])assert.equal(readCountRecovery(storage,countRecoveryKey(...args)),null);
 assert.equal(writeCountRecovery(storage,key,{...value,drafts:{}}),true);assert.equal(readCountRecovery(storage,key),null);
});
test('unavailable or corrupt storage is not reported as a safely preserved draft',()=>{
 const storage={getItem:()=>'{broken',setItem:()=>{throw Error('quota');},removeItem:()=>{throw Error('blocked');}};
 assert.throws(()=>readCountRecovery(storage,'key'));
 assert.equal(writeCountRecovery(storage,'key',{drafts:{'z:p':{quantity:'3',note:''}}}),false);
});
test('the quiet indicator never labels unacknowledged input as synced',()=>{
 const baseline={pending:0,invalid:false,failed:false,unavailable:false,auth:false,ready:true,storageFailed:false};
 assert.deepEqual(countSyncState(baseline),{label:'✓ 已同步',attention:false});
 assert.deepEqual(countSyncState({...baseline,pending:3}),{label:'待同步 3 筆',attention:false});
 assert.deepEqual(countSyncState({...baseline,pending:3,failed:true}),{label:'待同步 3 筆',attention:true});
 assert.equal(countSyncState({...baseline,ready:false}).label,'讀取中…');
 assert.equal(countSyncState({...baseline,unavailable:true}).label,'連線待恢復');
 assert.equal(countSyncState({...baseline,auth:true,pending:3}).label,'登入需更新');
 assert.equal(countSyncState({...baseline,storageFailed:true}).attention,true);
});
test('ordinary offline, conflicts and permission errors do not request logout',()=>{
 for(const message of ['Failed to fetch','COUNT_DRAFT_CHANGED','STORE_COUNTER_REQUIRED','COUNT_SAVE_TIMEOUT'])assert.equal(countAuthRequired({message}),false);
 assert.equal(countAuthRequired({code:'PGRST303',message:'JWT expired'}),true);
});
