import {recipeDisplayName,type RecipeDocument,type RecipeCard} from './recipe-model.ts';
export type RecipeMenu={id:string;name:string;state:'draft'|'active'|'closed';revision:number};
export type RecipeLifecycle='unset'|'ready'|'serving'|'unused'|'research'|'reserve'|'archived';
export const lifecycleLabels:Record<RecipeLifecycle,string>={unset:'待設定',ready:'待上市',serving:'使用中',unused:'未使用',reserve:'待設定',archived:'舊食譜',research:'待設定'};
export const menuStateLabels={draft:'規劃中',active:'供應中',closed:'已結束'};
export function recipeCategory(doc:RecipeDocument){return doc.category?.trim()||doc.source_category?.trim()||'待分類';}
// Usage is an explicit choice, not an approval or inferred menu state.
// Legacy uncertain values remain stored unchanged until an editor chooses.
export function recipeLifecycle(doc:RecipeDocument,_menus:RecipeMenu[]=[]):RecipeLifecycle{
 void _menus;
 if(doc.lifecycle&&['ready','serving','unused','archived'].includes(doc.lifecycle))return doc.lifecycle as RecipeLifecycle;
 if(!doc.lifecycle&&doc.source_status?.includes('舊菜'))return 'archived';
 return 'unset';
}
export function recipeLegacyStatus(doc:RecipeDocument):string{
 if(recipeLifecycle(doc)!=='unset')return '';
 if(doc.lifecycle==='menu')return '原狀態：依菜單分類';
 if(doc.lifecycle==='research')return '原狀態：未送確認';
 if(doc.lifecycle==='reserve'||doc.source_sheet_hidden||doc.source_status?.includes('原表隱藏'))return '原狀態：季節備用';
 return '原狀態：待確認';
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
export const recipeStatusTabs:RecipeLifecycle[]=['serving','unused','archived','ready'];
