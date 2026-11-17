import {canonicalIngredient,canonicalIngredientGroups} from './ingredient-identity.ts';
import {parsePurchaseSpecification} from './purchase-specification.ts';
import {recipeFactor,recipeUnit} from './recipe-model.ts';
import type {ReviewDraft} from './receipt-review.ts';
export type MatchIngredient={id:string;ingredient_code?:string;canonical_ingredient_id?:string|null;canonical_code?:string;name:string;unit:string;category:string;aliases:string[];recipe_aliases?:string[];purchase?:{unit:string;content_quantity?:number;content_unit?:string}|null};
export type IngredientBinding={stopped?:boolean;supplier:string;name:string;unit:string;specification:string;ingredient_id:string;revision:number};
export type IngredientMatching={ingredients:MatchIngredient[];bindings:IngredientBinding[]};
export const emptyIngredientMatching:IngredientMatching={ingredients:[],bindings:[]};
export const matchText=(v:string)=>v.normalize('NFKC').trim().replace(/\s+/gu,' ').toLocaleLowerCase();
const compactText=(v:string)=>matchText(v).replace(/\s+/gu,'');
export const ingredientLabel=(v:string)=>v.normalize('NFKC').replace(/\s*·\s*原表計價基準:.*$/u,'').trim();
type Line=ReviewDraft['lines'][number];
export function receiptIngredientOptions(catalog:IngredientMatching){
 return canonicalIngredientGroups(catalog.ingredients).map(({row,members})=>({...row,aliases:[...new Set(members.flatMap(m=>[...(m.id!==row.id?[m.name,m.ingredient_code||'']:[]),...m.aliases].filter(Boolean)))]}));
}
function receiptCanonical(catalog:IngredientMatching,id:string){const row=catalog.ingredients.find(i=>i.id===id);return row?canonicalIngredient(catalog.ingredients,row):null;}

export function bindingFor(catalog:IngredientMatching,supplier:string,line:Line){return catalog.bindings.find(b=>matchText(b.supplier)===matchText(supplier)&&matchText(b.name)===matchText(line.supplier_item_name||line.product_name)&&matchText(b.unit)===matchText(line.supplier_item_unit??line.unit)&&matchText(b.specification)===matchText(line.supplier_item_specification??line.specification));}

function packageKey(value:string){
 const spec=parsePurchaseSpecification(value);
 return spec?`${Number(spec.quantity)*recipeFactor(spec.unit)}:${recipeUnit(spec.unit)}`:compactText(value);
}

function samePurchaseBasis(binding:IngredientBinding,line:Line){
 return matchText(binding.unit)===matchText(line.supplier_item_unit??line.unit)
  &&packageKey(binding.specification)===packageKey(line.supplier_item_specification??line.specification);
}

// Undefined permits the catalog fallback. A stopped or ambiguous supplier alias does not.
function supplierAliasMatch(catalog:IngredientMatching,supplier:string,line:Line){
 const vendor=matchText(supplier),name=compactText(line.supplier_item_name||line.product_name);
 if(!vendor||!name)return undefined;
 const hits=catalog.bindings.filter(binding=>matchText(binding.supplier)===vendor&&compactText(binding.name)===name&&samePurchaseBasis(binding,line));
 if(!hits.length)return undefined;
 const roots=hits.map(binding=>binding.stopped?null:receiptCanonical(catalog,binding.ingredient_id));
 const first=roots[0];
 return first&&roots.every(root=>root?.id===first.id)?first:null;
}

// Use only a remembered supplier identity when refreshing a manually edited receipt row.
export function restoreReceiptSupplierAliases(value:ReviewDraft,catalog:IngredientMatching,supplier=value.supplier):ReviewDraft{
 const lines=value.lines.map(line=>{
  if(line.ingredient_id!==undefined||line.create_ingredient||line.ingredient_match_pending||line.handling&&line.handling!=='NORMAL')return line;
  const found=supplierAliasMatch(catalog,supplier,line);
  if(!found)return line;
  return {...chooseReceiptIngredient(line,found,catalog,supplier),product_name:line.product_name,specification:line.specification,unit:line.unit};
 });
 return lines.every((line,index)=>line===value.lines[index])?value:{...value,lines};
}

export function matchReceiptIngredient(catalog:IngredientMatching,supplier:string,line:Line){
 if(line.handling&&line.handling!=='NORMAL'||line.create_ingredient||line.ingredient_match_pending)return null;
 if(line.ingredient_id===null)return null;
 if(line.ingredient_id)return receiptCanonical(catalog,line.ingredient_id);
 const remembered=supplierAliasMatch(catalog,supplier,line);if(remembered!==undefined)return remembered;
 const name=matchText(line.product_name),unit=matchText(line.unit);
 const hits=catalog.ingredients.filter(i=>[ingredientLabel(i.name),...i.aliases].some(n=>matchText(n)===name)
  &&(!unit||[i.unit,i.purchase?.unit||''].some(u=>matchText(u)===unit))
  &&(!line.specification||!i.purchase?.content_quantity||packageKey(line.specification)===packageKey(`${i.purchase.content_quantity}${i.purchase.content_unit||''}`)));
 const roots=[...new Map(hits.map(i=>{const root=canonicalIngredient(catalog.ingredients,i);return [root.id,root] as const;})).values()];
 return roots.length===1?roots[0]:null;
}

