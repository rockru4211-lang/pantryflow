import {ingredientDraft,ingredientPurchase,type IngredientMaster,type IngredientSource,type IngredientDraft} from './ingredient-catalog.ts';
export type SupplyState={ingredient_id:string;supplier_key:string;supplier_name:string;stopped:boolean;reason:string;disposition:string;note:string;revision:number;updated_at:string};
export type SupplyEvent={id:string;ingredient_id:string;supplier_key:string;supplier_name:string;action:'stop'|'restore';reason:string;disposition:string;note:string;created_at:string;actor_id:string;actor_name?:string;snapshot:IngredientMaster};
export type PriceIngredient=IngredientMaster&{category?:string|null;price_date?:string|null;supplier_id?:string|null;supplier_name?:string;supplier_key?:string;sources?:PriceSource[];dismissed_reference?:string;dismissed_value?:number};
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
export const priceCategories=['食材','耗材','調料','酒水','待分類'];
export const baselineCategory=(row?:PriceIngredient)=>priceCategories.includes(row?.category||'')?row!.category!:'待分類';
export const baselinePriceDate=(row:PriceIngredient)=>row.price_date!==undefined?row.price_date||'':row.manual?'':row.effective_date||'';
export const priceEdit=(row?:PriceIngredient)=>({...ingredientDraft(row),category:baselineCategory(row),effective_date:new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}),change_reason:'供應商調價',supplier_id:row?.supplier_id||(row?.supplier_key?.startsWith('id:')?row.supplier_key.slice(3):'')||''});

export type PriceSheetEdit={row?:PriceIngredient;draft:IngredientDraft&{supplier_id:string;category?:string};requestId:string};

// Presentation grouping only. Keep every identity, saved price and recipe link intact.
export const baselineName=(name:string)=>name.normalize('NFKC').replace(/\s*·\s*原表計價基準:.*$/u,'').trim().replace(/\s+/gu,' ');
const normalizedName=(name:string)=>baselineName(name).toLocaleLowerCase();
export function baselineSourceRank(source?:string,kind?:string){
 if(source?.startsWith('請購表'))return 0;
 if(kind==='history'||source?.startsWith('歷史食譜'))return 2;
 return 1;
}
export function baselineSources(row:PriceIngredient){return [...(row.sources||[])].sort((a,b)=>baselineSourceRank(a.source,a.source_kind)-baselineSourceRank(b.source,b.source_kind)||(b.effective_date||'').localeCompare(a.effective_date||'')||a.id.localeCompare(b.id));}
export function baselinePurchaseDate(row:PriceIngredient){return [row,...(row.sources||[])].filter(s=>s.source?.startsWith('請購表')).map(s=>s.effective_date||'').sort().at(-1)||'';}
export function baselineHasPurchase(row:PriceIngredient){return [row,...(row.sources||[])].some(s=>s.source?.startsWith('請購表'));}
export function baselineHistoryOnly(row:PriceIngredient){const refs=[row,...(row.sources||[])].filter(s=>s.source||s.source_kind);return !row.manual&&refs.length>0&&refs.every(s=>baselineSourceRank(s.source,s.source_kind)===2);}
export type BaselineGroup={key:string;name:string;rows:PriceIngredient[];purchase:boolean;history:boolean;purchaseDate:string};
export function baselineGroups(rows:PriceIngredient[]):BaselineGroup[]{
 const groups=new Map<string,PriceIngredient[]>();
 for(const row of rows){
  // Real brand/package specifications and corrected aliases must not be guessed away.
  const specs=[...new Set(row.aliases.map(a=>(a.specification||'').normalize('NFKC').trim()).filter(s=>s&&!s.startsWith('原表計價基準:')))].sort();
  const purchase=ingredientPurchase(row);
  const packageKey=purchase?[purchase.unit,purchase.content_quantity||'',purchase.content_unit||'']:[];
  const key=JSON.stringify([normalizedName(row.name),row.unit,specs,packageKey,baselineCategory(row),row.aliases.some(a=>a.corrected)?row.id:'']);
  groups.set(key,[...(groups.get(key)||[]),row]);
 }
 return [...groups].map(([key,members])=>{
  const sorted=[...members].sort((a,b)=>Number(!!b.manual)-Number(!!a.manual)||Number(baselineHasPurchase(b))-Number(baselineHasPurchase(a))||baselinePurchaseDate(b).localeCompare(baselinePurchaseDate(a))||Number(b.cost_price!==null)-Number(a.cost_price!==null)||a.id.localeCompare(b.id));
  return {key,name:baselineName(sorted[0].name),rows:sorted,purchase:members.some(baselineHasPurchase),history:members.every(baselineHistoryOnly),purchaseDate:members.map(baselinePurchaseDate).sort().at(-1)||''};
 }).sort((a,b)=>Number(b.purchase)-Number(a.purchase)||Number(a.history)-Number(b.history)||b.purchaseDate.localeCompare(a.purchaseDate)||a.name.localeCompare(b.name,'zh-Hant')||a.key.localeCompare(b.key));
}
