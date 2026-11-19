import test from 'node:test';
import assert from 'node:assert/strict';
import {assertDatabaseIsolation} from '../scripts/database-isolation.mjs';
const target={canonicalBranch:'main',workerName:'pantryflow',appUrl:'https://pantryflow.rockru4211.workers.dev/',supabaseProject:'abcdefghijklmnopqrst',databaseIsolation:{status:'ready',protectedProject:'qckwzwyeqpuqogbydvvl',targetProduct:'xu-chain'}};
test('release requires a verified separate database and the Xu hosting target',()=>{
  assert.doesNotThrow(()=>assertDatabaseIsolation(target));
  for(const invalid of [
    {...target,databaseIsolation:undefined},
    {...target,databaseIsolation:{...target.databaseIsolation,status:'pending'}},
    {...target,supabaseProject:target.databaseIsolation.protectedProject},
    {...target,supabaseProject:''},
    {...target,canonicalBranch:'beape'},
    {...target,workerName:'beape-ops'},
    {...target,appUrl:'https://beape-ops.rockru4211.workers.dev/'},
  ])assert.throws(()=>assertDatabaseIsolation(invalid),/停止發布/);
});
