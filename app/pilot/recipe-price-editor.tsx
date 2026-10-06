import type {RecipePurchase} from '@/lib/recipe-cost';

export type RecipePriceInput={recipe_id?:string;line_id?:string;recipe_revision?:number;ingredient_id?:string;ingredient_revision?:number;cost_price?:number|null;name:string;product_id:string|null;unit:string;price:number;source:string;effective_date:string|null;reference_id?:string;purchase:RecipePurchase;supplier_name?:string;supplier_id?:string|null;specification?:string;matched_product_id?:string|null};
export const recipeUnitMoney=(value:number)=>`NT$ ${value.toLocaleString('zh-TW',{minimumFractionDigits:4,maximumFractionDigits:4})}`;
