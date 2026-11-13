import {purchaseUnitPrice} from './cost-price.ts';
import {recipeFactor, recipeUnit, type RecipePurchase} from './recipe-model.ts';

export const drinkPosFormats = [
 {key:'bottle', label:'整瓶'},
 {key:'half', label:'半瓶'},
 {key:'glass', label:'單杯'},
] as const;
export type DrinkPosFormat = (typeof drinkPosFormats)[number]['key'];
export type DrinkPosMapping = Partial<Record<DrinkPosFormat,string>> & {bottleMl?:number;glassMl?:number};
export type PosMapping<T> = {target_id:string;scope:string;mapping:T;revision:number};

export function recipePosName(rows:PosMapping<string>[], recipeId:string, menuId:string){
 return rows.find(row=>row.target_id===recipeId&&row.scope===menuId)?.mapping??'';
}

export function posBottleCapacity(purchase:RecipePurchase|null|undefined){
 const unit=purchase?.content_unit||'';
 return purchase?.unit==='瓶'&&recipeUnit(unit)==='ml'&&purchase.content_quantity&&purchase.content_quantity>0
  ?purchase.content_quantity*recipeFactor(unit):undefined;
}

export function drinkPosCost(purchase:RecipePurchase|null|undefined, mapping:DrinkPosMapping, format:DrinkPosFormat){
 if(!mapping[format]?.trim()||!purchase)return null;
 const bottleMl=mapping.bottleMl??posBottleCapacity(purchase);
 const bottle=purchaseUnitPrice(purchase,'瓶')??(recipeUnit(purchase.unit)==='ml'&&bottleMl
  ? (purchaseUnitPrice(purchase,'ml')??NaN)*bottleMl : NaN);
 if(!Number.isFinite(bottle))return null;
 if(format==='bottle')return bottle;
 if(format==='half')return bottle/2;
 const glassMl=mapping.glassMl;
 return bottleMl&&glassMl&&glassMl<=bottleMl?bottle*glassMl/bottleMl:null;
}
