import test from 'node:test';
import assert from 'node:assert/strict';
import {changedStoreAccess,loginIdentityStore,storeAccessChoices} from '../lib/store-access.ts';

test('existing memberships retain edit access; explicit view grants stay read-only',()=>{
  assert.deepEqual(storeAccessChoices([{id:'one'},{id:'two',access_mode:'VIEW'}]),{one:'EDIT',two:'VIEW'});
});
test('grant patches only change authorized stores, preserving unmanaged memberships',()=>{
  const before={one:'EDIT',two:'NONE',other:'EDIT'};
  assert.deepEqual(changedStoreAccess(['one','two'],before,{one:'EDIT',two:'VIEW',other:'NONE'}),[{store_id:'two',access_mode:'VIEW'}]);
  assert.deepEqual(changedStoreAccess(['one','two'],{one:'EDIT',two:'VIEW'},{one:'EDIT',two:'NONE'}),[{store_id:'two',access_mode:'NONE'}]);
  assert.deepEqual(changedStoreAccess(['one'],{one:'EDIT'},{one:'EDIT'}),[]);
});
test('switching data stores keeps a PIN user on the original login identity',()=>{
  const one={store_code:'1111',login_identifier:'小明'};
  const two={store_code:'2222',login_identifier:null};
  assert.equal(loginIdentityStore([one,two],two,'1111',true),one);
  assert.equal(loginIdentityStore([one,two],two,undefined,true),one);
  assert.equal(loginIdentityStore([one,two],two,'1111',false),two);
});
