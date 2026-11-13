import assert from 'node:assert/strict';
import test from 'node:test';
import {drinkPosCost,recipePosName,recipePosNameLines} from '../lib/pos-cost.ts';

test('seasonal POS names are scoped to the selected menu',()=>{
 const rows=[
  {target_id:'recipe',scope:'',mapping:'單點豬排',revision:1},
  {target_id:'recipe',scope:'winter',mapping:'秋冬豬排',revision:1},
 ];
 assert.equal(recipePosName(rows,'recipe',''),'單點豬排');
 assert.equal(recipePosName(rows,'recipe','winter'),'秋冬豬排');
 assert.equal(recipePosName(rows,'recipe','spring'),'');
});

test('bilingual POS names show the English translation on a separate line',()=>{
 assert.deepEqual(recipePosNameLines('奶油香煎海鰻魚 Butter-seared conger eel'),['奶油香煎海鰻魚','Butter-seared conger eel']);
 assert.deepEqual(recipePosNameLines('酒館脆脆細薯French fries'),['酒館脆脆細薯','French fries']);
 assert.deepEqual(recipePosNameLines('迷你羅曼凱薩沙拉 V2'),['迷你羅曼凱薩沙拉 V2']);
 assert.deepEqual(recipePosNameLines('Aperol Spritz 艾普羅泡泡'),['Aperol Spritz 艾普羅泡泡']);
});

test('drink formats share the purchase price and require known serving units',()=>{
 const purchase={amount:765,quantity:1,unit:'瓶',content_quantity:0.75,content_unit:'L'};
 const mapping={bottle:'整瓶',half:'半瓶',glass:'單杯'};
 assert.equal(drinkPosCost(purchase,mapping,'bottle'),765);
 assert.equal(drinkPosCost(purchase,mapping,'half'),382.5);
 assert.equal(drinkPosCost(purchase,mapping,'glass'),null);
 assert.equal(drinkPosCost(purchase,{...mapping,glassMl:150},'glass'),153);
 assert.equal(drinkPosCost(purchase,{...mapping,glassMl:800},'glass'),null);
 assert.equal(drinkPosCost(purchase,{},'bottle'),null);
 assert.equal(drinkPosCost({amount:765,quantity:1,unit:'箱'},mapping,'half'),null);
 assert.equal(drinkPosCost({amount:765,quantity:1,unit:'ml'},mapping,'bottle'),null);
 assert.equal(drinkPosCost({amount:4590,quantity:1,unit:'箱',content_quantity:6,content_unit:'瓶'},mapping,'bottle'),765);
 assert.equal(drinkPosCost({amount:765,quantity:750,unit:'ml'},{...mapping,bottleMl:750,glassMl:150},'glass'),153);
});
