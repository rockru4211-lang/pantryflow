export type RecipeLine={id:string;name:string;quantity:string;unit:string;product_id?:string;recipe_id?:string};
export type RecipeDocument={name:string;kind:'dish'|'prep';yield:string;unit:string;lines:RecipeLine[];notes:string;photo?:string;source_name?:string};
export type RecipePrice={key:string;name:string;product_id:string|null;unit:string;price:number;source:string;effective_date:string;supplier_name?:string};
export type RecipeCost={total:number|null;subtotal:number;missing:number;lines:{id:string;amount:number|null;reason:string|null;price:RecipePrice|null}[]};
export type RecipeCard={id:string;revision:number;document:RecipeDocument;updated_at:string;cost:RecipeCost};
export type RecipeWorkspace={recipes:RecipeCard[];products:{id:string;name:string;unit:string;specification?:string}[];prices:RecipePrice[];can_price:boolean};
export function recipeUnit(unit:string){const u=unit.trim().toLowerCase();return ['g','kg','公克','克','公斤','斤','台斤'].includes(u)?'g':['ml','l','毫升','公升'].includes(u)?'ml':u;}
export function recipeFactor(unit:string){const u=unit.trim().toLowerCase();return ['kg','公斤','l','公升'].includes(u)?1000:['斤','台斤'].includes(u)?600:1;}
export function recipeCost(doc:RecipeDocument,workspace:RecipeWorkspace,visited:string[]=[]):RecipeCost{
 const lines:RecipeCost['lines']=doc.lines.map(line=>{
  let amount:number|null=null,reason:string|null=null,price:RecipePrice|null=null;
  const q=Number(line.quantity);
  if(!Number.isFinite(q)||q<=0||!line.unit.trim())reason='待填用量';
  else if(line.recipe_id){
   const child=workspace.recipes.find(r=>r.id===line.recipe_id);
   if(!child||visited.includes(child.id)||visited.length>20)reason='備料引用無效或循環';
   else{
    const cost=recipeCost(child.document,workspace,[...visited,child.id]);const yieldQty=Number(child.document.yield);
    if(cost.total===null)reason='備料成本未完整';
    else if(!Number.isFinite(yieldQty)||yieldQty<=0)reason='待填製成量';
    else if(recipeUnit(child.document.unit)!==recipeUnit(line.unit))reason='待確認單位換算';
    else amount=cost.total*q*recipeFactor(line.unit)/(yieldQty*recipeFactor(child.document.unit));
   }
  }else{
   const key=line.product_id?`p:${line.product_id}`:`n:${line.name.trim().toLowerCase()}`;
   price=workspace.prices.find(p=>p.key===key&&p.unit===recipeUnit(line.unit))||null;
   if(!price||!Number.isFinite(Number(price.price))||Number(price.price)<0)reason='待補價格或換算';
   else amount=Number(price.price)*q*recipeFactor(line.unit);
  }
  return{id:line.id,amount,reason,price};
 });
 const missing=lines.length?lines.filter(l=>l.amount===null).length:1;
 const subtotal=lines.reduce((n,l)=>n+(l.amount??0),0);
 return{lines,missing,subtotal,total:missing?null:subtotal};
}
export const emptyRecipe=():RecipeDocument=>({name:'',kind:'dish',yield:'1',unit:'份',lines:[],notes:''});
// Import is an editable draft. Preserve source text; never silently infer yields or discard unresolved text.
export function parseRecipeText(text:string,name:string):RecipeDocument[]{
 const sections=text.split(/(?=【[^】]+】)/).filter(s=>s.trim());
 const docs:RecipeDocument[]=[];
 for(const section of sections){
  const heading=section.match(/^【([^】]+)】/);const yieldMatch=section.match(/製成\s*([\d,.]+)\s*(g|ml|公斤|公克|克|份)/i);
  const body=section.replace(/^【[^】]+】/,'').replace(/製成\s*[\d,.]+\s*(?:g|ml|公斤|公克|克|份)/i,'').replace(/一份(?:量)?\s*[\d,.]+\s*(?:g|ml|份)/gi,'');
  const lines:RecipeLine[]=[];
  for(const raw of body.split(/\n/)){
   const m=raw.trim().match(/^(.+?)\s*([\d,.]+)\s*(kg|ml|g|公克|公斤|克|顆|片|份|瓶|包|L)(?:\s*\([^)]*\))?\s*$/i);
   if(m)lines.push({id:crypto.randomUUID(),name:m[1].trim(),quantity:m[2].replaceAll(',',''),unit:m[3]});
  }
  if(!heading&&!lines.length)continue;
  docs.push({name:heading?heading[1]:name,kind:yieldMatch?'prep':'dish',yield:yieldMatch?yieldMatch[1].replaceAll(',',''):'',unit:yieldMatch?yieldMatch[2]:'份',lines,notes:section.trim(),source_name:name});
 }
 return docs.length?docs:[{...emptyRecipe(),name,notes:text,source_name:name}];
}
