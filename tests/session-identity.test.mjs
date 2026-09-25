import test from 'node:test';
import assert from 'node:assert/strict';
import {sameAuthSession} from '../lib/session-identity.ts';
const token=(sid,user='owner',exp=1)=>`header.${Buffer.from(JSON.stringify({session_id:sid,sub:user,exp})).toString('base64url')}.signature`;
test('token refresh keeps the same login, a new credential login does not',()=>{
 assert(sameAuthSession(token('one'),token('one','owner',2)));
 assert(!sameAuthSession(token('one'),token('two')));
 assert(!sameAuthSession(token('one'),token('one','staff')));
 assert(!sameAuthSession(token('one'),undefined));
 assert(!sameAuthSession('bad','other'));
});
