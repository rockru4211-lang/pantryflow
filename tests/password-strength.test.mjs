import test from 'node:test';import assert from 'node:assert/strict';
import {assessPassword} from '../lib/password-strength.ts';
test('common, numeric and repeating passwords remain weak despite mixed characters or length',()=>{
 for(const value of ['Password123!','P@ssw0rd2026!','Dragon123456!','123456789Aa!','welcome12345','1111111111111111','1234567890123456','Ab1!Ab1!Ab1!','short'])assert.equal(assessPassword(value).level,'弱',value);
});
test('long distinct passwords can be strong; eight-character passwords receive improvements',()=>{
 assert.equal(assessPassword('j9Q!s2Lx').level,'中');assert.match(assessPassword('j9Q!s2Lx').tips.join(' '),/10 個字元/);
 assert.equal(assessPassword('m7R!k2W@v9Z#').level,'強');assert.equal(assessPassword('orchard river lantern violet').level,'強');
 assert.match(assessPassword('m7R!k2W@v9Z#').tips.join(' '),/不要與其他服務重複使用/);
});
test('local assessment has no network or persistence dependency',()=>{
 const oldFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('password assessment must not transmit');};
 try{assert.equal(assessPassword('m7R!k2W@v9Z#').score,3);assert.equal(assessPassword('密碼').score,1);}finally{globalThis.fetch=oldFetch;}
});
