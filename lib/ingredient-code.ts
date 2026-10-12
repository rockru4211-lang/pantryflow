import {canonicalIngredient} from './ingredient-identity.ts';
import type {PriceIngredient} from './ingredient-price-sheet.ts';
import {priceEdit} from './ingredient-price-sheet.ts';
import type {RecipeLine,RecipeWorkspace} from './recipe-model.ts';
export function resolveIngredientImport(rows:PriceIngredient[],item:Record<string,unknown>){
 const id=String(item['識別碼']||'').trim(),code=String(item['食材編碼']||'').trim();
 const row=id?rows.find(r=>r.id===id):code?rows.find(r=>r.ingredient_code===code):rows.find(r=>r.name===String(item['食材']||item['食材名稱']||'').trim()&&priceEdit(r).unit===String(item['單位']||''));
 if((id||code)&&!row)throw Error('檔案含其他門市或不存在的食材編碼／識別碼。');
 if(code&&row?.ingredient_code!==code)throw Error('食材編碼與識別碼不一致，請核對後再匯入。');
 return row?canonicalIngredient(rows,row):row;
}
export function recipeIngredientCode(line:RecipeLine,workspace:RecipeWorkspace){
 const row=line.ingredient_id?workspace.ingredients?.find(r=>r.id===line.ingredient_id):undefined;
 return row?.canonical_code||row?.ingredient_code||'';
}
