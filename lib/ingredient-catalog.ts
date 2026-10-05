export type IngredientAlias={id:string;name:string;unit:string;specification:string;corrected:boolean};
export type IngredientMaster={id:string;name:string;unit:string;cost_price:number|null;selected_reference:string|null;review_status:'confirmed'|'pending';revision:number;aliases:IngredientAlias[];source?:string;source_kind?:string;effective_date?:string|null;manual?:boolean};
export type IngredientCatalog={ingredients:IngredientMaster[];can_price:boolean};
export type IngredientSource={id:string;name:string;unit:string;price:number|null;source:string;source_kind?:string;effective_date:string|null;review_status:string;source_ref?:{url?:string;supplier_name?:string;review_note?:string;specification?:string};purchase?:{amount:number;quantity:number;unit:string}|null};
export type IngredientDraft={name:string;unit:string;price:string;reference:string};
export const ingredientDraft=(row?:IngredientMaster):IngredientDraft=>({name:row?.name||'',unit:row?.unit||'g',price:row?.cost_price==null?'':String(row.cost_price),reference:row?.selected_reference||''});
export function ingredientMatches(row:IngredientMaster,term:string){return [row.name,...row.aliases.flatMap(a=>[a.name,a.specification])].join(' ').normalize('NFKC').toLowerCase().includes(term.trim().normalize('NFKC').toLowerCase());}
export const ingredientPending=(row:IngredientMaster)=>row.cost_price===null||row.review_status==='pending';
export function ingredientSourceLabel(row:Pick<IngredientMaster,'source'|'source_kind'|'manual'|'selected_reference'|'cost_price'>){
 if(row.manual&&!row.selected_reference)return '人工設定';
 if(row.source?.includes('已核對進貨'))return '進貨明細';
 if(row.source?.startsWith('請購表'))return '請購表';
 if(row.source_kind==='history')return '過去食譜成本表';
 return row.source|| (row.cost_price===null?'尚無資料':'既有資料');
}
export function ingredientSourcePriority(source?:string,kind?:string){return source?.includes('已核對進貨')?0:source?.startsWith('請購表')||kind==='purchase'?1:kind==='history'?2:3;}
export function ingredientSaveData(draft:IngredientDraft,row?:IngredientMaster){
 if(!draft.name.trim())throw Error('請填食材名稱。');
 if(!draft.unit.trim())throw Error('請選計價單位。');
 const cost=draft.price.trim()===''?null:Number(draft.price);
 if(cost!==null&&(!Number.isFinite(cost)||cost<0))throw Error('成本單價需為零或正數；尚未確認可留白。');
 return {id:row?.id,revision:row?.revision,name:draft.name.trim(),unit:draft.unit,cost_price:cost,selected_reference:draft.reference||null};
}
