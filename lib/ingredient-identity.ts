// Identity links never rewrite historical recipe or receipt IDs.
export type IngredientIdentity={id:string;ingredient_code?:string;canonical_ingredient_id?:string|null;canonical_code?:string};
export function canonicalIngredient<T extends IngredientIdentity>(rows:T[],row:T):T{
 return (row.canonical_ingredient_id&&rows.find(r=>r.id===row.canonical_ingredient_id))||row;
}
export function canonicalIngredientGroups<T extends IngredientIdentity>(rows:T[]){
 const byId=new Map(rows.map(r=>[r.id,r]));
 const groups=new Map<string,{row:T;members:T[]}>();
 for(const member of rows){const row=(member.canonical_ingredient_id&&byId.get(member.canonical_ingredient_id))||member;const group=groups.get(row.id)||{row,members:[]};group.members.push(member);groups.set(row.id,group);}
 return [...groups.values()];
}