/** Suggestions never bind a receipt. The user must choose the matching package. */
export function similarReceiptItemName(a:string,b:string){
 const keys=[compactText(a),compactText(b)].sort((left,right)=>left.length-right.length);
 const [shorter,longer]=keys;
 if(shorter.length<4||shorter===longer)return false;
 if(longer.startsWith(shorter+'·')&&/^\d+(?:\.\d+)?(?:g|kg|k|克|公斤|ml|l|毫升|公升|入|包|顆|支)$/u.test(longer.slice(shorter.length+1)))return true;
 if(longer.length-shorter.length>1)return false;
 const index=shorter.split('').findIndex((character,i)=>character!==longer[i]);
 if(index<0)return true;
 return shorter.slice(index+(shorter.length===longer.length?1:0))===longer.slice(index+1);
}

export function searchReceiptIngredients(catalog:IngredientMatching,supplier:string,line:Line,query:string,limit=6){
 const vendor=matchText(supplier),key=compactText(query);
 const options=receiptIngredientOptions(catalog);
 const canonicalIds=new Map(catalog.ingredients.map(ingredient=>[ingredient.id,ingredient.canonical_ingredient_id||ingredient.id]));
 const vendorNames=new Map<string,string[]>();
 for(const binding of catalog.bindings){
  if(!vendor||binding.stopped||matchText(binding.supplier)!==vendor||!samePurchaseBasis(binding,line))continue;
  const root=canonicalIds.get(binding.ingredient_id)||binding.ingredient_id;
  const names=vendorNames.get(root)||[];
  names.push(binding.name);
  vendorNames.set(root,names);
 }
 return options.flatMap(ingredient=>{
  const remembered=vendorNames.get(ingredient.id)||[];
  const names=[ingredientLabel(ingredient.name),...ingredient.aliases,...remembered];
  const exact=[...names,ingredient.canonical_code||'',ingredient.ingredient_code||''].some(name=>compactText(name)===key);
  const similar=!!key&&remembered.length>0&&names.some(name=>similarReceiptItemName(name,query));
  const includes=[...names,ingredient.canonical_code||'',ingredient.ingredient_code||''].some(name=>compactText(name).includes(key));
  return includes||similar?[{ingredient,similar:!exact&&similar,rank:exact?0:similar?1:2}]:[];
 }).sort((left,right)=>left.rank-right.rank).slice(0,limit);
}
export function chooseReceiptIngredient(line:Line,ingredient:MatchIngredient|null,catalog:IngredientMatching,supplier:string):Line{
 const binding=bindingFor(catalog,supplier,line);
 return {...line,remember_ingredient_alias:true,ingredient_id:ingredient?.id||null,create_ingredient:!ingredient,
 ingredient_match_pending:undefined,ingredient_status:undefined,ingredient_code:ingredient?.canonical_code||ingredient?.ingredient_code,
 supplier_item_name:line.supplier_item_name||line.product_name,supplier_item_unit:line.supplier_item_unit??line.unit,supplier_item_specification:line.supplier_item_specification??line.specification,
 ingredient_match_revision:binding?.revision||0,
 ...(ingredient?{product_name:ingredientLabel(ingredient.name),category:line.categorySource==='manual'||ingredient.category==='待分類'?line.category:ingredient.category,
 specification:line.specification||(ingredient.purchase?.content_quantity?`${ingredient.purchase.content_quantity}${ingredient.purchase.content_unit||''}`:''),unit:line.unit||ingredient.purchase?.unit||ingredient.unit}: {})};
}
export function clearReceiptIngredient(line:Line):Line{
 const next={...line,ingredient_id:null,create_ingredient:false};
 delete next.supplier_item_name;delete next.supplier_item_unit;delete next.supplier_item_specification;
 delete next.ingredient_match_revision;delete next.remember_ingredient_alias;
 delete next.ingredient_match_pending;delete next.ingredient_status;delete next.ingredient_code;
 return next;
}
export function autoMatchReceiptDraft(value:ReviewDraft,catalog:IngredientMatching):ReviewDraft{return {...value,lines:value.lines.map(line=>{if(line.ingredient_id!==undefined||line.create_ingredient)return line;const found=matchReceiptIngredient(catalog,value.supplier,line);return found?chooseReceiptIngredient(line,found,catalog,value.supplier):line;})};}
