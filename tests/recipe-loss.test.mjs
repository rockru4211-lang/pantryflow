import test from 'node:test';
import assert from 'node:assert/strict';
import {recipeLossPatch,recipeLossInput,recipeLossPercent,clearRecipeLoss} from '../lib/recipe-loss.ts';
import {recipeCost,emptyRecipe} from '../lib/recipe-cost.ts';
const line={id:'beef',name:'牛肉',quantity:'300',unit:'g'};
const doc={...emptyRecipe(),name:'牛排',lines:[line,{id:'butter',name:'奶油',quantity:'20',unit:'g'}]};
const workspace={recipes:[],products:[],prices:[{key:'n:牛肉',unit:'g',price:.95},{key:'n:奶油',unit:'g',price:.4}]};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} ~= ${b}`);
test('optional loss uses raw price by default, adjusts only selected ingredient and clears',()=>{
 close(recipeCost(doc,workspace).total,293);assert.equal(recipeLossPercent(line),null);
 const patched={...line,...recipeLossPatch('percent','24','','','g','g')};
 close(recipeCost({...doc,lines:[patched,doc.lines[1]]},workspace).total,383);
 close(recipeCost({...doc,lines:[{...patched,...clearRecipeLoss()},doc.lines[1]]},workspace).total,293);
 assert.equal(recipeLossPercent({...patched,...clearRecipeLoss()}),null);
});
test('weight conversion retains full precision across grams kilograms and Taiwan catties',()=>{
 for(const gross of [['3.55','kg'],['3550','g']]){
  const patched={...line,...recipeLossPatch('weight','',gross[0],'2700',gross[1],'g')};
  close(recipeCost({...doc,lines:[patched]},workspace).total,3372.5/2700*300);
 }
 close(Number(recipeLossPatch('weight','','1','450','台斤','g').edible_rate),.75);
});
test('zero loss is valid; impossible or incomplete loss inputs cannot overwrite a recipe',()=>{
 assert.equal(recipeLossPatch('percent','0','','','g','g').edible_rate,'1');
 for(const p of ['','-1','100','101','Infinity','24x'])assert.throws(()=>recipeLossPatch('percent',p,'','','g','g'));
 for(const [a,b,u] of [['','1','g'],['0','1','g'],['10','11','g'],['10','0','g'],['10','1','ml']])assert.throws(()=>recipeLossPatch('weight','',a,b,u,'g'));
 assert.equal(recipeLossInput({...line,edible_rate:'.96'}).slice(0,1),'4');
 assert.equal(recipeLossInput({...line,note:'可食用率 0.96'}).slice(0,1),'4');
});
test('saved costs preserve price and only apply changed loss once after reopening',()=>{
 const patched={...doc,lines:[{...line,...recipeLossPatch('percent','24','','','g','g')}]};
 const cost=recipeCost(patched,workspace);close(cost.total,375);
 const saved=JSON.parse(JSON.stringify(patched));
 const locked={...workspace,prices:[{key:'n:牛肉',unit:'g',price:8}],recipes:[{id:'r',document:saved,approved_cost:{document:saved,cost}}]};
 close(recipeCost(saved,locked,['r']).total,375);
 close(recipeCost({...saved,lines:[{...saved.lines[0],...recipeLossPatch('percent','24','','','g','g')}]},locked,['r']).total,375);
 close(recipeCost({...saved,lines:[{...saved.lines[0],...clearRecipeLoss()}]},locked,['r']).total,285);
});
test('component yield does not add the same loss again',()=>{
 const prep={...emptyRecipe(),kind:'prep',yield:'2700',unit:'g',lines:[{...line,quantity:'3550'}]};
 const ws={...workspace,recipes:[{id:'prep',document:prep}]};
 const meal={...emptyRecipe(),lines:[{...line,recipe_id:'prep',...recipeLossPatch('percent','24','','','g','g')}]};
 close(recipeCost(meal,ws).total,3372.5/2700*300);
});

test('edible rate agrees with loss rate and an included allowance never gets charged twice',async()=>{
 const {includedRecipeLoss,recipeLossLabel}=await import('../lib/recipe-loss.ts');
 const edible={...line,quantity:'180',...recipeLossPatch('edible','75','','','g','g')};
 const percent={...line,quantity:'180',...recipeLossPatch('percent','25','','','g','g')};
 close(recipeCost({...doc,lines:[edible]},workspace).total,228);
 close(recipeCost({...doc,lines:[percent]},workspace).total,228);
 const included={...edible,quantity:'250',...includedRecipeLoss()};
 close(recipeCost({...doc,lines:[included]},workspace).total,237.5);
 assert.equal(recipeLossLabel(included),'已含耗損');
 for(const rate of ['0','101','','-2'])assert.throws(()=>recipeLossPatch('edible',rate,'','','g','g'));
 const saved={...doc,lines:[included]},cost=recipeCost(saved,workspace);
 const locked={...workspace,prices:[{key:'n:牛肉',unit:'g',price:8}],recipes:[{id:'r',document:saved,approved_cost:{document:saved,cost}}]};
 close(recipeCost(JSON.parse(JSON.stringify(saved)),locked,['r']).total,237.5);
 close(recipeCost({...saved,lines:[{...included,note:'去筋膜'}]},locked,['r']).total,237.5);
});
