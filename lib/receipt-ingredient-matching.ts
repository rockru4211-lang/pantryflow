import type {ReviewDraft} from './receipt-review.ts';
export type MatchIngredient={id:string;name:string;unit:string;category:string;aliases:string[];purchase?:{unit:string;content_quantity?:number;content_unit?:string}|null};
export type IngredientBinding={supplier:string;name:string;unit:string;specification:string;ingredient_id:string;revision:number};
export type IngredientMatching={ingredients:MatchIngredient[];bindings:IngredientBinding[]};
export const emptyIngredientMatching:IngredientMatching={ingredients:[],bindings:[]};
export const matchText=(v:string)=>v.normalize('NFKC').trim().replace(/\s+/gu,' ').toLocaleLowerCase();
export const ingredientLabel=(v:string)=>v.normalize('NFKC').replace(/\s*·\s*原表計價基準:.*$/u,'').trim();
type Line=ReviewDraft['lines'][number];
export function bindingFor(catalog:IngredientMatching,supplier:string,line:Line){return catalog.bindings.find(b=>matchText(b.supplier)===matchText(supplier)&&matchText(b.name)===matchText(line.supplier_item_name||line.product_name)&&matchText(b.unit)===matchText(line.supplier_item_unit??line.unit)&&matchText(b.specification)===matchText(line.supplier_item_specification??line.specification));}
export function matchReceiptIngredient(catalog:IngredientMatching,supplier:string,line:Line){
 if(line.handling&&line.handling!=='NORMAL'||line.create_ingredient)return null;
 if(line.ingredient_id===null)return null;
 if(line.ingredient_id)return catalog.ingredients.find(i=>i.id===line.ingredient_id)||null;
 const binding=bindingFor(catalog,supplier,line);if(binding)return catalog.ingredients.find(i=>i.id===binding.ingredient_id)||null;
 const name=matchText(line.product_name),unit=matchText(line.unit);
 const hits=catalog.ingredients.filter(i=>[ingredientLabel(i.name),...i.aliases].some(n=>matchText(n)===name)&&(!unit||[i.unit,i.purchase?.unit||''].some(u=>matchText(u)===unit)));
 return hits.length===1?hits[0]:null;
}
export function chooseReceiptIngredient(line:Line,ingredient:MatchIngredient|null,catalog:IngredientMatching,supplier:string):Line{
 const binding=bindingFor(catalog,supplier,line);
 return {...line,ingredient_id:ingredient?.id||null,create_ingredient:!ingredient,
 supplier_item_name:line.supplier_item_name||line.product_name,supplier_item_unit:line.supplier_item_unit??line.unit,supplier_item_specification:line.supplier_item_specification??line.specification,
 ingredient_match_revision:binding?.revision||0,
 ...(ingredient?{product_name:ingredientLabel(ingredient.name),category:ingredient.category==='待分類'?line.category:ingredient.category,
 specification:line.specification||(ingredient.purchase?.content_quantity?`${ingredient.purchase.content_quantity}${ingredient.purchase.content_unit||''}`:''),unit:line.unit||ingredient.purchase?.unit||ingredient.unit}: {})};
}
export function clearReceiptIngredient(line:Line):Line{const next={...line};next.ingredient_id=null;next.create_ingredient=false;delete next.supplier_item_name;delete next.supplier_item_unit;delete next.supplier_item_specification;delete next.ingredient_match_revision;return next;}
export function autoMatchReceiptDraft(value:ReviewDraft,catalog:IngredientMatching):ReviewDraft{return {...value,lines:value.lines.map(line=>{if(line.ingredient_id!==undefined||line.create_ingredient)return line;const found=matchReceiptIngredient(catalog,value.supplier,line);return found?chooseReceiptIngredient(line,found,catalog,value.supplier):line;})};}
