import {ingredientDraft,ingredientPurchase,type IngredientMaster,type IngredientSource,type IngredientDraft} from './ingredient-catalog.ts';
export type SupplyState={ingredient_id:string;supplier_key:string;supplier_name:string;stopped:boolean;reason:string;disposition:string;note:string;revision:number;updated_at:string};
export type SupplyEvent={id:string;ingredient_id:string;supplier_key:string;supplier_name:string;action:'stop'|'restore';reason:string;disposition:string;note:string;created_at:string;actor_id:string;actor_name?:string;snapshot:IngredientMaster};
export type PriceIngredient=IngredientMaster&{supplier_id?:string|null;supplier_name?:string;supplier_key?:string;sources?:PriceSource[];dismissed_reference?:string;dismissed_value?:number};
export type PriceSource=IngredientSource&{supplier_key:string;supplier_name:string;created_at?:string;can_apply?:boolean};
export type StandardHistory={id:string;ingredient_id:string;effective_date:string;reason:string;actor_name:string;snapshot:IngredientMaster;created_at:string};
export type PriceSheetData={price_history?:StandardHistory[];ingredients:PriceIngredient[];can_price:boolean;supply_states:SupplyState[];supply_events:SupplyEvent[];suppliers:{id:string;name:string;active:boolean}[]};
export const emptyPriceSheet:PriceSheetData={ingredients:[],can_price:false,supply_states:[],supply_events:[],suppliers:[]};
export function isIngredientStopped(row:IngredientMaster,states:SupplyState[]){return states.some(s=>s.ingredient_id===row.id&&s.supplier_key==='*'&&s.stopped);}
export function priceCandidate(row:PriceIngredient,states:SupplyState[]){
 if(isIngredientStopped(row,states))return null;
 const q=(row.sources||[]).filter(q=>q.can_apply!==false&&q.review_status==='confirmed'&&q.source_kind==='purchase'&&q.price!==null&&q.unit===row.unit&&(!row.effective_date||!!q.effective_date&&q.effective_date>=row.effective_date)&&!states.some(s=>s.ingredient_id===row.id&&s.supplier_key===q.supplier_key&&s.stopped)).sort((a,b)=>(b.effective_date||'').localeCompare(a.effective_date||'')||(b.created_at||'').localeCompare(a.created_at||''))[0];
 return q&&q.id!==row.selected_reference&&q.price!==row.cost_price&&!(row.dismissed_reference===q.id&&row.dismissed_value===q.price)?q:null;
}
export function supplierOptions(row:PriceIngredient){const m=new Map<string,string>();if(row.supplier_key)m.set(row.supplier_key,row.supplier_name||'未命名供應商');for(const s of row.sources||[])if(s.supplier_key)m.set(s.supplier_key,s.supplier_name||'未命名供應商');return [...m].map(([key,name])=>({key,name}));}
export function priceSearch(row:PriceIngredient,term:string){return [row.name,row.supplier_name,...row.aliases.map(a=>a.name),...(row.sources||[]).map(s=>s.supplier_name)].join(' ').normalize('NFKC').toLowerCase().includes(term.trim().normalize('NFKC').toLowerCase());}
export function candidatePurchase(row:PriceIngredient,q:PriceSource){return ingredientPurchase({...row,cost_price:q.price,unit:q.unit,purchase:q.purchase})||{amount:q.price,unit:q.unit};}
export const priceEdit=(row?:PriceIngredient)=>({...ingredientDraft(row),effective_date:new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}),change_reason:'供應商調價',supplier_id:row?.supplier_id||(row?.supplier_key?.startsWith('id:')?row.supplier_key.slice(3):'')||''});

export type PriceSheetEdit={row?:PriceIngredient;draft:IngredientDraft&{supplier_id:string};requestId:string};
