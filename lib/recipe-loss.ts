import {recipeEdibleFactor,recipeEdibleRate,type RecipeLine} from './recipe-model.ts';

export function recipeLossPercent(line:RecipeLine):number|null{
 const factor=recipeEdibleFactor(line);
 return factor!==null&&factor>1?(1-1/factor)*100:null;
}
export function recipeLossInput(line:RecipeLine,notes=''):string{
 const raw=recipeEdibleRate(line,notes),rate=Number(raw);
 return raw.trim()&&Number.isFinite(rate)&&rate>0&&rate<=1?String((1-rate)*100):'';
}
export function recipeLossPatch(mode:'percent'|'edible'|'weight',percent:string,gross:string,net:string,grossUnit:string,netUnit:string):Pick<RecipeLine,'edible_rate'|'quantity_basis'|'loss_setting'>{
 const numeric=(value:string)=>value.trim()&&/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())?Number(value):NaN;
 let rate:number;
 if(mode==='percent'){
  const loss=numeric(percent);
  if(!Number.isFinite(loss)||loss<0||loss>=100)throw Error('耗損率請填 0 至小於 100 的數字。');
  rate=1-loss/100;
 }else if(mode==='edible'){
  const edible=numeric(percent);
  if(!Number.isFinite(edible)||edible<=0||edible>100)throw Error('可食用率請填大於 0 至 100 的數字。');
  rate=edible/100;
 }else{
  const factors:Record<string,number>={g:1,kg:1000,'台斤':600};
  const before=numeric(gross)*factors[grossUnit],after=numeric(net)*factors[netUnit];
  if(!Number.isFinite(before)||!Number.isFinite(after)||before<=0||after<=0||after>before)throw Error('重量需大於 0，且可食用重量不能超過原料重量。');
  rate=after/before;
 }
 return {edible_rate:String(rate),quantity_basis:'net',loss_setting:mode==='weight'?{mode,gross,net,grossUnit,netUnit}:{mode,value:percent}};
}
export const clearRecipeLoss=():Pick<RecipeLine,'edible_rate'|'quantity_basis'|'loss_setting'>=>({edible_rate:'1',quantity_basis:'gross',loss_setting:null});

export const includedRecipeLoss=():Partial<RecipeLine>=>({...clearRecipeLoss(),loss_setting:{mode:'included'}});
export function recipeLossLabel(line:RecipeLine):string{
 if(line.recipe_id)return '';
 if(line.quantity_basis==='gross'&&line.loss_setting?.mode==='included')return '已含耗損';
 const loss=recipeLossPercent(line);
 return loss===null?'':`耗損 ${loss.toLocaleString('zh-TW',{maximumFractionDigits:2})}%`;
}
