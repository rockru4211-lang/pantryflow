import {canonicalIngredient,canonicalIngredientGroups} from './ingredient-identity.ts';
import type {ReviewDraft} from './receipt-review.ts';
export type MatchIngredient={id:string;ingredient_code?:string;canonical_ingredient_id?:string|null;canonical_code?:string;name:string;unit:string;category:string;aliases:string[];purchase?:{unit:string;content_quantity?:number;content_unit?:string}|null};
export type IngredientBinding={supplier:string;name:string;unit:string;specification:string;ingredient_id:string;revision:number};
export type IngredientMatching={ingredients:MatchIngredient[];bindings:IngredientBinding[]};
export const emptyIngredientMatching:IngredientMatching={ingredients:[],bindings:[]};
export const matchText=(v:string)=>v.normalize('NFKC').trim().replace(/\s+/gu,' ').toLocaleLowerCase();
export const ingredientLabel=(v:string)=>v.normalize('NFKC').replace(/\s*·\s*原表計價基準:.*$/u,'').trim();
type Line=ReviewDraft['lines'][number];
export function receiptIngredientOptions(catalog:IngredientMatching){
 return canonicalIngredientGroups(catalog.ingredients).map(({row,members})=>({...row,aliases:[...new Set(members.flatMap(m=>[...(m.id!==row.id?[m.name,m.ingredient_code||'']:[]),...m.aliases].filter(Boolean)))]}));
}
function receiptCanonical(catalog:IngredientMatching,id:string){const row=catalog.ingredients.find(i=>i.id===id);return row?canonicalIngredient(catalog.ingredients,row):null;}

export function bindingFor(catalog:IngredientMatching,supplier:string,line:Line){return catalog.bindings.find(b=>matchText(b.supplier)===matchText(supplier)&&matchText(b.name)===matchText(line.supplier_item_name||line.product_name)&&matchText(b.unit)===matchText(line.supplier_item_unit??line.unit)&&matchText(b.specification)===matchText(line.supplier_item_specification??line.specification));}
export function matchReceiptIngredient(catalog:IngredientMatching,supplier:string,line:Line){
 if(line.handling&&line.handling!=='NORMAL'||line.create_ingredient)return null;
 if(line.ingredient_id===null)return null;
 if(line.ingredient_id)return receiptCanonical(catalog,line.ingredient_id);
 const binding=bindingFor(catalog,supplier,line);if(binding)return receiptCanonical(catalog,binding.ingredient_id);
 const name=matchText(line.product_name),unit=matchText(line.unit);
 const hits=catalog.ingredients.filter(i=>[ingredientLabel(i.name),...i.aliases].some(n=>matchText(n)===name)&&(!unit||[i.unit,i.purchase?.unit||''].some(u=>matchText(u)===unit)));
 const roots=[...new Map(hits.map(i=>{const root=canonicalIngredient(catalog.ingredients,i);return [root.id,root] as const;})).values()];
 return roots.length===1?roots[0]:null;
}
export function chooseReceiptIngredient(line:Line,ingredient:MatchIngredient|null,catalog:IngredientMatching,supplier:string):Line{
 const binding=bindingFor(catalog,supplier,line);
 return {...line,ingredient_id:ingredient?.id||null,create_ingredient:!ingredient,
 supplier_item_name:line.supplier_item_name||line.product_name,supplier_item_unit:line.supplier_item_unit??line.unit,supplier_item_specification:line.supplier_item_specification??line.specification,
 ingredient_match_revision:binding?.revision||0,
 ...(ingredient?{product_name:ingredientLabel(ingredient.name),category:line.categorySource==='manual'||ingredient.category==='待分類'?line.category:ingredient.category,
 specification:line.specification||(ingredient.purchase?.content_quantity?`${ingredient.purchase.content_quantity}${ingredient.purchase.content_unit||''}`:''),unit:line.unit||ingredient.purchase?.unit||ingredient.unit}: {})};
}
export function clearReceiptIngredient(line:Line):Line{const next={...line};next.ingredient_id=null;next.create_ingredient=false;delete next.supplier_item_name;delete next.supplier_item_unit;delete next.supplier_item_specification;delete next.ingredient_match_revision;return next;}
export function autoMatchReceiptDraft(value:ReviewDraft,catalog:IngredientMatching):ReviewDraft{return {...value,lines:value.lines.map(line=>{if(line.ingredient_id!==undefined||line.create_ingredient)return line;const found=matchReceiptIngredient(catalog,value.supplier,line);return found?chooseReceiptIngredient(line,found,catalog,value.supplier):line;})};}
