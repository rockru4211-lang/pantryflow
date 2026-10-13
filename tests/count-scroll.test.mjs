import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreCountScroll} from '../lib/count-scroll.ts';

test('restoring a count row scrolls only the list, leaving outer navigation in place',()=>{
 const calls=[];
 const scroller={scrollTop:200,clientHeight:500,scrollHeight:2000,getBoundingClientRect:()=>({top:180}),scrollTo:value=>calls.push(value)};
 const target={getBoundingClientRect:()=>({top:900,height:44}),scrollIntoView:()=>assert.fail('must not scroll page ancestors')};
 restoreCountScroll(scroller,target);
 assert.deepEqual(calls,[{top:692,behavior:'instant'}]);
 restoreCountScroll(scroller);
 assert.deepEqual(calls[1],{top:0,behavior:'instant'});
});

test('short lists and first or last rows cannot restore outside the list bounds',()=>{
 const calls=[];
 const scroller={scrollTop:0,clientHeight:500,scrollHeight:600,getBoundingClientRect:()=>({top:180}),scrollTo:value=>calls.push(value.top)};
 for(const top of [180,2000])restoreCountScroll(scroller,{getBoundingClientRect:()=>({top,height:44})});
 assert.deepEqual(calls,[0,100]);
 restoreCountScroll(null);
});
