import test from 'node:test';
import assert from 'node:assert/strict';
import {canData,viewAccess} from '../lib/data-access.ts';
test('optional field data defaults denied regardless of supervisor title',()=>{
 for(const role of ['STAFF','SUPERVISOR']){
  const store={role,work_functions:['FIELD']};
  for(const view of ['recipes','suppliers','spot-check','equipment','inventory-monthly','reports'])assert.equal(viewAccess(store,view),false,view);
  for(const view of ['count','receiving','transfers','waste'])assert.equal(viewAccess(store,view),true,view);
 }
});
test('view and edit permissions are independent and read-only store wins',()=>{
 const store={role:'SUPERVISOR',data_access:{SPOT:{view:true,edit:true},RECIPE:{view:true,edit:false}}};
 assert.equal(viewAccess(store,'spot-check'),true);assert.equal(canData(store,'RECIPE',true),false);
 assert.equal(canData({...store,access_mode:'VIEW'},'SPOT',true),false);
 assert.equal(viewAccess({...store,data_access:{}},'spot-check'),false);
});
