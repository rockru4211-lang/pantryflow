import {test} from 'node:test';
import assert from 'node:assert/strict';
import {memberProvisionSucceeded} from '../lib/member-provision-result.ts';
test('pending Email invitation is success without prematurely creating membership',()=>{
  assert.equal(memberProvisionSucceeded('LOGISTICS',{inviteId:'invite-1',invited:true}),true);
  assert.equal(memberProvisionSucceeded('OWNER',{inviteId:'invite-1',pending:true}),true);
  assert.equal(memberProvisionSucceeded('SUPERVISOR',{staffId:'legacy-member'}),false);
});
test('staff creation still requires the actual staff identity',()=>{
  assert.equal(memberProvisionSucceeded('STAFF',{staffId:'staff-1'}),true);
  assert.equal(memberProvisionSucceeded('STAFF',{inviteId:'invite-1',invited:true}),false);
  assert.equal(memberProvisionSucceeded('STAFF',null),false);
});
