import test from 'node:test';
import assert from 'node:assert/strict';
import {trialAmount,trialTotals,trialLine} from '../lib/mobile-recipe-trials.ts';
import {repairDirectory,repairLineLink} from '../lib/mobile-repair-directory.ts';
test('trial conversions, zero prices and incomplete totals stay distinct',()=>{
 const p={id:'1',name:'米',unit:'g',price:0.1,revision:1,aliases:''};
 const line={...trialLine(p),quantity:'0.5',unit:'公斤'};
 assert.equal(trialAmount(line),50);
 assert.equal(trialAmount({...line,unit:'毫升'}),null);
 assert.equal(trialAmount({...line,price:0}),0);
 assert.equal(trialAmount({...line,quantity:''}),null);
 assert.equal(trialAmount({...line,price:null}),null);
 assert.deepEqual(trialTotals({name:'新菜',notes:'',portions:'2',lines:[line,{...line,price:null}]}),{subtotal:50,missing:1,perPortion:null});
 assert.deepEqual(trialTotals({name:'新菜',notes:'',portions:'2',lines:[line]}),{subtotal:50,missing:0,perPortion:25});
 assert.equal(trialAmount({...line,price:100,price_unit:'公斤'}),50);
});
test('equipment search excludes food suppliers, historical repairs and disabled vendors',()=>{
 const row={id:'1',name:'冷凍服務',category:'設備資料',summary:'服務事項：冰箱、冷凍櫃\n聯絡人：技師\n電話：02-12345678',link:'',note:'',archived:false,revision:1};
 const rows=[row,{...row,id:'2',archived:true},{...row,id:'3',is_removed:true},{...row,id:'4',category:'維修紀錄'},{...row,id:'5',category:'食材'}];
 assert.equal(repairDirectory(rows,'冰箱').length,1);
 assert.equal(repairDirectory(rows,'技師')[0].phone,'02-12345678');
 assert.equal(repairDirectory(rows,'洗碗機').length,0);
 assert.equal(repairLineLink('https://docs.google.com/x'),null);
 assert.equal(repairLineLink('LINE 名稱'),null);
 assert.equal(repairLineLink('https://line.me.evil.test/x'),null);
 assert.equal(repairLineLink('LINE：https://lin.ee/abc'),'https://lin.ee/abc');
});

test('mobile trial lines carry the full automatic quote without changing saved snapshots',()=>{
 const current_quote={price:.2,unit:'g',basis:'receipt',reference_id:'receipt:1',date:'2026-11-11',source:'已確認建檔進貨'};
 const p={id:'1',name:'米',unit:'g',price:.2,revision:1,aliases:'',current_quote};
 const line=trialLine(p);assert.equal(line.expected_cost_quote,current_quote);
 const saved={...line,quantity:'100'};assert.equal(trialAmount(saved),20);
 const refreshed=trialLine({...p,price:.3,current_quote:{...current_quote,price:.3,reference_id:'receipt:2'}});
 assert.equal(refreshed.price,.3);assert.equal(saved.price,.2);assert.equal(saved.expected_cost_quote.reference_id,'receipt:1');
 assert.equal(trialLine({...p,price:null,current_quote:{price:null,reason:'規格衝突'}}).expected_cost_quote.price,null);
 assert.equal(trialLine({...p,price:0,current_quote:{price:0}}).price,0);
});
