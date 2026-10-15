export type ManagedCodeRow={id:string;store_id:string;store_name:string;kind:'ingredient'|'prep'|'dish';name:string;code:string;original_code:string;unit:string;category:string|null;aliases:string;specification:Record<string,unknown>|null;canonical_ingredient_id:string|null;target_id:string|null;editable:boolean;inactive:boolean};
export function groupManagedCodes(rows:ManagedCodeRow[]){
 const groups=new Map<string,ManagedCodeRow[]>();
 for(const row of rows){const key=`${row.kind}:${row.code||row.id}`;groups.set(key,[...(groups.get(key)||[]),row]);}
 return [...groups.entries()].map(([key,members])=>({key,members,primary:members.find(r=>r.original_code===r.code&&!r.canonical_ingredient_id&&!r.target_id)||members[0]}));
}
export function codeName(value:string){return value.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();}
export function duplicateCodeKeys(rows:ManagedCodeRow[],normalizeUnit:(unit:string)=>string){
 const names=new Map<string,ManagedCodeRow[]>();
 for(const r of rows){if(r.kind!=='ingredient'||r.inactive||!codeName(r.name))continue;const key=`${codeName(r.name)}:${normalizeUnit(r.unit)}`;names.set(key,[...(names.get(key)||[]),r]);}
 const result=new Set<string>();
 for(const members of names.values())if(new Set(members.map(r=>r.code)).size>1&&new Set(members.map(r=>r.store_id)).size>1)for(const r of members)result.add(`${r.kind}:${r.code||r.id}`);
 return result;
}
