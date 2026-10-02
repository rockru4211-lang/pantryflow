'use client';
import type {ComponentProps} from 'react';
import CoreRecipeEditor from './recipe-editor-core';
import {recipeUnit,type RecipeDocument} from '@/lib/recipe-cost';
export {recipeMoney} from './recipe-editor-core';
export type {RecipePriceInput} from './recipe-editor-core';
// Changing dimension is an explicit edit, never a reinterpretation of 600g as 600 rolls.
export default function RecipeEditor(props:ComponentProps<typeof CoreRecipeEditor>){
 const change=(patch:Partial<RecipeDocument>)=>{
  if(!patch.lines){props.onChange(patch);return;}
  const lines=patch.lines.map(line=>{
   const old=props.document.lines.find(item=>item.id===line.id);
   if(!old||old.recipe_id||recipeUnit(old.unit)===recipeUnit(line.unit)||old.quantity!==line.quantity)return line;
   const reference=old.quantity&&old.unit?`原用量參考：${old.quantity} ${old.unit}`:'';
   return {...line,quantity:'',note:[old.note,reference].filter(Boolean).join('；')};
  });
  props.onChange({...patch,lines});
 };
 return <CoreRecipeEditor {...props} onChange={change}/>;
}
