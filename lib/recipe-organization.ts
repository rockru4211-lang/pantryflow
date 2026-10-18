import {recipeDisplayName,type RecipeDocument,type RecipeCard} from './recipe-model.ts';
export type RecipeMenu={id:string;name:string;state:'draft'|'active'|'closed';revision:number};
export type RecipeLifecycle='unset'|'ready'|'serving'|'research'|'reserve'|'archived';
export const lifecycleLabels:Record<RecipeLifecycle,string>={unset:'待確認',ready:'待上線',serving:'使用中',reserve:'季節備用',archived:'舊食譜',research:'未送確認'};
export const menuStateLabels={draft:'規劃中',active:'供應中',closed:'已結束'};
export function recipeCategory(doc:RecipeDocument){return doc.category?.trim()||doc.source_category?.trim()||'待分類';}
export function recipeLifecycle(doc:RecipeDocument,menus:RecipeMenu[]):RecipeLifecycle{
 if(doc.lifecycle&&doc.lifecycle!=='menu')return doc.lifecycle;
 const memberships=menus.filter(m=>doc.menu_ids?.includes(m.id));
 if(memberships.some(m=>m.state==='active'))return 'serving';
 if(memberships.some(m=>m.state==='draft'))return 'research';
 if(memberships.length)return 'archived';
 if(doc.source_status?.includes('舊菜'))return 'archived';
 if(doc.source_sheet_hidden||doc.source_status?.includes('原表隱藏'))return 'reserve';
 return 'unset';
}
export function recipeDirectoryMatches(card:RecipeCard,recipes:RecipeCard[],term:string){
 const query=term.trim().toLocaleLowerCase();if(!query)return true;
 const seen=new Set<string>();
 const visit=(r:RecipeCard):boolean=>{
  if(seen.has(r.id))return false;seen.add(r.id);
  if([recipeDisplayName(r.document),r.document.name,recipeCategory(r.document),r.recipe_code||'',r.document.season||'',...r.document.lines.map(l=>l.name)].some(s=>s.toLocaleLowerCase().includes(query)))return true;
  const children=new Set([...r.document.lines.flatMap(l=>l.recipe_id?[l.recipe_id]:[]),...(r.document.component_order||[])]);
  return recipes.some(c=>children.has(c.id)&&visit(c));
 };return visit(card);
}

export const recipeSeasons=['全年','春季','夏季','秋季','冬季'] as const;
export const recipeStatusTabs:RecipeLifecycle[]=['unset','ready','serving','reserve','archived'];
export function canApproveRecipe(store:{role:string;access_mode?:string}){return store.access_mode!=='VIEW'&&['OWNER','SUPERVISOR'].includes(store.role);}
