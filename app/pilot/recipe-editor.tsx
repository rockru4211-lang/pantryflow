'use client';
import type {ComponentProps} from 'react';
import CoreRecipeEditor from './recipe-editor-core';
import {type RecipeDocument,type TransferredRecipeLine} from '@/lib/recipe-cost';
export {recipeMoney} from './recipe-editor-core';
export type {RecipePriceInput} from './recipe-editor-core';
export default function RecipeEditor(props:ComponentProps<typeof CoreRecipeEditor>){
 const change=(patch:Partial<RecipeDocument>)=>{
  if(!patch.lines){props.onChange(patch);return;}
  const lines=patch.lines.map(line=>{
   const old=props.document.lines.find(item=>item.id===line.id);const next:TransferredRecipeLine={...line};
   if(old&&(old.name!==line.name||old.product_id!==line.product_id||old.recipe_id!==line.recipe_id)){delete next.transfer_prices;delete next.transfer_price_at;}
   return next;
  });
  props.onChange({...patch,lines});
 };
 return <CoreRecipeEditor {...props} onChange={change}/>;
}
