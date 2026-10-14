import {recipeUnit,recipeFactor} from './recipe-model.ts';
export type TrialPrice={id:string;name:string;unit:string;price:number|null;revision:number;aliases:string};
export type TrialLine={ingredient_id:string;name:string;quantity:string;unit:string;price_revision:number;price:number|null;price_unit:string;amount?:number|null};
export type TrialDocument={name:string;portions:string;notes:string;lines:TrialLine[];subtotal?:number;missing?:number;per_portion?:number|null};
export type RecipeTrial={id:string;revision:number;updated_at:string;own:boolean;document:TrialDocument};
export function trialLine(price:TrialPrice):TrialLine{return {ingredient_id:price.id,name:price.name,quantity:'',unit:price.unit,price_revision:price.revision,price:price.price,price_unit:price.unit};}
export function trialAmount(line:TrialLine){const q=Number(line.quantity);return line.quantity.trim()&&Number.isFinite(q)&&q>0&&line.price!==null&&Number.isFinite(line.price)&&recipeUnit(line.unit)===recipeUnit(line.price_unit)?q*recipeFactor(line.unit)/recipeFactor(line.price_unit)*line.price:null;}
export function trialTotals(doc:TrialDocument){const amounts=doc.lines.map(trialAmount),missing=amounts.filter(v=>v===null).length,subtotal=amounts.reduce<number>((n,v)=>n+(v??0),0);return {subtotal,missing,perPortion:!missing&&doc.lines.length&&Number(doc.portions)>0?subtotal/Number(doc.portions):null};}
export function trialUnits(unit:string){return recipeUnit(unit)==='g'?[...new Set([unit,'克','公斤'])]:recipeUnit(unit)==='ml'?[...new Set([unit,'毫升','公升'])]:[unit];}
export const trialMoney=(n:number)=>new Intl.NumberFormat('zh-TW',{style:'currency',currency:'TWD',maximumFractionDigits:2}).format(n);
