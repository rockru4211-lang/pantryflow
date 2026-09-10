import test from 'node:test';
import assert from 'node:assert/strict';
import {writeLoginMemory,readLoginMemory,clearLoginMemory,devicePolicySummary} from '../lib/login-device.ts';
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
const base={storeCode:'QA',storeName:'QA store',loginMode:'NAME_OR_NICKNAME',identifier:'staff',displayName:'Employee',email:'qa@example.test',policy:{authorized:true,device_type:'PERSONAL',remember_device:true,reauth_days:7}};
test('only an authorized personal device retains identity hints',()=>{const s=storage();writeLoginMemory(base,s);assert.equal(readLoginMemory(s).identifier,'staff');for(const policy of [{...base.policy,device_type:'SHARED'},{...base.policy,authorized:false},{...base.policy,remember_device:false}]){writeLoginMemory({...base,policy},s);const saved=readLoginMemory(s);assert.equal(saved.storeCode,'QA');assert.equal(saved.identifier,undefined);assert.equal(saved.email,undefined);}clearLoginMemory(s);assert.equal(readLoginMemory(s),null);});
test('PIN policy describes each-time validation without editable controls',()=>{assert.match(devicePolicySummary({...base.policy,reauth_days:0}),/每次重新驗證/);assert.match(devicePolicySummary({...base.policy,device_type:'SHARED'}),/只記住門市/);});
