export type IngredientAlias={id:string;name:string;unit:string;specification:string;corrected:boolean};
export type IngredientMaster={id:string;name:string;unit:string;cost_price:number|null;selected_reference:string|null;review_status:'confirmed'|'pending';revision:number;aliases:IngredientAlias[]};
export type IngredientCatalog={ingredients:IngredientMaster[];can_price:boolean};
export type IngredientSource={id:string;name:string;unit:string;price:number|null;source:string;effective_date:string|null;review_status:string;source_ref?:{url?:string;supplier_name?:string;review_note?:string;specification?:string};purchase?:{amount:number;quantity:number;unit:string}|null};
export type IngredientDraft={name:string;unit:string;price:string;reference:string};
export const ingredientDraft=(row?:IngredientMaster):IngredientDraft=>({name:row?.name||'',unit:row?.unit||'g',price:row?.cost_price==null?'':String(row.cost_price),reference:row?.selected_reference||''});
export function ingredientMatches(row:IngredientMaster,term:string){return [row.name,...row.aliases.flatMap(a=>[a.name,a.specification])].join(' ').normalize('NFKC').toLowerCase().includes(term.trim().normalize('NFKC').toLowerCase());}
export const ingredientPending=(row:IngredientMaster)=>row.cost_price===null||row.review_status==='pending';
export function ingredientSaveData(draft:IngredientDraft,row?:IngredientMaster){
 if(!draft.name.trim())throw Error('請填食材名稱。');
 if(!draft.unit.trim())throw Error('請選計價單位。');
 const cost=draft.price.trim()===''?null:Number(draft.price);
 if(cost!==null&&(!Number.isFinite(cost)||cost<0))throw Error('成本單價需為零或正數；尚未確認可留白。');
 return {id:row?.id,revision:row?.revision,name:draft.name.trim(),unit:draft.unit,cost_price:cost,selected_reference:draft.reference||null};
}
